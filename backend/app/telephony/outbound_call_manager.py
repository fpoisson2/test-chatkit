"""Gestionnaire des appels sortants avec implémentation SIP complète."""

from __future__ import annotations

import asyncio
import logging
import os
import random
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import SessionLocal
from ..models import OutboundCall, SipAccount, WorkflowDefinition
from ..realtime_runner import close_voice_session, open_voice_session
from ..workflows.service import resolve_start_telephony_config
from .outbound_events_manager import get_outbound_events_manager
from .rtp_server import RtpServer, RtpServerConfig
from .voice_bridge import TelephonyVoiceBridge, VoiceBridgeHooks

logger = logging.getLogger("chatkit.telephony.outbound")

# Note: aiosip a des problèmes de compatibilité avec Python 3.11+
# À cause de l'utilisation de @asyncio.coroutine qui a été supprimé
# Pour l'instant, on désactive complètement aiosip pour ne pas bloquer le démarrage
AIOSIP_AVAILABLE = False
logger.info(
    "aiosip est désactivé en raison de problèmes de compatibilité avec Python 3.11+ - "
    "utilisation de PJSUA pour les appels sortants"
)

# PJSUA imports
try:
    import pjsua2 as pj

    from .pjsua_adapter import PJSUA_AVAILABLE, PJSUAAdapter, PJSUACall
    from .pjsua_audio_bridge import create_pjsua_audio_bridge
    if PJSUA_AVAILABLE:
        logger.info("PJSUA disponible pour les appels sortants")
except ImportError as e:
    PJSUA_AVAILABLE = False
    pj = None  # type: ignore
    PJSUAAdapter = None  # type: ignore
    PJSUACall = None  # type: ignore
    create_pjsua_audio_bridge = None  # type: ignore
    logger.warning("PJSUA non disponible: %s", e)


class OutboundCallSession:
    """Représente une session d'appel sortant active."""

    def __init__(
        self,
        call_id: str,
        to_number: str,
        from_number: str,
        workflow_id: int,
        sip_account_id: int,
        metadata: dict[str, Any],
    ):
        self.call_id = call_id
        self.to_number = to_number
        self.from_number = from_number
        self.workflow_id = workflow_id
        self.sip_account_id = sip_account_id
        self.metadata = metadata
        self.status = "queued"
        self._completion_event = asyncio.Event()
        # Legacy aiosip (désactivé)
        self._dialog: Any = None
        self._rtp_server: Any = None
        # PJSUA
        self._pjsua_call: PJSUACall | None = None
        self._audio_bridge: Any = None
        # Shared
        self._voice_bridge: Any = None

    async def wait_until_complete(self) -> None:
        """Attend que l'appel soit terminé."""
        await self._completion_event.wait()

    def mark_complete(self) -> None:
        """Marque l'appel comme terminé."""
        self._completion_event.set()


class OutboundCallManager:
    """Gère l'initiation et l'exécution des appels sortants avec SIP."""

    def __init__(self, pjsua_adapter: PJSUAAdapter | None = None):
        """Initialise le gestionnaire d'appels sortants.

        Args:
            pjsua_adapter: Adaptateur PJSUA pour gérer les appels (optionnel si aiosip est utilisé)
        """
        self.active_calls: dict[str, OutboundCallSession] = {}
        self._app: Any = None  # aiosip.Application (legacy)
        self._pjsua_adapter = pjsua_adapter

    async def _ensure_sip_application(self) -> Any:
        """S'assure que l'application SIP est initialisée."""
        if not AIOSIP_AVAILABLE:
            raise RuntimeError(
                "aiosip n'est pas disponible - incompatibilité avec Python 3.11+. "
                "Les appels sortants SIP ne sont pas supportés actuellement."
            )

        # Import dynamique pour éviter les problèmes de compatibilité
        # Note: Ceci ne devrait jamais être atteint car AIOSIP_AVAILABLE est False
        try:
            import aiosip  # noqa: F401
        except (ImportError, AttributeError) as e:
            raise RuntimeError(
                f"Impossible de charger aiosip: {e}. "
                "Incompatibilité avec Python 3.11+ (@asyncio.coroutine supprimé)."
            ) from e

        if self._app is None:
            logger.info("Initialisation de l'application SIP pour appels sortants")
            # Cette ligne ne sera jamais atteinte tant que AIOSIP_AVAILABLE est False
            import aiosip
            self._app = aiosip.Application(loop=asyncio.get_running_loop())

        return self._app

    async def initiate_call(
        self,
        db: Session,
        to_number: str,
        from_number: str,
        workflow_id: int,
        sip_account_id: int,
        metadata: dict[str, Any] | None = None,
    ) -> OutboundCallSession:
        """
        Initie un appel sortant.

        Args:
            db: Session de base de données
            to_number: Numéro à appeler (format E.164)
            from_number: Numéro appelant
            workflow_id: ID du workflow vocal à exécuter
            sip_account_id: ID du compte SIP à utiliser
            metadata: Métadonnées supplémentaires

        Returns:
            OutboundCallSession initiée
        """
        call_id = str(uuid.uuid4())
        metadata = metadata or {}

        logger.info(
            "Initiating outbound call: to=%s, from=%s, workflow_id=%s",
            to_number,
            from_number,
            workflow_id,
        )

        # Créer la session
        session = OutboundCallSession(
            call_id=call_id,
            to_number=to_number,
            from_number=from_number,
            workflow_id=workflow_id,
            sip_account_id=sip_account_id,
            metadata=metadata,
        )

        # Enregistrer en DB
        call_record = OutboundCall(
            call_sid=call_id,
            to_number=to_number,
            from_number=from_number,
            workflow_id=workflow_id,
            sip_account_id=sip_account_id,
            status="queued",
            metadata_=metadata,
            queued_at=datetime.now(UTC),
            triggered_by_workflow_id=metadata.get("triggered_by_workflow_id"),
            triggered_by_session_id=metadata.get("triggered_by_session_id"),
            trigger_node_slug=metadata.get("trigger_node_slug"),
        )
        db.add(call_record)
        db.commit()
        db.refresh(call_record)

        # Enregistrer la session active
        self.active_calls[call_id] = session

        # Émettre un événement call_started
        events_mgr = get_outbound_events_manager()
        asyncio.create_task(events_mgr.emit_event({
            "type": "call_started",
            "call_id": call_id,
            "to_number": to_number,
            "from_number": from_number,
        }))
        logger.info("Emitted call_started event for call %s", call_id)

        # Lancer l'appel en background avec PJSUA ou aiosip
        if PJSUA_AVAILABLE and self._pjsua_adapter is not None:
            logger.info("Utilisation de PJSUA pour l'appel sortant")
            asyncio.create_task(self._execute_call_pjsua(db, session, call_record.id))
        else:
            logger.info("Utilisation d'aiosip pour l'appel sortant (legacy)")
            asyncio.create_task(self._execute_call_sip(db, session, call_record.id))

        return session

    async def _execute_call_pjsua(
        self, db: Session, session: OutboundCallSession, call_db_id: int
    ) -> None:
        """Exécute l'appel sortant avec PJSUA."""
        try:
            # Récupérer le compte SIP
            sip_account = db.query(SipAccount).filter_by(
                id=session.sip_account_id
            ).first()

            if not sip_account:
                raise ValueError(f"SIP account {session.sip_account_id} not found")

            # Mettre à jour le statut
            session.status = "initiating"
            self._update_call_status(
                db, call_db_id, "initiating", initiated_at=datetime.now(UTC)
            )

            logger.info(
                "Executing PJSUA outbound call %s to %s via SIP account %s",
                session.call_id,
                session.to_number,
                sip_account.label,
            )

            # Construire l'URI de destination SIP
            # Format: sip:+33612345678@domain.com
            to_uri = self._build_sip_uri(session.to_number, sip_account.trunk_uri)

            # Créer un Event pour attendre que le média soit actif
            # IMPORTANT: Créer AVANT make_call pour éviter race condition
            media_active_event = asyncio.Event()

            # Créer une référence pour le call qu'on va créer
            # On va la remplir après make_call
            pjsua_call_ref: list[Any] = [None]

            # Variable pour stocker pjsua_ready_event (sera rempli après création du bridge)
            pjsua_ready_event_ref: list[asyncio.Event | None] = [None]

            # Callback pour débloquer l'audio quand le média est actif
            # IMPORTANT: Définir AVANT make_call pour capturer onCallMediaState
            async def on_media_active_callback_outbound(active_call: Any, media_info: Any) -> None:
                """Appelé quand le média devient actif (port audio créé)."""
                if pjsua_call_ref[0] is None or active_call != pjsua_call_ref[0]:
                    return

                logger.info("🎵 Média actif détecté pour appel sortant (call_id=%s)", session.call_id)

                # Attendre que le jitter buffer soit initialisé
                logger.info("⏱️ Attente 50ms pour initialisation jitter buffer... (call_id=%s)", session.call_id)
                await asyncio.sleep(0.05)  # 50ms

                # Attendre que PJSUA commence à consommer l'audio (onFrameRequested appelé)
                pjsua_ready_event = pjsua_ready_event_ref[0]
                if pjsua_ready_event:
                    logger.info("⏱️ Attente que PJSUA soit prêt à consommer l'audio... (call_id=%s)", session.call_id)
                    await pjsua_ready_event.wait()
                    logger.info("✅ PJSUA prêt - onFrameRequested appelé (call_id=%s)", session.call_id)

                # Marquer l'appel comme connecté MAINTENANT
                session.status = "answered"
                self._update_call_status(
                    db, call_db_id, "answered", answered_at=datetime.now(UTC)
                )

                logger.info("PJSUA call %s answered, média ready", session.call_id)
                media_active_event.set()

            # Enregistrer le callback média
            self._pjsua_adapter.set_media_active_callback(on_media_active_callback_outbound)

            # Callback pour nettoyer les ressources quand l'appel se termine
            cleanup_done = asyncio.Event()

            # Sauvegarder le callback précédent s'il existe
            previous_call_state_callback = getattr(self._pjsua_adapter, '_call_state_callback', None)

            async def on_call_state_callback_outbound(active_call: Any, call_info: Any) -> None:
                """Appelé quand l'état de l'appel change."""
                # D'abord, appeler le callback précédent s'il existe
                if previous_call_state_callback:
                    try:
                        await previous_call_state_callback(active_call, call_info)
                    except Exception as e:
                        logger.warning("Erreur dans callback précédent: %s", e)

                # Ensuite, gérer notre propre nettoyage
                if pjsua_call_ref[0] and active_call == pjsua_call_ref[0]:
                    # Si l'appel est déconnecté, nettoyer les ressources
                    if call_info.state == 6:  # PJSUA_CALL_STATE_DISCONNECTED
                        if not cleanup_done.is_set():
                            logger.info("📞 Appel sortant déconnecté - nettoyage des ressources (call_id=%s)", session.call_id)

                            # Arrêter le bridge audio
                            if session._audio_bridge:
                                try:
                                    session._audio_bridge.stop()
                                    logger.info("✅ Bridge audio arrêté (call_id=%s)", session.call_id)
                                except Exception as e:
                                    logger.warning("Erreur arrêt bridge audio: %s", e)

                            cleanup_done.set()

            # Enregistrer le callback de changement d'état
            self._pjsua_adapter.set_call_state_callback(on_call_state_callback_outbound)

            # CRITIQUE: Maintenant on initie l'appel APRÈS avoir enregistré les callbacks
            logger.info("📞 Initiation de l'appel PJSUA vers %s (call_id=%s)", to_uri, session.call_id)
            pjsua_call = await self._pjsua_adapter.make_call(to_uri)

            # Remplir la référence pour que les callbacks puissent l'utiliser
            pjsua_call_ref[0] = pjsua_call
            session._pjsua_call = pjsua_call

            logger.info("✅ Appel PJSUA initié, création de l'audio bridge (call_id=%s)", session.call_id)

            # Créer l'audio bridge MAINTENANT que l'appel existe
            rtp_stream, send_to_peer, clear_queue, first_packet_event, pjsua_ready_event, audio_bridge = await create_pjsua_audio_bridge(
                pjsua_call, media_active_event
            )

            # Remplir la référence pour le callback
            pjsua_ready_event_ref[0] = pjsua_ready_event
            session._audio_bridge = audio_bridge

            logger.info("✅ Audio bridge créé, attente du média actif (call_id=%s)", session.call_id)

            # Attendre que le média soit actif (max 10 secondes pour les appels sortants)
            # OU que l'appel soit déconnecté (cleanup_done)
            logger.info("⏱️ Attente activation du média pour appel sortant... (call_id=%s)", session.call_id)
            try:
                # Attendre soit media_active_event soit cleanup_done (appel terminé)
                done, pending = await asyncio.wait(
                    [
                        asyncio.create_task(media_active_event.wait()),
                        asyncio.create_task(cleanup_done.wait())
                    ],
                    timeout=10.0,
                    return_when=asyncio.FIRST_COMPLETED
                )

                # Annuler les tâches en attente
                for task in pending:
                    task.cancel()

                # Si l'appel a été déconnecté (cleanup_done), arrêter ici
                if cleanup_done.is_set():
                    logger.warning("❌ Appel déconnecté avant que le média soit actif (call_id=%s)", session.call_id)
                    return

                logger.info("✅ Média actif confirmé (call_id=%s)", session.call_id)
            except asyncio.TimeoutError:
                # Vérifier si l'appel est toujours connecté
                if cleanup_done.is_set():
                    logger.warning("❌ Appel déconnecté pendant l'attente du média (call_id=%s)", session.call_id)
                    return

                logger.warning("⚠️ Timeout attente média actif - on continue quand même (call_id=%s)", session.call_id)
                session.status = "answered"
                self._update_call_status(
                    db, call_db_id, "answered", answered_at=datetime.now(UTC)
                )

            # Wrapper send_to_peer pour bloquer l'audio jusqu'à ce que le média soit actif
            # CRITIQUE: Sans ce wrapper, OpenAI envoie de l'audio avant que le port soit prêt
            async def send_to_peer_blocked(audio: bytes) -> None:
                """Wrapper qui bloque l'envoi d'audio jusqu'à ce que le port audio existe."""
                await media_active_event.wait()
                await send_to_peer(audio)

            # Démarrer la session vocale (similaire au code existant)
            await self._run_voice_session_pjsua(
                db, session, call_db_id, rtp_stream, send_to_peer_blocked, clear_queue, pjsua_ready_event
            )

        except Exception as e:
            logger.exception("Error executing PJSUA outbound call %s: %s", session.call_id, e)
            session.status = "failed"
            self._update_call_status(
                db,
                call_db_id,
                "failed",
                ended_at=datetime.now(UTC),
                failure_reason=str(e),
            )
        finally:
            # Nettoyer les ressources de la session
            logger.info("🧹 Début nettoyage session appel %s", session.call_id)

            # 1. Arrêter l'audio bridge de la session d'abord
            if hasattr(session, '_audio_bridge') and session._audio_bridge:
                try:
                    logger.info("🛑 Arrêt audio bridge session (call_id=%s)", session.call_id)
                    session._audio_bridge.stop()
                except Exception as e:
                    logger.warning("Erreur arrêt audio bridge session (call_id=%s): %s", session.call_id, e)
                finally:
                    session._audio_bridge = None

            # 2. Nettoyer l'appel PJSUA avec la méthode dédiée
            if session._pjsua_call:
                try:
                    # Récupérer l'ID de l'appel PJSUA
                    call_info = session._pjsua_call.getInfo()
                    pjsua_call_id = call_info.id
                    logger.info("🧹 Nettoyage appel PJSUA (call_id=%s, pjsua_id=%s)", session.call_id, pjsua_call_id)
                    await self._pjsua_adapter.cleanup_call(pjsua_call_id)
                except Exception as e:
                    logger.warning("Erreur nettoyage appel PJSUA (call_id=%s): %s", session.call_id, e)
                finally:
                    session._pjsua_call = None

            # 3. Fermer les streams audio
            try:
                from .audio_stream_manager import get_audio_stream_manager
                audio_stream_mgr = get_audio_stream_manager()
                await audio_stream_mgr.close_call(session.call_id)
            except Exception as e:
                logger.warning("Erreur fermeture streams audio (call_id=%s): %s", session.call_id, e)

            # 4. Marquer la session comme terminée
            session.mark_complete()

            # Émettre un événement call_ended
            events_mgr = get_outbound_events_manager()
            try:
                asyncio.create_task(events_mgr.emit_event({
                    "type": "call_ended",
                    "call_id": session.call_id,
                    "status": session.status,
                }))
                logger.info("Emitted call_ended event for call %s", session.call_id)
            except Exception as e:
                logger.warning("Failed to emit call_ended event: %s", e)

            self.active_calls.pop(session.call_id, None)

            logger.info("✅ Nettoyage session terminé (call_id=%s)", session.call_id)

    async def _run_voice_session_pjsua(
        self,
        db: Session,
        session: OutboundCallSession,
        call_db_id: int,
        rtp_stream: Any,
        send_to_peer: Any,
        clear_queue: Any,
        pjsua_ready_event: asyncio.Event,
    ) -> None:
        """Exécute la session vocale avec PJSUA audio bridge."""
        try:
            # Charger le workflow et la configuration (code identique à _execute_call_sip)
            workflow = db.query(WorkflowDefinition).filter_by(
                id=session.workflow_id
            ).first()

            if not workflow:
                raise ValueError(f"Workflow {session.workflow_id} not found")

            # Résoudre la configuration de démarrage
            from ..workflows.service import resolve_start_telephony_config

            voice_config = resolve_start_telephony_config(workflow)
            if not voice_config or not voice_config.default_route:
                raise ValueError(
                    f"Workflow {session.workflow_id} has no voice configuration"
                )

            route = voice_config.default_route

            # Valeurs par défaut depuis la route/config
            voice_model = route.overrides.model or get_settings().chatkit_realtime_model
            instructions = (
                route.overrides.instructions or get_settings().chatkit_realtime_instructions
            )
            voice_name = route.overrides.voice or get_settings().chatkit_realtime_voice
            voice_provider_slug = getattr(route, "provider_slug", None) or "openai"
            voice_provider_id = getattr(route, "provider_id", None)

            # Extraire TOUS les paramètres du bloc voice_agent (pas seulement tools/handoffs)
            voice_tools = []
            voice_handoffs = []

            for step in workflow.steps:
                if getattr(step, "kind", None) == "voice_agent":
                    params = getattr(step, "parameters", None)
                    if isinstance(params, dict):
                        # Instructions personnalisées (override les instructions de la route)
                        custom_instructions = params.get("instructions")
                        if isinstance(custom_instructions, str) and custom_instructions.strip():
                            instructions = custom_instructions
                            logger.info("Using custom instructions from voice_agent block")

                        # Modèle vocal personnalisé
                        custom_model = params.get("model")
                        if isinstance(custom_model, str) and custom_model.strip():
                            voice_model = custom_model
                            logger.info("Using custom model from voice_agent block: %s", voice_model)

                        # Voix personnalisée
                        custom_voice = params.get("voice")
                        if isinstance(custom_voice, str) and custom_voice.strip():
                            voice_name = custom_voice
                            logger.info("Using custom voice from voice_agent block: %s", voice_name)

                        # Provider personnalisé
                        custom_provider_slug = params.get("model_provider_slug")
                        if isinstance(custom_provider_slug, str) and custom_provider_slug.strip():
                            voice_provider_slug = custom_provider_slug
                            logger.info("Using custom provider slug from voice_agent block: %s", voice_provider_slug)

                        custom_provider_id = params.get("model_provider_id")
                        if isinstance(custom_provider_id, str) and custom_provider_id.strip():
                            voice_provider_id = custom_provider_id
                            logger.info("Using custom provider id from voice_agent block: %s", voice_provider_id)

                        # Tools et handoffs
                        tools_payload = params.get("tools")
                        if isinstance(tools_payload, list):
                            voice_tools.extend(tools_payload)

                        handoffs_payload = params.get("handoffs")
                        if isinstance(handoffs_payload, list):
                            voice_handoffs.extend(handoffs_payload)
                    break

            session_handle = await open_voice_session(
                user_id=f"outbound:{session.call_id}",
                model=voice_model,
                instructions=instructions,
                voice=voice_name,
                provider_id=voice_provider_id,
                provider_slug=voice_provider_slug,
                tools=voice_tools,
                handoffs=voice_handoffs,
                realtime={},
                metadata={
                    "outbound_call_id": session.call_id,
                    "to_number": session.to_number,
                    "from_number": session.from_number,
                },
            )

            # Récupérer le client secret
            client_secret = session_handle.client_secret

            if not client_secret:
                raise ValueError(f"Client secret introuvable pour l'appel {session.call_id}")

            logger.info("PJSUA voice session created (session_id=%s)", session_handle.session_id)

            # Créer les hooks pour le voice bridge (adapté pour PJSUA)
            async def close_dialog_hook() -> None:
                pass  # Géré dans le cleanup final

            async def clear_voice_state_hook() -> None:
                # Pas de RTP server à arrêter avec PJSUA
                pass

            async def resume_workflow_hook(transcripts: list[dict[str, str]]) -> None:
                logger.info("Voice session completed with %d transcripts", len(transcripts))
                # Sauvegarder les transcriptions (code identique)
                try:
                    call = db.query(OutboundCall).filter_by(id=call_db_id).first()
                    if call:
                        metadata = call.metadata_ or {}
                        if not isinstance(metadata, dict):
                            metadata = {}
                        metadata["transcripts"] = transcripts
                        metadata["transcript_count"] = len(transcripts)
                        call.metadata_ = metadata
                        db.commit()
                        logger.info("Saved %d transcripts for outbound call %s", len(transcripts), session.call_id)
                except Exception as e:
                    logger.exception("Failed to save transcripts for call %s: %s", session.call_id, e)

            async def on_transcript_hook(transcript: dict[str, str]) -> None:
                """Appelé en temps réel pour chaque transcription."""
                try:
                    # Récupérer le thread_id depuis les métadonnées
                    call = db.query(OutboundCall).filter_by(id=call_db_id).first()
                    if not call:
                        logger.warning("Call not found for on_transcript hook")
                        return

                    metadata = call.metadata_ or {}
                    thread_id = metadata.get("triggered_by_session_id")
                    if not thread_id:
                        logger.debug("No thread_id in call metadata, skipping real-time transcript")
                        return

                    # Ajouter la transcription au thread ChatKit
                    import uuid
                    from datetime import datetime, timezone

                    from chatkit.types import (
                        AssistantMessageContent,
                        AssistantMessageItem,
                        InferenceOptions,
                        UserMessageItem,
                        UserMessageTextContent,
                    )

                    from ..chatkit import get_chatkit_server
                    from ..chatkit_server.context import ChatKitRequestContext
                    from ..models import ChatThread

                    server = get_chatkit_server()

                    # Récupérer le owner_id du thread depuis la base de données
                    thread_record = db.query(ChatThread).filter_by(id=thread_id).first()
                    if not thread_record:
                        logger.warning("Thread %s not found in database", thread_id)
                        return

                    # Créer un contexte avec le bon owner_id
                    context = ChatKitRequestContext(
                        user_id=thread_record.owner_id,
                        email=None,
                        authorization=None,
                        public_base_url=None,
                    )

                    # Ajouter le message de transcription
                    role = transcript.get("role")
                    text = transcript.get("text", "")

                    if not text:
                        return

                    # Créer un ID unique pour le message
                    message_id = f"transcript_{session.call_id}_{uuid.uuid4().hex[:8]}"
                    now = datetime.now(timezone.utc)

                    # Ajouter le message via le store API
                    try:
                        if role == "user":
                            user_msg = UserMessageItem(
                                id=message_id,
                                thread_id=thread_id,
                                created_at=now,
                                content=[UserMessageTextContent(text=text)],
                                attachments=[],
                                inference_options=InferenceOptions(),
                                quoted_text=None,
                            )
                            await server.store.add_thread_item(thread_id, user_msg, context)
                        elif role == "assistant":
                            assistant_msg = AssistantMessageItem(
                                id=message_id,
                                thread_id=thread_id,
                                created_at=now,
                                content=[AssistantMessageContent(text=text)],
                            )
                            await server.store.add_thread_item(thread_id, assistant_msg, context)
                        else:
                            return

                        events_mgr = get_outbound_events_manager()
                        await events_mgr.emit_event(
                            {
                                "type": "transcript_delta",
                                "call_id": session.call_id,
                                "thread_id": thread_id,
                                "message_id": message_id,
                                "role": role,
                                "text": text,
                            }
                        )

                        logger.info("Added real-time transcript to thread %s: %s: %s", thread_id, role, text[:50])
                    except Exception as e:
                        logger.error("Failed to add transcript to thread: %s", e, exc_info=True)

                except Exception as e:
                    logger.error("Error in on_transcript_hook: %s", e, exc_info=True)

            # Hooks pour le streaming audio
            from .audio_stream_manager import get_audio_stream_manager
            audio_stream_mgr = get_audio_stream_manager()

            async def on_audio_inbound_hook(pcm_data: bytes) -> None:
                """Appelé en temps réel pour chaque chunk audio entrant."""
                try:
                    await audio_stream_mgr.broadcast_audio(session.call_id, pcm_data, channel="inbound")
                except Exception as e:
                    logger.error("Error broadcasting inbound audio: %s", e)

            async def on_audio_outbound_hook(pcm_data: bytes) -> None:
                """Appelé en temps réel pour chaque chunk audio sortant."""
                try:
                    await audio_stream_mgr.broadcast_audio(session.call_id, pcm_data, channel="outbound")
                except Exception as e:
                    logger.error("Error broadcasting outbound audio: %s", e)

            hooks = VoiceBridgeHooks(
                close_dialog=close_dialog_hook,
                clear_voice_state=clear_voice_state_hook,
                resume_workflow=resume_workflow_hook,
                on_transcript=on_transcript_hook,
                on_audio_inbound=on_audio_inbound_hook,
                on_audio_outbound=on_audio_outbound_hook,
            )

            # Créer le voice bridge
            voice_bridge = TelephonyVoiceBridge(hooks=hooks, input_codec="pcm")
            session._voice_bridge = voice_bridge

            # Déterminer le base URL pour le provider
            realtime_api_base: str | None = None
            if voice_provider_slug == "openai":
                realtime_api_base = os.environ.get("CHATKIT_API_BASE") or "https://api.openai.com"

            # Exécuter le voice bridge avec PJSUA audio bridge
            logger.info("Starting TelephonyVoiceBridge for PJSUA outbound call")
            try:
                stats = await voice_bridge.run(
                    runner=session_handle.runner,
                    client_secret=client_secret,
                    model=voice_model,
                    instructions=instructions,
                    voice=voice_name,
                    rtp_stream=rtp_stream,  # PJSUA audio bridge stream
                    send_to_peer=send_to_peer,  # PJSUA audio bridge callback (wrapped pour bloquer)
                    clear_audio_queue=clear_queue,  # Permet d'interrompre l'audio
                    pjsua_ready_to_consume=pjsua_ready_event,  # Attend que PJSUA soit prêt avant speak_first
                    audio_bridge=session._audio_bridge,  # Pour enable_audio_output() après silence priming
                    api_base=realtime_api_base,
                    tools=voice_tools,
                    handoffs=voice_handoffs,
                )

                logger.info("PJSUA TelephonyVoiceBridge completed: %s", stats)

                # Sauvegarder les stats (identique au code existant)
                try:
                    call = db.query(OutboundCall).filter_by(id=call_db_id).first()
                    if call:
                        metadata = call.metadata_ or {}
                        if not isinstance(metadata, dict):
                            metadata = {}
                        metadata["voice_bridge_stats"] = {
                            "duration_seconds": stats.duration_seconds,
                            "inbound_audio_bytes": stats.inbound_audio_bytes,
                            "outbound_audio_bytes": stats.outbound_audio_bytes,
                            "transcript_count": stats.transcript_count,
                            "error": str(stats.error) if stats.error else None,
                        }
                        # Sauvegarder les chemins des fichiers audio
                        if stats.inbound_audio_file or stats.outbound_audio_file or stats.mixed_audio_file:
                            metadata["audio_recordings"] = {
                                "inbound": stats.inbound_audio_file,
                                "outbound": stats.outbound_audio_file,
                                "mixed": stats.mixed_audio_file,
                            }
                            logger.info(
                                "Audio recordings saved for call %s: inbound=%s, outbound=%s, mixed=%s",
                                session.call_id,
                                stats.inbound_audio_file,
                                stats.outbound_audio_file,
                                stats.mixed_audio_file,
                            )
                        call.metadata_ = metadata
                        db.commit()
                except Exception as e:
                    logger.warning("Failed to save voice bridge stats: %s", e)

                # Marquer l'appel comme terminé
                session.status = "completed"
                self._update_call_status(
                    db,
                    call_db_id,
                    "completed",
                    ended_at=datetime.now(UTC),
                    duration_seconds=int(stats.duration_seconds),
                )

            except Exception as e:
                logger.exception("Error in PJSUA voice bridge: %s", e)
                raise

        except Exception as e:
            logger.exception("Error running PJSUA voice session: %s", e)
            raise

    async def _execute_call_sip(
        self, db: Session, session: OutboundCallSession, call_db_id: int
    ) -> None:
        """
        Exécute l'appel sortant avec SIP complet (aiosip - legacy).
        """
        try:
            # Récupérer le compte SIP
            sip_account = db.query(SipAccount).filter_by(
                id=session.sip_account_id
            ).first()

            if not sip_account:
                raise ValueError(f"SIP account {session.sip_account_id} not found")

            # Mettre à jour le statut à "initiating"
            session.status = "initiating"
            self._update_call_status(
                db, call_db_id, "initiating", initiated_at=datetime.now(UTC)
            )

            logger.info(
                "Executing outbound call %s to %s via SIP account %s",
                session.call_id,
                session.to_number,
                sip_account.label,
            )

            # Initialiser l'application SIP
            app = await self._ensure_sip_application()

            # Construire les URIs SIP
            # Format: sip:+33612345678@sip.provider.com
            to_uri = self._build_sip_uri(session.to_number, sip_account.trunk_uri)
            from_uri = self._build_sip_uri(session.from_number, sip_account.trunk_uri)
            contact_uri = self._build_contact_uri(sip_account)

            # Extraire l'adresse remote du trunk
            remote_host, remote_port = self._parse_trunk_uri(sip_account.trunk_uri)

            # Déterminer le local_addr
            local_host = sip_account.contact_host or "0.0.0.0"
            local_port = sip_account.contact_port or 0  # 0 = port éphémère

            logger.info(
                "Creating SIP dialog: from=%s, to=%s, remote=%s:%s",
                from_uri,
                to_uri,
                remote_host,
                remote_port,
            )

            # Créer le dialog SIP
            dialog_kwargs = {}
            if sip_account.contact_transport:
                transport = sip_account.contact_transport.upper()
                if transport == "UDP":
                    try:
                        from aiosip.protocol import UDP
                        dialog_kwargs["protocol"] = UDP
                    except Exception:
                        logger.warning("Could not load UDP protocol for aiosip")

            try:
                dialog = await app.start_dialog(
                    from_uri=from_uri,
                    to_uri=to_uri,
                    contact_uri=contact_uri,
                    local_addr=(local_host, local_port),
                    remote_addr=(remote_host, remote_port),
                    password=sip_account.password,
                    **dialog_kwargs,
                )
                session._dialog = dialog
            except Exception as e:
                logger.error("Failed to create SIP dialog: %s", e)
                raise

            # Envoyer INVITE avec SDP
            logger.info("Sending SIP INVITE to %s", to_uri)

            # Créer un port RTP local temporaire pour l'offre
            local_rtp_port = random.randint(10000, 20000)
            offer_sdp = self._generate_sdp(local_host, local_rtp_port)

            # Envoyer l'INVITE et attendre la réponse
            # Note: aiosip dialog.invite() retourne une coroutine qui attend la réponse
            try:
                invite_response = await dialog.invite(
                    payload=offer_sdp,
                    headers={"Content-Type": "application/sdp"},
                )
            except Exception as e:
                logger.error("INVITE failed: %s", e)
                raise

            # Extraire le status code de la réponse
            status_code = getattr(invite_response, "status_code", 0)
            logger.info("INVITE response: %s", status_code)

            if status_code == 180:
                # Ringing
                session.status = "ringing"
                self._update_call_status(db, call_db_id, "ringing")
                logger.info("Call is ringing")

            if status_code == 200:
                # Call answered
                session.status = "answered"
                self._update_call_status(
                    db, call_db_id, "answered", answered_at=datetime.now(UTC)
                )
                logger.info("Call answered")

                # Parser le SDP de réponse pour obtenir l'adresse RTP distante
                response_sdp = getattr(invite_response, "payload", "")
                remote_host, remote_port = self._parse_sdp_connection(response_sdp)

                if not remote_host or not remote_port:
                    raise ValueError("Invalid SDP response: missing connection info")

                logger.info(
                    "Remote RTP endpoint: %s:%s", remote_host, remote_port
                )

                # Créer le serveur RTP
                rtp_config = RtpServerConfig(
                    local_host=local_host,
                    local_port=0,  # Port éphémère
                    remote_host=remote_host,
                    remote_port=remote_port,
                    codec="pcmu",
                )
                rtp_server = RtpServer(rtp_config)
                session._rtp_server = rtp_server

                await rtp_server.start()
                logger.info(
                    "RTP server started on %s:%s",
                    rtp_server.local_host,
                    rtp_server.local_port,
                )

                # Récupérer le workflow vocal
                workflow = db.query(WorkflowDefinition).filter_by(
                    id=session.workflow_id
                ).first()

                if not workflow:
                    raise ValueError(f"Workflow {session.workflow_id} not found")

                # Résoudre la configuration vocal du workflow
                voice_config = resolve_start_telephony_config(workflow)
                if not voice_config or not voice_config.default_route:
                    raise ValueError(
                        f"Workflow {session.workflow_id} has no voice configuration"
                    )

                route = voice_config.default_route
                voice_model = route.model or get_settings().chatkit_realtime_model
                instructions = (
                    route.instructions or get_settings().chatkit_realtime_instructions
                )
                voice_name = route.voice or get_settings().chatkit_realtime_voice

                # Ouvrir une session vocale Realtime
                logger.info("Opening Realtime voice session for outbound call")

                # Extraire les tools et handoffs du workflow vocal
                voice_tools = []
                voice_handoffs = []

                # Chercher le noeud voice_agent dans le workflow vocal
                for step in workflow.steps:
                    if getattr(step, "kind", None) == "voice_agent":
                        params = getattr(step, "parameters", None)
                        if isinstance(params, dict):
                            # Extraire les tools
                            tools_payload = params.get("tools")
                            if isinstance(tools_payload, list):
                                voice_tools.extend(tools_payload)

                            # Extraire les handoffs
                            handoffs_payload = params.get("handoffs")
                            if isinstance(handoffs_payload, list):
                                voice_handoffs.extend(handoffs_payload)
                        break

                # Ajouter automatiquement le tool de transfert d'appel pour la téléphonie
                outbound_call_tool_config = {
                    "type": "function",
                    "name": "make_outbound_call",
                    "description": (
                        "Effectue un appel sortant vers un numéro de téléphone. "
                        "Utilisez cette fonction lorsque vous devez contacter quelqu'un "
                        "ou transférer l'appelant vers un autre numéro."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "phone_number": {
                                "type": "string",
                                "description": (
                                    "Le numéro de téléphone à appeler. "
                                    "Format recommandé: E.164 (ex: +33123456789)"
                                ),
                            },
                            "announcement": {
                                "type": "string",
                                "description": (
                                    "Message optionnel à annoncer avant de passer l'appel"
                                ),
                            },
                        },
                        "required": ["phone_number"],
                    },
                }
                voice_tools.append(outbound_call_tool_config)

                logger.info(
                    "Voice agent tools configured (total: %d tools)", len(voice_tools)
                )

                # Déterminer le provider depuis la route ou config globale
                voice_provider_slug = getattr(route, "provider_slug", None) or "openai"
                voice_provider_id = getattr(route, "provider_id", None)

                session_handle = await open_voice_session(
                    user_id=f"outbound:{session.call_id}",
                    model=voice_model,
                    instructions=instructions,
                    voice=voice_name,
                    provider_id=voice_provider_id,
                    provider_slug=voice_provider_slug,
                    tools=voice_tools,
                    handoffs=voice_handoffs,
                    realtime={},
                    metadata={
                        "outbound_call_id": session.call_id,
                        "to_number": session.to_number,
                        "from_number": session.from_number,
                    },
                )

                # Récupérer le client secret
                client_secret = session_handle.client_secret

                if not client_secret:
                    raise ValueError(
                        f"Client secret introuvable pour l'appel {session.call_id}"
                    )

                logger.info(
                    "Voice session created (session_id=%s)", session_handle.session_id
                )

                # Créer les hooks pour le voice bridge
                async def close_dialog_hook() -> None:
                    """Ferme le dialogue SIP."""
                    # Le BYE sera envoyé dans le cleanup final
                    # On ne fait rien ici pour éviter les doubles BYE
                    pass

                async def clear_voice_state_hook() -> None:
                    """Nettoie l'état vocal."""
                    # Arrêter le serveur RTP
                    if session._rtp_server:
                        try:
                            await session._rtp_server.stop()
                        except Exception as e:
                            logger.debug("Failed to stop RTP server: %s", e)

                async def resume_workflow_hook(transcripts: list[dict[str, str]]) -> None:
                    """Callback appelé à la fin de la session vocale."""
                    logger.info(
                        "Voice session completed with %d transcripts",
                        len(transcripts),
                    )

                    # Sauvegarder les transcriptions dans les métadonnées de l'appel
                    try:
                        call = db.query(OutboundCall).filter_by(id=call_db_id).first()
                        if call:
                            # Récupérer les métadonnées existantes ou créer un dict vide
                            metadata = call.metadata_ or {}
                            if not isinstance(metadata, dict):
                                metadata = {}

                            # Ajouter les transcriptions
                            metadata["transcripts"] = transcripts
                            metadata["transcript_count"] = len(transcripts)

                            # Mettre à jour en base
                            call.metadata_ = metadata
                            db.commit()

                            logger.info(
                                "Saved %d transcripts for outbound call %s",
                                len(transcripts),
                                session.call_id,
                            )
                    except Exception as e:
                        logger.exception(
                            "Failed to save transcripts for call %s: %s",
                            session.call_id,
                            e,
                        )

                async def on_transcript_hook(transcript: dict[str, str]) -> None:
                    """Appelé en temps réel pour chaque transcription."""
                    try:
                        # Récupérer le thread_id depuis les métadonnées
                        call = db.query(OutboundCall).filter_by(id=call_db_id).first()
                        if not call:
                            logger.warning("Call not found for on_transcript hook")
                            return

                        metadata = call.metadata_ or {}
                        thread_id = metadata.get("triggered_by_session_id")
                        if not thread_id:
                            logger.debug("No thread_id in call metadata, skipping real-time transcript")
                            return

                        # Ajouter la transcription au thread ChatKit
                        import uuid
                        from datetime import datetime, timezone

                        from chatkit.types import (
                            AssistantMessageContent,
                            AssistantMessageItem,
                            InferenceOptions,
                            UserMessageItem,
                            UserMessageTextContent,
                        )

                        from ..chatkit import get_chatkit_server
                        from ..chatkit_server.context import ChatKitRequestContext
                        from ..models import ChatThread

                        server = get_chatkit_server()

                        # Récupérer le owner_id du thread depuis la base de données
                        thread_record = db.query(ChatThread).filter_by(id=thread_id).first()
                        if not thread_record:
                            logger.warning("Thread %s not found in database", thread_id)
                            return

                        # Créer un contexte avec le bon owner_id
                        context = ChatKitRequestContext(
                            user_id=thread_record.owner_id,
                            email=None,
                            authorization=None,
                            public_base_url=None,
                        )

                        # Ajouter le message de transcription
                        role = transcript.get("role")
                        text = transcript.get("text", "")

                        if not text:
                            return

                        # Créer un ID unique pour le message
                        message_id = f"transcript_{session.call_id}_{uuid.uuid4().hex[:8]}"
                        now = datetime.now(timezone.utc)

                        # Ajouter le message via le store API
                        try:
                            if role == "user":
                                user_msg = UserMessageItem(
                                    id=message_id,
                                    thread_id=thread_id,
                                    created_at=now,
                                    content=[UserMessageTextContent(text=text)],
                                    attachments=[],
                                    inference_options=InferenceOptions(),
                                    quoted_text=None,
                                )
                                await server.store.add_thread_item(thread_id, user_msg, context)
                            elif role == "assistant":
                                assistant_msg = AssistantMessageItem(
                                    id=message_id,
                                    thread_id=thread_id,
                                    created_at=now,
                                    content=[AssistantMessageContent(text=text)],
                                )
                                await server.store.add_thread_item(thread_id, assistant_msg, context)
                            else:
                                return

                            events_mgr = get_outbound_events_manager()
                            await events_mgr.emit_event(
                                {
                                    "type": "transcript_delta",
                                    "call_id": session.call_id,
                                    "thread_id": thread_id,
                                    "message_id": message_id,
                                    "role": role,
                                    "text": text,
                                }
                            )

                            logger.info("Added real-time transcript to thread %s: %s: %s", thread_id, role, text[:50])
                        except Exception as e:
                            logger.error("Failed to add transcript to thread: %s", e, exc_info=True)

                    except Exception as e:
                        logger.error("Error in on_transcript_hook: %s", e, exc_info=True)

                # Hooks pour le streaming audio
                from .audio_stream_manager import get_audio_stream_manager
                audio_stream_mgr = get_audio_stream_manager()

                async def on_audio_inbound_hook(pcm_data: bytes) -> None:
                    """Appelé en temps réel pour chaque chunk audio entrant."""
                    try:
                        await audio_stream_mgr.broadcast_audio(session.call_id, pcm_data, channel="inbound")
                    except Exception as e:
                        logger.error("Error broadcasting inbound audio: %s", e)

                async def on_audio_outbound_hook(pcm_data: bytes) -> None:
                    """Appelé en temps réel pour chaque chunk audio sortant."""
                    try:
                        await audio_stream_mgr.broadcast_audio(session.call_id, pcm_data, channel="outbound")
                    except Exception as e:
                        logger.error("Error broadcasting outbound audio: %s", e)

                hooks = VoiceBridgeHooks(
                    close_dialog=close_dialog_hook,
                    clear_voice_state=clear_voice_state_hook,
                    resume_workflow=resume_workflow_hook,
                    on_transcript=on_transcript_hook,
                    on_audio_inbound=on_audio_inbound_hook,
                    on_audio_outbound=on_audio_outbound_hook,
                )

                # Créer le voice bridge
                voice_bridge = TelephonyVoiceBridge(hooks=hooks, input_codec="pcm")
                session._voice_bridge = voice_bridge

                # Callback pour envoyer l'audio au peer
                async def send_to_peer(audio_data: bytes) -> None:
                    if session._rtp_server:
                        await session._rtp_server.send_audio(audio_data)

                # Déterminer le base URL pour le provider (OpenAI, etc.)
                realtime_api_base: str | None = None
                if voice_provider_slug == "openai":
                    realtime_api_base = os.environ.get("CHATKIT_API_BASE") or "https://api.openai.com"

                # Exécuter le voice bridge
                logger.info("Starting TelephonyVoiceBridge for outbound call")
                try:
                    stats = await voice_bridge.run(
                        runner=session_handle.runner,
                        client_secret=client_secret,
                        model=voice_model,
                        instructions=instructions,
                        voice=voice_name,
                        rtp_stream=rtp_server.packet_stream(),
                        send_to_peer=send_to_peer,
                        api_base=realtime_api_base,
                        tools=voice_tools,
                        handoffs=voice_handoffs,
                    )

                    # Le voice bridge est terminé
                    logger.info("TelephonyVoiceBridge completed: %s", stats)

                    # Mettre à jour les stats du voice bridge dans les métadonnées
                    try:
                        call = db.query(OutboundCall).filter_by(id=call_db_id).first()
                        if call:
                            # Récupérer les métadonnées existantes
                            metadata = call.metadata_ or {}
                            if not isinstance(metadata, dict):
                                metadata = {}

                            # Ajouter les stats du voice bridge
                            metadata["voice_bridge_stats"] = {
                                "duration_seconds": stats.duration_seconds,
                                "inbound_audio_bytes": stats.inbound_audio_bytes,
                                "outbound_audio_bytes": stats.outbound_audio_bytes,
                                "transcript_count": stats.transcript_count,
                                "error": str(stats.error) if stats.error else None,
                            }

                            # Sauvegarder les chemins des fichiers audio
                            if stats.inbound_audio_file or stats.outbound_audio_file or stats.mixed_audio_file:
                                metadata["audio_recordings"] = {
                                    "inbound": stats.inbound_audio_file,
                                    "outbound": stats.outbound_audio_file,
                                    "mixed": stats.mixed_audio_file,
                                }
                                logger.info(
                                    "Audio recordings saved for call %s: inbound=%s, outbound=%s, mixed=%s",
                                    session.call_id,
                                    stats.inbound_audio_file,
                                    stats.outbound_audio_file,
                                    stats.mixed_audio_file,
                                )

                            # Mettre à jour en base
                            call.metadata_ = metadata
                            db.commit()

                            logger.info(
                                "Saved voice bridge stats for call %s: %d seconds, %d transcripts",
                                session.call_id,
                                stats.duration_seconds,
                                stats.transcript_count,
                            )
                    except Exception as e:
                        logger.exception(
                            "Failed to save voice bridge stats for call %s: %s",
                            session.call_id,
                            e,
                        )

                finally:
                    # Fermer la session vocale
                    try:
                        await close_voice_session(session_id=session_handle.session_id)
                    except Exception as e:
                        logger.warning("Failed to close voice session: %s", e)

                # Envoyer BYE pour terminer l'appel
                try:
                    await dialog.bye()
                except Exception as e:
                    logger.warning("Failed to send BYE: %s", e)

                # Marquer comme terminé
                session.status = "completed"
                end_time = datetime.now(UTC)
                call = db.query(OutboundCall).filter_by(id=call_db_id).first()
                if call and call.answered_at:
                    duration = int((end_time - call.answered_at).total_seconds())
                    self._update_call_status(
                        db,
                        call_db_id,
                        "completed",
                        ended_at=end_time,
                        duration_seconds=duration,
                    )
                else:
                    self._update_call_status(
                        db, call_db_id, "completed", ended_at=end_time
                    )

            elif status_code == 486:
                # Busy
                session.status = "busy"
                self._update_call_status(
                    db, call_db_id, "busy", ended_at=datetime.now(UTC)
                )
                logger.info("Call busy")

            elif status_code == 487:
                # Request terminated (no answer)
                session.status = "no_answer"
                self._update_call_status(
                    db, call_db_id, "no_answer", ended_at=datetime.now(UTC)
                )
                logger.info("Call not answered")

            else:
                # Autre erreur
                session.status = "failed"
                self._update_call_status(
                    db,
                    call_db_id,
                    "failed",
                    failure_reason=f"SIP status {status_code}",
                    ended_at=datetime.now(UTC),
                )
                logger.warning("Call failed with status %s", status_code)

            logger.info("Outbound call %s completed successfully", session.call_id)

        except Exception as e:
            logger.error("Error executing outbound call %s: %s", session.call_id, e, exc_info=True)
            session.status = "failed"
            self._update_call_status(
                db, call_db_id, "failed", failure_reason=str(e), ended_at=datetime.now(UTC)
            )

        finally:
            # Cleanup
            if session._dialog:
                try:
                    session._dialog.close()
                except Exception as e:
                    logger.warning("Error closing SIP dialog: %s", e)

            if session._rtp_server:
                try:
                    await session._rtp_server.stop()
                except Exception as e:
                    logger.warning("Error stopping RTP server: %s", e)

            # Fermer les streams audio
            try:
                from .audio_stream_manager import get_audio_stream_manager
                audio_stream_mgr = get_audio_stream_manager()
                await audio_stream_mgr.close_call(session.call_id)
            except Exception as e:
                logger.warning("Erreur fermeture streams audio (call_id=%s): %s", session.call_id, e)

            # Marquer la session comme terminée
            session.mark_complete()

            # Émettre un événement call_ended
            events_mgr = get_outbound_events_manager()
            try:
                asyncio.create_task(events_mgr.emit_event({
                    "type": "call_ended",
                    "call_id": session.call_id,
                    "status": session.status,
                }))
                logger.info("Emitted call_ended event for call %s", session.call_id)
            except Exception as e:
                logger.warning("Failed to emit call_ended event: %s", e)

            # Retirer de la liste des appels actifs
            if session.call_id in self.active_calls:
                del self.active_calls[session.call_id]

    def _build_sip_uri(self, number: str, trunk_uri: str) -> str:
        """Construit un URI SIP à partir d'un numéro et du trunk URI."""
        # Extraire le domaine du trunk URI
        # trunk_uri est du genre: sip:username@sip.provider.com:5060
        if "@" in trunk_uri:
            domain_part = trunk_uri.split("@", 1)[1]
        else:
            domain_part = trunk_uri.replace("sip:", "").replace("sips:", "")

        # Nettoyer le numéro (garder seulement les chiffres et +)
        clean_number = "".join(c for c in number if c.isdigit() or c == "+")

        return f"sip:{clean_number}@{domain_part}"

    def _build_contact_uri(self, sip_account: SipAccount) -> str:
        """Construit l'URI de contact."""
        host = sip_account.contact_host or "localhost"
        port = sip_account.contact_port or 5060
        username = sip_account.username or "chatkit"

        return f"sip:{username}@{host}:{port}"

    def _parse_trunk_uri(self, trunk_uri: str) -> tuple[str, int]:
        """Parse le trunk URI pour extraire host et port."""
        # trunk_uri format: sip:username@host:port ou sip:host:port
        uri = trunk_uri.replace("sip:", "").replace("sips:", "")

        if "@" in uri:
            uri = uri.split("@", 1)[1]

        if ":" in uri:
            parts = uri.rsplit(":", 1)
            host = parts[0]
            try:
                port = int(parts[1])
            except ValueError:
                port = 5060
        else:
            host = uri
            port = 5060

        return host, port

    def _generate_sdp(self, local_host: str, local_rtp_port: int = 0) -> str:
        """Génère un SDP pour l'INVITE."""
        # Générer un port RTP local si non spécifié
        if local_rtp_port == 0:
            local_rtp_port = random.randint(10000, 20000)

        session_id = int(datetime.now(UTC).timestamp())

        sdp = f"""v=0
o=chatkit {session_id} {session_id} IN IP4 {local_host}
s=ChatKit Outbound Call
c=IN IP4 {local_host}
t=0 0
m=audio {local_rtp_port} RTP/AVP 0 8 18
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:18 G729/8000
a=ptime:20
a=sendrecv
"""
        return sdp

    def _parse_sdp_connection(self, sdp: str) -> tuple[str | None, int | None]:
        """Parse le SDP pour extraire l'adresse et le port RTP."""
        if not sdp:
            return None, None

        lines = sdp.strip().split("\n")
        connection_address = None
        media_port = None

        for line in lines:
            line = line.strip()
            # Chercher la ligne de connexion: c=IN IP4 x.x.x.x
            if line.startswith("c="):
                parts = line.split()
                if len(parts) >= 3 and parts[1].upper() in ("IP4", "IP6"):
                    connection_address = parts[2]

            # Chercher la ligne média: m=audio <port> ...
            if line.startswith("m=audio"):
                parts = line.split()
                if len(parts) >= 2:
                    try:
                        media_port = int(parts[1])
                    except ValueError:
                        pass

        return connection_address, media_port

    def _update_call_status(
        self,
        db: Session,
        call_db_id: int,
        status: str,
        **kwargs: Any,
    ) -> None:
        """Met à jour le statut d'un appel dans la base de données."""
        call = db.query(OutboundCall).filter_by(id=call_db_id).first()
        if call:
            call.status = status
            for key, value in kwargs.items():
                if hasattr(call, key):
                    # Truncate failure_reason to 256 characters to avoid database errors
                    if key == "failure_reason" and isinstance(value, str) and len(value) > 256:
                        value = value[:253] + "..."
                    setattr(call, key, value)
            db.commit()

    async def get_call_status(self, db: Session, call_id: str) -> dict[str, Any] | None:
        """Récupère le statut d'un appel."""
        call = db.query(OutboundCall).filter_by(call_sid=call_id).first()
        if not call:
            return None

        # Récupérer les métadonnées
        metadata = call.metadata_ or {}
        transcripts = metadata.get("transcripts", [])
        audio_recordings = metadata.get("audio_recordings", {})

        return {
            "call_id": call.call_sid,
            "status": call.status,
            "to_number": call.to_number,
            "from_number": call.from_number,
            "queued_at": call.queued_at.isoformat() if call.queued_at else None,
            "answered_at": call.answered_at.isoformat() if call.answered_at else None,
            "ended_at": call.ended_at.isoformat() if call.ended_at else None,
            "duration_seconds": call.duration_seconds,
            "failure_reason": call.failure_reason,
            "transcripts": transcripts,
            "audio_recordings": audio_recordings,
        }

    async def hangup_call(self, call_id: str) -> bool:
        """Termine un appel en cours manuellement.

        Args:
            call_id: ID de l'appel à terminer

        Returns:
            True si l'appel a été terminé, False si l'appel n'existe pas
        """
        # Vérifier si l'appel existe
        session = self.active_calls.get(call_id)
        if not session:
            logger.warning("Tentative de raccrochage d'un appel inexistant: %s", call_id)
            return False

        logger.info("Raccrochage manuel de l'appel %s", call_id)

        # Mettre à jour le statut
        session.status = "terminated"

        try:
            # 1. Terminer l'appel PJSUA si applicable
            if session._pjsua_call is not None:
                try:
                    logger.info("Raccrochage de l'appel PJSUA (call_id=%s)", call_id)
                    if pj is not None:
                        prm = pj.CallOpParam()
                        session._pjsua_call.hangup(prm)
                    else:
                        logger.warning("pjsua2 non disponible, impossible de raccrocher proprement")
                except Exception as e:
                    logger.warning("Erreur raccrochage PJSUA (call_id=%s): %s", call_id, e)
                finally:
                    session._pjsua_call = None

            # 2. Fermer les streams audio
            try:
                from .audio_stream_manager import get_audio_stream_manager
                audio_stream_mgr = get_audio_stream_manager()
                await audio_stream_mgr.close_call(call_id)
            except Exception as e:
                logger.warning("Erreur fermeture streams audio (call_id=%s): %s", call_id, e)

            # 3. Marquer la session comme terminée
            session.mark_complete()

            # 4. Mettre à jour la DB
            db = SessionLocal()
            try:
                # Récupérer l'enregistrement de l'appel pour obtenir son ID de base de données
                call_record = db.query(OutboundCall).filter_by(call_sid=call_id).first()
                if call_record:
                    self._update_call_status(
                        db,
                        call_record.id,
                        "terminated",
                        ended_at=datetime.now(UTC),
                        failure_reason="Raccroché manuellement"
                    )
                else:
                    logger.warning("Call record not found in DB for call_id=%s", call_id)
            finally:
                db.close()

            # 5. Émettre un événement call_ended
            events_mgr = get_outbound_events_manager()
            try:
                asyncio.create_task(events_mgr.emit_event({
                    "type": "call_ended",
                    "call_id": call_id,
                    "status": "terminated",
                }))
                logger.info("Emitted call_ended event for manually hung up call %s", call_id)
            except Exception as e:
                logger.warning("Failed to emit call_ended event: %s", e)

            # 6. Retirer de active_calls
            self.active_calls.pop(call_id, None)

            return True

        except Exception as e:
            logger.error("Erreur lors du raccrochage de l'appel %s: %s", call_id, e, exc_info=True)
            return False


# Instance globale
_outbound_call_manager: OutboundCallManager | None = None


def get_outbound_call_manager(pjsua_adapter: PJSUAAdapter | None = None) -> OutboundCallManager:
    """Récupère l'instance globale du gestionnaire d'appels sortants.

    Args:
        pjsua_adapter: Adaptateur PJSUA optionnel pour les appels sortants.
                      Si fourni, l'instance sera (re)créée avec cet adaptateur.

    Returns:
        L'instance globale du gestionnaire
    """
    global _outbound_call_manager

    # Si un adaptateur est fourni et qu'on n'a pas encore d'instance,
    # ou si l'adaptateur est différent, créer une nouvelle instance
    if pjsua_adapter is not None:
        if _outbound_call_manager is None or _outbound_call_manager._pjsua_adapter != pjsua_adapter:
            logger.info("Création du OutboundCallManager avec PJSUA adapter")
            _outbound_call_manager = OutboundCallManager(pjsua_adapter=pjsua_adapter)
    elif _outbound_call_manager is None:
        # Créer sans adaptateur (legacy aiosip)
        logger.info("Création du OutboundCallManager sans PJSUA (legacy)")
        _outbound_call_manager = OutboundCallManager()

    return _outbound_call_manager
