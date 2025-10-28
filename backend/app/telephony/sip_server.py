"""Résolution de workflow pour les appels SIP entrants."""

from __future__ import annotations

import asyncio
import datetime
import logging
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from sqlalchemy.orm import Session

from chatkit.types import ThreadMetadata

from ..chatkit import get_chatkit_server
from ..chatkit_server.context import (
    ChatKitRequestContext,
    _get_wait_state_metadata,
    _set_wait_state_metadata,
)
from ..config import Settings, get_settings
from ..database import SessionLocal
from ..voice_settings import get_or_create_voice_settings
from ..workflows.executor import (
    AgentContext,
    WorkflowInput,
    run_workflow,
)
from ..workflows.service import (
    TelephonyRouteConfig,
    TelephonyRouteOverrides,
    TelephonyStartConfiguration,
    WorkflowDefinition,
    WorkflowService,
    resolve_start_telephony_config,
)

logger = logging.getLogger(__name__)


CallState = Literal["invited", "established", "terminated", "failed"]


@dataclass(slots=True)
class SipCallSession:
    """Représente l'état d'un appel SIP géré par :class:`SipCallRequestHandler`."""

    call_id: str
    request: Any
    dialog: Any | None = None
    state: CallState = "invited"
    created_at: float = field(default_factory=time.monotonic)
    rtp_started_at: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def mark_established(self) -> None:
        self.state = "established"
        self.rtp_started_at = time.monotonic()

    def mark_failed(self) -> None:
        self.state = "failed"

    def mark_terminated(self) -> None:
        self.state = "terminated"


@dataclass(frozen=True)
class TelephonyRouteResolution:
    """Résultat brut de la sélection d'une route téléphonie."""

    workflow_definition: WorkflowDefinition
    normalized_number: str
    original_number: str
    route: TelephonyRouteConfig | None


@dataclass(frozen=True)
class TelephonyCallContext(TelephonyRouteResolution):
    """Contexte complet nécessaire pour exécuter un workflow téléphonie."""

    voice_model: str | None
    voice_instructions: str | None
    voice_voice: str | None
    voice_prompt_variables: dict[str, str]
    voice_provider_id: str | None = None
    voice_provider_slug: str | None = None


@dataclass(frozen=True)
class TelephonyVoiceWorkflowResult:
    """Informations retournées après l'exécution initiale du workflow voix."""

    voice_event: Mapping[str, Any]
    metadata: Mapping[str, Any]
    resume_callback: Callable[[Sequence[Mapping[str, Any]]], Awaitable[None]]


class TelephonyRouteSelectionError(RuntimeError):
    """Signale qu'aucune route téléphonie ne correspond au numéro entrant."""


def _normalize_incoming_number(number: str) -> str:
    sanitized = "".join(
        ch for ch in str(number) if str(ch).isdigit() or ch in {"+", "#", "*"}
    )
    return sanitized


def _sanitize_prompt_variables(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    sanitized: dict[str, str] = {}
    for key, raw in value.items():
        if not isinstance(key, str):
            continue
        trimmed_key = key.strip()
        if not trimmed_key:
            continue
        if raw is None:
            sanitized[trimmed_key] = ""
        elif isinstance(raw, str):
            sanitized[trimmed_key] = raw
        else:
            sanitized[trimmed_key] = str(raw)
    return sanitized


def _build_voice_bootstrap_message(
    context: TelephonyCallContext, call_id: str
) -> str:
    """Construit le texte transmis au workflow pour amorcer l'appel."""

    parts: list[str] = ["Appel téléphonique entrant via SIP."]

    number = context.original_number or context.normalized_number
    if number:
        parts.append(f"Numéro entrant : {number}.")

    route_label = getattr(getattr(context, "route", None), "label", None)
    if isinstance(route_label, str) and route_label.strip():
        parts.append(f"Route téléphonie : {route_label.strip()}.")

    prompt_variables = {
        key: value
        for key, value in context.voice_prompt_variables.items()
        if value
    }
    if prompt_variables:
        summary = ", ".join(
            f"{key}={value}" for key, value in sorted(prompt_variables.items())
        )
        parts.append(f"Variables de contexte : {summary}.")

    parts.append("Prépare la session voix.")
    parts.append("Attends les transcriptions de l'appelant avant de répondre.")

    parts.append(f"Identifiant d'appel : {call_id}.")

    return " ".join(parts)


def _merge_voice_settings(
    *,
    session: Session | None,
    overrides: TelephonyRouteOverrides | None,
    settings: Settings,
    workflow_definition: WorkflowDefinition | None = None,
) -> tuple[str, str, str, dict[str, str], str | None, str | None]:
    db: Session
    owns_session = False
    if session is None:
        db = SessionLocal()
        owns_session = True
    else:
        db = session

    try:
        voice_settings = get_or_create_voice_settings(db)
        model = (
            voice_settings.model or settings.chatkit_realtime_model or "gpt-realtime"
        )
        instructions = (
            voice_settings.instructions
            or settings.chatkit_realtime_instructions
            or "Assistant vocal ChatKit"
        )
        voice = voice_settings.voice or settings.chatkit_realtime_voice or "verse"
        prompt_variables = _sanitize_prompt_variables(
            getattr(voice_settings, "prompt_variables", {}) or {}
        )
        provider_id = getattr(voice_settings, "provider_id", None)
        provider_slug = getattr(voice_settings, "provider_slug", None)

        # Chercher le premier bloc agent vocal dans le workflow pour ses paramètres
        if workflow_definition is not None:
            steps = getattr(workflow_definition, "steps", [])
            logger.info(
                "Recherche de bloc agent vocal dans le workflow (nombre de steps=%d)",
                len(steps),
            )
            for step in steps:
                step_kind = getattr(step, "kind", "")
                step_slug = getattr(step, "slug", "<inconnu>")
                logger.info("Bloc trouvé : slug=%s, kind=%s", step_slug, step_kind)
                # Chercher les blocs de type agent ou voice-agent
                if step_kind in ("agent", "voice-agent", "voice_agent"):
                    params = getattr(step, "parameters", {})
                    logger.info(
                        "Paramètres complets du bloc %s : %s",
                        step_slug,
                        list(params.keys())
                        if isinstance(params, dict)
                        else type(params),
                    )
                    if isinstance(params, dict):
                        # Utiliser les paramètres du bloc agent si disponibles
                        if params.get("model"):
                            model = params["model"]
                        if params.get("instructions"):
                            instructions = params["instructions"]
                        if params.get("voice"):
                            voice = params["voice"]
                        # Les clés pour le provider sont model_provider
                        # et model_provider_slug
                        if params.get("model_provider"):
                            provider_id = params["model_provider"]
                        if params.get("model_provider_slug"):
                            provider_slug = params["model_provider_slug"]
                        logger.info(
                            "Paramètres voix extraits du bloc %s (kind=%s) : "
                            "model=%s, voice=%s, provider=%s",
                            step_slug,
                            step_kind,
                            model,
                            voice,
                            provider_slug or provider_id or "<aucun>",
                        )
                    # Utiliser le premier bloc agent trouvé
                    break
    finally:
        if owns_session:
            db.close()

    if overrides is not None:
        if overrides.model:
            model = overrides.model
        if overrides.instructions:
            instructions = overrides.instructions
        if overrides.voice:
            voice = overrides.voice
        if overrides.prompt_variables:
            prompt_variables.update(overrides.prompt_variables)
        if getattr(overrides, "provider_id", None):
            provider_id = overrides.provider_id
        if getattr(overrides, "provider_slug", None):
            provider_slug = overrides.provider_slug

    return model, instructions, voice, prompt_variables, provider_id, provider_slug


def _match_route(
    config: TelephonyStartConfiguration,
    normalized_number: str,
) -> TelephonyRouteConfig | None:
    if not config.routes and config.default_route is None:
        return None

    exact_matches: list[TelephonyRouteConfig] = []
    prefix_matches: list[tuple[int, TelephonyRouteConfig]] = []

    for route in sorted(config.routes, key=lambda entry: entry.priority):
        if normalized_number and normalized_number in route.phone_numbers:
            exact_matches.append(route)
            continue

        longest_prefix = 0
        for prefix in route.prefixes:
            if not prefix:
                continue
            if normalized_number.startswith(prefix):
                longest_prefix = max(longest_prefix, len(prefix))
        if longest_prefix:
            prefix_matches.append((longest_prefix, route))

    if len(exact_matches) > 1:
        logger.info(
            "Plusieurs routes téléphonie correspondent exactement au numéro %s : %s",
            normalized_number,
            [
                route.label or route.workflow_slug or str(route.priority)
                for route in exact_matches
            ],
        )

    if exact_matches:
        return exact_matches[0]

    if prefix_matches:
        prefix_matches.sort(key=lambda item: (-item[0], item[1].priority))
        if len(prefix_matches) > 1 and prefix_matches[0][0] == prefix_matches[1][0]:
            logger.info(
                "Plusieurs routes téléphonie partagent le même préfixe pour %s, "
                "sélection de la première configurée.",
                normalized_number,
            )
        return prefix_matches[0][1]

    return config.default_route


def resolve_workflow_for_phone_number(
    workflow_service: WorkflowService,
    *,
    phone_number: str,
    workflow_slug: str | None = None,
    session: Session | None = None,
    settings: Settings | None = None,
) -> TelephonyCallContext:
    """Résout le workflow et les overrides voix pour un appel entrant."""

    effective_settings = settings or get_settings()

    logger.info(
        "Appel entrant reçu pour %s (workflow demandé=%s)",
        phone_number,
        workflow_slug or "<non spécifié>",
    )

    if workflow_slug:
        definition = workflow_service.get_definition_by_slug(
            workflow_slug, session=session
        )
    else:
        definition = workflow_service.get_current(session=session)

    normalized_number = _normalize_incoming_number(phone_number)

    if normalized_number != phone_number:
        logger.info(
            "Numéro entrant normalisé de %s vers %s",
            phone_number,
            normalized_number,
        )
    else:
        logger.info("Numéro entrant %s déjà normalisé", normalized_number)

    telephony_config = resolve_start_telephony_config(definition)
    if telephony_config is None:
        logger.info(
            "Workflow %s sans configuration téléphonie : utilisation de la définition "
            "courante.",
            getattr(definition.workflow, "slug", "<inconnu>"),
        )
        model, instructions, voice, prompt_variables, provider_id, provider_slug = (
            _merge_voice_settings(
                session=session,
                overrides=None,
                settings=effective_settings,
                workflow_definition=definition,
            )
        )
        return TelephonyCallContext(
            workflow_definition=definition,
            normalized_number=normalized_number,
            original_number=phone_number,
            route=None,
            voice_model=model,
            voice_instructions=instructions,
            voice_voice=voice,
            voice_prompt_variables=prompt_variables,
            voice_provider_id=provider_id,
            voice_provider_slug=provider_slug,
        )
    else:
        logger.info(
            "Configuration téléphonie chargée pour %s : %d route(s), "
            "route par défaut=%s",
            getattr(definition.workflow, "slug", "<inconnu>"),
            len(telephony_config.routes),
            "oui" if telephony_config.default_route else "non",
        )

    route = _match_route(telephony_config, normalized_number)

    if route is None:
        logger.warning(
            "Aucune route téléphonie ne correspond au numéro %s pour le workflow %s",
            phone_number,
            getattr(definition.workflow, "slug", "<inconnu>"),
        )
        raise TelephonyRouteSelectionError(
            f"Aucune route téléphonie pour le numéro {phone_number!r}"
        )

    if route is telephony_config.default_route:
        match_reason = "route par défaut"
    elif normalized_number and normalized_number in route.phone_numbers:
        match_reason = "correspondance exacte"
    else:
        matched_prefix = next(
            (
                prefix
                for prefix in route.prefixes
                if normalized_number.startswith(prefix)
            ),
            None,
        )
        match_reason = (
            f"préfixe {matched_prefix}" if matched_prefix else "route configurée"
        )

    logger.info(
        "Route téléphonie sélectionnée (%s) : label=%s, workflow=%s, priorité=%s",
        match_reason,
        route.label or "<sans-label>",
        route.workflow_slug or getattr(definition.workflow, "slug", "<inconnu>"),
        route.priority,
    )

    selected_definition = definition
    if route.workflow_slug and (
        not hasattr(definition, "workflow")
        or getattr(definition.workflow, "slug", None) != route.workflow_slug
    ):
        try:
            selected_definition = workflow_service.get_definition_by_slug(
                route.workflow_slug,
                session=session,
            )
        except Exception as exc:
            logger.error(
                "Impossible de charger le workflow %s référencé dans la route %s",
                route.workflow_slug,
                route.label or route.workflow_slug or "<sans-label>",
                exc_info=exc,
            )
            raise TelephonyRouteSelectionError(
                f"Workflow {route.workflow_slug!r} introuvable pour la route téléphonie"
            ) from exc
        else:
            logger.info(
                "Workflow surchargé chargé depuis la route : %s",
                route.workflow_slug,
            )

    model, instructions, voice, prompt_variables, provider_id, provider_slug = (
        _merge_voice_settings(
            session=session,
            overrides=route.overrides,
            settings=effective_settings,
            workflow_definition=selected_definition,
        )
    )

    logger.info(
        "Paramètres voix appliqués : modèle=%s, voix=%s, instructions=%s, variables=%s",
        model,
        voice,
        instructions,
        prompt_variables,
    )

    return TelephonyCallContext(
        workflow_definition=selected_definition,
        normalized_number=normalized_number,
        original_number=phone_number,
        route=route,
        voice_model=model,
        voice_instructions=instructions,
        voice_voice=voice,
        voice_prompt_variables=prompt_variables,
        voice_provider_id=provider_id,
        voice_provider_slug=provider_slug,
    )


async def prepare_voice_workflow(
    call_context: TelephonyCallContext,
    *,
    call_id: str,
    settings: Settings | None = None,
) -> TelephonyVoiceWorkflowResult | None:
    """Exécute le workflow téléphonie jusqu'au premier bloc voix."""

    effective_settings = settings or get_settings()

    try:
        server = get_chatkit_server()
    except Exception as exc:  # pragma: no cover - dépend de l'initialisation du serveur
        logger.exception(
            "Impossible de récupérer le serveur ChatKit pour l'appel %s",
            call_id,
            exc_info=exc,
        )
        return None

    store = getattr(server, "store", None)
    if store is None or not hasattr(store, "generate_thread_id"):
        logger.warning(
            "Store ChatKit indisponible pour préparer le workflow voix (Call-ID=%s)",
            call_id,
        )
        return None

    request_context = ChatKitRequestContext(
        user_id=f"sip:{call_id}",
        email=None,
        authorization=None,
        public_base_url=effective_settings.backend_public_base_url,
        voice_model=call_context.voice_model,
        voice_instructions=call_context.voice_instructions,
        voice_voice=call_context.voice_voice,
        voice_prompt_variables=call_context.voice_prompt_variables,
        voice_model_provider_id=call_context.voice_provider_id,
        voice_model_provider_slug=call_context.voice_provider_slug,
    )

    try:
        thread_id = store.generate_thread_id(request_context)
    except Exception as exc:  # pragma: no cover - dépend du store
        logger.exception(
            "Impossible de générer un thread pour l'appel %s", call_id, exc_info=exc
        )
        return None

    thread = ThreadMetadata(
        id=thread_id,
        created_at=datetime.datetime.now(datetime.UTC),
        metadata={},
    )

    agent_context = AgentContext(
        thread=thread,
        store=store,
        request_context=request_context,
    )

    try:
        await store.save_thread(thread, request_context)
    except Exception as exc:  # pragma: no cover - dépend du store
        logger.exception(
            "Impossible d'enregistrer le thread %s avant exécution (Call-ID=%s)",
            thread_id,
            call_id,
            exc_info=exc,
        )
        return None

    workflow_input = WorkflowInput(
        input_as_text=_build_voice_bootstrap_message(call_context, call_id),
        auto_start_was_triggered=False,
        auto_start_assistant_message=None,
        source_item_id=f"sip:{call_id}",
    )

    try:
        await run_workflow(
            workflow_input,
            agent_context=agent_context,
            workflow_definition=call_context.workflow_definition,
        )
    except Exception as exc:
        logger.exception(
            "Erreur lors de l'exécution initiale du workflow voix (Call-ID=%s)",
            call_id,
            exc_info=exc,
        )
        return None

    wait_state = _get_wait_state_metadata(thread)
    if not isinstance(wait_state, Mapping) or wait_state.get("type") != "voice":
        logger.info("Aucun wait state vocal détecté pour l'appel %s", call_id)
        try:
            await store.save_thread(thread, request_context)
        except Exception:  # pragma: no cover - persistance best effort
            logger.debug(
                "Impossible d'enregistrer le thread %s sans wait state voix",
                thread_id,
                exc_info=True,
            )
        return None

    voice_event = wait_state.get("voice_event")
    if not isinstance(voice_event, Mapping):
        logger.warning(
            "Wait state vocal sans événement realtime pour l'appel %s", call_id
        )
        return None

    event_payload = voice_event.get("event")
    if not isinstance(event_payload, Mapping):
        logger.warning("Événement vocal invalide pour l'appel %s", call_id)
        return None

    session_context = event_payload.get("session")
    if not isinstance(session_context, Mapping):
        logger.warning(
            "Contexte session absent dans l'événement vocal (Call-ID=%s)", call_id
        )
        return None

    state_payload = wait_state.get("state")
    voice_context: Mapping[str, Any]
    if isinstance(state_payload, Mapping):
        stored_session = state_payload.get("last_voice_session")
        voice_context = stored_session if isinstance(stored_session, Mapping) else {}
    else:
        voice_context = {}
    if not voice_context:
        voice_context = session_context

    tool_permissions = event_payload.get("tool_permissions")
    if not isinstance(tool_permissions, Mapping):
        tool_permissions = {}

    async def _resume_workflow(transcripts: Sequence[Mapping[str, Any]]) -> None:
        current_wait_state = _get_wait_state_metadata(thread)
        if not isinstance(current_wait_state, Mapping):
            logger.info("Aucun état de reprise vocal pour l'appel %s", call_id)
            return

        updated_wait_state = dict(current_wait_state)
        normalized: list[dict[str, Any]] = []
        for entry in transcripts:
            if isinstance(entry, Mapping):
                normalized.append(dict(entry))
        updated_wait_state["voice_transcripts"] = normalized
        _set_wait_state_metadata(thread, updated_wait_state)

        try:
            await store.save_thread(thread, request_context)
        except Exception:
            logger.exception(
                "Impossible d'enregistrer les transcriptions vocales (Call-ID=%s)",
                call_id,
            )
            return

        resume_input = WorkflowInput(
            input_as_text="",
            auto_start_was_triggered=False,
            auto_start_assistant_message=None,
            source_item_id=current_wait_state.get("input_item_id"),
        )

        try:
            await run_workflow(
                resume_input,
                agent_context=agent_context,
                workflow_definition=call_context.workflow_definition,
            )
        except Exception:
            logger.exception(
                "Erreur lors de la reprise du workflow voix (Call-ID=%s)", call_id
            )
            raise
        finally:
            try:
                await store.save_thread(thread, request_context)
            except Exception:  # pragma: no cover - persistance best effort
                logger.debug(
                    "Impossible d'enregistrer le thread %s après reprise",
                    thread_id,
                    exc_info=True,
                )

    metadata_payload: dict[str, Any] = {
        "thread_id": thread.id,
        "tool_permissions": dict(tool_permissions),
        "voice_context": dict(voice_context),
        "wait_state": dict(wait_state),
        "resume_input_item_id": wait_state.get("input_item_id"),
        "voice_step_slug": wait_state.get("slug"),
        "realtime_session_id": event_payload.get("session_id"),
    }

    try:
        await store.save_thread(thread, request_context)
    except Exception:  # pragma: no cover - persistance best effort
        logger.debug(
            "Impossible d'enregistrer le thread %s après préparation",
            thread_id,
            exc_info=True,
        )

    logger.info(
        "Wait state vocal initialisé pour l'appel %s (thread=%s)",
        call_id,
        thread_id,
    )

    return TelephonyVoiceWorkflowResult(
        voice_event=dict(voice_event),
        metadata=metadata_payload,
        resume_callback=_resume_workflow,
    )


class SipCallRequestHandler:
    """Gestionnaire générique des requêtes SIP INVITE/ACK/BYE."""

    def __init__(
        self,
        *,
        invite_callback: Callable[[SipCallSession, Any], Awaitable[None]] | None = None,
        start_rtp_callback: Callable[[SipCallSession], Awaitable[None]] | None = None,
        terminate_callback: Callable[[SipCallSession, Any | None], Awaitable[None]]
        | None = None,
    ) -> None:
        self._invite_callback = invite_callback
        self._start_rtp_callback = start_rtp_callback
        self._terminate_callback = terminate_callback
        self._sessions: dict[str, SipCallSession] = {}
        self._lock = asyncio.Lock()

    async def handle_request(self, request: Any, *, dialog: Any | None = None) -> None:
        method = getattr(request, "method", None)
        if isinstance(method, str):
            method = method.upper()
        else:
            method = None

        if method == "INVITE":
            await self.handle_invite(request, dialog=dialog)
        elif method == "ACK":
            await self.handle_ack(request, dialog=dialog)
        elif method == "BYE":
            await self.handle_bye(request, dialog=dialog)
        else:
            logger.debug("Requête SIP ignorée (méthode=%s)", method)

    async def handle_invite(self, request: Any, *, dialog: Any | None = None) -> None:
        call_id = self._extract_call_id(request)
        if call_id is None:
            logger.warning("INVITE reçu sans en-tête Call-ID")
            return

        session = SipCallSession(call_id=call_id, request=request, dialog=dialog)
        async with self._lock:
            previous = self._sessions.get(call_id)
            if previous is not None:
                logger.info(
                    "Réinitialisation de la session SIP existante pour %s",
                    call_id,
                )
            self._sessions[call_id] = session

        logger.info("INVITE enregistré pour Call-ID=%s", call_id)

        if self._invite_callback is not None:
            try:
                await self._invite_callback(session, request)
            except Exception:  # pragma: no cover - dépend des callbacks
                logger.exception("Erreur lors du traitement applicatif de l'INVITE")
                async with self._lock:
                    current = self._sessions.get(call_id)
                    if current is session:
                        session.mark_failed()
                raise

    async def handle_ack(self, request: Any, *, dialog: Any | None = None) -> None:
        del dialog  # Dialog is not used directly but kept for signature symmetry.
        logger.debug("handle_ack appelé, request=%s", type(request).__name__)
        call_id = self._extract_call_id(request)
        logger.debug("handle_ack call_id extrait: %s", call_id)
        if call_id is None:
            logger.warning("ACK reçu sans en-tête Call-ID")
            return

        async with self._lock:
            session = self._sessions.get(call_id)
            if session is None:
                logger.warning(
                    "ACK reçu pour Call-ID=%s sans session correspondante",
                    call_id,
                )
                return
            if session.state == "established":
                logger.info("ACK supplémentaire ignoré pour Call-ID=%s", call_id)
                return
            session.mark_established()

        logger.info("ACK reçu pour Call-ID=%s", call_id)

        try:
            await self.start_rtp_session(session)
        except Exception:
            logger.exception("Impossible de démarrer la session RTP pour %s", call_id)
            async with self._lock:
                current = self._sessions.get(call_id)
                if current is session:
                    session.mark_failed()
            raise

    async def handle_bye(self, request: Any, *, dialog: Any | None = None) -> None:
        call_id = self._extract_call_id(request)
        if call_id is None:
            logger.warning("BYE reçu sans en-tête Call-ID")
            return

        async with self._lock:
            session = self._sessions.pop(call_id, None)

        if session is None:
            logger.info("BYE reçu pour une session inconnue : %s", call_id)
            return

        session.mark_terminated()
        logger.info("BYE reçu, session terminée pour Call-ID=%s", call_id)

        if self._terminate_callback is not None:
            try:
                await self._terminate_callback(session, dialog)
            except Exception:  # pragma: no cover - dépend des callbacks
                logger.exception(
                    "Erreur lors du nettoyage applicatif de la session BYE",
                )

    async def start_rtp_session(self, session: SipCallSession) -> None:
        if self._start_rtp_callback is None:
            logger.info(
                "Aucun callback RTP configuré ; session Call-ID=%s laissée inactive",
                session.call_id,
            )
            return

        await self._start_rtp_callback(session)

    def get_session(self, call_id: str) -> SipCallSession | None:
        return self._sessions.get(call_id)

    def active_sessions(self) -> dict[str, SipCallSession]:
        return dict(self._sessions)

    @staticmethod
    def _extract_call_id(request: Any) -> str | None:
        headers = getattr(request, "headers", None)
        if isinstance(headers, Mapping):
            value = headers.get("Call-ID") or headers.get("CallId")
        elif isinstance(headers, dict):
            value = headers.get("Call-ID") or headers.get("CallId")
        else:
            value = None

        if value is None:
            return None

        if isinstance(value, list | tuple):
            for candidate in value:
                if candidate:
                    return str(candidate)
            return None

        text = str(value).strip()
        return text or None


__all__ = [
    "SipCallSession",
    "SipCallRequestHandler",
    "TelephonyCallContext",
    "TelephonyRouteResolution",
    "TelephonyRouteSelectionError",
    "prepare_voice_workflow",
    "resolve_workflow_for_phone_number",
]
