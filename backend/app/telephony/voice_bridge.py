"""Pont entre la téléphonie SIP et les sessions Realtime."""

from __future__ import annotations

import asyncio
import audioop
import base64
import json
import logging
import struct
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import quote

from agents.realtime.events import (
    RealtimeAgentEndEvent,
    RealtimeAgentStartEvent,
    RealtimeAudio,
    RealtimeAudioEnd,
    RealtimeAudioInterrupted,
    RealtimeError,
    RealtimeHistoryAdded,
    RealtimeHistoryUpdated,
    RealtimeToolEnd,
    RealtimeToolStart,
)
from agents.realtime.model import RealtimePlaybackTracker, RealtimePlaybackState

from ..config import Settings, get_settings

logger = logging.getLogger("chatkit.telephony.voice_bridge")


class TelephonyPlaybackTracker(RealtimePlaybackTracker):
    """Tracks audio playback progress for telephony to enable proper interruption handling.

    In telephony scenarios, audio is sent via RTP packets with delays (20ms between packets).
    We need to tell OpenAI exactly when audio has been played so it can handle interruptions correctly.
    """

    def __init__(self) -> None:
        self._current_item_id: str | None = None
        self._current_item_content_index: int | None = None
        self._elapsed_ms: float = 0.0
        self._audio_format: Any = None
        self._lock = asyncio.Lock()

    def on_play_bytes(self, item_id: str, item_content_index: int, audio_bytes: bytes) -> None:
        """Called when we have actually sent audio bytes via RTP."""
        if self._audio_format is None:
            logger.warning("TelephonyPlaybackTracker: audio format not set yet")
            return

        # Calculate duration from bytes based on audio format
        # PCM16 at 24kHz: 2 bytes per sample, 24000 samples per second
        # So: bytes / 2 / 24000 * 1000 = ms
        sample_rate = getattr(self._audio_format, 'rate', 24000)
        bytes_per_sample = 2  # PCM16 is 16-bit = 2 bytes
        ms = (len(audio_bytes) / bytes_per_sample / sample_rate) * 1000

        self.on_play_ms(item_id, item_content_index, ms)

    def on_play_ms(self, item_id: str, item_content_index: int, ms: float) -> None:
        """Called when we have actually sent audio (measured in milliseconds)."""
        self._current_item_id = item_id
        self._current_item_content_index = item_content_index
        self._elapsed_ms += ms

    def on_interrupted(self) -> None:
        """Called by OpenAI when audio playback has been interrupted."""
        logger.info("TelephonyPlaybackTracker: playback interrupted, resetting state")
        self._elapsed_ms = 0.0

    def set_audio_format(self, format: Any) -> None:
        """Called by OpenAI to set the audio format."""
        self._audio_format = format
        logger.debug("TelephonyPlaybackTracker: audio format set to %s", format)

    def get_state(self) -> RealtimePlaybackState:
        """Called by OpenAI to get current playback state."""
        return {
            "current_item_id": self._current_item_id,
            "current_item_content_index": self._current_item_content_index,
            "elapsed_ms": self._elapsed_ms,
        }


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
        settings: Settings | None = None,
    ) -> None:
        self._hooks = hooks
        self._metrics = metrics or VoiceBridgeMetricsRecorder()
        self._websocket_connector = websocket_connector or default_websocket_connector
        self._voice_session_checker = voice_session_checker
        self._input_codec = input_codec.lower()
        self._target_sample_rate = target_sample_rate
        self._receive_timeout = max(0.1, receive_timeout)
        self._settings = settings or get_settings()

    async def run(
        self,
        *,
        runner: Any,
        client_secret: str,
        model: str,
        instructions: str,
        voice: str | None,
        rtp_stream: AsyncIterator[RtpPacket],
        send_to_peer: Callable[[bytes], Awaitable[None]],
        api_base: str | None = None,
        tools: list[Any] | None = None,
        handoffs: list[Any] | None = None,
    ) -> VoiceBridgeStats:
        """Démarre le pont voix jusqu'à la fin de session ou erreur."""

        logger.info(
            "Ouverture de la session Realtime voix avec runner (modèle=%s, voix=%s)",
            model,
            voice,
        )

        start_time = time.monotonic()
        inbound_audio_bytes = 0
        outbound_audio_bytes = 0
        transcripts: list[dict[str, str]] = []
        error: Exception | None = None
        session: Any | None = None
        stop_event = asyncio.Event()

        # Create playback tracker for proper interruption handling
        playback_tracker = TelephonyPlaybackTracker()

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

        async def forward_audio() -> None:
            nonlocal inbound_audio_bytes
            packet_count = 0
            bytes_sent = 0
            turn_detection_enabled = False
            # At 24kHz PCM16: 100ms = 24000 samples/sec * 0.1 sec * 2 bytes/sample = 4800 bytes
            MIN_AUDIO_BEFORE_VAD = 4800  # 100ms minimum before enabling VAD

            try:
                async for packet in rtp_stream:
                    packet_count += 1
                    pcm = self._decode_packet(packet)
                    if not pcm:
                        logger.debug("Paquet RTP #%d: décodage vide, ignoré", packet_count)
                        continue
                    inbound_audio_bytes += len(pcm)

                    if packet_count == 1:
                        logger.info("Premier paquet audio reçu: %d bytes PCM", len(pcm))

                    # Always send audio with commit=False - let turn_detection handle commits
                    await session.send_audio(pcm, commit=False)
                    bytes_sent += len(pcm)

                    # After sending enough audio, enable turn_detection
                    if not turn_detection_enabled and bytes_sent >= MIN_AUDIO_BEFORE_VAD:
                        logger.info(
                            "Activation de turn_detection après %.1fms d'audio",
                            bytes_sent / 2 / 24000 * 1000
                        )
                        try:
                            from agents.realtime.model_inputs import RealtimeModelSendSessionUpdate
                            await session._model.send_event(
                                RealtimeModelSendSessionUpdate(
                                    session_settings={
                                        "input_audio_transcription": {
                                            "model": "whisper-1",
                                        },
                                        "turn_detection": {
                                            "type": "semantic_vad",
                                            "create_response": True,
                                            "interrupt_response": True,
                                        },
                                    }
                                )
                            )
                            turn_detection_enabled = True
                            logger.info("Turn detection (semantic_vad) activé avec succès")
                        except Exception as e:
                            logger.warning("Impossible d'activer turn_detection: %s", e)

                    if not should_continue():
                        logger.info("forward_audio: arrêt demandé par should_continue()")
                        break

                logger.info("forward_audio: fin de la boucle RTP stream (paquets reçus: %d)", packet_count)
            finally:
                logger.debug("Fin du flux audio RTP, attente de la fermeture de session")
                await request_stop()

        transcript_buffers: dict[str, list[str]] = {}
        last_response_id: str | None = None
        agent_is_speaking = False  # Track if agent is currently speaking
        user_speech_detected = False  # Track if we detected user speech
        block_audio_send = False  # Block sending audio when user interrupts

        async def handle_events() -> None:
            """Handle events from the SDK session (replaces raw WebSocket handling)."""
            nonlocal outbound_audio_bytes, error, last_response_id, agent_is_speaking, user_speech_detected, block_audio_send, playback_tracker
            try:
                async for event in session:
                    if not should_continue():
                        break

                    # DEBUG: Log ALL event types to understand what we receive
                    event_type = type(event).__name__
                    if event_type not in ("RealtimeAudio",):  # Skip audio events (too noisy)
                        logger.debug(f"🔍 EVENT TYPE: {event_type}")

                    # Handle error events
                    if isinstance(event, RealtimeError):
                        error_code = getattr(event.error, 'code', None)
                        # Ignore "response_cancel_not_active" - it's OK if there's no active response
                        if error_code == 'response_cancel_not_active':
                            logger.debug("response.cancel ignoré (pas de réponse active): %s", event.error)
                            continue
                        # For other errors, fail the session
                        error = VoiceBridgeError(str(event.error))
                        logger.error("Erreur Realtime API: %s", event.error)
                        break

                    # Check for input_audio_buffer.speech_started in raw events
                    # This is the KEY event for detecting user interruption!
                    if event_type == "RealtimeRawModelEvent":
                        raw_data = getattr(event, 'raw_event', None) or getattr(event, 'event', None)
                        if raw_data and isinstance(raw_data, dict):
                            event_subtype = raw_data.get('type', '')

                            # DEBUG: Log ALL raw events to see what's happening
                            logger.info(f"📡 RAW EVENT: {event_subtype}")

                            # User started speaking - INTERRUPT THE AGENT AND BLOCK AUDIO!
                            if event_subtype == 'input_audio_buffer.speech_started':
                                logger.info("🎤 Utilisateur commence à parler")
                                if agent_is_speaking:
                                    logger.info("🛑 Interruption de l'agent!")
                                    block_audio_send = True  # Stop sending audio immediately
                                    try:
                                        await session.interrupt()
                                    except Exception as e:
                                        logger.warning("Erreur lors de session.interrupt(): %s", e)
                                user_speech_detected = True
                                continue

                            # User stopped speaking
                            if event_subtype == 'input_audio_buffer.speech_stopped':
                                logger.info("🎤 Utilisateur arrête de parler")
                                user_speech_detected = False
                                continue
                        else:
                            logger.debug(f"⚠️ RealtimeRawModelEvent sans raw_data détectable")

                    # Track when agent starts speaking - unblock audio
                    if isinstance(event, RealtimeAgentStartEvent):
                        agent_is_speaking = True
                        block_audio_send = False  # Allow audio again for new response
                        logger.debug("Agent commence à parler - déblocage audio")
                        continue

                    # Track when agent stops speaking
                    if isinstance(event, RealtimeAgentEndEvent):
                        agent_is_speaking = False
                        logger.debug("Agent arrête de parler")
                        continue

                    # Handle audio interruption - BLOCK AUDIO IMMEDIATELY!
                    if isinstance(event, RealtimeAudioInterrupted):
                        logger.info("🛑 Audio interrompu confirmé par OpenAI - blocage audio")
                        block_audio_send = True
                        # Try to cancel the current response generation
                        # (may fail if response already completed, which is OK)
                        try:
                            from agents.realtime.model_inputs import RealtimeModelSendRawMessage
                            await session._model.send_event(
                                RealtimeModelSendRawMessage(
                                    message={"type": "response.cancel"}
                                )
                            )
                            logger.info("✅ Envoyé response.cancel")
                        except Exception as e:
                            # It's OK if there's no active response to cancel
                            logger.debug("response.cancel ignoré: %s", e)
                        continue

                    # Handle audio events (agent speaking) - only send if not blocked
                    if isinstance(event, RealtimeAudio):
                        if not block_audio_send:
                            audio_event = event.audio
                            pcm_data = audio_event.data
                            if pcm_data:
                                outbound_audio_bytes += len(pcm_data)
                                # Send audio and wait until it's actually sent via RTP
                                await send_to_peer(pcm_data)
                                # Now update the playback tracker so OpenAI knows when audio was played
                                # This is critical for proper interruption handling!
                                playback_tracker.on_play_bytes(
                                    event.item_id,
                                    event.content_index,
                                    pcm_data
                                )
                        else:
                            # Audio blocked - user is interrupting
                            logger.debug("🚫 Audio agent bloqué (interruption en cours)")
                        continue

                    # Handle audio end
                    if isinstance(event, RealtimeAudioEnd):
                        logger.debug("Agent a fini de parler")
                        continue

                    # Handle history updates (contains transcripts)
                    if isinstance(event, (RealtimeHistoryAdded, RealtimeHistoryUpdated)):
                        history = getattr(event, "history", [event.item] if hasattr(event, "item") else [])
                        for item in history:
                            role = getattr(item, "role", None)
                            if role not in ("user", "assistant"):
                                continue
                            text_parts: list[str] = []
                            contents = getattr(item, "content", [])
                            for content in contents:
                                text = getattr(content, "text", None) or getattr(content, "transcript", None)
                                if isinstance(text, str) and text.strip():
                                    text_parts.append(text.strip())
                            if text_parts:
                                combined_text = "\n".join(text_parts)
                                transcripts.append({"role": role, "text": combined_text})
                        continue

                    # Handle tool calls (the SDK automatically executes these!)
                    if isinstance(event, RealtimeToolStart):
                        tool_name = getattr(event.tool, "name", None)
                        logger.info("Exécution de l'outil MCP: %s", tool_name)
                        continue

                    if isinstance(event, RealtimeToolEnd):
                        tool_name = getattr(event.tool, "name", None)
                        output = event.output
                        logger.info("Outil MCP terminé: %s, résultat: %s", tool_name, output)
                        continue

            except Exception as exc:
                logger.exception("Erreur dans le flux d'événements SDK")
                error = VoiceBridgeError(f"Erreur événements SDK: {exc}")
            finally:
                await request_stop()

        stats: VoiceBridgeStats | None = None
        try:
            # Build model config for the SDK runner
            # Note: turn_detection is already configured in client_secret (semantic_vad)
            model_settings: dict[str, Any] = {
                "model_name": model,
                "modalities": ["audio"],  # For telephony, audio only
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
            }
            if voice:
                model_settings["voice"] = voice

            model_config: dict[str, Any] = {
                "api_key": client_secret,
                "initial_model_settings": model_settings,
                "playback_tracker": playback_tracker,  # Track audio playback for interruptions
            }

            # Create session using the SDK runner (this is what enables tool calls!)
            logger.info("Démarrage session SDK avec runner")
            session = await runner.run(model_config=model_config)
            await session.__aenter__()
            logger.info("Session SDK démarrée avec succès")

            audio_task = asyncio.create_task(forward_audio())
            events_task = asyncio.create_task(handle_events())
            try:
                await asyncio.gather(audio_task, events_task)
            except Exception as exc:
                await request_stop()
                for task in (audio_task, events_task):
                    if not task.done():
                        task.cancel()
                await asyncio.gather(
                    audio_task, events_task, return_exceptions=True
                )
                error = exc
        except Exception as exc:
            error = exc
            logger.error("Session voix Realtime interrompue : %s", exc)
        finally:
            if session is not None:
                try:
                    await session.close()
                except Exception:  # pragma: no cover - fermeture best effort
                    logger.debug(
                        "Fermeture session SDK en erreur",
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
                    "Session voix terminée (durée=%.2fs, audio_in=%d, audio_out=%d, "
                    "transcripts=%d)",
                    duration,
                    inbound_audio_bytes,
                    outbound_audio_bytes,
                    stats.transcript_count,
                )
            else:
                logger.warning(
                    "Session voix terminée avec erreur après %.2fs", duration
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
    ) -> dict[str, Any]:
        # Format API GA (non-beta)
        # Note: tools et handoffs sont déjà configurés via client_secret
        payload: dict[str, Any] = {
            "type": "realtime",
            "model": model,
            "instructions": instructions,
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": 24000},
                    "turn_detection": {
                        "type": "semantic_vad",  # VAD sémantique pour une meilleure détection de fin de phrase
                        "create_response": True,
                        "interrupt_response": True,
                    },
                },
                "output": {
                    "format": {"type": "audio/pcm", "rate": 24000},
                },
            },
        }
        if voice:
            payload["audio"]["output"]["voice"] = voice
        return payload

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
