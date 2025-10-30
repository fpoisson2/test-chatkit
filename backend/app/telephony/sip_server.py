"""Résolution de workflow pour les appels SIP entrants."""

from __future__ import annotations

import asyncio
import logging
import time
import copy
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..database import SessionLocal
from ..voice_settings import get_or_create_voice_settings
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
    voice_tools: list[Any] = field(default_factory=list)
    voice_handoffs: list[Any] = field(default_factory=list)
    ring_timeout_seconds: float = 0.0
    sip_account_id: int | None = None


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


def _merge_voice_settings(
    *,
    session: Session | None,
    overrides: TelephonyRouteOverrides | None,
    settings: Settings,
    workflow_definition: WorkflowDefinition | None = None,
) -> tuple[str, str, str, dict[str, str], str | None, str | None, list[Any], list[Any], float]:
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
        tools: list[Any] = []
        handoffs: list[Any] = []
        ring_timeout_seconds: float = 0.0

        def _copy_sequence(value: Any) -> list[Any]:
            if isinstance(value, Sequence) and not isinstance(
                value, (str, bytes, bytearray)
            ):
                return [copy.deepcopy(item) for item in value]
            return []

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
                logger.info(
                    "Bloc trouvé : slug=%s, kind=%s", step_slug, step_kind
                )
                # Chercher les blocs de type agent ou voice-agent
                if step_kind in ("agent", "voice-agent", "voice_agent"):
                    params = getattr(step, "parameters", {})
                    logger.info(
                        "Paramètres complets du bloc %s : %s",
                        step_slug,
                        list(params.keys()) if isinstance(params, dict) else type(params),
                    )
                    if isinstance(params, dict):
                        # Utiliser les paramètres du bloc agent si disponibles
                        if params.get("model"):
                            model = params["model"]
                        if params.get("instructions"):
                            instructions = params["instructions"]
                        if params.get("voice"):
                            voice = params["voice"]
                        # Les clés pour le provider sont model_provider et model_provider_slug
                        if params.get("model_provider"):
                            provider_id = params["model_provider"]
                        if params.get("model_provider_slug"):
                            provider_slug = params["model_provider_slug"]
                        if "tools" in params:
                            tools = _copy_sequence(params.get("tools"))
                            logger.info(
                                "Outils extraits du bloc %s : %d outils",
                                step_slug,
                                len(tools),
                            )
                        if "handoffs" in params:
                            handoffs = _copy_sequence(params.get("handoffs"))
                            logger.info(
                                "Handoffs extraits du bloc %s : %d handoffs",
                                step_slug,
                                len(handoffs),
                            )
                        # Extraire ring_timeout_seconds si présent
                        if "ring_timeout_seconds" in params:
                            raw_timeout = params["ring_timeout_seconds"]
                            try:
                                ring_timeout_seconds = float(raw_timeout)
                                if ring_timeout_seconds < 0:
                                    ring_timeout_seconds = 0.0
                                logger.info(
                                    "Délai de sonnerie configuré : %.2f secondes",
                                    ring_timeout_seconds,
                                )
                            except (TypeError, ValueError):
                                logger.warning(
                                    "ring_timeout_seconds invalide (%s), utilisation de 0.0",
                                    raw_timeout,
                                )
                                ring_timeout_seconds = 0.0
                        logger.info(
                            "Paramètres voix extraits du bloc %s (kind=%s) : "
                            "model=%s, voice=%s, provider=%s, tools=%d, handoffs=%d, ring_timeout=%.2fs",
                            step_slug,
                            step_kind,
                            model,
                            voice,
                            provider_slug or provider_id or "<aucun>",
                            len(tools),
                            len(handoffs),
                            ring_timeout_seconds,
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

    return (
        model,
        instructions,
        voice,
        prompt_variables,
        provider_id,
        provider_slug,
        tools,
        handoffs,
        ring_timeout_seconds,
    )


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
    sip_account_id: int | None = None,
) -> TelephonyCallContext:
    """Résout le workflow pour un appel SIP entrant.

    Cherche le workflow associé au compte SIP spécifié.
    Si aucun compte SIP n'est spécifié, cherche le workflow avec is_sip_workflow=true (comportement legacy).
    Les paramètres voix seront pris du bloc voice-agent du workflow.

    Args:
        workflow_service: Service de gestion des workflows
        phone_number: Numéro de téléphone entrant
        workflow_slug: Slug du workflow (non utilisé actuellement)
        session: Session SQLAlchemy
        settings: Paramètres de l'application
        sip_account_id: ID du compte SIP qui a reçu l'appel. Si None, utilise le comportement legacy.

    Returns:
        Le contexte de l'appel téléphonique avec les informations du workflow

    Raises:
        TelephonyRouteSelectionError: Si aucun workflow n'est trouvé pour le compte SIP
    """

    effective_settings = settings or get_settings()
    normalized_number = _normalize_incoming_number(phone_number)

    logger.info(
        "Appel SIP entrant pour %s (normalisé: %s) sur compte SIP ID=%s",
        phone_number,
        normalized_number,
        sip_account_id if sip_account_id is not None else "<legacy>",
    )

    # Chercher le workflow associé au compte SIP
    definition = workflow_service.get_sip_workflow(
        session=session, sip_account_id=sip_account_id
    )

    if definition is None:
        if sip_account_id is not None:
            logger.error(
                "Aucun workflow configuré pour le compte SIP ID=%d", sip_account_id
            )
            raise TelephonyRouteSelectionError(
                f"Aucun workflow configuré pour le compte SIP ID={sip_account_id}"
            )
        else:
            logger.error("Aucun workflow SIP configuré")
            raise TelephonyRouteSelectionError(
                "Aucun workflow configuré pour les appels SIP"
            )

    logger.info(
        "Workflow SIP sélectionné : %s",
        getattr(definition.workflow, "slug", "<inconnu>"),
    )

    # Récupérer les paramètres voix du bloc voice-agent
    (
        model,
        instructions,
        voice,
        prompt_variables,
        provider_id,
        provider_slug,
        tools,
        handoffs,
        ring_timeout_seconds,
    ) = _merge_voice_settings(
        session=session,
        overrides=None,  # Plus d'overrides, tout vient du voice-agent
        settings=effective_settings,
        workflow_definition=definition,
    )

    logger.info(
        "Paramètres voix du voice-agent : modèle=%s, voix=%s, ring_timeout=%.2fs",
        model,
        voice,
        ring_timeout_seconds,
    )

    # Récupérer l'ID du compte SIP associé au workflow
    sip_account_id = getattr(definition, "sip_account_id", None)

    if sip_account_id:
        logger.info(
            "Workflow associé au compte SIP ID: %d",
            sip_account_id,
        )
    else:
        logger.info("Workflow utilise le compte SIP par défaut")

    return TelephonyCallContext(
        workflow_definition=definition,
        normalized_number=normalized_number,
        original_number=phone_number,
        route=None,  # Plus de routes
        voice_model=model,
        voice_instructions=instructions,
        voice_voice=voice,
        voice_prompt_variables=prompt_variables,
        voice_provider_id=provider_id,
        voice_provider_slug=provider_slug,
        voice_tools=tools,
        voice_handoffs=handoffs,
        ring_timeout_seconds=ring_timeout_seconds,
        sip_account_id=sip_account_id,
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
    "resolve_workflow_for_phone_number",
]
