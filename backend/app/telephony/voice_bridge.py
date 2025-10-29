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

from ..config import Settings, get_settings

logger = logging.getLogger("chatkit.telephony.voice_bridge")


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
            nonlocal inbound_audio_bytes, agent_is_speaking
            packet_count = 0
            try:
                async for packet in rtp_stream:
                    packet_count += 1
                    pcm = self._decode_packet(packet)
                    if not pcm:
                        continue
                    inbound_audio_bytes += len(pcm)

                    # Use SDK's send_audio method instead of raw JSON
                    # commit=True tells the SDK to process this audio chunk
                    await session.send_audio(pcm, commit=True)

                    if not should_continue():
                        logger.info("forward_audio: arrêt demandé par should_continue()")
                        break
                logger.info("forward_audio: fin de la boucle RTP stream (paquets reçus: %d)", packet_count)
            finally:
                logger.debug("Fin du flux audio RTP, attente de la fermeture de session")
                await request_stop()

        transcript_buffers: dict[str, list[str]] = {}
        audio_interrupted = asyncio.Event()
        last_response_id: str | None = None
        agent_is_speaking = False

        async def handle_events() -> None:
            """Handle events from the SDK session (replaces raw WebSocket handling)."""
            nonlocal outbound_audio_bytes, error, last_response_id, agent_is_speaking
            try:
                async for event in session:
                    if not should_continue():
                        break

                    # Handle error events
                    if isinstance(event, RealtimeError):
                        error = VoiceBridgeError(str(event.error))
                        logger.error("Erreur Realtime API: %s", event.error)
                        break

                    # Handle audio events (agent speaking)
                    if isinstance(event, RealtimeAudio):
                        audio_event = event.audio
                        pcm_data = audio_event.data
                        if pcm_data:
                            outbound_audio_bytes += len(pcm_data)
                            await send_to_peer(pcm_data)
                        continue

                    # Handle audio interruption
                    if isinstance(event, RealtimeAudioInterrupted):
                        logger.info("Audio interrompu par l'utilisateur")
                        audio_interrupted.set()
                        agent_is_speaking = False
                        continue

                    # Handle audio end
                    if isinstance(event, RealtimeAudioEnd):
                        agent_is_speaking = False
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

                    # Log other events for debugging
                    event_type = type(event).__name__
                    logger.debug("Événement SDK reçu: %s", event_type)

            except Exception as exc:
                logger.exception("Erreur dans le flux d'événements SDK")
                error = VoiceBridgeError(f"Erreur événements SDK: {exc}")
            finally:
                await request_stop()

        stats: VoiceBridgeStats | None = None
        try:
            # Build model config for the SDK runner (like the browser does)
            model_settings: dict[str, Any] = {
                "model_name": model,
                "turn_detection": {
                    "type": "semantic_vad",
                    "create_response": True,
                    "interrupt_response": True,
                },
                "modalities": ["audio"],  # For telephony, audio only (not ['text', 'audio'])
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
            }
            if voice:
                model_settings["voice"] = voice

            model_config: dict[str, Any] = {
                "api_key": client_secret,
                "initial_model_settings": model_settings,
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
