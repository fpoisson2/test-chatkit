"""Pont entre la téléphonie SIP et les sessions Realtime."""

from __future__ import annotations

import asyncio
import audioop
import base64
import json
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import quote

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
        client_secret: str,
        model: str,
        instructions: str,
        voice: str | None,
        rtp_stream: AsyncIterator[RtpPacket],
        send_to_peer: Callable[[bytes], Awaitable[None]],
        api_base: str | None = None,
    ) -> VoiceBridgeStats:
        """Démarre le pont voix jusqu'à la fin de session ou erreur."""

        url = build_realtime_ws_url(model, api_base=api_base, settings=self._settings)
        headers = {
            "Authorization": f"Bearer {client_secret}",
            # Note: "OpenAI-Beta: realtime=v1" retiré pour utiliser l'API GA
        }

        logger.info(
            "Ouverture de la session Realtime voix (modèle=%s, voix=%s)",
            model,
            voice,
        )

        start_time = time.monotonic()
        inbound_audio_bytes = 0
        outbound_audio_bytes = 0
        transcripts: list[dict[str, str]] = []
        error: Exception | None = None
        websocket: WebSocketLike | None = None
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

        async def send_json(message: Mapping[str, Any]) -> None:
            payload = json.dumps(message)
            await websocket.send(payload)  # type: ignore[arg-type]

        async def forward_audio() -> None:
            nonlocal inbound_audio_bytes
            appended = False
            try:
                async for packet in rtp_stream:
                    pcm = self._decode_packet(packet)
                    if not pcm:
                        continue
                    inbound_audio_bytes += len(pcm)
                    encoded = base64.b64encode(pcm).decode("ascii")
                    await send_json(
                        {
                            "type": "input_audio_buffer.append",
                            "audio": encoded,
                        }
                    )
                    appended = True
                    if not should_continue():
                        break
            finally:
                # Avec VAD activé, l'API gère automatiquement le commit et la création de réponse
                # On commit manuellement uniquement si l'appel se termine pendant que l'utilisateur parle
                if appended:
                    try:
                        await send_json({"type": "input_audio_buffer.commit"})
                    except Exception as exc:  # pragma: no cover - fermeture concurrente
                        logger.debug(
                            "Impossible d'envoyer le commit final Realtime : %s",
                            exc,
                        )
                await request_stop()

        transcript_buffers: dict[str, list[str]] = {}

        async def handle_realtime() -> None:
            nonlocal outbound_audio_bytes, error
            while True:
                try:
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

                # Événements VAD - l'API gère automatiquement l'interruption
                if message_type == "input_audio_buffer.speech_started":
                    logger.debug("Détection de parole utilisateur - interruption automatique")
                    continue
                if message_type == "input_audio_buffer.speech_stopped":
                    logger.debug("Fin de parole utilisateur détectée")
                    continue
                if message_type == "response.cancelled":
                    logger.debug("Réponse annulée suite à interruption utilisateur")
                    continue

                if message_type.endswith("audio.delta"):
                    for chunk in self._extract_audio_chunks(message):
                        try:
                            pcm = base64.b64decode(chunk)
                        except ValueError:
                            logger.debug("Segment audio Realtime invalide ignoré")
                            continue
                        if pcm:
                            outbound_audio_bytes += len(pcm)
                            await send_to_peer(pcm)
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

                if message_type == "response.completed":
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
                    break
            await request_stop()

        stats: VoiceBridgeStats | None = None
        try:
            websocket = await self._websocket_connector(url, headers)
            await send_json(
                {
                    "type": "session.update",
                    "session": self._build_session_update(model, instructions, voice),
                }
            )

            audio_task = asyncio.create_task(forward_audio())
            realtime_task = asyncio.create_task(handle_realtime())
            try:
                await asyncio.gather(audio_task, realtime_task)
            except Exception as exc:
                await request_stop()
                for task in (audio_task, realtime_task):
                    if not task.done():
                        task.cancel()
                await asyncio.gather(
                    audio_task, realtime_task, return_exceptions=True
                )
                error = exc
        except Exception as exc:
            error = exc
            logger.error("Session voix Realtime interrompue : %s", exc)
        finally:
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
        self, model: str, instructions: str, voice: str | None
    ) -> dict[str, Any]:
        # Format API GA (non-beta)
        payload: dict[str, Any] = {
            "type": "realtime",
            "model": model,
            "instructions": instructions,
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": 24000},
                },
                "output": {
                    "format": {"type": "audio/pcm", "rate": 24000},
                },
            },
            "turn_detection": {
                "type": "server_vad",
                "threshold": 0.5,
                "prefix_padding_ms": 300,
                "silence_duration_ms": 500,
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
