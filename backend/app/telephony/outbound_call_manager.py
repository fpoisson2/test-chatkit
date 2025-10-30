"""Gestionnaire des appels sortants avec implémentation SIP complète."""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
import random
from datetime import datetime, UTC
from typing import Any

from sqlalchemy.orm import Session

from ..models import OutboundCall, SipAccount, WorkflowDefinition
from ..database import SessionLocal
from .rtp_server import RtpServer, RtpServerConfig
from .voice_bridge import TelephonyVoiceBridge, VoiceBridgeHooks, VoiceBridgeMetricsRecorder
from ..workflows.service import WorkflowService, resolve_start_telephony_config
from ..config import get_settings
from ..realtime_runner import open_voice_session, close_voice_session

logger = logging.getLogger("chatkit.telephony.outbound")

# Import aiosip avec gestion d'erreur
try:
    import aiosip
    AIOSIP_AVAILABLE = True
except ImportError:
    aiosip = None  # type: ignore[assignment]
    AIOSIP_AVAILABLE = False
    logger.warning("aiosip n'est pas disponible - les appels sortants ne fonctionneront pas")


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
        self._dialog: Any = None
        self._rtp_server: Any = None
        self._voice_bridge: Any = None

    async def wait_until_complete(self) -> None:
        """Attend que l'appel soit terminé."""
        await self._completion_event.wait()

    def mark_complete(self) -> None:
        """Marque l'appel comme terminé."""
        self._completion_event.set()


class OutboundCallManager:
    """Gère l'initiation et l'exécution des appels sortants avec SIP."""

    def __init__(self):
        self.active_calls: dict[str, OutboundCallSession] = {}
        self._app: Any = None  # aiosip.Application

    async def _ensure_sip_application(self) -> Any:
        """S'assure que l'application SIP est initialisée."""
        if not AIOSIP_AVAILABLE:
            raise RuntimeError("aiosip n'est pas disponible")

        if self._app is None:
            logger.info("Initialisation de l'application SIP pour appels sortants")
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

        # Lancer l'appel en background
        asyncio.create_task(self._execute_call_sip(db, session, call_record.id))

        return session

    async def _execute_call_sip(
        self, db: Session, session: OutboundCallSession, call_db_id: int
    ) -> None:
        """
        Exécute l'appel sortant avec SIP complet.
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
                from ..session_secret import session_secret_parser

                secret_payload = session_handle.payload
                parsed_secret = session_secret_parser.parse(secret_payload)
                client_secret = parsed_secret.as_text()

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

                hooks = VoiceBridgeHooks(
                    close_dialog=close_dialog_hook,
                    clear_voice_state=clear_voice_state_hook,
                    resume_workflow=resume_workflow_hook,
                )

                # Créer le voice bridge
                voice_bridge = TelephonyVoiceBridge(hooks=hooks)
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

            # Marquer la session comme terminée
            session.mark_complete()

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
                    setattr(call, key, value)
            db.commit()

    async def get_call_status(self, db: Session, call_id: str) -> dict[str, Any] | None:
        """Récupère le statut d'un appel."""
        call = db.query(OutboundCall).filter_by(call_sid=call_id).first()
        if not call:
            return None

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
        }


# Instance globale
_outbound_call_manager: OutboundCallManager | None = None


def get_outbound_call_manager() -> OutboundCallManager:
    """Récupère l'instance globale du gestionnaire d'appels sortants."""
    global _outbound_call_manager
    if _outbound_call_manager is None:
        _outbound_call_manager = OutboundCallManager()
    return _outbound_call_manager
