"""Pont entre la téléphonie SIP et les sessions Realtime."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import audioop
import contextlib
import json
import logging
import time
import uuid
import wave
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

from agents.realtime.model import RealtimePlaybackState, RealtimePlaybackTracker

from ...config import Settings, get_settings
from .audio_pipeline import AudioStreamManager
from .event_router import RealtimeEventRouter
from .sip_sync import SipSyncController

logger = logging.getLogger("chatkit.telephony.voice_bridge")


class _AsyncTaskLimiter:
    """Utility to throttle background tasks while ensuring cleanup on shutdown."""

    def __init__(self, *, name: str, max_pending: int) -> None:
        self._name = name
        self._semaphore = asyncio.Semaphore(max_pending)
        self._tasks: set[asyncio.Task[None]] = set()

    @property
    def pending(self) -> int:
        return len(self._tasks)

    async def submit(self, coro: Awaitable[None]) -> None:
        """Schedule *coro* once a slot is available."""

        await self._semaphore.acquire()

        async def _runner() -> None:
            try:
                await coro
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.error("Erreur dans %s: %s", self._name, exc)
            finally:
                self._semaphore.release()

        task = asyncio.create_task(_runner())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def cancel_pending(self) -> None:
        """Cancel all running tasks and wait for their completion."""

        if not self._tasks:
            return

        for task in list(self._tasks):
            task.cancel()

        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

class TelephonyPlaybackTracker(RealtimePlaybackTracker):
    """Track audio playback progress for telephony calls.

    In telephony scenarios, audio is sent via RTP packets roughly every 20 ms. We need to
    report exactly when audio has played so the platform can handle interruptions correctly.
    """

    def __init__(self, on_interrupt_callback: callable | None = None) -> None:
        self._current_item_id: str | None = None
        self._current_item_content_index: int | None = None
        self._elapsed_ms: float = 0.0
        self._audio_format: Any = None
        self._lock = asyncio.Lock()
        self._on_interrupt_callback = on_interrupt_callback

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
        # Call the callback to block audio immediately
        if self._on_interrupt_callback:
            self._on_interrupt_callback()

    def set_audio_format(self, format: Any) -> None:
        """Called by OpenAI to set the audio format."""
        self._audio_format = format
        logger.debug("TelephonyPlaybackTracker: audio format set to %s", format)

    def set_interrupt_callback(self, callback: callable | None) -> None:
        """Update the interrupt callback."""
        self._on_interrupt_callback = callback
        logger.debug("TelephonyPlaybackTracker: interrupt callback updated")

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
    inbound_audio_file: str | None = None
    outbound_audio_file: str | None = None
    mixed_audio_file: str | None = None

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
    # Appelé pour chaque transcription en temps réel
    on_transcript: Callable[[dict[str, str]], Awaitable[None]] | None = None
    # Appelé pour chaque chunk audio entrant
    on_audio_inbound: Callable[[bytes], Awaitable[None]] | None = None
    # Appelé pour chaque chunk audio sortant
    on_audio_outbound: Callable[[bytes], Awaitable[None]] | None = None


VoiceSessionChecker = Callable[[], bool]


class AudioRecorder:
    """Helper pour enregistrer l'audio entrant et sortant dans des fichiers WAV."""

    def __init__(self, call_id: str, recordings_dir: str = "/tmp/chatkit_recordings"):
        """Initialise l'enregistreur audio.

        Args:
            call_id: Identifiant unique de l'appel
            recordings_dir: Répertoire pour stocker les enregistrements
        """
        self.call_id = call_id
        self.recordings_dir = Path(recordings_dir)
        self.recordings_dir.mkdir(parents=True, exist_ok=True)

        # Créer des noms de fichiers uniques
        timestamp = str(int(time.time()))
        self.inbound_path = self.recordings_dir / f"{call_id}_{timestamp}_inbound.wav"
        self.outbound_path = self.recordings_dir / f"{call_id}_{timestamp}_outbound.wav"
        self.mixed_path = self.recordings_dir / f"{call_id}_{timestamp}_mixed.wav"

        # Ouvrir les fichiers WAV (PCM 24kHz mono)
        self.inbound_wav: wave.Wave_write | None = None
        self.outbound_wav: wave.Wave_write | None = None
        self.inbound_frames: list[bytes] = []
        self.outbound_frames: list[bytes] = []

        try:
            self.inbound_wav = wave.open(str(self.inbound_path), 'wb')
            self.inbound_wav.setnchannels(1)  # Mono
            self.inbound_wav.setsampwidth(2)  # 16-bit
            self.inbound_wav.setframerate(24000)  # 24kHz

            self.outbound_wav = wave.open(str(self.outbound_path), 'wb')
            self.outbound_wav.setnchannels(1)  # Mono
            self.outbound_wav.setsampwidth(2)  # 16-bit
            self.outbound_wav.setframerate(24000)  # 24kHz

            logger.info(
                "Audio recorder initialized: inbound=%s, outbound=%s",
                self.inbound_path,
                self.outbound_path,
            )
        except Exception as e:
            logger.error("Failed to initialize audio recorder: %s", e)
            self.close()
            raise

    def write_inbound(self, pcm_data: bytes) -> None:
        """Enregistre l'audio entrant (user)."""
        if self.inbound_wav:
            try:
                self.inbound_wav.writeframes(pcm_data)
                self.inbound_frames.append(pcm_data)
            except Exception as e:
                logger.error("Failed to write inbound audio: %s", e)

    def write_outbound(self, pcm_data: bytes) -> None:
        """Enregistre l'audio sortant (assistant)."""
        if self.outbound_wav:
            try:
                self.outbound_wav.writeframes(pcm_data)
                self.outbound_frames.append(pcm_data)
            except Exception as e:
                logger.error("Failed to write outbound audio: %s", e)

    def close(self) -> tuple[str | None, str | None, str | None]:
        """Ferme les fichiers et crée un fichier mixé.

        Returns:
            Tuple (inbound_path, outbound_path, mixed_path) ou (None, None, None)
            en cas d'erreur
        """
        inbound_path = None
        outbound_path = None
        mixed_path = None

        try:
            # Fermer les fichiers WAV
            if self.inbound_wav:
                self.inbound_wav.close()
                self.inbound_wav = None
                if self.inbound_path.exists() and self.inbound_path.stat().st_size > 44:  # Plus que header WAV
                    inbound_path = str(self.inbound_path)
                    logger.info("Inbound audio saved: %s", inbound_path)
                else:
                    # Supprimer fichier vide
                    self.inbound_path.unlink(missing_ok=True)

            if self.outbound_wav:
                self.outbound_wav.close()
                self.outbound_wav = None
                if self.outbound_path.exists() and self.outbound_path.stat().st_size > 44:  # Plus que header WAV
                    outbound_path = str(self.outbound_path)
                    logger.info("Outbound audio saved: %s", outbound_path)
                else:
                    # Supprimer fichier vide
                    self.outbound_path.unlink(missing_ok=True)

            # Créer fichier mixé (stéréo : inbound=gauche, outbound=droite)
            if self.inbound_frames or self.outbound_frames:
                try:
                    mixed_wav = wave.open(str(self.mixed_path), 'wb')
                    mixed_wav.setnchannels(2)  # Stéréo
                    mixed_wav.setsampwidth(2)  # 16-bit
                    mixed_wav.setframerate(24000)  # 24kHz

                    # Mixer les deux canaux

                    max_len = max(len(self.inbound_frames), len(self.outbound_frames))
                    for i in range(max_len):
                        inbound_chunk = (
                            self.inbound_frames[i]
                            if i < len(self.inbound_frames)
                            else b"\x00" * 480
                        )
                        outbound_chunk = (
                            self.outbound_frames[i]
                            if i < len(self.outbound_frames)
                            else b"\x00" * 480
                        )

                        max_len_chunk = max(len(inbound_chunk), len(outbound_chunk))

                        if len(inbound_chunk) < max_len_chunk:
                            inbound_chunk += b"\x00" * (
                                max_len_chunk - len(inbound_chunk)
                            )
                        if len(outbound_chunk) < max_len_chunk:
                            outbound_chunk += b"\x00" * (
                                max_len_chunk - len(outbound_chunk)
                            )

                        num_samples = len(inbound_chunk) // 2
                        stereo_chunk = bytearray()
                        for j in range(num_samples):
                            start = j * 2
                            stereo_chunk.extend(inbound_chunk[start : start + 2])
                            stereo_chunk.extend(outbound_chunk[start : start + 2])

                        mixed_wav.writeframes(bytes(stereo_chunk))

                    mixed_wav.close()
                    if self.mixed_path.exists() and self.mixed_path.stat().st_size > 44:
                        mixed_path = str(self.mixed_path)
                        logger.info("Mixed audio saved: %s", mixed_path)
                    else:
                        self.mixed_path.unlink(missing_ok=True)
                except Exception as e:
                    logger.error("Failed to create mixed audio file: %s", e)
                    self.mixed_path.unlink(missing_ok=True)
        except Exception as e:
            logger.error("Failed to close audio recorder: %s", e)

        return (inbound_path, outbound_path, mixed_path)


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
        target_sample_rate: int = 24_000,  # 24kHz requis par OpenAI Realtime API
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

    async def _run_with_connected_session(
        self,
        *,
        session: Any,
        playback_tracker: Any,
        model: str,
        instructions: str,
        voice: str | None,
        rtp_stream: AsyncIterator[RtpPacket],
        send_to_peer: Callable[[bytes], Awaitable[None]],
        clear_audio_queue: Callable[[], int] | None = None,
        pjsua_ready_to_consume: asyncio.Event | None = None,
        audio_bridge: Any | None = None,
        api_base: str | None = None,
        tools: list[Any] | None = None,
        handoffs: list[Any] | None = None,
        speak_first: bool = False,
    ) -> VoiceBridgeStats:
        """Exécute le voice bridge avec une session SDK déjà connectée.

        Cette méthode interne est utilisée pour l'optimisation où la connexion WebSocket
        est démarrée avant answer_call dans startup.py.
        """
        logger.info("Session SDK déjà connectée, démarrage du pont voix")
        # Appeler run() avec la session pré-connectée
        return await self.run(
            runner=None,  # Pas besoin de runner, on a déjà la session
            client_secret="",  # Déjà utilisé pour créer la session
            model=model,
            instructions=instructions,
            voice=voice,
            rtp_stream=rtp_stream,
            send_to_peer=send_to_peer,
            clear_audio_queue=clear_audio_queue,
            pjsua_ready_to_consume=pjsua_ready_to_consume,
            audio_bridge=audio_bridge,
            api_base=None,  # Déjà utilisé pour créer la session
            tools=tools,
            handoffs=handoffs,
            speak_first=speak_first,
            _existing_session=session,  # Passer la session existante
            _existing_playback_tracker=playback_tracker,  # Passer le tracker existant
        )

    async def run(
        self,
        *,
        runner: Any | None = None,
        client_secret: str = "",
        model: str,
        instructions: str,
        voice: str | None,
        rtp_stream: AsyncIterator[RtpPacket],
        send_to_peer: Callable[[bytes], Awaitable[None]],
        clear_audio_queue: Callable[[], int] | None = None,
        pjsua_ready_to_consume: asyncio.Event | None = None,
        audio_bridge: Any | None = None,
        api_base: str | None = None,
        tools: list[Any] | None = None,
        handoffs: list[Any] | None = None,
        speak_first: bool = False,
        _existing_session: Any | None = None,
        _existing_playback_tracker: Any | None = None,
    ) -> VoiceBridgeStats:
        """Démarre le pont voix jusqu'à la fin de session ou erreur."""

        logger.info(
            "Ouverture de la session Realtime voix avec runner (modèle=%s, voix=%s)",
            model,
            voice,
        )

        start_time = time.monotonic()
        transcripts: list[dict[str, str]] = []
        error: Exception | None = None
        session: Any | None = None
        stop_event = asyncio.Event()

        call_id = str(uuid.uuid4())
        audio_recorder: AudioRecorder | None = None
        try:
            audio_recorder = AudioRecorder(call_id=call_id)
            logger.info("Audio recorder initialized for call %s", call_id)
        except Exception as exc:
            logger.warning(
                "Failed to initialize audio recorder: %s. "
                "Continuing without recording.",
                exc,
            )
            audio_recorder = None

        block_audio_send_ref = [False]

        def on_playback_interrupted() -> None:
            block_audio_send_ref[0] = True
            logger.info("🛑 Audio bloqué via playback tracker "
                        "(interruption détectée par SDK)")

        if _existing_playback_tracker is not None:
            playback_tracker = _existing_playback_tracker
            playback_tracker.set_interrupt_callback(on_playback_interrupted)
        else:
            playback_tracker = TelephonyPlaybackTracker(
                on_interrupt_callback=on_playback_interrupted
            )

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

        stop_requested = [False]

        inbound_audio_dispatcher = _AsyncTaskLimiter(
            name="on_audio_inbound",
            max_pending=8,
        )

        async def request_stop() -> None:
            if stop_requested[0]:
                logger.debug("request_stop() déjà appelé, ignorer")
                return
            stop_requested[0] = True

            stop_event.set()

            if session is None:
                logger.debug("Session non créée, ignorer request_stop()")
                return

            try:
                from agents.realtime.model_inputs import RealtimeModelSendRawMessage

                await session._model.send_event(  # type: ignore[protected-access]
                    RealtimeModelSendRawMessage(message={"type": "response.cancel"})
                )
                logger.debug("✅ Réponse en cours annulée avant fermeture")
            except asyncio.CancelledError:
                logger.debug("response.cancel annulé (task en cours d'annulation)")
            except Exception as exc:
                logger.debug(
                    "response.cancel échoué (peut-être pas de réponse active): %s",
                    exc,
                )

            try:
                from agents.realtime.model_inputs import RealtimeModelSendRawMessage

                await session._model.send_event(  # type: ignore[protected-access]
                    RealtimeModelSendRawMessage(
                        message={"type": "input_audio_buffer.clear"}
                    )
                )
                logger.debug("✅ Buffer audio d'entrée vidé avant fermeture")
            except asyncio.CancelledError:
                logger.debug(
                    "input_audio_buffer.clear annulé (task en cours d'annulation)"
                )
            except Exception as exc:
                logger.debug("input_audio_buffer.clear échoué: %s", exc)

            await inbound_audio_dispatcher.cancel_pending()

        sip_sync = SipSyncController(
            speak_first=speak_first,
            audio_bridge=audio_bridge,
            clear_audio_queue=clear_audio_queue,
            pjsua_ready_to_consume=pjsua_ready_to_consume,
        )

        audio_manager: AudioStreamManager | None = None
        event_router: RealtimeEventRouter | None = None
        inbound_audio_bytes = 0
        outbound_audio_bytes = 0

        try:
            model_settings: dict[str, Any] = {
                "model_name": model,
                "modalities": ["audio"],
                "output_modalities": ["audio"],
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
            }
            if voice:
                model_settings["voice"] = voice

            model_config: dict[str, Any] = {
                "api_key": client_secret,
                "initial_model_settings": model_settings,
                "playback_tracker": playback_tracker,
            }

            if _existing_session is not None:
                session_context = contextlib.nullcontext(_existing_session)
                logger.info("Session SDK déjà connectée, utilisation directe")
            else:
                if runner is None:
                    raise RuntimeError("Realtime runner requis pour établir la session")
                logger.info("Démarrage session SDK avec runner")
                session_context = await runner.run(model_config=model_config)

            async with session_context as session_obj:
                session = session_obj
                if _existing_session is None:
                    logger.info("Session SDK démarrée avec succès")

                if audio_bridge:
                    audio_bridge.reset_all()
                    logger.info("✅ Audio bridge reset_all() "
                                "appelé au début de l'appel")

                try:
                    from agents.realtime.model_inputs import RealtimeModelSendRawMessage

                    await session._model.send_event(  # type: ignore[protected-access]
                        RealtimeModelSendRawMessage(
                            message={"type": "input_audio_buffer.clear"}
                        )
                    )
                    logger.debug("✅ Buffer audio d'entrée vidé au début de la session")
                except Exception as exc:
                    logger.warning("input_audio_buffer.clear échoué au début: %s", exc)

                await sip_sync.prepare_session(session)

                audio_manager = AudioStreamManager(
                    session=session,
                    rtp_stream=rtp_stream,
                    decode_packet=self._decode_packet,
                    should_continue=should_continue,
                    request_stop=request_stop,
                    inbound_audio_dispatcher=inbound_audio_dispatcher,
                    hooks=self._hooks,
                    audio_recorder=audio_recorder,
                    sip_sync=sip_sync,
                    audio_bridge=audio_bridge,
                )

                event_router = RealtimeEventRouter(
                    session=session,
                    playback_tracker=playback_tracker,
                    should_continue=should_continue,
                    request_stop=request_stop,
                    send_to_peer=send_to_peer,
                    clear_audio_queue=clear_audio_queue,
                    hooks=self._hooks,
                    transcripts=transcripts,
                    block_audio_send_ref=block_audio_send_ref,
                    audio_recorder=audio_recorder,
                    sip_sync=sip_sync,
                    error_factory=VoiceBridgeError,
                )

                try:
                    async with asyncio.TaskGroup() as tg:
                        tg.create_task(audio_manager.stream())
                        tg.create_task(event_router.run())
                except Exception as exc:
                    if hasattr(exc, "exceptions"):
                        for inner in exc.exceptions:  # type: ignore[attr-defined]
                            if isinstance(inner, asyncio.CancelledError):
                                continue
                            error = inner
                    else:
                        error = exc
                else:
                    if audio_manager.error and error is None:
                        error = audio_manager.error
                    if event_router.error and error is None:
                        error = event_router.error

                if audio_manager is not None:
                    inbound_audio_bytes = audio_manager.inbound_audio_bytes
                else:
                    inbound_audio_bytes = 0
                if event_router is not None:
                    outbound_audio_bytes = event_router.outbound_audio_bytes
                else:
                    outbound_audio_bytes = 0
        except Exception as exc:
            error = exc
            logger.error("Session voix Realtime interrompue : %s", exc)
        finally:
            inbound_audio_file: str | None = None
            outbound_audio_file: str | None = None
            mixed_audio_file: str | None = None

            if audio_manager is not None:
                inbound_audio_file, outbound_audio_file, mixed_audio_file = (
                    audio_manager.record()
                )
                if any((inbound_audio_file, outbound_audio_file, mixed_audio_file)):
                    logger.info(
                        "Audio recordings closed: inbound=%s, outbound=%s, mixed=%s",
                        inbound_audio_file,
                        outbound_audio_file,
                        mixed_audio_file,
                    )
            elif audio_recorder is not None:
                try:
                    (
                        inbound_audio_file,
                        outbound_audio_file,
                        mixed_audio_file,
                    ) = audio_recorder.close()
                except Exception as exc:
                    logger.error("Failed to close audio recorder: %s", exc)

            duration = time.monotonic() - start_time
            stats = VoiceBridgeStats(
                duration_seconds=duration,
                inbound_audio_bytes=inbound_audio_bytes,
                outbound_audio_bytes=outbound_audio_bytes,
                transcripts=list(transcripts),
                error=error,
                inbound_audio_file=inbound_audio_file,
                outbound_audio_file=outbound_audio_file,
                mixed_audio_file=mixed_audio_file,
            )
            await self._metrics.record(stats)
            await self._teardown(transcripts, error)
            if error is None:
                logger.info(
                    "Session voix terminée (durée=%.2fs, audio_in=%d, "
                    "audio_out=%d, transcripts=%d)",
                    duration,
                    inbound_audio_bytes,
                    outbound_audio_bytes,
                    stats.transcript_count,
                )
            else:
                logger.warning(
                    "Session voix terminée avec erreur après %.2fs",
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
    ) -> dict[str, Any]:
        # Format API GA (non-beta)
        # Note: tools et handoffs sont déjà configurés via client_secret
        payload: dict[str, Any] = {
            "type": "realtime",
            "model": model,
            "instructions": instructions,
            "output_modalities": ["audio"],  # CRITICAL: Force audio output for telephony
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": 24000},  # 24kHz requis par OpenAI Realtime API
                    "turn_detection": {
                        "type": "semantic_vad",  # VAD sémantique pour une meilleure détection de fin de phrase
                        "create_response": True,
                        "interrupt_response": True,
                    },
                },
                "output": {
                    "format": {"type": "audio/pcm", "rate": 24000},  # 24kHz requis par OpenAI Realtime API
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
