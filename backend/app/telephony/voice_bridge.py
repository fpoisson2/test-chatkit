"""Pont entre la téléphonie SIP et les sessions Realtime."""

from __future__ import annotations

import asyncio
import audioop
import base64
import json
import logging
import struct
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import quote

from ..config import Settings, get_settings

logger = logging.getLogger("chatkit.telephony.voice_bridge")

SIP_SAMPLE_RATE = 8_000


class VoiceBridgeError(RuntimeError):
    """Erreur levée lorsque la session Realtime échoue."""


@dataclass(frozen=True)
class RtpPacket:
    """Représentation minimale d'un paquet RTP audio."""

    payload: bytes
    timestamp: int
    sequence_number: int
    payload_type: int = 0
    marker: bool = False


class WebSocketLike(Protocol):
    """Interface minimale utilisée par le pont Realtime."""

    async def send(self, data: str | bytes) -> None: ...

    async def recv(self) -> str | bytes: ...

    async def close(self, code: int = 1000) -> None: ...


@dataclass
class VoiceBridgeStats:
    """Statistiques d'exécution d'une session de pont voix."""

    duration_seconds: float
    inbound_audio_bytes: int
    outbound_audio_bytes: int
    transcripts: list[dict[str, str]] = field(default_factory=list)
    error: Exception | None = None

    @property
    def transcript_count(self) -> int:
        return len(self.transcripts)


class VoiceBridgeMetricsRecorder:
    """Collecte en mémoire les métriques des sessions voix."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._total_sessions = 0
        self._total_errors = 0
        self._total_duration = 0.0
        self._total_inbound = 0
        self._total_outbound = 0
        self._last_error: str | None = None

    async def record(self, stats: VoiceBridgeStats) -> None:
        async with self._lock:
            self._total_sessions += 1
            self._total_duration += stats.duration_seconds
            self._total_inbound += stats.inbound_audio_bytes
            self._total_outbound += stats.outbound_audio_bytes
            if stats.error is not None:
                self._total_errors += 1
                self._last_error = repr(stats.error)

    def snapshot(self) -> dict[str, Any]:
        return {
            "total_sessions": self._total_sessions,
            "total_errors": self._total_errors,
            "total_duration": self._total_duration,
            "total_inbound_audio_bytes": self._total_inbound,
            "total_outbound_audio_bytes": self._total_outbound,
            "last_error": self._last_error,
            "average_duration": (
                self._total_duration / self._total_sessions
                if self._total_sessions
                else 0.0
            ),
        }


@dataclass
class VoiceBridgeHooks:
    """Callbacks déclenchés lors de l'arrêt d'une session vocale."""

    close_dialog: Callable[[], Awaitable[None]] | None = None
    clear_voice_state: Callable[[], Awaitable[None]] | None = None
    resume_workflow: Callable[[list[dict[str, str]]], Awaitable[None]] | None = None


VoiceSessionChecker = Callable[[], bool]


async def default_websocket_connector(
    url: str,
    headers: Mapping[str, str],
) -> WebSocketLike:
    """Ouvre une connexion WebSocket Realtime avec la librairie websockets."""

    try:  # pragma: no cover - dépendance optionnelle
        from websockets.asyncio.client import connect  # type: ignore[import-not-found]
    except ImportError:  # pragma: no cover - compatibilité versions
        try:
            from websockets.client import connect  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover - websockets non installé
            raise RuntimeError(
                "Le module websockets est requis pour le pont Realtime"
            ) from exc

    return await connect(
        url,
        additional_headers=headers,
        open_timeout=10.0,
        close_timeout=5.0,
        max_size=None,
    )


def build_realtime_ws_url(
    model: str, *, api_base: str | None = None, settings: Settings | None = None
) -> str:
    """Construit l'URL WebSocket Realtime pour le modèle demandé."""

    if api_base:
        base = api_base.rstrip("/")
    else:
        effective_settings = settings or get_settings()
        base = effective_settings.model_api_base.rstrip("/")

    if base.startswith("https://"):
        ws_base = "wss://" + base[len("https://") :]
    elif base.startswith("http://"):
        ws_base = "ws://" + base[len("http://") :]
    else:
        ws_base = base
        if not ws_base.startswith("ws"):
            ws_base = "wss://" + ws_base.lstrip("/")

    # Ajouter /v1 si ce n'est pas déjà présent dans le chemin
    if not ws_base.endswith("/v1") and "/v1/" not in ws_base:
        ws_base = f"{ws_base}/v1"

    return f"{ws_base}/realtime?model={quote(model, safe='')}"


class TelephonyVoiceBridge:
    """Pont entre le flux RTP SIP et la session Realtime ChatKit."""

    def __init__(
        self,
        *,
        hooks: VoiceBridgeHooks,
        metrics: VoiceBridgeMetricsRecorder | None = None,
        websocket_connector: Callable[
            [str, Mapping[str, str]], Awaitable[WebSocketLike]
        ]
        | None = None,
        voice_session_checker: VoiceSessionChecker | None = None,
        input_codec: str = "pcmu",
        target_sample_rate: int = 24_000,
        receive_timeout: float = 0.5,
        vad_threshold: float = 500.0,
        settings: Settings | None = None,
        keepalive_interval: float = 0.5,
    ) -> None:
        self._hooks = hooks
        self._metrics = metrics or VoiceBridgeMetricsRecorder()
        self._websocket_connector = websocket_connector or default_websocket_connector
        self._voice_session_checker = voice_session_checker
        self._input_codec = input_codec.lower()
        self._target_sample_rate = target_sample_rate
        self._receive_timeout = max(0.1, receive_timeout)
        self._vad_threshold = vad_threshold
        self._settings = settings or get_settings()
        self._keepalive_interval = max(0.01, keepalive_interval)
        self.running = False
        self._active_rtp_server: Any | None = None

    @staticmethod
    def _calculate_audio_energy(pcm_data: bytes) -> float:
        """Calcule l'énergie RMS de l'audio PCM16."""
        if not pcm_data or len(pcm_data) < 2:
            return 0.0

        # Convertir bytes en samples int16
        num_samples = len(pcm_data) // 2
        samples = struct.unpack(f"{num_samples}h", pcm_data)

        # Calculer RMS (Root Mean Square)
        sum_squares = sum(s * s for s in samples)
        rms = (sum_squares / num_samples) ** 0.5
        return rms

    async def run(
        self,
        *,
        client_secret: str,
        model: str,
        instructions: str,
        voice: str | None,
        call_id: str | None = None,
        rtp_stream: AsyncIterator[RtpPacket],
        send_to_peer: Callable[[bytes], Awaitable[None]],
        api_base: str | None = None,
        session_config: Mapping[str, Any] | None = None,
        tool_permissions: Mapping[str, Any] | None = None,
        rtp_server: Any | None = None,
    ) -> VoiceBridgeStats:
        """Démarre le pont voix jusqu'à la fin de session ou erreur."""

        url = build_realtime_ws_url(model, api_base=api_base, settings=self._settings)
        headers = {
            "Authorization": f"Bearer {client_secret}",
            # Note: "OpenAI-Beta: realtime=v1" retiré pour utiliser l'API GA
        }

        call_context = f" (Call-ID={call_id})" if call_id else ""
        logger.info(
            "Ouverture de la session Realtime voix%s (modèle=%s, voix=%s)",
            call_context,
            model,
            voice,
        )
        if isinstance(session_config, Mapping) and session_config:
            logger.info(
                "Session.update initiale%s : champs=%s",
                call_context,
                sorted(session_config.keys()),
            )
        if isinstance(tool_permissions, Mapping) and tool_permissions:
            logger.info(
                "Permissions outils initiales%s : %s",
                call_context,
                sorted(tool_permissions.keys()),
            )

        start_time = time.monotonic()
        inbound_audio_bytes = 0
        outbound_audio_bytes = 0
        transcripts: list[dict[str, str]] = []
        error: Exception | None = None
        websocket: WebSocketLike | None = None
        stop_event = asyncio.Event()
        initial_messages: list[str | bytes] = []
        user_audio_logged = False
        agent_audio_logged = False
        last_outbound_audio = time.monotonic()
        silence_frame = self._build_silence_frame()

        def should_continue() -> bool:
            if stop_event.is_set():
                return False
            checker = self._voice_session_checker
            if checker is None:
                return True
            try:
                return bool(checker())
            except Exception:  # pragma: no cover - garde-fou
                logger.exception(
                    "Lecture de voice_session_active impossible, poursuite par défaut",
                )
                return True

        async def request_stop() -> None:
            stop_event.set()

        async def send_json(message: Mapping[str, Any]) -> None:
            payload = json.dumps(message)
            await websocket.send(payload)  # type: ignore[arg-type]

        async def forward_audio() -> None:
            nonlocal inbound_audio_bytes, agent_is_speaking, user_audio_logged
            try:
                async for packet in rtp_stream:
                    pcm = self._decode_packet(packet)
                    if not pcm:
                        continue
                    inbound_audio_bytes += len(pcm)
                    if not user_audio_logged:
                        logger.info(
                            "Flux RTP utilisateur démarré%s (octets=%d, séquence=%d)",
                            call_context,
                            len(pcm),
                            packet.sequence_number,
                        )
                        user_audio_logged = True

                    # VAD local : détecter si l'utilisateur parle pendant que
                    # l'agent parle
                    energy = self._calculate_audio_energy(pcm)
                    if energy > self._vad_threshold and agent_is_speaking:
                        if not audio_interrupted.is_set():
                            logger.info(
                                "VAD local : interruption détectée "
                                "(énergie=%.1f, seuil=%.1f)",
                                energy,
                                self._vad_threshold
                            )
                            audio_interrupted.set()

                    encoded = base64.b64encode(pcm).decode("ascii")
                    await send_json(
                        {
                            "type": "input_audio_buffer.append",
                            "audio": encoded,
                        }
                    )
                    if not should_continue():
                        break
            finally:
                # Mode conversation : le VAD gère automatiquement les commits.
                # Pas de commit manuel : l'API déclenche speech_stopped.
                logger.debug(
                    "Fin du flux audio RTP, attente de la fermeture de session"
                )
                if not user_audio_logged:
                    logger.info(
                        "Flux RTP utilisateur terminé sans audio%s", call_context
                    )
                await request_stop()

        transcript_buffers: dict[str, list[str]] = {}
        audio_interrupted = asyncio.Event()
        last_response_id: str | None = None
        agent_is_speaking = False

        async def handle_realtime() -> None:
            nonlocal outbound_audio_bytes, error, last_response_id
            nonlocal agent_is_speaking, agent_audio_logged, last_outbound_audio
            while True:
                try:
                    if initial_messages:
                        raw = initial_messages.pop(0)
                    else:
                        raw = await asyncio.wait_for(
                            websocket.recv(), timeout=self._receive_timeout
                        )
                except asyncio.TimeoutError:
                    if not should_continue():
                        break
                    continue
                except (StopAsyncIteration, EOFError):
                    break
                except Exception as exc:
                    error = VoiceBridgeError("Erreur de transport WebSocket")
                    logger.error("Erreur de transport WebSocket", exc_info=exc)
                    break

                message = self._parse_ws_message(raw)
                if not message:
                    if not should_continue():
                        break
                    continue
                message_type = str(message.get("type") or "").strip()
                if message_type == "session.ended":
                    break
                if message_type == "error":
                    description = self._extract_error_message(message)
                    error = VoiceBridgeError(description)
                    break

                # Événements VAD et interruption
                if message_type == "input_audio_buffer.speech_started":
                    logger.info(
                        "Détection de parole utilisateur - interruption de l'agent"
                    )
                    audio_interrupted.set()
                    continue
                if message_type == "input_audio_buffer.speech_stopped":
                    logger.debug("Fin de parole utilisateur détectée")
                    # Ne PAS réinitialiser le flag ici - on attend la nouvelle réponse
                    continue
                if message_type == "response.cancelled":
                    logger.info("Réponse annulée par l'API")
                    continue
                if message_type in {"audio_interrupted", "response.audio_interrupted"}:
                    logger.info("Audio interrompu par l'utilisateur")
                    continue

                if message_type.endswith("audio.delta"):
                    # Vérifier le response_id pour détecter une nouvelle réponse
                    response_id = self._extract_response_id(message)

                    # Si c'est une nouvelle réponse (response_id différent),
                    # réinitialiser le flag
                    if response_id and response_id != last_response_id:
                        if audio_interrupted.is_set():
                            logger.info(
                                "Nouvelle réponse %s détectée - "
                                "réinitialisation du flag d'interruption",
                                response_id
                            )
                        audio_interrupted.clear()
                        last_response_id = response_id
                        agent_is_speaking = True
                        logger.debug(
                            "Agent commence à parler (réponse %s)", response_id
                        )

                    # Marquer que l'agent parle
                    if not agent_is_speaking:
                        agent_is_speaking = True
                        logger.debug("Agent commence à parler")

                    # Ne pas envoyer l'audio si l'utilisateur a interrompu
                    if audio_interrupted.is_set():
                        logger.debug("Audio delta ignoré (utilisateur a interrompu)")
                        continue

                    for chunk in self._extract_audio_chunks(message):
                        try:
                            pcm = base64.b64decode(chunk)
                        except ValueError:
                            logger.debug("Segment audio Realtime invalide ignoré")
                            continue
                        if pcm:
                            outbound_audio_bytes += len(pcm)
                            if not agent_audio_logged:
                                logger.info(
                                    "Première réponse audio agent%s (octets=%d)",
                                    call_context,
                                    len(pcm),
                                )
                                agent_audio_logged = True
                            await send_to_peer(pcm)
                            last_outbound_audio = time.monotonic()
                    if not should_continue():
                        break
                    continue

                if message_type.endswith("transcript.delta"):
                    response_id = self._extract_response_id(message)
                    text = self._extract_transcript_text(message)
                    if response_id and text:
                        transcript_buffers.setdefault(response_id, []).append(text)
                    if not should_continue():
                        break
                    continue

                if message_type in {"response.completed", "response.done"}:
                    # L'agent a fini de parler
                    agent_is_speaking = False
                    logger.debug("Agent a fini de parler")

                    response = message.get("response")
                    response_id = self._extract_response_id(message)
                    combined_entry: dict[str, str] | None = None
                    if response_id and response_id in transcript_buffers:
                        combined_parts = transcript_buffers.pop(response_id)
                        combined = "".join(combined_parts).strip()
                        if combined:
                            combined_entry = {
                                "role": "assistant",
                                "text": combined,
                            }
                    completed_entries = self._extract_completed_transcripts(response)
                    if completed_entries:
                        transcripts.extend(completed_entries)
                        if (
                            combined_entry
                            and all(
                                entry.get("text") != combined_entry["text"]
                                for entry in completed_entries
                            )
                        ):
                            transcripts.append(combined_entry)
                    elif combined_entry:
                        transcripts.append(combined_entry)

                    # Un événement response.completed marque la fin d'une réponse
                    # individuelle mais ne signifie pas que la session doit être
                    # interrompue. On continue donc à écouter les prochains
                    # événements (nouvelles réponses, reprise utilisateur, etc.).
                    if message_type == "response.done":
                        logger.debug("Response.done reçu, poursuite de la session")
                    continue
                if message_type:
                    logger.debug(
                        "Événement Realtime ignoré%s : %s",
                        call_context,
                        message_type,
                    )
                else:
                    logger.debug("Événement Realtime sans type%s ignoré", call_context)
                if not should_continue():
                    break
            await request_stop()

        async def rtp_send_loop() -> None:
            nonlocal last_outbound_audio, outbound_audio_bytes
            interval = self._keepalive_interval
            base_frame = self._ensure_sip_sample_rate(silence_frame)
            ulaw_payload = audioop.lin2ulaw(base_frame, 2) if base_frame else b""
            samples_per_frame = max(1, len(base_frame) // 2) if base_frame else 160
            sequence = 0
            timestamp = 0
            sent_packets = 0
            logger.info(
                "🔄 [Keepalive] Boucle keepalive RTP initialisée%s "
                "(intervalle=%.3fs, taille=%d)",
                call_context,
                interval,
                len(silence_frame),
            )
            rtp_server_obj = self._active_rtp_server
            if rtp_server_obj is not None:
                logger.info(
                    "🔍 [Keepalive] Vérification des attributs%s...",
                    call_context,
                )
                logger.info("  - self.rtp_server: %r", rtp_server_obj)
                logger.info(
                    "  - self.rtp_server.socket: %r",
                    getattr(rtp_server_obj, "socket", None),
                )
                logger.info(
                    "  - self.rtp_server.remote_ip: %r",
                    getattr(rtp_server_obj, "remote_ip", None),
                )
                logger.info(
                    "  - self.rtp_server.remote_port: %r",
                    getattr(rtp_server_obj, "remote_port", None),
                )
            else:
                logger.info("🔍 [Keepalive] Aucun serveur RTP attaché%s", call_context)

            logger.info("🔄 [Keepalive] Démarrage de la boucle d'envoi%s", call_context)
            while not stop_event.is_set():
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=interval)
                    logger.debug(
                        "Arrêt de la boucle keepalive sur signal stop%s", call_context
                    )
                    break
                except asyncio.TimeoutError:
                    if not should_continue() or not self.running:
                        logger.info(
                            "⏹️ [Keepalive] Arrêt de la boucle (running=%s)%s",
                            self.running,
                            call_context,
                        )
                        break
                    now = time.monotonic()
                    if now - last_outbound_audio < interval:
                        continue

                    first_packet = sent_packets == 0
                    try:
                        use_direct_socket = False
                        remote_ip = None
                        remote_port = None
                        socket_obj = None
                        payload_type = 0
                        ssrc = 0x12345678
                        if rtp_server_obj is not None:
                            remote_ip = getattr(rtp_server_obj, "remote_ip", None)
                            remote_port = getattr(rtp_server_obj, "remote_port", None)
                            socket_obj = getattr(rtp_server_obj, "socket", None)
                            payload_type = int(
                                getattr(rtp_server_obj, "payload_type", payload_type)
                            )
                            ssrc = int(getattr(rtp_server_obj, "ssrc", ssrc))
                            use_direct_socket = (
                                socket_obj is not None
                                and remote_ip is not None
                                and remote_port is not None
                            )

                        if use_direct_socket:
                            if first_packet:
                                logger.info(
                                    "🔄 [Keepalive] Envoi du premier paquet...%s",
                                    call_context,
                                )
                            packet = self._build_rtp_datagram(
                                payload_type=payload_type,
                                sequence=sequence,
                                timestamp=timestamp,
                                ssrc=ssrc,
                                payload=ulaw_payload,
                            )
                            socket_obj.sendto(packet, (remote_ip, remote_port))
                            if first_packet:
                                logger.info(
                                    "✅ [Keepalive] Premier paquet envoyé vers %s:%s%s",
                                    remote_ip,
                                    remote_port,
                                    call_context,
                                )
                        else:
                            if first_packet:
                                logger.info(
                                    "🔄 [Keepalive] Envoi du premier paquet "
                                    "(send_audio)%s",
                                    call_context,
                                )
                            await send_to_peer(silence_frame)
                            if first_packet:
                                logger.info(
                                    "✅ [Keepalive] Premier paquet envoyé via "
                                    "send_audio%s",
                                    call_context,
                                )

                        last_outbound_audio = time.monotonic()
                        outbound_audio_bytes += len(silence_frame)
                        sent_packets += 1
                        sequence = (sequence + 1) % 65536
                        timestamp = (timestamp + samples_per_frame) % (1 << 32)
                        if sent_packets % 50 == 0:
                            logger.info(
                                "🔄 [Keepalive] %d paquets envoyés%s",
                                sent_packets,
                                call_context,
                            )
                    except Exception as exc:  # pragma: no cover - instrumentation
                        logger.error(
                            "❌ [Keepalive] Erreur dans la boucle%s: %s",
                            call_context,
                            exc,
                        )
                        logger.exception("Traceback keepalive")
                        break

        stats: VoiceBridgeStats | None = None
        self._active_rtp_server = rtp_server
        try:
            websocket = await self._websocket_connector(url, headers)
            logger.info(
                "Connexion WebSocket Realtime établie%s (url=%s)",
                call_context,
                url,
            )
            logger.info("✅ Connexion WebSocket établie")
            logger.info("🔍 CHECKPOINT 1: Après connexion WS")

            handshake_error: Exception | None = None
            try:
                logger.info("⏳ Attente de session.created...")
                session_created = False
                while True:
                    try:
                        first_message = await asyncio.wait_for(
                            websocket.recv(), timeout=5.0
                        )
                    except StopAsyncIteration:
                        logger.warning(
                            "⚠️ Flux WebSocket terminé avant session.created"
                        )
                        break
                    if isinstance(first_message, bytes):
                        preview_message = first_message.decode(
                            "utf-8", "ignore"
                        )
                    else:
                        preview_message = first_message
                    logger.info("📩 Message reçu: %s...", preview_message[:200])
                    logger.info("🔍 CHECKPOINT 2: Message reçu")

                    try:
                        data = json.loads(preview_message)
                    except json.JSONDecodeError:
                        data = {}
                        logger.warning("⚠️ Type inattendu: payload non JSON")
                        initial_messages.append(first_message)
                        continue

                    if data.get("type") == "session.created":
                        logger.info("✅ session.created confirmé")
                        session_created = True
                        break

                    logger.warning("⚠️ Type inattendu: %s", data.get("type"))
                    initial_messages.append(first_message)

                if not session_created:
                    logger.warning("⚠️ Aucun événement session.created reçu")

                logger.info("🔍 CHECKPOINT 3: Avant démarrage boucles")
                await send_json(
                    {
                        "type": "session.update",
                        "session": self._build_session_update(
                            model,
                            instructions,
                            voice,
                            session_config=session_config,
                            tool_permissions=tool_permissions,
                        ),
                    }
                )

                logger.info("🎙️ Démarrage des boucles audio...")
                self.running = True
                logger.info("🔍 CHECKPOINT 4: self.running = True")

                tasks: list[asyncio.Task[Any]] = []
                logger.info("📥 Création tâche rtp_receive_loop...")
                tasks.append(asyncio.create_task(forward_audio()))
                logger.info("📡 Création tâche websocket_receive_loop...")
                tasks.append(asyncio.create_task(handle_realtime()))
                logger.info("📤 Création tâche rtp_send_loop...")
                tasks.append(asyncio.create_task(rtp_send_loop()))
                logger.info("✅ %d tâches créées", len(tasks))
                logger.info("🔍 CHECKPOINT 5: Avant gather")

                results = await asyncio.gather(
                    *tasks, return_exceptions=True
                )
                logger.info(
                    "🔍 CHECKPOINT 6: Après gather (ne devrait pas arriver)"
                )

                for result in results:
                    if isinstance(result, Exception):
                        if error is None:
                            error = result
                        logger.error(
                            "Boucle voix terminée avec exception", exc_info=result
                        )
            except asyncio.TimeoutError:
                logger.error("❌ TIMEOUT: Pas de session.created reçu après 5s")
                handshake_error = VoiceBridgeError(
                    "Aucun événement session.created reçu dans le délai imparti"
                )
            except Exception as exc:  # pragma: no cover - instrumentation debug
                logger.error("❌ EXCEPTION: %s: %s", type(exc).__name__, exc)
                import traceback

                logger.error("Traceback: %s", traceback.format_exc())
                handshake_error = exc

            if handshake_error is not None:
                error = handshake_error
        except Exception as exc:
            error = exc
            logger.error(
                "Session voix Realtime interrompue%s : %s", call_context, exc
            )
        finally:
            self.running = False
            self._active_rtp_server = None
            logger.info("🛑 Fin du pont voix")
            if websocket is not None:
                try:
                    await websocket.close()
                except Exception:  # pragma: no cover - fermeture best effort
                    logger.debug(
                        "Fermeture WebSocket Realtime en erreur",
                        exc_info=True,
                    )

            duration = time.monotonic() - start_time
            stats = VoiceBridgeStats(
                duration_seconds=duration,
                inbound_audio_bytes=inbound_audio_bytes,
                outbound_audio_bytes=outbound_audio_bytes,
                transcripts=list(transcripts),
                error=error,
            )
            await self._metrics.record(stats)
            await self._teardown(transcripts, error)
            if error is None:
                logger.info(
                    "Session voix terminée%s (durée=%.2fs, audio_in=%d, "
                    "audio_out=%d, transcripts=%d)",
                    call_context,
                    duration,
                    inbound_audio_bytes,
                    outbound_audio_bytes,
                    stats.transcript_count,
                )
            else:
                logger.warning(
                    "Session voix terminée avec erreur%s après %.2fs",
                    call_context,
                    duration,
                )

        if stats is None:  # pragma: no cover - garde-fou
            raise RuntimeError("Statistiques de pont voix indisponibles")

        return stats

    async def _teardown(
        self, transcripts: list[dict[str, str]], error: Exception | None
    ) -> None:
        await self._invoke_hook(self._hooks.close_dialog)
        await self._invoke_hook(self._hooks.clear_voice_state)
        if transcripts and self._hooks.resume_workflow is not None:
            await self._invoke_hook(self._hooks.resume_workflow, transcripts)
        elif error is not None and self._hooks.resume_workflow is not None:
            logger.debug(
                "Transcriptions absentes après erreur, reprise workflow non déclenchée",
            )

    async def _invoke_hook(
        self,
        hook: Callable[..., Awaitable[None]] | None,
        *args: Any,
    ) -> None:
        if hook is None:
            return
        try:
            await hook(*args)
        except Exception:  # pragma: no cover - meilleure isolation possible
            logger.exception("Hook de pont voix en erreur")

    def _build_session_update(
        self,
        model: str,
        instructions: str,
        voice: str | None,
        *,
        session_config: Mapping[str, Any] | None = None,
        tool_permissions: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        def _sanitize_permissions(
            permissions: Mapping[str, Any] | None,
        ) -> dict[str, Any]:
            if not isinstance(permissions, Mapping):
                return {}
            sanitized: dict[str, Any] = {}
            for key, value in permissions.items():
                if not isinstance(key, str):
                    continue
                sanitized[key] = value
            return sanitized

        sanitized_permissions = _sanitize_permissions(tool_permissions)

        if isinstance(session_config, Mapping):
            payload = self._normalize_session_config(
                session_config,
                model=model,
                instructions=instructions,
                voice=voice,
            )

            if sanitized_permissions and "tool_permissions" not in payload:
                payload["tool_permissions"] = sanitized_permissions

            return payload

        payload: dict[str, Any] = {
            "type": "realtime",
            "model": model,
            "instructions": instructions,
        }
        if voice:
            payload["voice"] = voice

        realtime_defaults: dict[str, Any] = {
            "start_mode": "auto",
            "stop_mode": "manual",
            "turn_detection": {
                "type": "server_vad",
                "threshold": 0.5,
                "prefix_padding_ms": 300,
                "silence_duration_ms": 500,
                "create_response": True,
                "interrupt_response": True,
            },
            "input_audio_format": {
                "type": "audio/pcm",
                "rate": SIP_SAMPLE_RATE,
            },
            "output_audio_format": {
                "type": "audio/pcm",
                "rate": SIP_SAMPLE_RATE,
            },
            "input_audio_noise_reduction": {"type": "near_field"},
        }

        if sanitized_permissions:
            realtime_defaults["tools"] = sanitized_permissions
            payload["tool_permissions"] = sanitized_permissions

        payload["realtime"] = realtime_defaults
        return payload

    def _normalize_session_config(
        self,
        session_config: Mapping[str, Any],
        *,
        model: str,
        instructions: str,
        voice: str | None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "type": "realtime",
            "model": str(session_config.get("model") or model),
            "instructions": str(session_config.get("instructions") or instructions),
        }

        voice_value = session_config.get("voice") or voice
        if isinstance(voice_value, str):
            stripped = voice_value.strip()
            if stripped:
                payload["voice"] = stripped

        def _copy_mapping(key: str) -> None:
            value = session_config.get(key)
            if isinstance(value, Mapping):
                payload[key] = deepcopy(dict(value))

        def _copy_sequence(key: str) -> None:
            value = session_config.get(key)
            if isinstance(value, Sequence) and not isinstance(
                value, (str | bytes | bytearray)
            ):
                payload[key] = [deepcopy(item) for item in value]

        _copy_mapping("prompt_variables")
        _copy_mapping("metadata")
        _copy_sequence("tools")
        _copy_sequence("handoffs")

        output_modalities: list[str] = []
        modalities = session_config.get("output_modalities")
        if isinstance(modalities, Sequence) and not isinstance(
            modalities, (str | bytes | bytearray)
        ):
            for modality in modalities:
                if isinstance(modality, str) and modality.strip():
                    output_modalities.append(modality.strip())
        elif isinstance(session_config.get("modalities"), Sequence):
            for modality in session_config["modalities"]:  # type: ignore[index]
                if isinstance(modality, str) and modality.strip():
                    output_modalities.append(modality.strip())
        if output_modalities:
            payload["output_modalities"] = output_modalities

        existing_audio = session_config.get("audio")
        audio_section: dict[str, Any] = (
            deepcopy(dict(existing_audio))
            if isinstance(existing_audio, Mapping)
            else {}
        )

        input_section: dict[str, Any] = (
            dict(audio_section.get("input"))
            if isinstance(audio_section.get("input"), Mapping)
            else {}
        )
        output_section: dict[str, Any] = (
            dict(audio_section.get("output"))
            if isinstance(audio_section.get("output"), Mapping)
            else {}
        )

        realtime_config = session_config.get("realtime")
        if isinstance(realtime_config, Mapping):
            input_format = realtime_config.get("input_audio_format")
            if isinstance(input_format, Mapping):
                input_section.update({"format": dict(input_format)})

            turn_detection = realtime_config.get("turn_detection")
            if isinstance(turn_detection, Mapping):
                input_section.setdefault("turn_detection", dict(turn_detection))

            noise_reduction = realtime_config.get("input_audio_noise_reduction")
            if isinstance(noise_reduction, Mapping):
                input_section.setdefault("noise_reduction", dict(noise_reduction))

            transcription = realtime_config.get("input_audio_transcription")
            if isinstance(transcription, Mapping):
                input_section.setdefault("transcription", dict(transcription))

            output_format = realtime_config.get("output_audio_format")
            if isinstance(output_format, Mapping):
                output_section.update({"format": dict(output_format)})

            speed = realtime_config.get("speed")
            if isinstance(speed, int | float):
                output_section.setdefault("speed", float(speed))

            voice_mode = realtime_config.get("voice")
            if isinstance(voice_mode, str) and voice_mode.strip():
                output_section.setdefault("voice", voice_mode.strip())

            if output_modalities and "output_modalities" not in payload:
                payload["output_modalities"] = output_modalities

        def _force_audio_format(section: dict[str, Any]) -> None:
            format_payload = section.get("format")
            normalized_format = (
                dict(format_payload) if isinstance(format_payload, Mapping) else {}
            )
            normalized_format["type"] = "audio/pcm"
            normalized_format["rate"] = SIP_SAMPLE_RATE
            section["format"] = normalized_format

        _force_audio_format(input_section)
        _force_audio_format(output_section)

        audio_section["input"] = input_section
        audio_section["output"] = output_section

        if audio_section:
            payload["audio"] = audio_section

        return payload

    def _build_silence_frame(self) -> bytes:
        """Construit un segment PCM16 silencieux pour les keepalive RTP."""

        samples = max(1, int(self._target_sample_rate * 0.02))
        return b"\x00\x00" * samples

    def _ensure_sip_sample_rate(self, pcm: bytes) -> bytes:
        """Convertit un segment PCM16 vers le taux d'échantillonnage SIP."""

        if not pcm:
            return pcm
        if self._target_sample_rate == SIP_SAMPLE_RATE:
            return pcm
        converted, _ = audioop.ratecv(
            pcm,
            2,
            1,
            self._target_sample_rate,
            SIP_SAMPLE_RATE,
            None,
        )
        return converted

    def _build_rtp_datagram(
        self,
        *,
        payload_type: int,
        sequence: int,
        timestamp: int,
        ssrc: int,
        payload: bytes,
        marker: bool = False,
    ) -> bytes:
        """Construit un paquet RTP brut avec payload déjà encodé."""

        version = 2 << 6
        padding = 0
        extension = 0
        csrc_count = 0
        first_byte = version | padding | extension | csrc_count
        marker_bit = 0x80 if marker else 0x00
        second_byte = marker_bit | (payload_type & 0x7F)
        header = struct.pack(
            "!BBHII",
            first_byte,
            second_byte,
            sequence,
            timestamp,
            ssrc,
        )
        return header + payload

    def _decode_packet(self, packet: RtpPacket) -> bytes:
        payload = packet.payload
        if not payload:
            return b""

        source_sample_rate = self._target_sample_rate
        if self._input_codec == "pcmu":
            pcm = audioop.ulaw2lin(payload, 2)
            source_sample_rate = 8_000
        elif self._input_codec == "pcma":
            pcm = audioop.alaw2lin(payload, 2)
            source_sample_rate = 8_000
        else:
            pcm = payload

        if source_sample_rate != self._target_sample_rate:
            pcm, _ = audioop.ratecv(
                pcm, 2, 1, source_sample_rate, self._target_sample_rate, None
            )
        return pcm

    def _parse_ws_message(self, raw: Any) -> dict[str, Any]:
        if isinstance(raw, bytes):
            try:
                raw = raw.decode("utf-8")
            except UnicodeDecodeError:
                return {}
        if isinstance(raw, str):
            candidate = raw.strip()
            if not candidate:
                return {}
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                logger.debug("Message Realtime non JSON ignoré : %s", candidate)
                return {}
        if isinstance(raw, dict):
            return raw
        return {}

    @staticmethod
    def _extract_error_message(message: Mapping[str, Any]) -> str:
        error_payload = message.get("error")
        if isinstance(error_payload, Mapping):
            for key in ("message", "detail", "error"):
                value = error_payload.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
        generic = message.get("message")
        if isinstance(generic, str) and generic.strip():
            return generic.strip()
        return "Session Realtime en erreur"

    def _extract_audio_chunks(self, message: Mapping[str, Any]) -> list[str]:
        chunks: list[str] = []
        for key in ("audio", "chunk"):
            value = message.get(key)
            if isinstance(value, str):
                chunks.append(value)
            elif isinstance(value, list):
                chunks.extend(
                    str(entry) for entry in value if isinstance(entry, str | bytes)
                )
        delta = message.get("delta")
        # API GA : delta est directement une string base64
        if isinstance(delta, str):
            chunks.append(delta)
        # API beta : delta est un objet avec audio/chunk à l'intérieur
        elif isinstance(delta, Mapping):
            nested = delta.get("audio") or delta.get("chunk")
            if isinstance(nested, str):
                chunks.append(nested)
            elif isinstance(nested, list):
                chunks.extend(
                    str(entry) for entry in nested if isinstance(entry, str | bytes)
                )
        return chunks

    def _extract_transcript_text(self, message: Mapping[str, Any]) -> str | None:
        delta = message.get("delta")
        # API GA : pour les transcriptions, delta peut être directement une string
        if isinstance(delta, str) and delta.strip():
            return delta
        # API beta : delta est un objet avec text/transcript à l'intérieur
        if isinstance(delta, Mapping):
            for key in ("text", "transcript"):
                value = delta.get(key)
                if isinstance(value, str) and value.strip():
                    return value
        for key in ("text", "transcript"):
            value = message.get(key)
            if isinstance(value, str) and value.strip():
                return value
        return None

    @staticmethod
    def _extract_response_id(message: Mapping[str, Any]) -> str | None:
        for key in ("response_id", "responseId", "id"):
            value = message.get(key)
            if isinstance(value, str) and value.strip():
                return value
        response = message.get("response")
        if isinstance(response, Mapping):
            for key in ("id", "response_id", "responseId"):
                value = response.get(key)
                if isinstance(value, str) and value.strip():
                    return value
        return None

    def _extract_completed_transcripts(
        self, response: Any
    ) -> list[dict[str, str]]:
        transcripts: list[dict[str, str]] = []
        if not isinstance(response, Mapping):
            return transcripts
        output_entries = response.get("output") or response.get("outputs")
        if not isinstance(output_entries, list):
            return transcripts
        for entry in output_entries:
            if not isinstance(entry, Mapping):
                continue
            role = entry.get("role")
            role_name = role if isinstance(role, str) and role.strip() else "assistant"
            contents = entry.get("content")
            if not isinstance(contents, list):
                continue
            for content in contents:
                if not isinstance(content, Mapping):
                    continue
                content_type = content.get("type")
                if content_type not in {"output_text", "text"}:
                    continue
                text_value = content.get("text")
                if isinstance(text_value, str) and text_value.strip():
                    transcripts.append({
                        "role": role_name,
                        "text": text_value.strip(),
                    })
        return transcripts


__all__ = [
    "RtpPacket",
    "TelephonyVoiceBridge",
    "VoiceBridgeError",
    "VoiceBridgeHooks",
    "VoiceBridgeMetricsRecorder",
    "VoiceBridgeStats",
    "build_realtime_ws_url",
    "default_websocket_connector",
]
