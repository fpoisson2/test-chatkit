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
    SipAccount,
    TelephonyRoute,
    User,
    VoiceSettings,
    Workflow,
)
from .realtime_runner import open_voice_session
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
from .vector_store import (
    WORKFLOW_VECTOR_STORE_DESCRIPTION,
    WORKFLOW_VECTOR_STORE_METADATA,
    WORKFLOW_VECTOR_STORE_SLUG,
    WORKFLOW_VECTOR_STORE_TITLE,
    JsonVectorStoreService,
)
from .workflows.service import WorkflowService

logger = logging.getLogger("chatkit.server")

for noisy_logger in (
    "aiosip",
    "aiosip.protocol",
    "aiosip.application",
    # La librairie `websockets` est très verbeuse en DEBUG et noie nos journaux.
    # On force un niveau plus élevé tant qu'aucune configuration spécifique
    # n'a été appliquée par l'utilisateur.
    "websockets.client",
    "websockets.asyncio.client",
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
        preinit_response_create_sent = metadata.get("preinit_response_create_sent", False)
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

        # Vérifier si une session a été pré-initialisée pendant le ring timeout
        preinit_session_handle = metadata.pop("preinit_session_handle", None)
        client_secret = metadata.get("client_secret")

        if preinit_session_handle is not None:
            # Utiliser la session pré-initialisée
            session_handle = preinit_session_handle
            logger.info(
                "🚀 Utilisation de la session Realtime pré-initialisée "
                "(Call-ID=%s, session_id=%s) - AUCUN DÉLAI",
                session.call_id,
                metadata.get("realtime_session_id"),
            )
        elif client_secret is None:
            # Pas de session pré-initialisée, créer une nouvelle session
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
        else:
            # Session déjà créée (fallback pour compatibilité)
            logger.warning(
                "Session Realtime déjà créée pour Call-ID=%s, session_handle introuvable",
                session.call_id,
            )
            return

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
                preinit_response_create_sent=preinit_response_create_sent,
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

        # Créer et démarrer le serveur RTP
        rtp_config = RtpServerConfig(
            local_host=media_host,
            local_port=int(media_port) if media_port else 0,
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

            if voice_model and instructions:
                logger.info(
                    "Pré-initialisation de la session Realtime pendant le ring timeout "
                    "(Call-ID=%s)",
                    call_id,
                )

                async def _preinit_realtime_session():
                    """Initialise la session Realtime pendant que le téléphone sonne."""
                    try:
                        # Créer un nouveau thread pour cet appel
                        thread_id = str(uuid.uuid4())

                        # Ajouter les informations de l'appel SIP aux métadonnées du thread
                        sip_metadata = {
                            "sip_caller_number": telephony_meta.get("normalized_number") or telephony_meta.get("original_number"),
                            "sip_original_number": telephony_meta.get("original_number"),
                            "sip_call_id": session.call_id,
                        }

                        thread = ThreadMetadata(
                            id=thread_id,
                            created_at=datetime.datetime.now(datetime.UTC),
                            metadata=sip_metadata,
                        )

                        # Sauvegarder le thread dans le store ChatKit
                        server = get_chatkit_server()
                        store = getattr(server, "store", None)
                        if store is not None:
                            chatkit_context = ChatKitRequestContext(
                                user_id=f"sip:{session.call_id}",
                                email=None,
                                authorization=None,
                                public_base_url=settings.backend_public_base_url,
                                voice_model=voice_model,
                                voice_instructions=instructions,
                                voice_voice=voice_name,
                                voice_prompt_variables=telephony_meta.get("voice_prompt_variables"),
                            )
                            await store.save_thread(thread, chatkit_context)
                            telephony_meta["thread_id"] = thread_id
                            logger.info(
                                "Thread pré-créé pendant le ring (Call-ID=%s, thread_id=%s)",
                                session.call_id,
                                thread_id,
                            )

                        # Ajouter automatiquement le tool de transfert d'appel
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

                        metadata_extras: dict[str, Any] = {}
                        if thread_id:
                            metadata_extras["thread_id"] = thread_id

                        # Ouvrir la session Realtime
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

                        # Stocker le session handle dans les métadonnées
                        telephony_meta["preinit_session_handle"] = session_handle

                        secret_payload = session_handle.payload
                        parsed_secret = session_secret_parser.parse(secret_payload)
                        client_secret = parsed_secret.as_text()
                        if client_secret:
                            telephony_meta["client_secret"] = client_secret
                            telephony_meta["client_secret_expires_at"] = (
                                parsed_secret.expires_at_isoformat()
                            )
                            telephony_meta["realtime_session_id"] = session_handle.session_id
                            logger.info(
                                "✅ Session Realtime pré-initialisée pendant le ring "
                                "(Call-ID=%s, session_id=%s)",
                                session.call_id,
                                session_handle.session_id,
                            )

                            # Si speak_first est activé, envoyer response.create MAINTENANT
                            # pour pré-générer l'audio pendant la sonnerie
                            if speak_first:
                                try:
                                    runner = session_handle.runner
                                    if runner:
                                        logger.info(
                                            "🎯 Pré-génération de l'audio pendant la sonnerie "
                                            "(speak_first activé, Call-ID=%s)",
                                            session.call_id,
                                        )
                                        # Importer les classes nécessaires pour envoyer l'événement
                                        from agents.realtime.model_inputs import (
                                            RealtimeModelRawClientMessage,
                                            RealtimeModelSendRawMessage,
                                        )
                                        # Envoyer response.create via le runner
                                        await runner._model.send_event(
                                            RealtimeModelSendRawMessage(
                                                message=RealtimeModelRawClientMessage(
                                                    type="response.create",
                                                    other_data={},
                                                )
                                            )
                                        )
                                        telephony_meta["preinit_response_create_sent"] = True
                                        logger.info(
                                            "✅ response.create pré-envoyé - audio en cours de génération "
                                            "(Call-ID=%s)",
                                            session.call_id,
                                        )
                                except Exception as exc:
                                    logger.warning(
                                        "Impossible de pré-envoyer response.create (Call-ID=%s): %s",
                                        session.call_id,
                                        exc,
                                    )
                    except Exception as exc:
                        logger.exception(
                            "Erreur lors de la pré-initialisation de la session Realtime "
                            "(Call-ID=%s)",
                            session.call_id,
                            exc_info=exc,
                        )

                # Démarrer la pré-initialisation en arrière-plan
                session_init_task = asyncio.create_task(_preinit_realtime_session())

        # Maintenant envoyer le 200 OK (avec le ring timeout)
        try:
            await handle_incoming_invite(
                dialog,
                request,
                media_host=media_host,
                media_port=actual_media_port,
                contact_uri=contact_uri,
                ring_timeout_seconds=ring_timeout_seconds,
            )
        except InviteHandlingError as exc:
            logger.warning("Traitement de l'INVITE interrompu : %s", exc)
            if session_init_task:
                session_init_task.cancel()
            await rtp_server.stop()
            return
        except Exception as exc:  # pragma: no cover - dépend de aiosip
            logger.exception(
                "Erreur inattendue lors du traitement d'un INVITE",
                exc_info=exc,
            )
            if session_init_task:
                session_init_task.cancel()
            await rtp_server.stop()
            with contextlib.suppress(Exception):
                await send_sip_reply(
                    dialog,
                    500,
                    reason="Server Internal Error",
                    contact_uri=contact_uri,
                )
            return

        # Attendre que la pré-initialisation se termine (si elle était lancée)
        if session_init_task:
            try:
                await session_init_task
                logger.info(
                    "Pré-initialisation de la session Realtime terminée avant réponse "
                    "(Call-ID=%s)",
                    call_id,
                )
            except Exception as exc:
                logger.warning(
                    "La pré-initialisation a échoué, la session sera créée normalement "
                    "(Call-ID=%s): %s",
                    call_id,
                    exc,
                )

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


def register_startup_events(app: FastAPI) -> None:
    sip_contact_host = settings.sip_contact_host
    sip_contact_port = (
        settings.sip_contact_port
        if settings.sip_contact_port is not None
        else settings.sip_bind_port
    )

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
        manager: MultiSIPRegistrationManager = app.state.sip_registration
        try:
            await manager.stop()
        except Exception as exc:  # pragma: no cover - network dependent
            logger.exception(
                "Arrêt du gestionnaire d'enregistrement SIP échoué",
                exc_info=exc,
            )
