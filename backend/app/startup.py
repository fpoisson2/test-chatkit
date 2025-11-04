from __future__ import annotations

import asyncio
import contextlib
import copy
import datetime
import logging
import os
import re
import uuid
from typing import Any

from fastapi import FastAPI
from sqlalchemy import String, inspect, select, text
from sqlalchemy.sql import bindparam

from chatkit.types import ThreadMetadata

from .admin_settings import (
    apply_runtime_model_overrides,
    get_thread_title_prompt_override,
)
from .chatkit import get_chatkit_server
from .chatkit_server.context import (
    ChatKitRequestContext,
    _set_wait_state_metadata,
)
from .chatkit_sessions import SessionSecretParser
from .config import DEFAULT_THREAD_TITLE_MODEL, settings_proxy
from .database import (
    SessionLocal,
    engine,
    ensure_database_extensions,
    ensure_vector_indexes,
    wait_for_database,
)
from .docs import DocumentationService
from .model_providers import configure_model_provider
from .models import (
    EMBEDDING_DIMENSION,
    AppSettings,
    AvailableModel,
    Base,
    WorkflowAppearance,
    McpServer,
    SipAccount,
    TelephonyRoute,
    User,
    VoiceSettings,
    Workflow,
)
from .realtime_runner import close_voice_session, open_voice_session
from .security import hash_password
from .telephony.invite_handler import (
    InviteHandlingError,
    handle_incoming_invite,
    send_sip_reply,
)
from .telephony.multi_sip_manager import MultiSIPRegistrationManager
from .telephony.registration import SIPRegistrationManager
from .telephony.rtp_server import RtpServer, RtpServerConfig
from .telephony.sip_server import (
    SipCallRequestHandler,
    SipCallSession,
    TelephonyRouteSelectionError,
    resolve_workflow_for_phone_number,
)
from .telephony.voice_bridge import TelephonyVoiceBridge, VoiceBridgeHooks
# PJSUA imports
try:
    from .telephony.pjsua_adapter import PJSUAAdapter, PJSUA_AVAILABLE
    from .telephony.pjsua_audio_bridge import create_pjsua_audio_bridge
except ImportError:
    PJSUA_AVAILABLE = False
    PJSUAAdapter = None  # type: ignore
    create_pjsua_audio_bridge = None  # type: ignore
from .vector_store import (
    WORKFLOW_VECTOR_STORE_DESCRIPTION,
    WORKFLOW_VECTOR_STORE_METADATA,
    WORKFLOW_VECTOR_STORE_SLUG,
    WORKFLOW_VECTOR_STORE_TITLE,
    JsonVectorStoreService,
)
from .workflows.service import WorkflowService

logger = logging.getLogger("chatkit.server")

# Configuration: utiliser PJSUA au lieu d'aiosip pour SIP/RTP
# TODO: Déplacer vers settings une fois la migration terminée
USE_PJSUA = PJSUA_AVAILABLE  # Utiliser PJSUA si disponible

for noisy_logger in (
    "aiosip",
    "aiosip.protocol",
    "aiosip.application",
    # La librairie `websockets` est très verbeuse en DEBUG et noie nos journaux.
    # On force un niveau plus élevé tant qu'aucune configuration spécifique
    # n'a été appliquée par l'utilisateur.
    "websockets.client",
    "websockets.asyncio.client",
    # Le client MCP génère des logs DEBUG très verbeux avec les payloads complets
    # des événements SSE et des messages serveur. On réduit le niveau de log.
    "mcp.client.sse",
):
    logger_instance = logging.getLogger(noisy_logger)
    if logger_instance.level == logging.NOTSET:
        logger_instance.setLevel(logging.INFO)
settings = settings_proxy


def _build_invite_handler(manager: MultiSIPRegistrationManager | SIPRegistrationManager):
    workflow_service = WorkflowService()
    session_secret_parser = SessionSecretParser()

    async def _attach_dialog_callbacks(
        dialog: Any, handler: SipCallRequestHandler
    ) -> None:
        if dialog is None:
            return

        async def _on_message(message: Any) -> None:
            await handler.handle_request(message, dialog=dialog)

        try:
            dialog.on_message = _on_message  # type: ignore[attr-defined]
        except Exception:  # pragma: no cover - dépend des implémentations aiosip
            logger.debug(
                "Impossible de lier on_message au dialogue SIP", exc_info=True
            )

        # Enregistrer un handler pour BYE pour éviter le KeyError
        async def _on_bye(dialog_arg: Any, message: Any) -> None:
            call_id_header = getattr(message, 'headers', {}).get('Call-ID', ['unknown'])
            call_id = call_id_header[0] if isinstance(call_id_header, list) and call_id_header else str(call_id_header)
            logger.info("BYE reçu pour Call-ID=%s", call_id)
            await handler.handle_request(message, dialog=dialog_arg)

        try:
            # Enregistrer le callback BYE dans dialog.callbacks
            if hasattr(dialog, 'callbacks'):
                if 'BYE' not in dialog.callbacks:
                    dialog.callbacks['BYE'] = []
                # Format attendu par aiosip: dict avec 'callable', 'args', 'kwargs', et 'wait'
                dialog.callbacks['BYE'].append({
                    'callable': _on_bye,
                    'args': (),
                    'kwargs': {},
                    'wait': True
                })
                logger.debug("Callback BYE enregistré pour le dialogue")
        except Exception:  # pragma: no cover - dépend des implémentations aiosip
            logger.debug(
                "Impossible d'enregistrer le callback BYE", exc_info=True
            )

        # `aiosip.Dialog.register` est dédié aux messages SIP REGISTER.
        # Utiliser ce mécanisme ici provoquerait une corruption des en-têtes
        # (les journaux d'erreur le montrent), d'où la limitation au hook
        # `on_message` ci-dessus.

    def _sanitize_phone_candidate(raw: Any) -> str | None:
        values: list[Any]
        if isinstance(raw, list | tuple):
            values = list(raw)
        else:
            values = [raw]

        for value in values:
            if value is None:
                continue
            text = str(value).strip()
            if not text:
                continue
            match = re.search(r"sip:(?P<number>[^@>;]+)", text, flags=re.IGNORECASE)
            candidate = match.group("number") if match else text
            digits = "".join(
                ch for ch in candidate if ch.isdigit() or ch in {"+", "#", "*"}
            )
            if digits:
                return digits
            if candidate:
                return candidate
        return None

    def _extract_incoming_number(request: Any) -> str | None:
        headers = getattr(request, "headers", None)
        items = getattr(headers, "items", None)
        iterable: list[tuple[Any, Any]]
        if callable(items):
            try:
                iterable = list(items())
            except Exception:  # pragma: no cover - garde-fou
                iterable = []
        elif isinstance(headers, dict):
            iterable = list(headers.items())
        else:
            iterable = []

        normalized: dict[str, Any] = {}
        for key, value in iterable:
            if isinstance(key, str):
                normalized[key.lower()] = value

        for header_name in (
            "x-original-to",
            "x-called-number",
            "p-called-party-id",
            "p-asserted-identity",
            "to",
            "from",
        ):
            if header_name not in normalized:
                continue
            candidate = _sanitize_phone_candidate(normalized[header_name])
            if candidate:
                return candidate
        return None

    def _extract_sip_account_id_from_request(request: Any) -> int | None:
        """Extrait l'ID du compte SIP depuis la requête INVITE.

        Analyse l'en-tête To: de l'INVITE et le compare aux comptes SIP
        enregistrés pour déterminer quel compte a reçu l'appel.

        Args:
            request: La requête INVITE SIP

        Returns:
            L'ID du compte SIP qui a reçu l'appel, ou None en mode legacy

        Raises:
            TelephonyRouteSelectionError: Si aucun compte SIP ne correspond à l'URI
                                         en mode multi-SIP
        """
        if not isinstance(manager, MultiSIPRegistrationManager):
            # Pour un gestionnaire simple, retourner None (comportement legacy)
            return None

        # Mode multi-SIP : on doit trouver une correspondance exacte
        # Extraire l'en-tête To: en utilisant la même logique que _extract_incoming_number
        headers = getattr(request, "headers", None)
        items = getattr(headers, "items", None)
        iterable: list[tuple[Any, Any]]
        if callable(items):
            try:
                iterable = list(items())
            except Exception:  # pragma: no cover - garde-fou
                iterable = []
        elif isinstance(headers, dict):
            iterable = list(headers.items())
        else:
            iterable = []

        to_header = None
        for key, value in iterable:
            if isinstance(key, str) and key.lower() == "to":
                if isinstance(value, list) and value:
                    to_header = str(value[0])
                elif isinstance(value, tuple) and value:
                    to_header = str(value[0])
                else:
                    to_header = str(value)
                break

        if not to_header:
            logger.error("Impossible d'extraire l'en-tête To: de l'INVITE SIP")
            raise TelephonyRouteSelectionError(
                "En-tête To: manquant dans la requête INVITE"
            )

        # Extraire l'URI SIP depuis l'en-tête To:
        # Format typique: "Display Name" <sip:user@domain> ou sip:user@domain
        match = re.search(r"sips?:([^@>;]+)@", to_header, flags=re.IGNORECASE)
        if not match:
            logger.error("Format d'en-tête To: non reconnu: %s", to_header)
            raise TelephonyRouteSelectionError(
                f"Format d'en-tête To: invalide: {to_header}"
            )

        to_username = match.group(1).lower()  # Juste le username (partie avant @)

        # Comparer le username avec les comptes SIP enregistrés
        with SessionLocal() as session:
            accounts = session.scalars(
                select(SipAccount).where(SipAccount.is_active == True)
            ).all()

            for account in accounts:
                # Comparer avec le username du compte SIP
                if account.username and account.username.lower() == to_username:
                    logger.info(
                        "Appel SIP correspond au compte '%s' (ID=%d) via username '%s'",
                        account.label,
                        account.id,
                        account.username,
                    )
                    return account.id

        # Aucune correspondance trouvée - rejeter l'appel
        logger.error(
            "Aucun compte SIP actif ne correspond au username: %s",
            to_username,
        )
        raise TelephonyRouteSelectionError(
            f"Aucun compte SIP configuré pour le username {to_username}"
        )

    async def _close_dialog(session: SipCallSession) -> None:
        dialog = session.dialog
        if dialog is None:
            return
        # Only try bye() - close() has a bug in aiosip that causes "Dialog is not subscriptable"
        method = getattr(dialog, "bye", None)
        if callable(method):
            try:
                outcome = method()
                if asyncio.iscoroutine(outcome):
                    await outcome
            except Exception:  # pragma: no cover - best effort
                logger.debug(
                    "Fermeture du dialogue SIP via bye échouée",
                    exc_info=True,
                )

    async def _clear_voice_state(session: SipCallSession) -> None:
        metadata = session.metadata.get("telephony")
        if not isinstance(metadata, dict):
            return

        # Arrêter le serveur RTP s'il existe
        rtp_server = metadata.pop("rtp_server", None)
        if isinstance(rtp_server, RtpServer):
            try:
                await rtp_server.stop()
            except Exception:  # pragma: no cover - best effort
                logger.debug(
                    "Arrêt du serveur RTP en erreur pour Call-ID=%s",
                    session.call_id,
                    exc_info=True,
                )

        metadata.pop("rtp_stream_factory", None)
        metadata.pop("send_audio", None)
        metadata.pop("client_secret", None)
        metadata["voice_session_active"] = False

    async def _resume_workflow(
        session: SipCallSession, transcripts: list[dict[str, str]]
    ) -> None:
        metadata = session.metadata.get("telephony")
        transcript_count = len(transcripts)
        if not isinstance(metadata, dict):
            logger.info(
                "Reprise workflow ignorée (Call-ID=%s, aucun contexte)",
                session.call_id,
            )
            return

        resume_callable = metadata.get("resume_workflow_callable")
        if callable(resume_callable):
            try:
                await resume_callable(transcripts)
            except Exception:  # pragma: no cover - dépend des hooks
                logger.exception(
                    "Erreur lors de la reprise du workflow (Call-ID=%s)",
                    session.call_id,
                )
            else:
                logger.info(
                    "Workflow repris via hook personnalisé "
                    "(Call-ID=%s, transcriptions=%d)",
                    session.call_id,
                    transcript_count,
                )
            return

        thread_id = metadata.get("thread_id")
        if not thread_id:
            logger.info(
                "Reprise workflow non configurée (Call-ID=%s, transcriptions=%d)",
                session.call_id,
                transcript_count,
            )
            return

        server = get_chatkit_server()
        context = ChatKitRequestContext(
            user_id=f"sip:{session.call_id}",
            email=None,
            authorization=None,
            public_base_url=settings.backend_public_base_url,
            voice_model=metadata.get("voice_model"),
            voice_instructions=metadata.get("voice_instructions"),
            voice_voice=metadata.get("voice_voice"),
            voice_prompt_variables=metadata.get("voice_prompt_variables"),
        )

        post_callable = getattr(server, "post", None)
        if callable(post_callable):
            # Extraire les messages de l'utilisateur depuis les transcriptions
            user_messages = [
                t.get("text", "").strip()
                for t in transcripts
                if t.get("role") == "user" and t.get("text", "").strip()
            ]
            # Combiner tous les messages de l'utilisateur
            combined_text = " ".join(user_messages) if user_messages else ""

            # Construire le payload avec le contenu de l'utilisateur
            message_content = []
            if combined_text:
                message_content.append({"type": "input_text", "text": combined_text})

            payload = {
                "type": "user_message",
                "thread_id": thread_id,
                "message": {"content": message_content},
                "metadata": {"source": "sip", "transcripts": transcripts},
            }
            try:
                await post_callable(payload, context)
            except Exception:  # pragma: no cover - dépend du serveur ChatKit
                logger.exception(
                    "Échec de la reprise du workflow via post() (Call-ID=%s)",
                    session.call_id,
                )
            else:
                preview_text = (
                    f"{combined_text[:50]}..."
                    if len(combined_text) > 50
                    else combined_text
                )
                logger.info(
                    "Workflow repris via ChatKitServer.post "
                    "(Call-ID=%s, transcriptions=%d, texte=%s)",
                    session.call_id,
                    transcript_count,
                    preview_text,
                )
            return

        logger.info(
            "Aucune méthode de reprise disponible pour Call-ID=%s", session.call_id
        )

    async def _register_session(
        session: SipCallSession, request: Any
    ) -> None:
        incoming_number = _extract_incoming_number(request)
        sip_account_id = _extract_sip_account_id_from_request(request)

        logger.info(
            "Appel SIP initialisé (Call-ID=%s, numéro entrant=%s, compte SIP ID=%s)",
            session.call_id,
            incoming_number or "<inconnu>",
            sip_account_id if sip_account_id is not None else "<legacy>",
        )

        telephony_metadata = session.metadata.setdefault("telephony", {})
        telephony_metadata.update(
            {
                "call_id": session.call_id,
                "incoming_number": incoming_number,
                "sip_account_id": sip_account_id,
            }
        )

        with SessionLocal() as db_session:
            try:
                context = resolve_workflow_for_phone_number(
                    workflow_service,
                    phone_number=incoming_number or "",
                    session=db_session,
                    sip_account_id=sip_account_id,
                )
            except TelephonyRouteSelectionError as exc:
                logger.warning(
                    "Aucune route téléphonie active pour Call-ID=%s (%s)",
                    session.call_id,
                    incoming_number or "<inconnu>",
                )
                telephony_metadata["workflow_resolution_error"] = str(exc)
                raise
            except Exception as exc:  # pragma: no cover - dépend BDD
                logger.exception(
                    "Résolution du workflow téléphonie impossible (Call-ID=%s)",
                    session.call_id,
                    exc_info=exc,
                )
                telephony_metadata["workflow_resolution_error"] = str(exc)
                raise

        workflow_obj = getattr(context.workflow_definition, "workflow", None)
        workflow_slug = getattr(workflow_obj, "slug", None)
        telephony_metadata.update(
            {
                "workflow_slug": workflow_slug,
                "voice_model": context.voice_model,
                "voice_instructions": context.voice_instructions,
                "voice_voice": context.voice_voice,
                "voice_prompt_variables": dict(context.voice_prompt_variables),
                "voice_provider_id": context.voice_provider_id,
                "voice_provider_slug": context.voice_provider_slug,
                "voice_tools": copy.deepcopy(context.voice_tools),
                "voice_handoffs": copy.deepcopy(context.voice_handoffs),
                "ring_timeout_seconds": context.ring_timeout_seconds,
                "speak_first": context.speak_first,
                "voice_session_active": False,
            }
        )

        if context.route is None:
            logger.info(
                "Route téléphonie par défaut retenue (Call-ID=%s, workflow=%s)",
                session.call_id,
                workflow_slug or "<inconnu>",
            )
        else:
            telephony_metadata.update(
                {
                    "route_label": context.route.label,
                    "route_workflow_slug": context.route.workflow_slug,
                    "route_priority": context.route.priority,
                }
            )
            logger.info(
                "Route téléphonie sélectionnée (Call-ID=%s) : label=%s, "
                "workflow=%s, priorité=%s",
                session.call_id,
                context.route.label or "<sans-label>",
                context.route.workflow_slug or workflow_slug or "<inconnu>",
                context.route.priority,
            )

    async def _start_rtp(session: SipCallSession) -> None:
        metadata = session.metadata.get("telephony") or {}
        voice_model = metadata.get("voice_model")
        instructions = metadata.get("voice_instructions")
        voice_name = metadata.get("voice_voice")
        voice_provider_id = metadata.get("voice_provider_id")
        voice_provider_slug = metadata.get("voice_provider_slug")
        voice_tools = metadata.get("voice_tools") or []
        voice_handoffs = metadata.get("voice_handoffs") or []
        speak_first = metadata.get("speak_first", False)
        rtp_stream_factory = metadata.get("rtp_stream_factory")
        send_audio = metadata.get("send_audio")

        if not voice_model or not instructions:
            logger.error(
                "Paramètres voix incomplets pour Call-ID=%s", session.call_id
            )
            return

        if not callable(rtp_stream_factory) or not callable(send_audio):
            logger.error(
                "Flux RTP non configuré pour Call-ID=%s (stream=%s, send=%s)",
                session.call_id,
                bool(callable(rtp_stream_factory)),
                bool(callable(send_audio)),
            )
            return

        # Vérifier si un thread a déjà été créé pendant la pré-initialisation
        thread_id = metadata.get("thread_id")

        # Créer le contexte ChatKit (nécessaire pour thread et wait_state)
        server = get_chatkit_server()
        store = getattr(server, "store", None)
        chatkit_context = ChatKitRequestContext(
            user_id=f"sip:{session.call_id}",
            email=None,
            authorization=None,
            public_base_url=settings.backend_public_base_url,
            voice_model=voice_model,
            voice_instructions=instructions,
            voice_voice=voice_name,
            voice_prompt_variables=metadata.get("voice_prompt_variables"),
        )

        if not thread_id:
            # Créer un nouveau thread pour cet appel avant de démarrer la session vocale
            thread_id = str(uuid.uuid4())

            # Ajouter les informations de l'appel SIP aux métadonnées du thread
            sip_metadata = {
                "sip_caller_number": metadata.get("normalized_number") or metadata.get("original_number"),
                "sip_original_number": metadata.get("original_number"),
                "sip_call_id": session.call_id,
            }

            thread = ThreadMetadata(
                id=thread_id,
                created_at=datetime.datetime.now(datetime.UTC),
                metadata=sip_metadata,
            )

            # Sauvegarder le thread dans le store ChatKit
            if store is not None:
                try:
                    await store.save_thread(thread, chatkit_context)
                    metadata["thread_id"] = thread_id
                    logger.info(
                        "Thread créé pour l'appel SIP (Call-ID=%s, thread_id=%s)",
                        session.call_id,
                        thread_id,
                    )
                except Exception as exc:
                    logger.exception(
                        "Erreur lors de la création du thread pour Call-ID=%s",
                        session.call_id,
                        exc_info=exc,
                    )
            else:
                logger.warning(
                    "Store ChatKit non disponible, thread non créé pour Call-ID=%s",
                    session.call_id,
                )
        else:
            logger.info(
                "Thread pré-existant utilisé (Call-ID=%s, thread_id=%s)",
                session.call_id,
                thread_id,
            )

        metadata["voice_session_active"] = True
        logger.info(
            "Démarrage du pont voix Realtime (Call-ID=%s, modèle=%s, voix=%s, "
            "provider=%s)",
            session.call_id,
            voice_model,
            voice_name or "<auto>",
            voice_provider_slug or voice_provider_id or "<défaut>",
        )

        # Créer une nouvelle session Realtime
        logger.info(
            "Création d'une nouvelle session Realtime (Call-ID=%s)",
            session.call_id,
        )
        metadata_extras: dict[str, Any] = {}
        thread_identifier = metadata.get("thread_id")
        if isinstance(thread_identifier, str) and thread_identifier.strip():
            metadata_extras["thread_id"] = thread_identifier.strip()

        # Ajouter automatiquement le tool de transfert d'appel pour la téléphonie
        telephony_tools = list(voice_tools) if voice_tools else []
        transfer_tool_config = {
            "type": "function",
            "name": "transfer_call",
            "description": (
                "Transfère l'appel en cours vers un autre numéro de téléphone. "
                "Utilisez cette fonction lorsque l'appelant demande à être "
                "transféré vers un service spécifique, un département, ou une personne."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "phone_number": {
                        "type": "string",
                        "description": (
                            "Le numéro de téléphone vers lequel transférer l'appel. "
                            "Format recommandé: E.164 (ex: +33123456789)"
                        ),
                    },
                    "announcement": {
                        "type": "string",
                        "description": (
                            "Message optionnel à annoncer à l'appelant avant le transfert"
                        ),
                    },
                },
                "required": ["phone_number"],
            },
        }
        telephony_tools.append(transfer_tool_config)
        logger.info(
            "Ajout du tool de transfert d'appel (total tools: %d)",
            len(telephony_tools),
        )

        session_handle = await open_voice_session(
            user_id=f"sip:{session.call_id}",
            model=voice_model,
            instructions=instructions,
            voice=voice_name,
            provider_id=voice_provider_id,
            provider_slug=voice_provider_slug,
            tools=telephony_tools or None,
            handoffs=voice_handoffs or None,
            realtime={
                # Start WITHOUT turn_detection to avoid "buffer too small" error
                # It will be enabled dynamically after sending initial audio
            },
            metadata=metadata_extras or None,
        )
        secret_payload = session_handle.payload
        parsed_secret = session_secret_parser.parse(secret_payload)
        client_secret = parsed_secret.as_text()
        if not client_secret:
            logger.error(
                "Client secret Realtime introuvable pour Call-ID=%s",
                session.call_id,
            )
            return
        metadata["client_secret"] = client_secret
        metadata["client_secret_expires_at"] = (
            parsed_secret.expires_at_isoformat()
        )
        metadata["realtime_session_id"] = session_handle.session_id

        # Créer un wait_state pour que le frontend puisse détecter la session vocale
        if store is not None and thread_id:
            try:
                thread = await store.load_thread(thread_id, chatkit_context)

                # Créer l'événement realtime.event aligné avec les workflows
                voice_event = {
                    "type": "realtime.event",
                    "step": {
                        "slug": "sip-voice-session",
                        "title": "Appel SIP",
                    },
                    "event": {
                        "type": "history",
                        "session_id": metadata.get("realtime_session_id"),
                        "client_secret": client_secret,
                        "tool_permissions": {},
                        "session": {
                            "model": voice_model,
                            "voice": voice_name or "alloy",
                            "instructions": instructions,
                            "realtime": {
                                "start_mode": "auto",
                                "stop_mode": "manual",
                                "tools": {},
                            },
                        },
                    },
                }
                session_payload = voice_event["event"]["session"]
                if voice_tools:
                    session_payload["tools"] = copy.deepcopy(voice_tools)
                if voice_handoffs:
                    session_payload["handoffs"] = copy.deepcopy(voice_handoffs)

                # Créer le wait_state
                wait_state = {
                    "type": "voice",
                    "voice_event": voice_event,
                    "voice_event_consumed": False
                }

                # Mettre à jour le thread avec le wait_state
                _set_wait_state_metadata(thread, wait_state)
                await store.save_thread(thread, chatkit_context)

                logger.info(
                    "Wait state vocal créé pour le thread %s (Call-ID=%s)",
                    thread_id,
                    session.call_id,
                )
            except Exception as exc:
                logger.exception(
                    "Erreur lors de la création du wait_state pour Call-ID=%s",
                    session.call_id,
                    exc_info=exc,
                )

        hooks = VoiceBridgeHooks(
            close_dialog=lambda: _close_dialog(session),
            clear_voice_state=lambda: _clear_voice_state(session),
            resume_workflow=lambda transcripts: _resume_workflow(
                session, transcripts
            ),
        )
        voice_bridge = TelephonyVoiceBridge(hooks=hooks)

        # Déterminer le base URL pour le provider (OpenAI, etc.)
        realtime_api_base: str | None = None
        if voice_provider_slug == "openai":
            realtime_api_base = os.environ.get("CHATKIT_API_BASE") or "https://api.openai.com"

        try:
            stats = await voice_bridge.run(
                runner=session_handle.runner,
                client_secret=client_secret,
                model=voice_model,
                instructions=instructions,
                voice=voice_name,
                rtp_stream=rtp_stream_factory(),
                send_to_peer=send_audio,
                api_base=realtime_api_base,
                tools=voice_tools,
                handoffs=voice_handoffs,
                speak_first=speak_first,
            )
        except Exception as exc:  # pragma: no cover - dépend réseau
            logger.exception(
                "Session Realtime en erreur (Call-ID=%s)",
                session.call_id,
                exc_info=exc,
            )
            metadata["voice_bridge_error"] = repr(exc)
            raise
        else:
            metadata["voice_bridge_stats"] = {
                "duration_seconds": stats.duration_seconds,
                "inbound_audio_bytes": stats.inbound_audio_bytes,
                "outbound_audio_bytes": stats.outbound_audio_bytes,
                "transcript_count": stats.transcript_count,
                "error": repr(stats.error) if stats.error else None,
            }
            logger.info(
                "Session Realtime terminée (Call-ID=%s, durée=%.2fs, "
                "transcriptions=%d)",
                session.call_id,
                stats.duration_seconds,
                stats.transcript_count,
            )

    async def _terminate_session(
        session: SipCallSession, dialog: Any | None
    ) -> None:
        del dialog  # Le nettoyage spécifique est géré par les hooks.
        await _clear_voice_state(session)
        metadata = session.metadata.get("telephony") or {}
        logger.info(
            "Session SIP terminée (Call-ID=%s, numéro=%s)",
            session.call_id,
            metadata.get("incoming_number") or "<inconnu>",
        )

    sip_handler = SipCallRequestHandler(
        invite_callback=_register_session,
        start_rtp_callback=_start_rtp,
        terminate_callback=_terminate_session,
    )

    async def _on_invite(dialog: Any, request: Any) -> None:
        logger.info("🔔 _on_invite appelé - CODE MODIFIÉ v2")
        # Récupérer le gestionnaire par défaut pour MultiSIPRegistrationManager
        if isinstance(manager, MultiSIPRegistrationManager):
            default_manager = manager.get_default_manager()
            config = default_manager.active_config if default_manager else None
        else:
            config = manager.active_config

        media_host = (
            manager.contact_host
            or (config.contact_host if config else None)
            or settings.sip_bind_host
        )
        contact_uri = config.contact_uri() if config is not None else None
        media_port = getattr(settings, "sip_media_port", None)

        if media_port is None:
            logger.warning(
                "INVITE reçu mais aucun port RTP n'est configuré; réponse 486 Busy"
            )
            with contextlib.suppress(Exception):
                await send_sip_reply(
                    dialog,
                    486,
                    reason="Busy Here",
                    contact_uri=contact_uri,
                )
            return

        if not media_host:
            logger.warning(
                "INVITE reçu mais aucun hôte média n'est disponible; réponse 480"
            )
            with contextlib.suppress(Exception):
                await send_sip_reply(
                    dialog,
                    480,
                    reason="Temporarily Unavailable",
                    contact_uri=contact_uri,
                )
            return

        # Parser le SDP de l'INVITE pour extraire l'adresse RTP distante
        remote_rtp_host: str | None = None
        remote_rtp_port: int | None = None

        try:
            from app.telephony.invite_handler import (
                _parse_audio_media_line,
                _parse_connection_address,
            )

            payload = request.payload
            if isinstance(payload, bytes):
                payload_text = payload.decode("utf-8", errors="ignore")
            elif isinstance(payload, str):
                payload_text = payload
            else:
                payload_text = str(payload)

            logger.info("📋 Parsing SDP pour extraire l'adresse RTP distante")
            logger.debug("SDP brut (100 premiers caractères): %s", payload_text[:100])

            # Le SDP peut être sur une seule ligne ou sur plusieurs lignes séparées par \r\n
            # On essaie d'abord le split normal, puis on force un split si tout est collé
            normalized = payload_text.replace("\r\n", "\n").replace("\r", "\n")
            sdp_lines = [line.strip() for line in normalized.splitlines() if line.strip()]

            # Si on n'a qu'une seule ligne très longue, c'est que le SDP est mal formaté
            # On force un split en cherchant les patterns SDP standard (v=, o=, s=, c=, t=, m=, a=)
            if len(sdp_lines) == 1 and len(sdp_lines[0]) > 50:
                logger.debug("SDP sur une seule ligne détecté, split forcé")
                import re
                # Split sur les patterns SDP standard
                sdp_lines = [s.strip() for s in re.split(r'(?=[vosctma]=)', sdp_lines[0]) if s.strip()]

            logger.debug("SDP lines après split: %d lignes", len(sdp_lines))
            logger.debug("Premières lignes SDP: %s", sdp_lines[:5])

            remote_rtp_host = _parse_connection_address(sdp_lines)
            logger.info("🔍 Connection address from SDP: %s", remote_rtp_host)

            audio_media = _parse_audio_media_line(sdp_lines)
            if audio_media:
                remote_rtp_port, _ = audio_media
                logger.info("🔍 Audio media port from SDP: %s", remote_rtp_port)

            if remote_rtp_host and remote_rtp_port:
                logger.info(
                    "✅ Adresse RTP distante extraite du SDP : %s:%d",
                    remote_rtp_host,
                    remote_rtp_port,
                )
            else:
                logger.warning(
                    "⚠️ Impossible d'extraire l'adresse RTP complète (host=%s, port=%s)",
                    remote_rtp_host,
                    remote_rtp_port,
                )
        except Exception as exc:
            logger.warning("❌ Erreur lors de l'extraction de l'adresse RTP du SDP : %s", exc, exc_info=True)

        # Créer et démarrer le serveur RTP
        rtp_config = RtpServerConfig(
            local_host=media_host,
            local_port=int(media_port) if media_port else 0,
            remote_host=remote_rtp_host,
            remote_port=remote_rtp_port,
            payload_type=0,  # PCMU
            output_codec="pcmu",
        )
        rtp_server = RtpServer(rtp_config)

        try:
            await rtp_server.start()
        except Exception as exc:
            logger.exception(
                "Impossible de démarrer le serveur RTP",
                exc_info=exc,
            )
            with contextlib.suppress(Exception):
                await send_sip_reply(
                    dialog,
                    500,
                    reason="Server Internal Error",
                    contact_uri=contact_uri,
                )
            return

        # Utiliser le port réel du serveur RTP pour la négociation SDP
        actual_media_port = rtp_server.local_port

        # Enregistrer la session et attacher les callbacks AVANT d'envoyer le 200 OK
        # pour que l'ACK soit capturé correctement
        try:
            await sip_handler.handle_invite(request, dialog=dialog)
        except TelephonyRouteSelectionError as exc:
            # Appel vers un compte SIP sans workflow configuré ou en-tête invalide
            logger.warning(
                "Appel SIP rejeté : %s",
                str(exc),
            )
            await rtp_server.stop()
            with contextlib.suppress(Exception):
                await send_sip_reply(
                    dialog,
                    404,
                    reason="Not Found",
                    contact_uri=contact_uri,
                )
            return
        except Exception:  # pragma: no cover - dépend des callbacks
            logger.exception(
                "Erreur lors de la gestion applicative de l'INVITE"
            )
            await rtp_server.stop()
            with contextlib.suppress(Exception):
                await send_sip_reply(
                    dialog,
                    500,
                    reason="Server Internal Error",
                    contact_uri=contact_uri,
                )
            return

        # Récupérer la session créée et y stocker les callbacks RTP
        call_id_raw = getattr(request, "headers", {}).get("Call-ID")
        call_id: str | None = None
        session: SipCallSession | None = None

        if call_id_raw:
            if isinstance(call_id_raw, list | tuple) and call_id_raw:
                call_id = str(call_id_raw[0])
            else:
                call_id = str(call_id_raw)

            session = sip_handler.get_session(call_id)
            if session:
                telephony_metadata = session.metadata.setdefault("telephony", {})
                telephony_metadata["rtp_server"] = rtp_server

                def _rtp_stream_factory() -> Any:
                    return rtp_server.packet_stream()

                telephony_metadata["rtp_stream_factory"] = _rtp_stream_factory
                telephony_metadata["send_audio"] = rtp_server.send_audio
                logger.info(
                    "Serveur RTP configuré pour Call-ID=%s (port=%d)",
                    call_id,
                    actual_media_port,
                )
            else:
                logger.warning(
                    "Session introuvable pour Call-ID=%s, serveur RTP non configuré",
                    call_id,
                )
                await rtp_server.stop()
                return

        # Attacher les callbacks dialog AVANT d'envoyer le 200 OK
        # pour capturer l'ACK qui arrive juste après
        await _attach_dialog_callbacks(dialog, sip_handler)

        # Extraire le ring_timeout_seconds depuis les métadonnées de la session
        ring_timeout_seconds = 0.0
        if session:
            telephony_meta = session.metadata.get("telephony") or {}
            ring_timeout_seconds = telephony_meta.get("ring_timeout_seconds", 0.0)
            logger.info(
                "Ring timeout extrait des métadonnées (Call-ID=%s): %.2f secondes",
                call_id or "inconnu",
                ring_timeout_seconds,
            )

        # Si ring_timeout > 0, pré-initialiser la session Realtime en parallèle
        # pour qu'elle soit prête quand l'appel sera répondu
        session_init_task = None
        if session and ring_timeout_seconds > 0:
            telephony_meta = session.metadata.get("telephony") or {}
            voice_model = telephony_meta.get("voice_model")
            instructions = telephony_meta.get("voice_instructions")
            voice_name = telephony_meta.get("voice_voice")
            voice_provider_id = telephony_meta.get("voice_provider_id")
            voice_provider_slug = telephony_meta.get("voice_provider_slug")
            voice_tools = telephony_meta.get("voice_tools") or []
            voice_handoffs = telephony_meta.get("voice_handoffs") or []
            speak_first = telephony_meta.get("speak_first", False)

        # Envoyer le 200 OK (avec le ring timeout)
        try:
            await handle_incoming_invite(
                dialog,
                request,
                media_host=media_host,
                media_port=actual_media_port,
                contact_uri=contact_uri,
                ring_timeout_seconds=ring_timeout_seconds,
            )
            # Envoyer un paquet de silence immédiatement pour accélérer la découverte RTP
            await rtp_server.send_silence_packet()
        except InviteHandlingError as exc:
            logger.warning("Traitement de l'INVITE interrompu : %s", exc)
            await rtp_server.stop()
            return
        except Exception as exc:  # pragma: no cover - dépend de aiosip
            logger.exception(
                "Erreur inattendue lors du traitement d'un INVITE",
                exc_info=exc,
            )
            await rtp_server.stop()
            with contextlib.suppress(Exception):
                await send_sip_reply(
                    dialog,
                    500,
                    reason="Server Internal Error",
                    contact_uri=contact_uri,
                )
            return

        # Démarrer la session RTP immédiatement après le 200 OK
        # Le téléphone commence déjà à envoyer de l'audio, pas besoin d'attendre l'ACK
        if session:
            logger.info(
                "Démarrage immédiat de la session RTP pour Call-ID=%s",
                call_id,
            )
            try:
                await sip_handler.start_rtp_session(session)
            except Exception as exc:
                logger.exception(
                    "Erreur lors du démarrage de la session RTP pour %s",
                    call_id,
                    exc_info=exc,
                )
                await rtp_server.stop()

    return _on_invite


def _run_ad_hoc_migrations() -> None:
    """Apply les évolutions mineures du schéma sans Alembic."""

    with engine.begin() as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())
        if "available_models" not in table_names:
            logger.info("Création de la table available_models manquante")
            AvailableModel.__table__.create(bind=connection)
            table_names.add("available_models")
        else:
            available_models_columns = {
                column["name"]
                for column in inspect(connection).get_columns("available_models")
            }
            if "provider_id" not in available_models_columns:
                logger.info(
                    "Migration du schéma available_models : ajout de la colonne "
                    "provider_id"
                )
                connection.execute(
                    text(
                        "ALTER TABLE available_models ADD COLUMN provider_id "
                        "VARCHAR(128)"
                    )
                )
            if "provider_slug" not in available_models_columns:
                logger.info(
                    "Migration du schéma available_models : ajout de la colonne "
                    "provider_slug"
                )
                connection.execute(
                    text(
                        "ALTER TABLE available_models ADD COLUMN provider_slug "
                        "VARCHAR(64)"
                    )
                )
            if "supports_previous_response_id" not in available_models_columns:
                logger.info(
                    "Migration du schéma available_models : ajout de la colonne "
                    "supports_previous_response_id"
                )
                connection.execute(
                    text(
                        "ALTER TABLE available_models ADD COLUMN "
                        "supports_previous_response_id BOOLEAN NOT NULL DEFAULT TRUE"
                    )
                )
            if "supports_reasoning_summary" not in available_models_columns:
                logger.info(
                    "Migration du schéma available_models : ajout de la colonne "
                    "supports_reasoning_summary"
                )
                connection.execute(
                    text(
                        "ALTER TABLE available_models ADD COLUMN "
                        "supports_reasoning_summary BOOLEAN NOT NULL DEFAULT TRUE"
                    )
                )
            if "store" not in available_models_columns:
                logger.info(
                    "Migration du schéma available_models : ajout de la colonne "
                    "store"
                )
                connection.execute(
                    text("ALTER TABLE available_models ADD COLUMN store BOOLEAN")
                )

        if "voice_settings" not in table_names:
            logger.info("Création de la table voice_settings manquante")
            VoiceSettings.__table__.create(bind=connection)
            table_names.add("voice_settings")

        if "workflow_appearances" not in table_names:
            logger.info("Création de la table workflow_appearances manquante")
            WorkflowAppearance.__table__.create(bind=connection)
            table_names.add("workflow_appearances")

        if "hosted_workflows" in table_names:
            hosted_columns = {
                column["name"]
                for column in inspect(connection).get_columns("hosted_workflows")
            }
            if "remote_workflow_id" not in hosted_columns:
                logger.info(
                    "Migration du schéma hosted_workflows : ajout de la colonne "
                    "remote_workflow_id",
                )
                connection.execute(
                    text(
                        "ALTER TABLE hosted_workflows ADD COLUMN "
                        "remote_workflow_id VARCHAR(128)"
                    )
                )
                connection.execute(
                    text(
                        "UPDATE hosted_workflows SET remote_workflow_id = slug "
                        "WHERE remote_workflow_id IS NULL"
                    )
                )

        if "voice_settings" in table_names:
            voice_settings_columns = {
                column["name"]
                for column in inspect(connection).get_columns("voice_settings")
            }
            if "provider_id" not in voice_settings_columns:
                logger.info(
                    "Migration du schéma voice_settings : ajout de la colonne "
                    "provider_id",
                )
                connection.execute(
                    text(
                        "ALTER TABLE voice_settings ADD COLUMN provider_id "
                        "VARCHAR(128)"
                    )
                )
            if "provider_slug" not in voice_settings_columns:
                logger.info(
                    "Migration du schéma voice_settings : ajout de la colonne "
                    "provider_slug",
                )
                connection.execute(
                    text(
                        "ALTER TABLE voice_settings ADD COLUMN provider_slug "
                        "VARCHAR(64)"
                    )
                )

        if "app_settings" not in table_names:
            logger.info("Création de la table app_settings manquante")
            AppSettings.__table__.create(bind=connection)
            table_names.add("app_settings")

        # Migration pour les comptes SIP multiples
        if "sip_accounts" not in table_names:
            logger.info("Création de la table sip_accounts pour les comptes SIP multiples")
            SipAccount.__table__.create(bind=connection)
            table_names.add("sip_accounts")

        if "mcp_servers" not in table_names:
            logger.info("Création de la table mcp_servers manquante")
            McpServer.__table__.create(bind=connection)
            table_names.add("mcp_servers")
        else:
            mcp_columns = {
                column["name"]
                for column in inspect(connection).get_columns("mcp_servers")
            }
            dialect_name = connection.dialect.name
            json_type = "JSONB" if dialect_name == "postgresql" else "JSON"
            timestamp_type = (
                "TIMESTAMP WITH TIME ZONE"
                if dialect_name == "postgresql"
                else "TIMESTAMP"
            )

            def _add_mcp_column(name: str, definition: str) -> None:
                if name in mcp_columns:
                    return
                logger.info(
                    "Migration du schéma mcp_servers : ajout de la colonne %s",
                    name,
                )
                connection.execute(
                    text(f"ALTER TABLE mcp_servers ADD COLUMN {name} {definition}")
                )
                mcp_columns.add(name)

            _add_mcp_column("transport", "VARCHAR(32)")
            _add_mcp_column("is_active", "BOOLEAN NOT NULL DEFAULT TRUE")
            _add_mcp_column("authorization_encrypted", "TEXT")
            _add_mcp_column("authorization_hint", "VARCHAR(128)")
            _add_mcp_column("access_token_encrypted", "TEXT")
            _add_mcp_column("access_token_hint", "VARCHAR(128)")
            _add_mcp_column("refresh_token_encrypted", "TEXT")
            _add_mcp_column("refresh_token_hint", "VARCHAR(128)")
            _add_mcp_column("oauth_client_id", "VARCHAR(255)")
            _add_mcp_column("oauth_client_secret_encrypted", "TEXT")
            _add_mcp_column("oauth_client_secret_hint", "VARCHAR(128)")
            _add_mcp_column("oauth_scope", "TEXT")
            _add_mcp_column("oauth_authorization_endpoint", "TEXT")
            _add_mcp_column("oauth_token_endpoint", "TEXT")
            _add_mcp_column("oauth_redirect_uri", "TEXT")
            _add_mcp_column("oauth_metadata", json_type)
            _add_mcp_column("tools_cache", json_type)
            _add_mcp_column(
                "tools_cache_updated_at", f"{timestamp_type}"
            )
            _add_mcp_column(
                "created_at",
                f"{timestamp_type} NOT NULL DEFAULT CURRENT_TIMESTAMP",
            )
            _add_mcp_column(
                "updated_at",
                f"{timestamp_type} NOT NULL DEFAULT CURRENT_TIMESTAMP",
            )

        # Ajouter la colonne sip_account_id dans workflow_definitions
        if "workflow_definitions" in table_names:
            workflow_definitions_columns = {
                column["name"]
                for column in inspect(connection).get_columns("workflow_definitions")
            }
            if "sip_account_id" not in workflow_definitions_columns:
                logger.info(
                    "Migration du schéma workflow_definitions : ajout de la colonne "
                    "sip_account_id"
                )
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions ADD COLUMN sip_account_id "
                        "INTEGER REFERENCES sip_accounts(id) ON DELETE SET NULL"
                    )
                )
                connection.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS idx_workflow_definitions_sip_account "
                        "ON workflow_definitions(sip_account_id)"
                    )
                )

        # Migration automatique des paramètres SIP globaux vers un compte SIP
        if "sip_accounts" in table_names and "app_settings" in table_names:
            # Vérifier s'il n'y a pas déjà de comptes SIP
            existing_accounts_count = connection.execute(
                text("SELECT COUNT(*) FROM sip_accounts")
            ).scalar()

            if existing_accounts_count == 0:
                # Récupérer les paramètres globaux
                app_settings_row = connection.execute(
                    text(
                        "SELECT sip_trunk_uri, sip_trunk_username, sip_trunk_password, "
                        "sip_contact_host, sip_contact_port, sip_contact_transport "
                        "FROM app_settings LIMIT 1"
                    )
                ).first()

                if app_settings_row and app_settings_row[0]:  # sip_trunk_uri existe
                    trunk_uri_raw = app_settings_row[0]
                    username = app_settings_row[1]
                    password = app_settings_row[2]
                    contact_host = app_settings_row[3]
                    contact_port = app_settings_row[4]
                    contact_transport = app_settings_row[5] or "udp"

                    # Construire un URI SIP valide
                    trunk_uri = trunk_uri_raw.strip()
                    if not trunk_uri.lower().startswith(("sip:", "sips:")):
                        # Format legacy: probablement juste l'host
                        if username:
                            trunk_uri = f"sip:{username}@{trunk_uri}"
                        else:
                            trunk_uri = f"sip:chatkit@{trunk_uri}"

                    logger.info(
                        "Migration automatique des paramètres SIP globaux vers un compte SIP"
                    )

                    # Créer le compte SIP
                    connection.execute(
                        text(
                            "INSERT INTO sip_accounts "
                            "(label, trunk_uri, username, password, contact_host, contact_port, "
                            "contact_transport, is_default, is_active, created_at, updated_at) "
                            "VALUES (:label, :trunk_uri, :username, :password, :contact_host, "
                            ":contact_port, :contact_transport, :is_default, :is_active, "
                            ":created_at, :updated_at)"
                        ),
                        {
                            "label": "Compte migré (legacy)",
                            "trunk_uri": trunk_uri,
                            "username": username,
                            "password": password,
                            "contact_host": contact_host,
                            "contact_port": contact_port,
                            "contact_transport": contact_transport,
                            "is_default": True,
                            "is_active": True,
                            "created_at": datetime.datetime.now(datetime.UTC),
                            "updated_at": datetime.datetime.now(datetime.UTC),
                        },
                    )

                    # Nettoyer les paramètres globaux
                    connection.execute(
                        text(
                            "UPDATE app_settings SET "
                            "sip_trunk_uri = NULL, "
                            "sip_trunk_username = NULL, "
                            "sip_trunk_password = NULL, "
                            "sip_contact_host = NULL, "
                            "sip_contact_port = NULL, "
                            "sip_contact_transport = NULL"
                        )
                    )

                    logger.info(
                        "Migration SIP terminée : ancien système désactivé, "
                        "nouveau compte SIP créé"
                    )

        if "app_settings" in table_names:
            app_settings_columns = {
                column["name"]
                for column in inspect(connection).get_columns("app_settings")
            }
            if "thread_title_model" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "thread_title_model",
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN thread_title_model "
                        "VARCHAR(128)"
                    )
                )
                default_model_param = bindparam(
                    "default_model", type_=String(128), literal_execute=True
                )
                connection.execute(
                    text(
                        "UPDATE app_settings SET thread_title_model = :default_model"
                    ).bindparams(default_model_param),
                    {"default_model": DEFAULT_THREAD_TITLE_MODEL},
                )
                dialect = connection.dialect.name
                if dialect == "postgresql":
                    connection.execute(
                        text(
                            "ALTER TABLE app_settings ALTER COLUMN thread_title_model "
                            "SET DEFAULT :default_model"
                        ).bindparams(default_model_param),
                        {"default_model": DEFAULT_THREAD_TITLE_MODEL},
                    )
                    connection.execute(
                        text(
                            "ALTER TABLE app_settings ALTER COLUMN thread_title_model "
                            "SET NOT NULL"
                        )
                    )
            if "sip_trunk_uri" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_trunk_uri"
                )
                connection.execute(
                    text("ALTER TABLE app_settings ADD COLUMN sip_trunk_uri TEXT")
                )
            if "sip_trunk_username" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_trunk_username"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN sip_trunk_username "
                        "VARCHAR(128)"
                    )
                )
            if "sip_trunk_password" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_trunk_password"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN sip_trunk_password "
                        "VARCHAR(256)"
                    )
                )
            if "sip_contact_host" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_contact_host"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN sip_contact_host "
                        "VARCHAR(255)"
                    )
                )
            if "sip_contact_port" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_contact_port"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN sip_contact_port INTEGER"
                    )
                )
            if "sip_contact_transport" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "sip_contact_transport"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN sip_contact_transport "
                        "VARCHAR(16)"
                    )
                )
            if "model_provider" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "model_provider"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN model_provider "
                        "VARCHAR(64)"
                    )
                )
            if "model_api_base" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "model_api_base"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN model_api_base TEXT"
                    )
                )
            if "model_api_key_encrypted" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "model_api_key_encrypted"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN model_api_key_encrypted "
                        "TEXT"
                    )
                )
            if "model_api_key_hint" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "model_api_key_hint"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN model_api_key_hint "
                        "VARCHAR(128)"
                    )
                )
            if "model_provider_configs" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "model_provider_configs"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN model_provider_configs "
                        "TEXT"
                    )
                )
            if "appearance_color_scheme" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_color_scheme"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_color_scheme "
                        "VARCHAR(16)"
                    )
                )
            if "appearance_accent_color" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_accent_color"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_accent_color "
                        "VARCHAR(32)"
                    )
                )
            if "appearance_use_custom_surface" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_use_custom_surface"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_use_custom_surface "
                        "BOOLEAN"
                    )
                )
            if "appearance_surface_hue" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_surface_hue"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_surface_hue "
                        "FLOAT"
                    )
                )
            if "appearance_surface_tint" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_surface_tint"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_surface_tint "
                        "FLOAT"
                    )
                )
            if "appearance_surface_shade" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_surface_shade"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_surface_shade "
                        "FLOAT"
                    )
                )
            if "appearance_heading_font" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_heading_font"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_heading_font "
                        "VARCHAR(128)"
                    )
                )
            if "appearance_body_font" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_body_font"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_body_font "
                        "VARCHAR(128)"
                    )
                )
            if "appearance_start_greeting" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_start_greeting"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_start_greeting "
                        "TEXT"
                    )
                )
            if "appearance_start_prompt" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_start_prompt"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_start_prompt "
                        "TEXT"
                    )
                )
            if "appearance_input_placeholder" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_input_placeholder"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_input_placeholder "
                        "TEXT"
                    )
                )
            if "appearance_disclaimer" not in app_settings_columns:
                logger.info(
                    "Migration du schéma app_settings : ajout de la colonne "
                    "appearance_disclaimer"
                )
                connection.execute(
                    text(
                        "ALTER TABLE app_settings ADD COLUMN appearance_disclaimer "
                        "TEXT"
                    )
                )

        if "telephony_routes" not in table_names:
            logger.info("Création de la table telephony_routes manquante")
            TelephonyRoute.__table__.create(bind=connection)
            table_names.add("telephony_routes")

        # Migration de la dimension des vecteurs dans json_chunks
        if "json_chunks" in table_names:
            dialect = connection.dialect.name
            if dialect == "postgresql":
                # Vérifier la dimension actuelle de la colonne embedding
                # en interrogeant directement le type
                result = connection.execute(
                    text(
                        "SELECT format_type(atttypid, atttypmod) "
                        "FROM pg_attribute "
                        "JOIN pg_class ON pg_attribute.attrelid = pg_class.oid "
                        "WHERE pg_class.relname = 'json_chunks' "
                        "AND pg_attribute.attname = 'embedding'"
                    )
                ).scalar()

                # result est de la forme 'vector(1536)'
                # ou None si la colonne n'existe pas
                current_dimension = None
                if result is not None:
                    # Extraire la dimension du format 'vector(1536)'
                    import re

                    match = re.match(r"vector\((\d+)\)", result)
                    if match:
                        current_dimension = int(match.group(1))

                if (
                    current_dimension is not None
                    and current_dimension != EMBEDDING_DIMENSION
                ):
                    logger.info(
                        "Migration de la dimension des vecteurs : %d -> %d dimensions. "
                        "Suppression des données vectorielles existantes.",
                        current_dimension,
                        EMBEDDING_DIMENSION,
                    )
                    # Supprimer l'index vectoriel s'il existe
                    connection.execute(
                        text("DROP INDEX IF EXISTS ix_json_chunks_embedding")
                    )
                    # Supprimer toutes les données de la table json_chunks
                    # car les embeddings existants ne sont plus compatibles
                    connection.execute(text("TRUNCATE TABLE json_chunks CASCADE"))
                    connection.execute(text("TRUNCATE TABLE json_documents CASCADE"))
                    # Recréer la colonne avec la nouvelle dimension
                    connection.execute(
                        text("ALTER TABLE json_chunks DROP COLUMN embedding")
                    )
                    connection.execute(
                        text(
                            "ALTER TABLE json_chunks "
                            f"ADD COLUMN embedding vector({EMBEDDING_DIMENSION}) "
                            "NOT NULL"
                        )
                    )

        if "workflows" in table_names:
            workflow_columns = {
                column["name"]
                for column in inspect(connection).get_columns("workflows")
            }
            if "is_chatkit_default" not in workflow_columns:
                dialect = connection.dialect.name
                logger.info(
                    "Migration du schéma des workflows : ajout de la colonne "
                    "is_chatkit_default"
                )
                connection.execute(
                    text(
                        "ALTER TABLE workflows "
                        "ADD COLUMN is_chatkit_default BOOLEAN NOT NULL DEFAULT FALSE"
                    )
                )
                connection.execute(
                    text(
                        "UPDATE workflows SET is_chatkit_default = TRUE "
                        "WHERE slug = :slug"
                    ),
                    {"slug": "workflow-par-defaut"},
                )
                if dialect == "postgresql":
                    connection.execute(
                        text(
                            "ALTER TABLE workflows ALTER COLUMN "
                            "is_chatkit_default SET DEFAULT FALSE"
                        )
                    )

        if "workflow_steps" in table_names:
            dialect = connection.dialect.name

            def _refresh_columns() -> set[str]:
                return {
                    column["name"]
                    for column in inspect(connection).get_columns("workflow_steps")
                }

            columns = _refresh_columns()

            def _get_column(name: str) -> dict[str, Any] | None:
                for column in inspect(connection).get_columns("workflow_steps"):
                    if column["name"] == name:
                        return column
                return None

            if "slug" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_steps "
                        "ADD COLUMN slug VARCHAR(128)"
                    )
                )
                if dialect == "postgresql":
                    connection.execute(
                        text("UPDATE workflow_steps SET slug = CONCAT('step_', id)")
                    )
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_steps ALTER COLUMN slug "
                            "SET NOT NULL"
                        )
                    )
                else:
                    connection.execute(
                        text("UPDATE workflow_steps SET slug = 'step_' || id")
                    )
                columns = _refresh_columns()

            if "kind" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_steps "
                        "ADD COLUMN kind VARCHAR(32) NOT NULL DEFAULT 'agent'"
                    )
                )
                columns = _refresh_columns()

            if "display_name" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_steps "
                        "ADD COLUMN display_name VARCHAR(128)"
                    )
                )
                columns = _refresh_columns()

            agent_key_column = _get_column("agent_key")
            if agent_key_column is None:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_steps "
                        "ADD COLUMN agent_key VARCHAR(128)"
                    )
                )
                agent_key_column = _get_column("agent_key")
            if agent_key_column is not None and not agent_key_column.get(
                "nullable", True
            ):
                if dialect == "postgresql":
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_steps ALTER COLUMN agent_key "
                            "DROP NOT NULL"
                        )
                    )
                    agent_key_column = _get_column("agent_key")
                else:
                    logger.warning(
                        "Impossible de rendre la colonne agent_key nullable pour le "
                        "dialecte %s",
                        dialect,
                    )
            columns = _refresh_columns()

            if "position" not in columns:
                if "order" in columns:
                    connection.execute(
                        text("ALTER TABLE workflow_steps ADD COLUMN position INTEGER")
                    )
                    connection.execute(
                        text('UPDATE workflow_steps SET position = "order"')
                    )
                    if dialect == "postgresql":
                        connection.execute(
                            text(
                                "ALTER TABLE workflow_steps ALTER COLUMN position "
                                "SET NOT NULL"
                            )
                        )
                else:
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_steps ADD COLUMN position INTEGER "
                            "NOT NULL DEFAULT 0"
                        )
                    )
                columns = _refresh_columns()

            if "is_enabled" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_steps ADD COLUMN is_enabled BOOLEAN "
                        "NOT NULL DEFAULT TRUE"
                    )
                )
                columns = _refresh_columns()

            json_type = "JSONB" if dialect == "postgresql" else "TEXT"
            json_default = "'{}'::jsonb" if dialect == "postgresql" else "'{}'"

            if "parameters" not in columns:
                connection.execute(
                    text(
                        f"ALTER TABLE workflow_steps ADD COLUMN parameters {json_type} "
                        f"NOT NULL DEFAULT {json_default}"
                    )
                )
                columns = _refresh_columns()

            metadata_column = "metadata"
            if metadata_column not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_steps "
                        f"ADD COLUMN {metadata_column} {json_type} "
                        f"NOT NULL DEFAULT {json_default}"
                    )
                )
                columns = _refresh_columns()

            inspector = inspect(connection)
            uniques = {
                constraint["name"]
                for constraint in inspector.get_unique_constraints("workflow_steps")
            }
            if "workflow_steps_definition_slug" not in uniques:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_steps "
                        "ADD CONSTRAINT workflow_steps_definition_slug "
                        "UNIQUE(definition_id, slug)"
                    )
                )

        if "workflow_transitions" in table_names:
            dialect = connection.dialect.name
            json_type = "JSONB" if dialect == "postgresql" else "TEXT"
            json_default = "'{}'::jsonb" if dialect == "postgresql" else "'{}'"

            def _refresh_transition_columns() -> set[str]:
                return {
                    column["name"]
                    for column in inspect(connection).get_columns(
                        "workflow_transitions"
                    )
                }

            columns = _refresh_transition_columns()

            if "condition" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_transitions "
                        "ADD COLUMN condition VARCHAR(64)"
                    )
                )
                columns = _refresh_transition_columns()

            metadata_column = "metadata"
            if metadata_column not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_transitions "
                        f"ADD COLUMN {metadata_column} {json_type} "
                        f"NOT NULL DEFAULT {json_default}"
                    )
                )

        if "workflow_definitions" in table_names:
            dialect = connection.dialect.name

            def _refresh_definition_columns() -> set[str]:
                return {
                    column["name"]
                    for column in inspect(connection).get_columns(
                        "workflow_definitions"
                    )
                }

            definition_columns = _refresh_definition_columns()

            if "workflow_id" not in definition_columns:
                logger.info(
                    "Migration du schéma des workflows : ajout de la colonne "
                    "workflow_id et rétro-portage des données"
                )

                if "workflows" not in table_names:
                    logger.info("Création de la table workflows manquante")
                    Workflow.__table__.create(bind=connection)
                    table_names.add("workflows")

                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions "
                        "ADD COLUMN workflow_id INTEGER"
                    )
                )
                definition_columns = _refresh_definition_columns()

                timestamp = datetime.datetime.now(datetime.UTC)
                default_slug = "workflow-par-defaut"
                default_display_name = "Workflow par défaut"

                workflow_row = connection.execute(
                    text("SELECT id FROM workflows WHERE slug = :slug"),
                    {"slug": default_slug},
                ).first()

                if workflow_row is None:
                    connection.execute(
                        Workflow.__table__.insert(),
                        {
                            "slug": default_slug,
                            "display_name": default_display_name,
                            "description": None,
                            "active_version_id": None,
                            "created_at": timestamp,
                            "updated_at": timestamp,
                        },
                    )
                    workflow_row = connection.execute(
                        text("SELECT id FROM workflows WHERE slug = :slug"),
                        {"slug": default_slug},
                    ).first()

                if workflow_row is None:
                    raise RuntimeError(
                        "Impossible de créer le workflow par défaut pour la migration"
                    )

                workflow_id = workflow_row.id

                connection.execute(
                    text("UPDATE workflow_definitions SET workflow_id = :workflow_id"),
                    {"workflow_id": workflow_id},
                )

                active_definition = connection.execute(
                    text(
                        "SELECT id FROM workflow_definitions "
                        "WHERE is_active IS TRUE "
                        "ORDER BY updated_at DESC LIMIT 1"
                    )
                ).first()

                if active_definition is None:
                    active_definition = connection.execute(
                        text(
                            "SELECT id FROM workflow_definitions "
                            "ORDER BY updated_at DESC LIMIT 1"
                        )
                    ).first()

                if active_definition is not None:
                    connection.execute(
                        text(
                            "UPDATE workflows SET active_version_id = :definition_id "
                            "WHERE id = :workflow_id"
                        ),
                        {
                            "definition_id": active_definition.id,
                            "workflow_id": workflow_id,
                        },
                    )

                if dialect == "postgresql":
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_definitions ALTER COLUMN "
                            "workflow_id SET NOT NULL"
                        )
                    )
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_definitions "
                            "ADD CONSTRAINT workflow_definitions_workflow_id_fkey "
                            "FOREIGN KEY (workflow_id) REFERENCES workflows (id) "
                            "ON DELETE CASCADE"
                        )
                    )
                    connection.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS "
                            "ix_workflow_definitions_workflow_id "
                            "ON workflow_definitions (workflow_id)"
                        )
                    )
                else:
                    logger.warning(
                        "La contrainte NOT NULL/FOREIGN KEY sur "
                        "workflow_definitions.workflow_id n'a pas pu être ajoutée "
                        "pour le dialecte %s",
                        dialect,
                    )

            definition_columns = _refresh_definition_columns()

            if "name" not in definition_columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions ADD COLUMN name VARCHAR(128)"
                    )
                )
                definition_columns = _refresh_definition_columns()

            if "version" not in definition_columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions "
                        "ADD COLUMN version INTEGER NOT NULL DEFAULT 1"
                    )
                )
                definition_columns = _refresh_definition_columns()

            if "is_active" not in definition_columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions "
                        "ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE"
                    )
                )
                definition_columns = _refresh_definition_columns()

            datetime_type = "TIMESTAMPTZ" if dialect == "postgresql" else "DATETIME"
            current_ts = "CURRENT_TIMESTAMP"

            if "created_at" not in definition_columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions "
                        f"ADD COLUMN created_at {datetime_type} NOT NULL DEFAULT "
                        f"{current_ts}"
                    )
                )
                definition_columns = _refresh_definition_columns()

            if "updated_at" not in definition_columns:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions "
                        f"ADD COLUMN updated_at {datetime_type} NOT NULL DEFAULT "
                        f"{current_ts}"
                    )
                )

            inspector = inspect(connection)
            unique_constraints = {
                constraint["name"]
                for constraint in inspector.get_unique_constraints(
                    "workflow_definitions"
                )
            }
            indexes = {
                index["name"]
                for index in inspector.get_indexes("workflow_definitions")
                if index.get("name")
            }

            if "workflow_definitions_name_key" in unique_constraints:
                connection.execute(
                    text(
                        "ALTER TABLE workflow_definitions DROP CONSTRAINT "
                        "workflow_definitions_name_key"
                    )
                )
                unique_constraints.discard("workflow_definitions_name_key")
            elif "workflow_definitions_name_key" in indexes:
                connection.execute(
                    text("DROP INDEX IF EXISTS workflow_definitions_name_key")
                )
                indexes.discard("workflow_definitions_name_key")

            if dialect == "postgresql":
                if "workflow_definitions_workflow_version" not in unique_constraints:
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_definitions "
                            "ADD CONSTRAINT workflow_definitions_workflow_version "
                            "UNIQUE (workflow_id, version)"
                        )
                    )
                if "workflow_definitions_workflow_name" not in unique_constraints:
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_definitions "
                            "ADD CONSTRAINT workflow_definitions_workflow_name "
                            "UNIQUE (workflow_id, name)"
                        )
                    )
            else:
                if "workflow_definitions_workflow_version" not in indexes:
                    connection.execute(
                        text(
                            "CREATE UNIQUE INDEX IF NOT EXISTS "
                            "workflow_definitions_workflow_version "
                            "ON workflow_definitions (workflow_id, version)"
                        )
                    )
                if "workflow_definitions_workflow_name" not in indexes:
                    connection.execute(
                        text(
                            "CREATE UNIQUE INDEX IF NOT EXISTS "
                            "workflow_definitions_workflow_name "
                            "ON workflow_definitions (workflow_id, name)"
                        )
                    )

        # Migration de workflow_viewports pour la séparation mobile/desktop
        if "workflow_viewports" in table_names:
            dialect = connection.dialect.name

            def _refresh_viewport_columns() -> set[str]:
                return {
                    column["name"]
                    for column in inspect(connection).get_columns("workflow_viewports")
                }

            viewport_columns = _refresh_viewport_columns()

            if "device_type" not in viewport_columns:
                logger.info(
                    "Migration du schéma des workflow_viewports : ajout de la colonne "
                    "device_type pour la séparation mobile/desktop"
                )
                # Ajouter la colonne device_type avec valeur par défaut 'desktop'
                connection.execute(
                    text(
                        "ALTER TABLE workflow_viewports "
                        "ADD COLUMN device_type VARCHAR(16) NOT NULL DEFAULT 'desktop'"
                    )
                )
                viewport_columns = _refresh_viewport_columns()

                # Supprimer l'ancienne contrainte unique
                inspector = inspect(connection)
                unique_constraints = {
                    constraint["name"]
                    for constraint in inspector.get_unique_constraints(
                        "workflow_viewports"
                    )
                }

                # Nom de l'ancienne contrainte (sans device_type)
                old_constraint_name = None
                for constraint in inspector.get_unique_constraints(
                    "workflow_viewports"
                ):
                    # Chercher une contrainte qui inclut user_id,
                    # workflow_id et version_id
                    # Chercher une contrainte qui inclut
                    # user_id, workflow_id, version_id
                    if {"user_id", "workflow_id", "version_id"}.issubset(
                        set(constraint.get("column_names", []))
                    ):
                        old_constraint_name = constraint["name"]
                        break

                if old_constraint_name:
                    logger.info(
                        "Suppression de l'ancienne contrainte unique : %s",
                        old_constraint_name,
                    )
                    if dialect == "postgresql":
                        connection.execute(
                            text(
                                f"ALTER TABLE workflow_viewports "
                                f"DROP CONSTRAINT {old_constraint_name}"
                            )
                        )
                    else:
                        connection.execute(
                            text(f"DROP INDEX IF EXISTS {old_constraint_name}")
                        )

                # Créer la nouvelle contrainte unique incluant device_type
                if dialect == "postgresql":
                    connection.execute(
                        text(
                            "ALTER TABLE workflow_viewports "
                            "ADD CONSTRAINT "
                            "workflow_viewports_user_workflow_version_device "
                            "UNIQUE (user_id, workflow_id, version_id, device_type)"
                        )
                    )
                else:
                    connection.execute(
                        text(
                            "CREATE UNIQUE INDEX IF NOT EXISTS "
                            "workflow_viewports_user_workflow_version_device "
                            "ON workflow_viewports "
                            "(user_id, workflow_id, version_id, device_type)"
                        )
                    )

                logger.info(
                    "Migration de workflow_viewports terminée : "
                    "device_type ajouté avec nouvelle contrainte unique"
                )

        # Migration de la contrainte FK pour language_generation_tasks.language_id
        if "language_generation_tasks" in table_names and "languages" in table_names:
            # Vérifier si la contrainte a besoin d'être mise à jour
            fk_constraints = inspector.get_foreign_keys("language_generation_tasks")
            needs_migration = True

            for fk in fk_constraints:
                if fk.get("name") == "language_generation_tasks_language_id_fkey":
                    # La contrainte existe - vérifier si elle a ON DELETE SET NULL
                    # Note: SQLAlchemy inspector ne retourne pas toujours les options ON DELETE
                    # On va vérifier directement dans PostgreSQL
                    if dialect == "postgresql":
                        result = connection.execute(
                            text("""
                                SELECT confdeltype
                                FROM pg_constraint
                                WHERE conname = 'language_generation_tasks_language_id_fkey'
                            """)
                        )
                        row = result.fetchone()
                        if row and row[0] == 'n':  # 'n' = SET NULL
                            needs_migration = False
                            logger.info("Migration language_generation_tasks FK : déjà appliquée")

            if needs_migration:
                logger.info(
                    "Migration language_generation_tasks : mise à jour FK "
                    "pour permettre suppression de langues"
                )
                connection.execute(
                    text("""
                        ALTER TABLE language_generation_tasks
                        DROP CONSTRAINT IF EXISTS language_generation_tasks_language_id_fkey;

                        ALTER TABLE language_generation_tasks
                        ADD CONSTRAINT language_generation_tasks_language_id_fkey
                        FOREIGN KEY (language_id)
                        REFERENCES languages(id)
                        ON DELETE SET NULL;
                    """)
                )
                logger.info(
                    "Migration language_generation_tasks FK terminée : "
                    "ON DELETE SET NULL appliqué"
                )

    # Nettoyer les serveurs MCP en doublon dans les workflows
    _cleanup_duplicate_mcp_servers()


def _cleanup_duplicate_mcp_servers() -> None:
    """Remove duplicate MCP servers from workflow tools (legacy duplicates)."""
    import json

    logger.info("Nettoyage des serveurs MCP en doublon dans les workflows...")

    with SessionLocal() as session:
        # Trouver tous les steps de type voice-agent avec des outils
        result = session.execute(
            text("""
                SELECT ws.id, ws.slug, ws.parameters
                FROM workflow_steps ws
                JOIN workflow_definitions wd ON ws.definition_id = wd.id
                WHERE wd.is_active = true
                  AND ws.kind IN ('voice-agent', 'agent')
                  AND ws.parameters IS NOT NULL
                  AND ws.parameters::text LIKE '%"type"%:%"mcp"%'
            """)
        )

        updated_count = 0
        removed_count = 0

        for row in result:
            step_id, slug, parameters_json = row

            if not parameters_json:
                continue

            parameters = dict(parameters_json) if isinstance(parameters_json, dict) else parameters_json
            tools = parameters.get('tools', [])

            if not tools:
                continue

            # Identifier les serveurs MCP et dédupliquer par URL
            seen_urls: dict[str, dict] = {}
            new_tools = []

            for tool in tools:
                if isinstance(tool, dict) and tool.get('type') == 'mcp':
                    url = (tool.get('server_url') or tool.get('url') or '').strip()
                    if not url:
                        new_tools.append(tool)
                        continue

                    if url in seen_urls:
                        # Doublon détecté - garder le plus complet (avec allowlist)
                        existing = seen_urls[url]
                        has_allowlist = 'allow' in tool or 'allowlist' in tool
                        existing_has_allowlist = 'allow' in existing or 'allowlist' in existing

                        if has_allowlist and not existing_has_allowlist:
                            # Remplacer l'ancien par le nouveau (plus complet)
                            idx = new_tools.index(existing)
                            new_tools[idx] = tool
                            seen_urls[url] = tool
                            logger.debug(
                                "Step '%s': Remplacement serveur MCP %s (ajout allowlist)",
                                slug, url
                            )
                        else:
                            # Garder l'existant, ignorer le nouveau
                            logger.debug(
                                "Step '%s': Ignoré serveur MCP en doublon: %s",
                                slug, url
                            )
                        removed_count += 1
                    else:
                        seen_urls[url] = tool
                        new_tools.append(tool)
                else:
                    new_tools.append(tool)

            # Mettre à jour si des doublons ont été supprimés
            if len(new_tools) < len(tools):
                new_parameters = dict(parameters)
                new_parameters['tools'] = new_tools

                session.execute(
                    text("UPDATE workflow_steps SET parameters = :params WHERE id = :id"),
                    {"params": json.dumps(new_parameters), "id": step_id}
                )
                updated_count += 1
                logger.info(
                    "Step '%s' nettoyé: %d outils → %d outils (%d doublons retirés)",
                    slug, len(tools), len(new_tools), len(tools) - len(new_tools)
                )

        if updated_count > 0:
            session.commit()
            logger.info(
                "Nettoyage terminé: %d workflow step(s) mis à jour, %d serveur(s) MCP en doublon retirés",
                updated_count, removed_count
            )
        else:
            logger.info("Aucun serveur MCP en doublon trouvé")


def _ensure_protected_vector_store() -> None:
    """Crée le vector store réservé aux workflows s'il est absent."""

    with SessionLocal() as session:
        service = JsonVectorStoreService(session)
        existing = service.get_store(WORKFLOW_VECTOR_STORE_SLUG)
        if existing is not None:
            session.rollback()
            return

        logger.info(
            "Création du vector store protégé %s pour les workflows",
            WORKFLOW_VECTOR_STORE_SLUG,
        )
        service.ensure_store_exists(
            WORKFLOW_VECTOR_STORE_SLUG,
            title=WORKFLOW_VECTOR_STORE_TITLE,
            description=WORKFLOW_VECTOR_STORE_DESCRIPTION,
            metadata=dict(WORKFLOW_VECTOR_STORE_METADATA),
        )
        session.commit()


def _build_pjsua_incoming_call_handler(app: FastAPI) -> Any:
    """Construit le handler pour les appels entrants PJSUA."""

    async def _handle_pjsua_incoming_call(call: Any, call_info: Any) -> None:
        """Gère un appel entrant PJSUA."""
        from .telephony.pjsua_audio_bridge import create_pjsua_audio_bridge

        pjsua_adapter: PJSUAAdapter = app.state.pjsua_adapter
        call_id = str(uuid.uuid4())

        logger.info(
            "Appel PJSUA entrant: call_id=%s, remote_uri=%s",
            call_id,
            call_info.remoteUri if hasattr(call_info, 'remoteUri') else '<unknown>',
        )

        # Extraire le numéro appelant depuis l'URI SIP
        # Format: sip:+33612345678@domain ou "Display Name" <sip:+33612345678@domain>
        remote_uri = call_info.remoteUri if hasattr(call_info, 'remoteUri') else ""
        incoming_number = None

        # Parser l'URI SIP pour extraire le numéro
        import re
        match = re.search(r"sip:([^@>;]+)@", remote_uri, flags=re.IGNORECASE)
        if match:
            incoming_number = match.group(1)
            logger.info("Numéro entrant extrait: %s", incoming_number)

        try:
            # Résoudre le workflow
            with SessionLocal() as db_session:
                workflow_service = WorkflowService(db_session)
                try:
                    context = resolve_workflow_for_phone_number(
                        workflow_service,
                        phone_number=incoming_number or "",
                        session=db_session,
                        sip_account_id=None,  # TODO: extraire depuis call_info
                    )
                except TelephonyRouteSelectionError as exc:
                    logger.warning(
                        "Aucune route téléphonie pour l'appel PJSUA (call_id=%s, numéro=%s): %s",
                        call_id,
                        incoming_number,
                        exc,
                    )
                    # Rejeter l'appel
                    await pjsua_adapter.hangup_call(call)
                    return
                except Exception as exc:
                    logger.exception(
                        "Erreur résolution workflow PJSUA (call_id=%s): %s",
                        call_id,
                        exc,
                    )
                    await pjsua_adapter.hangup_call(call)
                    return

                voice_model = context.voice_model
                instructions = context.voice_instructions
                voice_name = context.voice_voice
                voice_provider_id = context.voice_provider_id
                voice_provider_slug = context.voice_provider_slug
                voice_tools = context.voice_tools or []
                voice_handoffs = context.voice_handoffs or []
                speak_first = context.speak_first
                ring_timeout_seconds = context.ring_timeout_seconds

            # Envoyer 180 Ringing
            logger.info("Envoi 180 Ringing (call_id=%s)", call_id)
            await pjsua_adapter.answer_call(call, code=180)

            # Créer un Event pour bloquer l'envoi d'audio ET le RTP stream jusqu'à ce que le média soit actif
            # Le média devient actif APRÈS le 200 OK + ACK, quand PJSUA crée le port audio
            # IMPORTANT: Passer cet event au RTP stream pour éviter de capturer du bruit avant que le média soit prêt
            media_active_event = asyncio.Event()

            # Créer l'audio bridge IMMÉDIATEMENT après le ringing
            # pour permettre à l'assistant de générer l'audio pendant la sonnerie
            # IMPORTANT: Le RTP stream attendra media_active_event avant de yield des paquets
            logger.info("Création de l'audio bridge PJSUA AVANT la réponse (call_id=%s)", call_id)
            rtp_stream, send_to_peer_raw, clear_queue, first_packet_event, pjsua_ready_event, audio_bridge = await create_pjsua_audio_bridge(call, media_active_event)

            # pjsua_ready_event est maintenant un event spécifique à cet appel (pas partagé)
            # Plus besoin de clear() car chaque appel a son propre event frais

            # Callback pour débloquer l'audio quand le média est actif
            async def on_media_active_callback(active_call: Any, media_info: Any) -> None:
                """Appelé quand le média devient actif (port audio créé)."""
                if active_call == call:
                    logger.info("🎵 Média actif détecté (call_id=%s)", call_id)

                    # Attendre que le jitter buffer soit initialisé
                    # Le jitter buffer est "reset" au premier paquet
                    # On attend 50ms pour qu'il soit prêt
                    logger.info("⏱️ Attente 50ms pour initialisation jitter buffer... (call_id=%s)", call_id)
                    await asyncio.sleep(0.05)  # 50ms

                    # Attendre que PJSUA commence à consommer l'audio (onFrameRequested appelé)
                    # C'est CRITIQUE: si on démarre OpenAI avant, il va envoyer de l'audio
                    # alors que personne ne le consomme, et la queue va déborder
                    # Utiliser l'event spécifique à cet appel (pas un event partagé)
                    if pjsua_ready_event:
                        logger.info("⏱️ Attente que PJSUA soit prêt à consommer l'audio... (call_id=%s)", call_id)
                        await pjsua_ready_event.wait()
                        logger.info("✅ PJSUA prêt - onFrameRequested appelé (call_id=%s)", call_id)

                    # Débloquer l'audio pour que les paquets OpenAI soient transmis immédiatement
                    logger.info("✅ Déblocage de l'envoi d'audio (call_id=%s)", call_id)
                    media_active_event.set()

                    # Démarrer le voice bridge MAINTENANT
                    # La connexion OpenAI sera établie et speak_first sera traité automatiquement
                    # Le RTP stream démarrera et consommera les paquets du téléphone
                    logger.info("🚀 Démarrage de la connexion OpenAI (call_id=%s)", call_id)
                    voice_bridge_start_event.set()

            # Enregistrer le callback média avant de démarrer
            pjsua_adapter.set_media_active_callback(on_media_active_callback)

            # Callback pour nettoyer les ressources quand l'appel se termine
            bridge_ref: list[Any] = [audio_bridge]  # Stocker la référence au bridge
            cleanup_done = asyncio.Event()

            # Sauvegarder le callback précédent s'il existe
            previous_call_state_callback = getattr(pjsua_adapter, '_call_state_callback', None)

            async def on_call_state_callback(active_call: Any, call_info: Any) -> None:
                """Appelé quand l'état de l'appel change."""
                # D'abord, appeler le callback précédent s'il existe
                if previous_call_state_callback:
                    try:
                        await previous_call_state_callback(active_call, call_info)
                    except Exception as e:
                        logger.warning("Erreur dans callback précédent: %s", e)

                # Ensuite, gérer notre propre nettoyage
                if active_call == call:
                    # Si l'appel est déconnecté, nettoyer les ressources
                    if call_info.state == 6:  # PJSUA_CALL_STATE_DISCONNECTED
                        if not cleanup_done.is_set():
                            logger.info("📞 Appel déconnecté - nettoyage des ressources (call_id=%s)", call_id)

                            # Arrêter le bridge audio
                            if bridge_ref:
                                try:
                                    bridge_ref[0].stop()
                                    logger.info("✅ Bridge audio arrêté (call_id=%s)", call_id)
                                except Exception as e:
                                    logger.warning("Erreur arrêt bridge audio: %s", e)

                            # Fermer la session vocale
                            try:
                                if session_handle:
                                    await close_voice_session(session_id=session_handle.session_id)
                                    logger.info("✅ Session vocale fermée (call_id=%s)", call_id)
                            except Exception as e:
                                logger.warning("Erreur fermeture session vocale: %s", e)

                            cleanup_done.set()

            # Enregistrer le callback de changement d'état
            pjsua_adapter.set_call_state_callback(on_call_state_callback)

            # Wrapper send_to_peer pour bloquer l'audio jusqu'à ce que le média soit actif
            async def send_to_peer_blocked(audio: bytes) -> None:
                """Wrapper qui bloque l'envoi d'audio jusqu'à ce que le port audio existe."""
                await media_active_event.wait()
                await send_to_peer_raw(audio)

            send_to_peer = send_to_peer_blocked

            # Ajouter le tool de transfert d'appel AVANT de créer la session
            telephony_tools = list(voice_tools) if voice_tools else []
            transfer_tool_config = {
                "type": "function",
                "name": "transfer_call",
                "description": (
                    "Transfère l'appel en cours vers un autre numéro de téléphone. "
                    "Utilisez cette fonction lorsque l'appelant demande à être "
                    "transféré vers un service spécifique, un département, ou une personne."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "phone_number": {
                            "type": "string",
                            "description": (
                                "Le numéro de téléphone vers lequel transférer l'appel. "
                                "Format recommandé: E.164 (ex: +33123456789)"
                            ),
                        },
                        "announcement": {
                            "type": "string",
                            "description": "Message optionnel à annoncer avant le transfert",
                        },
                    },
                    "required": ["phone_number"],
                },
            }
            telephony_tools.append(transfer_tool_config)

            # OPTIMISATION: Créer la session vocale EN PARALLÈLE avec la sonnerie
            # Cela permet de gagner jusqu'à 1 seconde de latence (requête client_secret + connexion OpenAI)
            logger.info("🚀 Démarrage création session vocale PENDANT la sonnerie (call_id=%s)", call_id)

            # Créer une tâche asynchrone pour la création de session
            async def create_session_async():
                """Crée la session vocale de manière asynchrone."""
                return await asyncio.wait_for(
                    open_voice_session(
                        user_id=f"pjsua:{call_id}",
                        model=voice_model,
                        instructions=instructions,
                        voice=voice_name,
                        provider_id=voice_provider_id,
                        provider_slug=voice_provider_slug,
                        tools=telephony_tools,
                        handoffs=voice_handoffs,
                        realtime={},
                        metadata={
                            "pjsua_call_id": call_id,
                            "incoming_number": incoming_number,
                        },
                    ),
                    timeout=10.0,  # Timeout de 10 secondes
                )

            session_task = asyncio.create_task(create_session_async())

            # Attendre la sonnerie ET la création de session en parallèle
            if ring_timeout_seconds > 0:
                logger.info(
                    "⏰ Sonnerie de %.2f secondes (en parallèle avec création session) (call_id=%s)",
                    ring_timeout_seconds,
                    call_id,
                )
                await asyncio.sleep(ring_timeout_seconds)
                logger.info("🔔 Sonnerie terminée, attente de la session si nécessaire... (call_id=%s)", call_id)

            # Attendre que la session soit prête (si elle n'est pas déjà terminée)
            try:
                session_handle = await session_task
            except asyncio.TimeoutError:
                logger.error(
                    "⏱️ Timeout lors de la création de session Realtime (call_id=%s) - "
                    "OpenAI ne répond pas",
                    call_id,
                )
                await pjsua_adapter.hangup_call(call)
                return
            except Exception as e:
                logger.exception(
                    "❌ Erreur lors de la création de session Realtime (call_id=%s)",
                    call_id,
                    exc_info=e,
                )
                await pjsua_adapter.hangup_call(call)
                return

            # Récupérer le client secret
            client_secret = session_handle.client_secret

            if not client_secret:
                logger.error(
                    "Client secret introuvable pour l'appel %s - fermeture session",
                    call_id,
                )
                try:
                    await close_voice_session(session_id=session_handle.session_id)
                except Exception:
                    pass
                await pjsua_adapter.hangup_call(call)
                return

            logger.info("Session vocale créée (session_id=%s)", session_handle.session_id)

            # Créer les hooks pour le voice bridge
            async def close_dialog_hook() -> None:
                """Ferme le dialogue SIP."""
                try:
                    await pjsua_adapter.hangup_call(call)
                    logger.info("Appel PJSUA terminé (call_id=%s)", call_id)
                except Exception as e:
                    # Ignorer les erreurs "already terminated" (appel déjà raccroché)
                    error_str = str(e).lower()
                    if "already terminated" not in error_str and "esessionterminated" not in error_str:
                        logger.warning("Erreur fermeture appel PJSUA: %s", e)

            async def clear_voice_state_hook() -> None:
                """Nettoie l'état vocal."""
                # Pas de cleanup spécifique pour PJSUA (géré par l'adaptateur)
                pass

            async def resume_workflow_hook(transcripts: list[dict[str, str]]) -> None:
                """Callback appelé à la fin de la session vocale."""
                logger.info(
                    "Session vocale PJSUA terminée avec %d transcripts (call_id=%s)",
                    len(transcripts),
                    call_id,
                )
                # TODO: Intégrer avec workflow executor si nécessaire

            hooks = VoiceBridgeHooks(
                close_dialog=close_dialog_hook,
                clear_voice_state=clear_voice_state_hook,
                resume_workflow=resume_workflow_hook,
            )

            # Créer le voice bridge
            voice_bridge = TelephonyVoiceBridge(hooks=hooks, input_codec="pcm")

            # Déterminer le base URL pour le provider
            realtime_api_base: str | None = None
            if voice_provider_slug == "openai":
                realtime_api_base = os.environ.get("CHATKIT_API_BASE") or "https://api.openai.com"

            # Event pour contrôler quand démarrer le voice bridge
            # Le voice bridge ne doit démarrer QU'APRÈS que le média soit actif et l'audio débloqué
            voice_bridge_start_event = asyncio.Event()

            async def run_voice_bridge():
                """Tâche pour exécuter le voice bridge."""
                # Attendre que le média soit actif et l'audio débloqué
                await voice_bridge_start_event.wait()
                logger.info("🚀 Démarrage TelephonyVoiceBridge maintenant que l'audio est prêt (call_id=%s)", call_id)

                try:
                    stats = await voice_bridge.run(
                        runner=session_handle.runner,
                        client_secret=client_secret,
                        model=voice_model,
                        instructions=instructions,
                        voice=voice_name,
                        rtp_stream=rtp_stream,
                        send_to_peer=send_to_peer,
                        clear_audio_queue=clear_queue,
                        pjsua_ready_to_consume=pjsua_ready_event,  # Attendre que PJSUA soit prêt avant speak_first
                        audio_bridge=audio_bridge,  # Pour enable_audio_output() après silence priming
                        api_base=realtime_api_base,
                        tools=telephony_tools,
                        handoffs=voice_handoffs,
                        speak_first=speak_first,  # speak_first sera traité par VoiceBridge au bon moment
                    )
                    logger.info("TelephonyVoiceBridge PJSUA terminé: %s (call_id=%s)", stats, call_id)
                except Exception as e:
                    logger.exception("Erreur dans VoiceBridge PJSUA (call_id=%s): %s", call_id, e)

            # Créer la tâche mais elle attendra l'event avant de démarrer
            voice_bridge_task = asyncio.create_task(run_voice_bridge())

            # Maintenant répondre à l'appel (200 OK)
            logger.info("📞 Réponse à l'appel PJSUA (call_id=%s)", call_id)
            await pjsua_adapter.answer_call(call, code=200)

            # L'audio sera débloqué automatiquement par le callback on_media_active_callback
            # quand PJSUA appellera onCallMediaState et créera le port audio
            logger.info("⏳ Attente que le média devienne actif pour envoyer l'audio... (call_id=%s)", call_id)

            # Attendre la fin du voice bridge
            try:
                await voice_bridge_task
                # Session vocale terminée - raccrocher l'appel de notre côté
                logger.info("✅ Session vocale fermée (call_id=%s)", call_id)
                try:
                    await pjsua_adapter.hangup_call(call)
                    logger.info("📞 Appel PJSUA raccroché (call_id=%s)", call_id)
                except Exception as hangup_error:
                    # Ignorer les erreurs "already terminated" (appel déjà raccroché)
                    error_str = str(hangup_error).lower()
                    if "already terminated" not in error_str and "esessionterminated" not in error_str:
                        logger.warning("Erreur fermeture appel PJSUA: %s", hangup_error)
            except Exception as e:
                logger.exception("Erreur d'attente du voice bridge (call_id=%s): %s", call_id, e)
                # En cas d'erreur, aussi raccrocher
                try:
                    await pjsua_adapter.hangup_call(call)
                except Exception:
                    pass
            finally:
                # Garantir la fermeture de la session Realtime
                try:
                    await close_voice_session(session_id=session_handle.session_id)
                    logger.info("🔒 Session Realtime fermée explicitement (call_id=%s)", call_id)
                except Exception as cleanup_error:
                    logger.warning(
                        "Erreur lors du nettoyage de session Realtime (call_id=%s): %s",
                        call_id,
                        cleanup_error,
                    )

        except Exception as e:
            logger.exception("Erreur traitement appel entrant PJSUA (call_id=%s): %s", call_id, e)
            try:
                await pjsua_adapter.hangup_call(call)
            except Exception:
                pass

    return _handle_pjsua_incoming_call


def register_startup_events(app: FastAPI) -> None:
    sip_contact_host = settings.sip_contact_host
    sip_contact_port = (
        settings.sip_contact_port
        if settings.sip_contact_port is not None
        else settings.sip_bind_port
    )

    # Choisir entre PJSUA ou aiosip selon la configuration
    if USE_PJSUA:
        logger.info("Utilisation de PJSUA pour la téléphonie SIP")
        # Créer l'adaptateur PJSUA (sera initialisé au démarrage)
        pjsua_adapter = PJSUAAdapter()
        app.state.pjsua_adapter = pjsua_adapter
        app.state.sip_registration = None  # Pas de MultiSIPRegistrationManager avec PJSUA
    else:
        logger.info("Utilisation d'aiosip pour la téléphonie SIP (legacy)")
        # Utiliser le gestionnaire multi-SIP pour supporter plusieurs comptes
        sip_registration_manager = MultiSIPRegistrationManager(
            session_factory=SessionLocal,
            settings=settings,
            contact_host=sip_contact_host,
            contact_port=sip_contact_port,
            contact_transport=settings.sip_contact_transport,
            bind_host=settings.sip_bind_host,
        )
        sip_registration_manager.set_invite_handler(
            _build_invite_handler(sip_registration_manager)
        )
        app.state.sip_registration = sip_registration_manager
        app.state.pjsua_adapter = None

    @app.on_event("startup")
    def _on_startup() -> None:
        wait_for_database()
        ensure_database_extensions()
        _run_ad_hoc_migrations()
        Base.metadata.create_all(bind=engine)
        ensure_vector_indexes()
        with SessionLocal() as session:
            override = get_thread_title_prompt_override(session)
            runtime_settings = apply_runtime_model_overrides(override)
        configure_model_provider(runtime_settings)
        _ensure_protected_vector_store()
        if settings.admin_email and settings.admin_password:
            normalized_email = settings.admin_email.lower()
            with SessionLocal() as session:
                existing = session.scalar(
                    select(User).where(User.email == normalized_email)
                )
                if not existing:
                    logger.info("Creating initial admin user %s", normalized_email)
                    user = User(
                        email=normalized_email,
                        password_hash=hash_password(settings.admin_password),
                        is_admin=True,
                    )
                    session.add(user)
                    session.commit()
        if settings.docs_seed_documents:
            with SessionLocal() as session:
                service = DocumentationService(session)
                for seed in settings.docs_seed_documents:
                    slug = str(seed.get("slug") or "").strip()
                    if not slug:
                        logger.warning(
                            "Entrée de seed documentation ignorée : slug manquant"
                        )
                        continue
                    if service.get_document(slug) is not None:
                        continue
                    metadata = {
                        key: value
                        for key, value in seed.items()
                        if key
                        not in {
                            "slug",
                            "title",
                            "summary",
                            "language",
                            "content_markdown",
                        }
                    }
                    try:
                        service.create_document(
                            slug,
                            title=seed.get("title"),
                            summary=seed.get("summary"),
                            language=seed.get("language"),
                            content_markdown=seed.get("content_markdown"),
                            metadata=metadata,
                        )
                        session.commit()
                        logger.info(
                            "Document de documentation initial importé : %s", slug
                        )
                    except Exception as exc:  # pragma: no cover - dépend externe
                        session.rollback()
                        logger.warning(
                            "Impossible d'ingérer le document de seed %s : %s",
                            slug,
                            exc,
                        )

    @app.on_event("startup")
    async def _start_sip_registration() -> None:
        if USE_PJSUA:
            # Démarrer PJSUA
            pjsua_adapter: PJSUAAdapter = app.state.pjsua_adapter
            try:
                # Initialiser l'endpoint PJSUA
                port = settings.sip_bind_port or 5060
                await pjsua_adapter.initialize(port=port)
                logger.info("PJSUA endpoint initialisé sur port %d", port)

                # Charger le compte SIP depuis la BD
                with SessionLocal() as session:
                    account_loaded = await pjsua_adapter.load_account_from_db(session)
                    if account_loaded:
                        logger.info("Compte SIP chargé depuis la BD pour PJSUA")
                    else:
                        logger.warning("Aucun compte SIP actif trouvé - PJSUA en mode sans compte")

                # Initialiser le gestionnaire d'appels sortants avec PJSUA
                from .telephony.outbound_call_manager import get_outbound_call_manager
                get_outbound_call_manager(pjsua_adapter=pjsua_adapter)
                logger.info("OutboundCallManager initialisé avec PJSUA")

                # Configurer le callback pour les appels entrants
                incoming_call_handler = _build_pjsua_incoming_call_handler(app)
                pjsua_adapter.set_incoming_call_callback(incoming_call_handler)
                logger.info("Callback appels entrants PJSUA configuré")

                logger.info("PJSUA prêt pour les appels SIP")
            except Exception as e:
                logger.exception("Erreur lors du démarrage de PJSUA: %s", e)
        else:
            # Démarrer aiosip (legacy)
            manager: MultiSIPRegistrationManager = app.state.sip_registration
            with SessionLocal() as session:
                # Charger tous les comptes SIP actifs depuis la BD
                await manager.load_accounts_from_db(session)

                # Si aucun compte SIP n'est configuré, essayer les anciens paramètres
                if not manager.has_accounts():
                    logger.info(
                        "Aucun compte SIP trouvé en BD, tentative de chargement depuis AppSettings"
                    )
                    # Fallback : créer un gestionnaire unique avec les anciens paramètres
                    stored_settings = session.scalar(select(AppSettings).limit(1))
                    if stored_settings and stored_settings.sip_trunk_uri:
                        from .telephony.registration import SIPRegistrationConfig

                        # Créer un compte SIP temporaire depuis AppSettings
                        fallback_config = SIPRegistrationConfig(
                            uri=stored_settings.sip_trunk_uri,
                            username=stored_settings.sip_trunk_username or "",
                            password=stored_settings.sip_trunk_password or "",
                            contact_host=stored_settings.sip_contact_host or sip_contact_host or "127.0.0.1",
                            contact_port=stored_settings.sip_contact_port or sip_contact_port or 5060,
                            transport=stored_settings.sip_contact_transport,
                            bind_host=settings.sip_bind_host,
                        )

                        # Créer un gestionnaire temporaire
                        fallback_manager = SIPRegistrationManager(
                            session_factory=SessionLocal,
                            settings=settings,
                            contact_host=sip_contact_host,
                            contact_port=sip_contact_port,
                            contact_transport=settings.sip_contact_transport,
                            bind_host=settings.sip_bind_host,
                            invite_handler=_build_invite_handler(manager),
                        )
                        fallback_manager.apply_config(fallback_config)
                        # Stocker temporairement le gestionnaire fallback
                        manager._managers[0] = fallback_manager
                        logger.info("Compte SIP de fallback créé depuis AppSettings")

            await manager.start()

    @app.on_event("shutdown")
    async def _stop_sip_registration() -> None:
        if USE_PJSUA:
            # Arrêter PJSUA
            pjsua_adapter: PJSUAAdapter = app.state.pjsua_adapter
            try:
                await pjsua_adapter.shutdown()
                logger.info("PJSUA arrêté proprement")
            except Exception as exc:
                logger.exception("Erreur lors de l'arrêt de PJSUA", exc_info=exc)
        else:
            # Arrêter aiosip (legacy)
            manager: MultiSIPRegistrationManager = app.state.sip_registration
            try:
                await manager.stop()
            except Exception as exc:  # pragma: no cover - network dependent
                logger.exception(
                    "Arrêt du gestionnaire d'enregistrement SIP échoué",
                    exc_info=exc,
                )
