from __future__ import annotations

import asyncio
import contextlib
import copy
import datetime
import logging
import os
import re
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import select

from chatkit.types import ThreadMetadata

from ..chatkit import get_chatkit_server
from ..chatkit_server.context import ChatKitRequestContext, _set_wait_state_metadata
from ..chatkit_sessions import SessionSecretParser
from ..config import settings_proxy
from ..database import SessionLocal
from ..models import SipAccount
from ..realtime_runner import open_voice_session
from ..workflows.service import WorkflowService
from .invite_handler import InviteHandlingError, handle_incoming_invite, send_sip_reply
from .multi_sip_manager import MultiSIPRegistrationManager
from .registration import SIPRegistrationManager
from .rtp_server import RtpServer, RtpServerConfig
from .sip_server import (
    SipCallRequestHandler,
    SipCallSession,
    TelephonyRouteSelectionError,
    resolve_workflow_for_phone_number,
)
from .voice_bridge import TelephonyVoiceBridge, VoiceBridgeHooks

logger = logging.getLogger("chatkit.server")
settings = settings_proxy


class InviteRuntime:
    """Orchestrates SIP invite lifecycle for telephony calls."""

    def __init__(
        self,
        manager: MultiSIPRegistrationManager | SIPRegistrationManager,
        *,
        workflow_service: WorkflowService | None = None,
        session_secret_parser: SessionSecretParser | None = None,
    ) -> None:
        self.manager = manager
        self.workflow_service = workflow_service or WorkflowService()
        self.session_secret_parser = session_secret_parser or SessionSecretParser()
        self.sip_handler = SipCallRequestHandler(
            invite_callback=self._register_session,
            start_rtp_callback=self._start_rtp,
            terminate_callback=self._terminate_session,
        )

    def build_handler(self) -> Callable[[Any, Any], Awaitable[None]]:
        return self._on_invite

    async def _attach_dialog_callbacks(
        self, dialog: Any, handler: SipCallRequestHandler
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

        async def _on_bye(dialog_arg: Any, message: Any) -> None:
            call_id_header = getattr(message, "headers", {}).get("Call-ID", ["unknown"])
            call_id = (
                call_id_header[0]
                if isinstance(call_id_header, list) and call_id_header
                else str(call_id_header)
            )
            logger.info("BYE reçu pour Call-ID=%s", call_id)
            await handler.handle_request(message, dialog=dialog_arg)

        try:
            if hasattr(dialog, "callbacks"):
                if "BYE" not in dialog.callbacks:
                    dialog.callbacks["BYE"] = []
                dialog.callbacks["BYE"].append(
                    {
                        "callable": _on_bye,
                        "args": (),
                        "kwargs": {},
                        "wait": True,
                    }
                )
                logger.debug("Callback BYE enregistré pour le dialogue")
        except Exception:  # pragma: no cover - dépend des implémentations aiosip
            logger.debug(
                "Impossible d'enregistrer le callback BYE", exc_info=True
            )

    def _sanitize_phone_candidate(self, raw: Any) -> str | None:
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

    def _extract_incoming_number(self, request: Any) -> str | None:
        headers = getattr(request, "headers", None)
        items = getattr(headers, "items", None)
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
            candidate = self._sanitize_phone_candidate(normalized[header_name])
            if candidate:
                return candidate
        return None

    def _extract_sip_account_id_from_request(self, request: Any) -> int | None:
        if not isinstance(self.manager, MultiSIPRegistrationManager):
            return None

        headers = getattr(request, "headers", None)
        items = getattr(headers, "items", None)
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
                if isinstance(value, list | tuple) and value:
                    to_header = str(value[0])
                else:
                    to_header = str(value)
                break

        if not to_header:
            logger.error("Impossible d'extraire l'en-tête To: de l'INVITE SIP")
            raise TelephonyRouteSelectionError(
                "En-tête To: manquant dans la requête INVITE"
            )

        match = re.search(r"sips?:([^@>;]+)@", to_header, flags=re.IGNORECASE)
        if not match:
            logger.error("Format d'en-tête To: non reconnu: %s", to_header)
            raise TelephonyRouteSelectionError(
                f"Format d'en-tête To: invalide: {to_header}"
            )

        to_username = match.group(1).lower()

        with SessionLocal() as session:
            accounts = session.scalars(
                select(SipAccount).where(SipAccount.is_active)
            ).all()

            for account in accounts:
                if account.username and account.username.lower() == to_username:
                    logger.info(
                        "Appel SIP correspond au compte '%s' (ID=%d) via username '%s'",
                        account.label,
                        account.id,
                        account.username,
                    )
                    return account.id

        logger.error(
            "Aucun compte SIP actif ne correspond au username: %s",
            to_username,
        )
        raise TelephonyRouteSelectionError(
            f"Aucun compte SIP configuré pour le username {to_username}"
        )

    async def _close_dialog(self, session: SipCallSession) -> None:
        dialog = session.dialog
        if dialog is None:
            return
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

    async def _clear_voice_state(self, session: SipCallSession) -> None:
        metadata = session.metadata.get("telephony")
        if not isinstance(metadata, dict):
            return

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
        self, session: SipCallSession, transcripts: list[dict[str, str]]
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
            user_messages = [
                t.get("text", "").strip()
                for t in transcripts
                if t.get("role") == "user" and t.get("text", "").strip()
            ]
            combined_text = " ".join(user_messages) if user_messages else ""

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

    async def _register_session(self, session: SipCallSession, request: Any) -> None:
        incoming_number = self._extract_incoming_number(request)
        sip_account_id = self._extract_sip_account_id_from_request(request)

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
                    self.workflow_service,
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

    async def _start_rtp(self, session: SipCallSession) -> None:
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

        thread_id = metadata.get("thread_id")

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
            thread_id = str(uuid.uuid4())
            sip_metadata = {
                "sip_caller_number": metadata.get("normalized_number")
                or metadata.get("original_number"),
                "sip_original_number": metadata.get("original_number"),
                "sip_call_id": session.call_id,
            }

            thread = ThreadMetadata(
                id=thread_id,
                created_at=datetime.datetime.now(datetime.UTC),
                metadata=sip_metadata,
            )

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
            "Démarrage du pont voix Realtime (Call-ID=%s, modèle=%s, "
            "voix=%s, provider=%s)",
            session.call_id,
            voice_model,
            voice_name or "<auto>",
            voice_provider_slug or voice_provider_id or "<défaut>",
        )

        logger.info(
            "Création d'une nouvelle session Realtime (Call-ID=%s)",
            session.call_id,
        )
        metadata_extras: dict[str, Any] = {}
        thread_identifier = metadata.get("thread_id")
        if isinstance(thread_identifier, str) and thread_identifier.strip():
            metadata_extras["thread_id"] = thread_identifier.strip()

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
                            "Message optionnel à annoncer à l'appelant avant le "
                            "transfert"
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
            realtime={},
            metadata=metadata_extras or None,
        )
        secret_payload = session_handle.payload
        parsed_secret = self.session_secret_parser.parse(secret_payload)
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

        if store is not None and thread_id:
            try:
                thread = await store.load_thread(thread_id, chatkit_context)

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

                wait_state = {
                    "type": "voice",
                    "voice_event": voice_event,
                    "voice_event_consumed": False,
                }

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
            close_dialog=lambda: self._close_dialog(session),
            clear_voice_state=lambda: self._clear_voice_state(session),
            resume_workflow=lambda transcripts: self._resume_workflow(
                session, transcripts
            ),
        )
        voice_bridge = TelephonyVoiceBridge(hooks=hooks)

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
        self, session: SipCallSession, dialog: Any | None
    ) -> None:
        del dialog
        await self._clear_voice_state(session)
        metadata = session.metadata.get("telephony") or {}
        logger.info(
            "Session SIP terminée (Call-ID=%s, numéro=%s)",
            session.call_id,
            metadata.get("incoming_number") or "<inconnu>",
        )

    async def _on_invite(self, dialog: Any, request: Any) -> None:
        logger.info("🔔 _on_invite appelé - CODE MODIFIÉ v2")
        if isinstance(self.manager, MultiSIPRegistrationManager):
            default_manager = self.manager.get_default_manager()
            config = default_manager.active_config if default_manager else None
        else:
            config = self.manager.active_config

        media_host = (
            self.manager.contact_host
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

            normalized = payload_text.replace("\r\n", "\n").replace("\r", "\n")
            sdp_lines = [
                line.strip()
                for line in normalized.splitlines()
                if line.strip()
            ]

            if len(sdp_lines) == 1 and len(sdp_lines[0]) > 50:
                logger.debug("SDP sur une seule ligne détecté, split forcé")
                import re

                sdp_lines = [
                    s.strip()
                    for s in re.split(r"(?=[vosctma]=)", sdp_lines[0])
                    if s.strip()
                ]

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
            logger.warning(
                "❌ Erreur lors de l'extraction de l'adresse RTP du SDP : %s",
                exc,
                exc_info=True,
            )

        rtp_config = RtpServerConfig(
            local_host=media_host,
            local_port=int(media_port) if media_port else 0,
            remote_host=remote_rtp_host,
            remote_port=remote_rtp_port,
            payload_type=0,
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

        actual_media_port = rtp_server.local_port

        try:
            await self.sip_handler.handle_invite(request, dialog=dialog)
        except TelephonyRouteSelectionError as exc:
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
        except Exception:
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

        call_id_raw = getattr(request, "headers", {}).get("Call-ID")
        call_id: str | None = None
        session: SipCallSession | None = None

        if call_id_raw:
            if isinstance(call_id_raw, list | tuple) and call_id_raw:
                call_id = str(call_id_raw[0])
            else:
                call_id = str(call_id_raw)

            session = self.sip_handler.get_session(call_id)
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

        await self._attach_dialog_callbacks(dialog, self.sip_handler)

        ring_timeout_seconds = 0.0
        if session:
            telephony_meta = session.metadata.get("telephony") or {}
            ring_timeout_seconds = telephony_meta.get("ring_timeout_seconds", 0.0)
            logger.info(
                "Ring timeout extrait des métadonnées (Call-ID=%s): %.2f secondes",
                call_id or "inconnu",
                ring_timeout_seconds,
            )

        try:
            await handle_incoming_invite(
                dialog,
                request,
                media_host=media_host,
                media_port=actual_media_port,
                contact_uri=contact_uri,
                ring_timeout_seconds=ring_timeout_seconds,
            )
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

        if session:
            logger.info(
                "Démarrage immédiat de la session RTP pour Call-ID=%s",
                call_id,
            )
            try:
                await self.sip_handler.start_rtp_session(session)
            except Exception as exc:
                logger.exception(
                    "Erreur lors du démarrage de la session RTP pour %s",
                    call_id,
                    exc_info=exc,
                )
                await rtp_server.stop()


def build_invite_handler(
    manager: MultiSIPRegistrationManager | SIPRegistrationManager,
) -> Callable[[Any, Any], Awaitable[None]]:
    runtime = InviteRuntime(manager)
    return runtime.build_handler()
