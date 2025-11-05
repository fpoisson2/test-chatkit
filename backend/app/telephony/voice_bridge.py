"""Pont entre la téléphonie SIP et les sessions Realtime."""

from __future__ import annotations

import asyncio
import audioop
import base64
import contextlib
import json
import logging
import os
import struct
import time
import uuid
import wave
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
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
from .call_transfer import transfer_call

logger = logging.getLogger("chatkit.telephony.voice_bridge")


class TelephonyPlaybackTracker(RealtimePlaybackTracker):
    """Tracks audio playback progress for telephony to enable proper interruption handling.

    In telephony scenarios, audio is sent via RTP packets with delays (20ms between packets).
    We need to tell OpenAI exactly when audio has been played so it can handle interruptions correctly.
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
    on_transcript: Callable[[dict[str, str]], Awaitable[None]] | None = None  # Appelé pour chaque transcription en temps réel
    on_audio_inbound: Callable[[bytes], Awaitable[None]] | None = None  # Appelé pour chaque chunk audio entrant
    on_audio_outbound: Callable[[bytes], Awaitable[None]] | None = None  # Appelé pour chaque chunk audio sortant


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

            logger.info("Audio recorder initialized: inbound=%s, outbound=%s", self.inbound_path, self.outbound_path)
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
            Tuple (inbound_path, outbound_path, mixed_path) ou (None, None, None) en cas d'erreur
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
                        inbound_chunk = self.inbound_frames[i] if i < len(self.inbound_frames) else b'\x00' * 480  # 20ms silence
                        outbound_chunk = self.outbound_frames[i] if i < len(self.outbound_frames) else b'\x00' * 480

                        # Assurer que les deux chunks ont la même longueur
                        min_len = min(len(inbound_chunk), len(outbound_chunk))
                        max_len_chunk = max(len(inbound_chunk), len(outbound_chunk))

                        # Pad le plus court avec du silence
                        if len(inbound_chunk) < max_len_chunk:
                            inbound_chunk = inbound_chunk + b'\x00' * (max_len_chunk - len(inbound_chunk))
                        if len(outbound_chunk) < max_len_chunk:
                            outbound_chunk = outbound_chunk + b'\x00' * (max_len_chunk - len(outbound_chunk))

                        # Interleaver les samples (L, R, L, R, ...)
                        num_samples = len(inbound_chunk) // 2
                        stereo_chunk = bytearray()
                        for j in range(num_samples):
                            stereo_chunk.extend(inbound_chunk[j*2:j*2+2])  # Left (inbound)
                            stereo_chunk.extend(outbound_chunk[j*2:j*2+2])  # Right (outbound)

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
        _existing_session: Any | None = None,  # Paramètre interne pour optimisation
        _existing_playback_tracker: Any | None = None,  # Paramètre interne pour optimisation
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

        # Initialize audio recorder
        call_id = str(uuid.uuid4())
        audio_recorder: AudioRecorder | None = None
        try:
            audio_recorder = AudioRecorder(call_id=call_id)
            logger.info("Audio recorder initialized for call %s", call_id)
        except Exception as e:
            logger.warning("Failed to initialize audio recorder: %s. Continuing without recording.", e)
            audio_recorder = None

        # Track if we've sent response.create immediately (for speak_first optimization)
        response_create_sent_immediately = False

        # Use a list to create a mutable reference for block_audio_send
        block_audio_send_ref = [False]

        def on_playback_interrupted():
            """Called when SDK detects audio interruption."""
            block_audio_send_ref[0] = True
            logger.info("🛑 Audio bloqué via playback tracker (interruption détectée par SDK)")

        # Create playback tracker for proper interruption handling (or use existing one)
        if _existing_playback_tracker is not None:
            playback_tracker = _existing_playback_tracker
            # Update callback since it references block_audio_send_ref from this scope
            playback_tracker.set_interrupt_callback(on_playback_interrupted)
        else:
            playback_tracker = TelephonyPlaybackTracker(on_interrupt_callback=on_playback_interrupted)

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

        # Flag pour s'assurer que request_stop() n'est appelé qu'une seule fois
        stop_requested = [False]

        async def request_stop() -> None:
            """Request immediate stop of both audio forwarding and event handling."""
            # Éviter les nettoyages multiples
            if stop_requested[0]:
                logger.debug("request_stop() déjà appelé, ignorer")
                return
            stop_requested[0] = True

            stop_event.set()

            # Si la session n'est pas encore créée, ne rien faire
            if session is None:
                logger.debug("Session non créée, ignorer request_stop()")
                return

            # Annuler toute réponse en cours pour éviter le "saignement" audio entre sessions
            try:
                from agents.realtime.model_inputs import RealtimeModelSendRawMessage
                await session._model.send_event(
                    RealtimeModelSendRawMessage(
                        message={"type": "response.cancel"}
                    )
                )
                logger.debug("✅ Réponse en cours annulée avant fermeture")
            except asyncio.CancelledError:
                logger.debug("response.cancel annulé (task en cours d'annulation)")
            except Exception as e:
                logger.debug("response.cancel échoué (peut-être pas de réponse active): %s", e)

            # Vider le buffer audio d'entrée pour éviter des données résiduelles
            try:
                from agents.realtime.model_inputs import RealtimeModelSendRawMessage
                await session._model.send_event(
                    RealtimeModelSendRawMessage(
                        message={"type": "input_audio_buffer.clear"}
                    )
                )
                logger.debug("✅ Buffer audio d'entrée vidé avant fermeture")
            except asyncio.CancelledError:
                logger.debug("input_audio_buffer.clear annulé (task en cours d'annulation)")
            except Exception as e:
                logger.debug("input_audio_buffer.clear échoué: %s", e)
            # Note: Ne pas fermer la session ici car __aexit__ doit être appelé depuis la même tâche que __aenter__
            # La session sera fermée automatiquement par le context manager 'async with'

        async def forward_audio() -> None:
            nonlocal inbound_audio_bytes, response_create_sent_immediately
            packet_count = 0
            # Note: turn_detection est déjà activé dans la configuration initiale de session (_build_session_update)
            # Track if we've sent response.create when phone became ready
            response_create_sent_on_ready = False

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

                        # Si speak_first est activé, amorcer le canal et envoyer response.create MAINTENANT
                        # que le canal bidirectionnel est confirmé
                        if speak_first and not response_create_sent_immediately and not response_create_sent_on_ready:
                            try:
                                # NOTE: reset_all() is now called unconditionally at session start (line ~997)
                                # so no need to call it again here

                                # 1. D'abord, précharger généreusement le ring buffer (8-10 frames)
                                # CRITIQUE: Amorcer avec TARGET frames pour éviter sous-alimentation
                                # Cela évite les silences quand TTS arrive en burst
                                # IMPORTANT: Injection DIRECTE dans le ring buffer @ 8kHz
                                num_silence_frames = 12  # 12 frames = 240ms - amorçage très généreux (anti-starvation)

                                logger.info("🔇 Canal bidirectionnel confirmé - injection directe de %d frames de silence (%dms prime pour stabilité)", num_silence_frames, num_silence_frames * 20)
                                if audio_bridge:
                                    # Injection directe dans le ring buffer @ 8kHz (synchrone, pas async)
                                    audio_bridge.send_prime_silence_direct(num_frames=num_silence_frames)
                                    logger.info("✅ Pipeline audio amorcé avec %d frames de silence (injection directe)", num_silence_frames)
                                    # Déverrouiller l'envoi audio maintenant que les conditions sont remplies:
                                    # - onCallMediaState actif (media_active_event)
                                    # - Premier onFrameRequested reçu (pjsua_ready_event)
                                    # - 20ms de silence envoyés (amorçage)
                                    audio_bridge.enable_audio_output()
                                    logger.info("🔓 Envoi audio TTS déverrouillé après amorçage")
                                else:
                                    logger.warning("⚠️ audio_bridge n'est pas disponible pour l'injection de silence")

                                # 2. PUIS, envoyer response.create maintenant que le canal est amorcé
                                from agents.realtime.model_inputs import (
                                    RealtimeModelRawClientMessage,
                                    RealtimeModelSendRawMessage,
                                )
                                await session._model.send_event(
                                    RealtimeModelSendRawMessage(
                                        message=RealtimeModelRawClientMessage(
                                            type="response.create",
                                            other_data={},
                                        )
                                    )
                                )
                                response_create_sent_on_ready = True

                                # Timing diagnostic: envoi response.create (t1)
                                if audio_bridge:
                                    import time
                                    audio_bridge._t1_response_create = time.monotonic()
                                    if audio_bridge._t0_first_rtp is not None:
                                        delta = (audio_bridge._t1_response_create - audio_bridge._t0_first_rtp) * 1000
                                        logger.info(
                                            "✅ [t1=%.3fs, Δt0→t1=%.1fms] response.create envoyé après amorçage",
                                            audio_bridge._t1_response_create, delta
                                        )
                                    else:
                                        logger.info(
                                            "✅ [t1=%.3fs] response.create envoyé après amorçage",
                                            audio_bridge._t1_response_create
                                        )
                            except Exception as exc:
                                logger.warning("⚠️ Erreur lors de l'amorçage et envoi response.create: %s", exc)

                    # Always send audio with commit=False - let turn_detection handle commits
                    await session.send_audio(pcm, commit=False)

                    # Record inbound audio
                    if audio_recorder:
                        audio_recorder.write_inbound(pcm)

                    # Stream inbound audio en temps réel
                    if self._hooks.on_audio_inbound:
                        try:
                            await self._hooks.on_audio_inbound(pcm)
                        except Exception as e:
                            logger.error("Erreur lors du streaming audio entrant: %s", e)

                    # Note: turn_detection est déjà activé dans la configuration initiale de session
                    # (voir _build_session_update), donc on n'a pas besoin de l'activer ici.
                    # Tenter de le faire après le speak_first cause l'erreur:
                    # "Cannot update a conversation's voice if assistant audio is present."

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
        # block_audio_send is now block_audio_send_ref[0]

        # Track tool calls to ensure confirmations
        tool_call_detected = False  # Set to True when we detect a tool call
        last_assistant_message_was_short = False  # Track if last message was likely just a preamble

        # Track processed history items to avoid re-processing replays
        processed_item_ids: set[str] = set()  # Track item IDs we've already seen

        # Force immediate response after user speech (max 0.1s silence)
        # CRITICAL FIX: Track all watchdog tasks to prevent leaks
        response_watchdog_tasks: list[asyncio.Task] = []  # All watchdog tasks (for proper cleanup)
        audio_received_after_user_speech = False  # Track if we got actual audio
        response_started_after_user_speech = False  # Track if agent started generating ANY response

        async def force_response_if_silent() -> None:
            """Wait 0.1s and force audio response if no audio received."""
            nonlocal audio_received_after_user_speech, response_started_after_user_speech
            try:
                await asyncio.sleep(0.1)  # Wait 0.1 second
                # If we reach here and NO AUDIO received, force response with audio
                # This ensures there's ALWAYS a verbal preamble, even before function calls
                if not audio_received_after_user_speech:
                    if response_started_after_user_speech:
                        logger.warning("⏱️ 0.1s sans audio détecté (function call sans préambule) - forçage response.create avec audio")
                        # Cancel the current response first (it has no audio anyway)
                        try:
                            from agents.realtime.model_inputs import RealtimeModelSendRawMessage
                            await session._model.send_event(
                                RealtimeModelSendRawMessage(
                                    message={"type": "response.cancel"}
                                )
                            )
                            logger.info("🚫 Réponse sans audio annulée")
                        except Exception as e:
                            logger.debug("response.cancel échoué: %s", e)
                    else:
                        logger.warning("⏱️ 0.1s silence TOTAL détecté - forçage response.create")

                    try:
                        from agents.realtime.model_inputs import (
                            RealtimeModelRawClientMessage,
                            RealtimeModelSendRawMessage,
                        )
                        await session._model.send_event(
                            RealtimeModelSendRawMessage(
                                message=RealtimeModelRawClientMessage(
                                    type="response.create",
                                    other_data={},
                                )
                            )
                        )
                        logger.info("✅ response.create forcé pour garantir audio")
                    except Exception as e:
                        logger.warning("Impossible de forcer response.create: %s", e)
            except asyncio.CancelledError:
                # Watchdog cancelled because audio arrived - this is good!
                logger.debug("Watchdog annulé - audio reçu à temps")

        async def handle_events() -> None:
            """Handle events from the SDK session (replaces raw WebSocket handling)."""
            nonlocal outbound_audio_bytes, error, last_response_id, agent_is_speaking, user_speech_detected, playback_tracker, tool_call_detected, last_assistant_message_was_short, processed_item_ids, response_watchdog_tasks, audio_received_after_user_speech, response_started_after_user_speech
            try:
                async for event in session:
                    if not should_continue():
                        break

                    event_type = type(event).__name__

                    # Logging audio events is too verbose - disabled
                    # if 'audio' in event_type.lower() or 'agent' in event_type.lower():
                    #     logger.debug("📡 Event: %s", event_type)

                    # Debug: log ALL events to trace MCP tool calls
                    if 'tool' in event_type.lower() or 'function' in event_type.lower():
                        logger.info("🔧 Event: %s - %s", event_type, event)

                    # Handle error events
                    if isinstance(event, RealtimeError):
                        error_code = getattr(event.error, 'code', None)
                        # Ignore "response_cancel_not_active" - it's OK if there's no active response
                        if error_code == 'response_cancel_not_active':
                            logger.debug("response.cancel ignoré (pas de réponse active): %s", event.error)
                            continue
                        # Ignore "conversation_already_has_active_response" - happens when turn_detection
                        # and manual response.create race (expected behavior)
                        if error_code == 'conversation_already_has_active_response':
                            logger.debug("response.create ignoré (réponse déjà active - turn_detection l'a créée): %s", event.error)
                            continue
                        # For other errors, fail the session
                        error = VoiceBridgeError(str(event.error))
                        logger.error("Erreur Realtime API: %s", event.error)
                        break

                    # Check for input_audio_buffer.speech_started in raw events
                    # This is the KEY event for detecting user interruption!
                    if event_type == "RealtimeRawModelEvent":
                        # SDK structure: RealtimeRawModelEvent.data is a RealtimeModelEvent
                        # When it's RealtimeModelRawServerEvent, the .data attribute contains the raw dict
                        model_event = getattr(event, 'data', None)
                        if model_event:
                            model_event_type = getattr(model_event, 'type', None)

                            # Check if this is a raw_server_event (contains raw OpenAI events)
                            if model_event_type == 'raw_server_event':
                                # Extract the raw data dictionary
                                raw_data = getattr(model_event, 'data', None)
                                if raw_data and isinstance(raw_data, dict):
                                    event_subtype = raw_data.get('type', '')

                                    # Debug: Log specific event types (disabled by default for performance)
                                    # if event_subtype not in ('input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped',
                                    #                          'input_audio_buffer.committed', 'response.audio.delta',
                                    #                          'response.audio_transcript.delta', 'conversation.item.input_audio_transcription.completed'):
                                    #     logger.info("🔍 RAW EVENT: %s", event_subtype)

                                    # User started speaking - INTERRUPT THE AGENT AND BLOCK AUDIO!
                                    if event_subtype == 'input_audio_buffer.speech_started':
                                        logger.info("🎤 Utilisateur commence à parler")
                                        # ALWAYS block audio when user speaks, even if agent just finished
                                        # (there might be audio packets still in the pipeline)
                                        block_audio_send_ref[0] = True

                                        # Clear outgoing audio queue to stop playback immediately
                                        if clear_audio_queue:
                                            frames_cleared = clear_audio_queue()
                                            if frames_cleared > 0:
                                                logger.info("🗑️  Audio queue vidée: %d frames supprimées pour interruption rapide", frames_cleared)

                                        # Reset tool call tracking when user speaks
                                        # (no need for confirmation if user moved on)
                                        if tool_call_detected:
                                            logger.debug("Réinitialisation du tracking tool call (utilisateur parle)")
                                            tool_call_detected = False
                                            last_assistant_message_was_short = False

                                        if agent_is_speaking:
                                            logger.info("🛑 Interruption de l'agent (agent parlait)!")
                                            try:
                                                await session.interrupt()
                                            except Exception as e:
                                                logger.warning("Erreur lors de session.interrupt(): %s", e)
                                        else:
                                            logger.info("🛑 Blocage audio (agent vient de finir)")
                                        user_speech_detected = True
                                        continue

                                    # User stopped speaking
                                    if event_subtype == 'input_audio_buffer.speech_stopped':
                                        logger.info("🎤 Utilisateur arrête de parler")
                                        user_speech_detected = False
                                        # If agent is not speaking, unblock audio
                                        if not agent_is_speaking:
                                            block_audio_send_ref[0] = False
                                            logger.info("→ Déblocage audio (agent ne parle pas)")
                                        # Turn detection will create response automatically (no manual intervention)
                                        continue

                                    # Detect MCP tool call completion in real-time
                                    if event_subtype == 'response.mcp_call.completed':
                                        tool_data = raw_data.get('mcp_call', {}) if isinstance(raw_data.get('mcp_call'), dict) else {}
                                        tool_name = tool_data.get('name', 'unknown')
                                        logger.info("🔧 Tool MCP terminé EN TEMPS RÉEL: %s", tool_name)

                                        # Force response.create pour confirmation vocale
                                        # Ignore l'erreur si turn_detection a déjà créé une réponse
                                        try:
                                            from agents.realtime.model_inputs import (
                                                RealtimeModelRawClientMessage,
                                                RealtimeModelSendRawMessage,
                                            )
                                            logger.info("→ Envoi response.create pour forcer confirmation vocale")
                                            await session._model.send_event(
                                                RealtimeModelSendRawMessage(
                                                    message=RealtimeModelRawClientMessage(
                                                        type="response.create",
                                                        other_data={},
                                                    )
                                                )
                                            )
                                            logger.info("✅ response.create envoyé")
                                        except Exception as e:
                                            # Ignorer silencieusement si turn_detection a déjà créé une réponse
                                            error_msg = str(e).lower()
                                            if "already has an active response" in error_msg or "conversation_already_has_active_response" in error_msg:
                                                logger.debug("response.create ignoré (réponse déjà active): %s", e)
                                            else:
                                                logger.warning("Erreur lors de l'envoi de response.create: %s", e)
                                        continue

                                    # Detect standard function call completion in real-time
                                    if event_subtype == 'response.function_call_arguments.done':
                                        function_name = raw_data.get('name', 'unknown')
                                        logger.info("🔧 Function call terminé EN TEMPS RÉEL: %s", function_name)

                                        # Force response.create pour confirmation vocale
                                        # Ignore l'erreur si turn_detection a déjà créé une réponse
                                        try:
                                            from agents.realtime.model_inputs import (
                                                RealtimeModelRawClientMessage,
                                                RealtimeModelSendRawMessage,
                                            )
                                            logger.info("→ Envoi response.create pour forcer confirmation vocale")
                                            await session._model.send_event(
                                                RealtimeModelSendRawMessage(
                                                    message=RealtimeModelRawClientMessage(
                                                        type="response.create",
                                                        other_data={},
                                                    )
                                                )
                                            )
                                            logger.info("✅ response.create envoyé")
                                        except Exception as e:
                                            # Ignorer silencieusement si turn_detection a déjà créé une réponse
                                            error_msg = str(e).lower()
                                            if "already has an active response" in error_msg or "conversation_already_has_active_response" in error_msg:
                                                logger.debug("response.create ignoré (réponse déjà active): %s", e)
                                            else:
                                                logger.warning("Erreur lors de l'envoi de response.create: %s", e)
                                        continue

                    # Track when agent starts speaking
                    if isinstance(event, RealtimeAgentStartEvent):
                        agent_is_speaking = True
                        # Mark that a response has started (even if no audio yet)
                        # This prevents watchdog from forcing duplicate response.create
                        response_started_after_user_speech = True
                        # DON'T cancel watchdog here - wait for actual audio chunk
                        # (AgentStart can fire even for responses without audio, like pure tool calls)
                        # Don't change block_audio_send here - let RealtimeAgentEndEvent unblock it
                        logger.debug("Agent commence à parler (block_audio_send=%s)", block_audio_send_ref[0])
                        continue

                    # Track when agent stops speaking - THIS is when we unblock audio
                    if isinstance(event, RealtimeAgentEndEvent):
                        agent_is_speaking = False
                        # Only unblock audio if user is not currently speaking
                        if not user_speech_detected:
                            block_audio_send_ref[0] = False
                        # else: audio reste bloqué car user parle encore

                        # Tool call handling is now done immediately when detected (see history processing)
                        # No need for a delayed confirmation check here

                        continue

                    # Handle audio interruption - BLOCK AUDIO IMMEDIATELY!
                    if isinstance(event, RealtimeAudioInterrupted):
                        logger.info("🛑 Audio interrompu confirmé par OpenAI - blocage audio")
                        block_audio_send_ref[0] = True
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
                        # Mark that we received audio - this prevents watchdog from firing
                        if not audio_received_after_user_speech:
                            audio_received_after_user_speech = True
                            logger.debug("✅ Audio reçu - watchdog ne se déclenchera pas")

                        # Cancel ALL watchdog tasks on FIRST audio chunk - agent is actually speaking!
                        # CRITICAL FIX: Cancel all watchdog tasks to prevent leaks
                        for watchdog_task in response_watchdog_tasks:
                            if not watchdog_task.done():
                                watchdog_task.cancel()
                        if response_watchdog_tasks:
                            logger.debug("✅ %d watchdog task(s) annulé(s) - agent parle vraiment", len(response_watchdog_tasks))
                            response_watchdog_tasks.clear()  # Clear list after cancelling all

                        audio_event = event.audio
                        pcm_data = audio_event.data

                        if not block_audio_send_ref[0]:
                            if pcm_data:
                                # Timing diagnostic: premier chunk TTS (t2)
                                if audio_bridge and audio_bridge._t2_first_tts_chunk is None:
                                    import time
                                    audio_bridge._t2_first_tts_chunk = time.monotonic()
                                    if audio_bridge._t1_response_create is not None:
                                        delta = (audio_bridge._t2_first_tts_chunk - audio_bridge._t1_response_create) * 1000
                                        logger.info(
                                            "🎵 [t2=%.3fs, Δt1→t2=%.1fms] Premier chunk TTS reçu (%d bytes)",
                                            audio_bridge._t2_first_tts_chunk, delta, len(pcm_data)
                                        )

                                        # 📊 Diagnostic: Enregistrer le temps du premier TTS
                                        if hasattr(audio_bridge, '_chatkit_call_id') and audio_bridge._chatkit_call_id:
                                            from .call_diagnostics import get_diagnostics_manager
                                            diag_manager = get_diagnostics_manager()
                                            diag = diag_manager.get_call(audio_bridge._chatkit_call_id)
                                            if diag:
                                                # Utiliser directement delta au lieu de start/end pour capturer la vraie valeur
                                                diag.phase_first_tts.duration_ms = delta
                                                diag.phase_first_tts.metadata = {'delay_ms': delta, 'bytes': len(pcm_data)}
                                                logger.info(f"⏱️ Phase 'first_tts' enregistrée: {delta:.1f}ms")

                                    # CRITIQUE: Premier chunk TTS → activer l'audio output MAINTENANT
                                    # 1. Amorcer le ring buffer avec du silence (évite les clics)
                                    # 2. Activer l'audio output
                                    # 3. Le TTS va immédiatement suivre dans send_to_peer() ci-dessous
                                    # Aucune race condition car tout se passe dans le même événement async
                                    num_silence_frames = 12  # 240ms de silence de prime
                                    audio_bridge.send_prime_silence_direct(num_frames=num_silence_frames)
                                    logger.info("✅ Ring buffer amorcé avec %d frames de silence", num_silence_frames)

                                    audio_bridge.enable_audio_output()
                                    logger.info("🔓 Audio output activé (premier chunk TTS reçu)")

                                outbound_audio_bytes += len(pcm_data)
                                logger.debug("🎵 Envoi de %d bytes d'audio vers téléphone", len(pcm_data))
                                # Send audio and wait until it's actually sent via RTP
                                await send_to_peer(pcm_data)

                                # Record outbound audio
                                if audio_recorder:
                                    audio_recorder.write_outbound(pcm_data)

                                # Stream outbound audio en temps réel
                                if self._hooks.on_audio_outbound:
                                    try:
                                        await self._hooks.on_audio_outbound(pcm_data)
                                    except Exception as e:
                                        logger.error("Erreur lors du streaming audio sortant: %s", e)

                                # Now update the playback tracker so OpenAI knows when audio was played
                                # This is critical for proper interruption handling!
                                playback_tracker.on_play_bytes(
                                    event.item_id,
                                    event.content_index,
                                    pcm_data
                                )
                        else:
                            logger.debug("🛑 Audio bloqué (block_audio_send=%s)", block_audio_send_ref[0])
                        continue

                    # Handle audio end
                    if isinstance(event, RealtimeAudioEnd):
                        continue

                    # Handle history updates (contains transcripts)
                    if isinstance(event, (RealtimeHistoryAdded, RealtimeHistoryUpdated)):
                        history = getattr(event, "history", [event.item] if hasattr(event, "item") else [])
                        for idx, item in enumerate(history):
                            role = getattr(item, "role", None)

                            # Debug: Log ALL history items to trace tool calls
                            item_id = getattr(item, "id", None)

                            # Create a unique identifier for this item (even if id is None)
                            # Use index in history + role + content_count as fallback
                            item_unique_id = item_id if item_id else f"{idx}_{role}_{len(getattr(item, 'content', []))}"

                            # DEDUPLICATION: Skip items we've already processed (filters out replays)
                            if item_unique_id in processed_item_ids:
                                continue  # Already processed this item

                            # Mark this item as processed
                            processed_item_ids.add(item_unique_id)

                            item_type = getattr(item, "type", None)
                            contents = getattr(item, "content", [])
                            content_count = len(contents) if contents else 0
                            logger.info("📋 History item: role=%s, type=%s, id=%s, unique_id=%s, content_count=%d",
                                       role, item_type, item_id, item_unique_id, content_count)

                            # DETECT TOOL CALLS: Check if there are actual function_call or tool_call contents
                            # Don't just rely on content_count=0, verify there's a real tool call
                            has_tool_call_content = False
                            if contents:
                                for content in contents:
                                    content_type = getattr(content, "type", None)
                                    if content_type in ("function_call", "tool_call", "function_call_output"):
                                        has_tool_call_content = True
                                        break

                            # Only detect tool call if:
                            # 1. It's an assistant message AND
                            # 2. Either has tool call content OR is type="function_call"
                            if role == "assistant" and (has_tool_call_content or item_type == "function_call"):
                                tool_call_detected = True
                                logger.debug("🔧 Tool call détecté dans l'historique (type=%s, has_tool_content=%s)",
                                           item_type, has_tool_call_content)

                            # Inspect content types for tool-related data
                            if contents:
                                for idx, content in enumerate(contents):
                                    content_type = getattr(content, "type", None)
                                    logger.info("  📄 Content[%d]: type=%s", idx, content_type)
                                    # Log tool call details if present
                                    if content_type in ("function_call", "tool_call", "function_call_output"):
                                        logger.info("    🔧 Tool content: %s", content)

                            # Only process user/assistant text for transcripts
                            if role not in ("user", "assistant"):
                                continue
                            text_parts: list[str] = []
                            for content in contents:
                                text = getattr(content, "text", None) or getattr(content, "transcript", None)
                                if isinstance(text, str) and text.strip():
                                    text_parts.append(text.strip())

                            if text_parts:
                                combined_text = "\n".join(text_parts)
                                transcript_entry = {"role": role, "text": combined_text}
                                transcripts.append(transcript_entry)
                                # Log transcription to help debug tool usage
                                logger.info("💬 %s: %s", role.upper(), combined_text[:200])

                                # Appeler le hook de transcription en temps réel si disponible
                                if self._hooks.on_transcript:
                                    try:
                                        await self._hooks.on_transcript(transcript_entry)
                                    except Exception as e:
                                        logger.error("Erreur lors de l'envoi de la transcription en temps réel: %s", e)

                                # Track if assistant message is short (likely just a preamble)
                                if role == "assistant":
                                    # Short messages (< 30 chars) are likely preambles like "Je m'en occupe"
                                    is_short = len(combined_text) < 30
                                    last_assistant_message_was_short = is_short

                                    # If we had a tool call and now get a proper response, clear the flag
                                    if tool_call_detected and not is_short:
                                        logger.info("✅ Confirmation détectée après tool call: %s", combined_text[:50])
                                        tool_call_detected = False
                                    elif tool_call_detected and is_short:
                                        logger.warning("⚠️ Message court après tool call (probable préambule): %s", combined_text)
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
                        # Note: response.create is sent when tool call is detected via history (content_count=0)
                        continue

            except Exception as exc:
                logger.exception("Erreur dans le flux d'événements SDK")
                error = VoiceBridgeError(f"Erreur événements SDK: {exc}")
            finally:
                # CRITICAL FIX: Cancel all watchdog tasks to prevent leaks
                for watchdog_task in response_watchdog_tasks:
                    if not watchdog_task.done():
                        watchdog_task.cancel()
                if response_watchdog_tasks:
                    logger.debug("🧹 Cleanup: %d watchdog task(s) annulé(s)", len(response_watchdog_tasks))
                    response_watchdog_tasks.clear()
                await request_stop()

        stats: VoiceBridgeStats | None = None
        try:
            # Build model config for the SDK runner
            # Note: turn_detection is already configured in client_secret (semantic_vad)
            # Note: tools are already available via the runner's MCP server connections
            # Note: Tool calls work with audio-only mode - they happen internally and don't require text modality
            model_settings: dict[str, Any] = {
                "model_name": model,
                "modalities": ["audio"],  # For telephony, audio only (tool calls work internally)
                "output_modalities": ["audio"],  # CRITICAL: Explicitly force audio-only output
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
            # OPTIMISATION: Si une session est déjà fournie (connexion WebSocket déjà établie),
            # l'utiliser directement au lieu de créer une nouvelle connexion
            if _existing_session is not None:
                # Session déjà connectée - utiliser avec un context manager dummy
                session_context = contextlib.nullcontext(_existing_session)
                logger.info("Session SDK déjà connectée, utilisation directe")
            else:
                # Créer une nouvelle session avec le runner
                logger.info("Démarrage session SDK avec runner")
                session_context = await runner.run(model_config=model_config)

            # Utiliser async with pour gérer proprement le context manager
            async with session_context as session:
                if _existing_session is None:
                    logger.info("Session SDK démarrée avec succès")

                # CRITICAL FIX: Reset audio bridge at START of call to clear any state from previous call
                # Especially important for _drop_until_next_assistant flag which blocks all audio if True
                if audio_bridge:
                    audio_bridge.reset_all()
                    logger.info("✅ Audio bridge reset_all() appelé au début de l'appel")

                # Vider le buffer audio d'entrée au début de la session pour éviter des données résiduelles
                # de sessions précédentes
                try:
                    from agents.realtime.model_inputs import RealtimeModelSendRawMessage
                    await session._model.send_event(
                        RealtimeModelSendRawMessage(
                            message={"type": "input_audio_buffer.clear"}
                        )
                    )
                    logger.debug("✅ Buffer audio d'entrée vidé au début de la session")
                except Exception as e:
                    logger.warning("input_audio_buffer.clear échoué au début: %s", e)

                # Si speak_first est activé, attendre que PJSUA soit prêt à consommer l'audio
                # OPTIMISATION: Envoyer response.create IMMÉDIATEMENT après pjsua_ready, sans attendre le premier RTP
                if speak_first:
                    if pjsua_ready_to_consume is not None:
                        logger.info("⏳ Attente que PJSUA soit prêt à consommer l'audio avant speak_first...")
                        try:
                            await asyncio.wait_for(pjsua_ready_to_consume.wait(), timeout=5.0)
                            logger.info("✅ PJSUA prêt - envoi IMMÉDIAT de response.create (sans attendre RTP)")

                            # OPTIMISATION CRITIQUE: Vider la queue locale PJSUA MAINTENANT
                            # Les frames de silence se sont accumulées pendant l'attente
                            logger.info("🔍 DEBUG: clear_audio_queue = %s (type=%s)", clear_audio_queue, type(clear_audio_queue))
                            if clear_audio_queue is not None:
                                try:
                                    cleared_count = clear_audio_queue()
                                    logger.info("🗑️ Queue locale PJSUA vidée: %d frames de silence supprimées", cleared_count)
                                except Exception as e:
                                    logger.warning("Erreur lors du vidage de la queue PJSUA: %s", e)
                            else:
                                logger.warning("⚠️ clear_audio_queue est None - impossible de vider la queue!")

                            # OPTIMISATION AGRESSIVE: Envoyer response.create MAINTENANT
                            # Cela démarre la génération TTS immédiatement sans attendre le premier paquet RTP
                            # Gain de temps: ~200-800ms (délai typique avant premier RTP)
                            try:
                                # 1. Envoyer response.create MAINTENANT pour démarrer la génération TTS
                                from agents.realtime.model_inputs import (
                                    RealtimeModelRawClientMessage,
                                    RealtimeModelSendRawMessage,
                                )
                                await session._model.send_event(
                                    RealtimeModelSendRawMessage(
                                        message=RealtimeModelRawClientMessage(
                                            type="response.create",
                                            other_data={},
                                        )
                                    )
                                )
                                response_create_sent_immediately = True

                                # Timing diagnostic
                                if audio_bridge:
                                    audio_bridge._t1_response_create = time.monotonic()
                                    logger.info("✅ response.create envoyé IMMÉDIATEMENT (optimisation maximale)")

                                    # 📊 Diagnostic: Enregistrer le début de response.create
                                    if hasattr(audio_bridge, '_chatkit_call_id') and audio_bridge._chatkit_call_id:
                                        from .call_diagnostics import get_diagnostics_manager
                                        diag_manager = get_diagnostics_manager()
                                        diag = diag_manager.get_call(audio_bridge._chatkit_call_id)
                                        if diag:
                                            diag.phase_response_create.start()
                                            diag.phase_response_create.end()

                                # NOTE IMPORTANTE: On N'active PAS audio_output ici !
                                # L'activation se fera dans forward_audio() dès réception du premier chunk TTS.
                                # Cela évite la starvation du ring buffer pendant l'attente du TTS (800-900ms).
                                # Si on active maintenant, PJSUA consommerait ~40 frames avant l'arrivée du TTS.
                                logger.info("⏸️ Audio output restera désactivé jusqu'au premier chunk TTS (évite starvation)")
                            except Exception as exc:
                                logger.warning("⚠️ Erreur lors de l'envoi immédiat de response.create: %s", exc)
                                # En cas d'erreur, le fallback dans forward_audio() prendra le relais

                        except asyncio.TimeoutError:
                            logger.warning("⚠️ Timeout en attendant PJSUA")
                    else:
                        logger.info("⏳ Mode speak_first activé - response.create sera envoyé après amorçage du canal")

                # OPTIMISATION: Démarrer forward_audio() et handle_events() IMMÉDIATEMENT
                # pour que le RTP stream commence à capturer l'audio le plus tôt possible
                audio_task = asyncio.create_task(forward_audio())
                events_task = asyncio.create_task(handle_events())
                try:
                    # Utiliser wait() avec FIRST_COMPLETED au lieu de gather()
                    # Cela permet d'annuler la tâche restante dès que l'une se termine
                    done, pending = await asyncio.wait(
                        {audio_task, events_task},
                        return_when=asyncio.FIRST_COMPLETED
                    )

                    # Si une tâche se termine, arrêter l'autre
                    await request_stop()
                    for task in pending:
                        task.cancel()

                    # Attendre que les tâches annulées se terminent proprement (ignorer CancelledError)
                    if pending:
                        try:
                            await asyncio.gather(*pending, return_exceptions=True)
                        except Exception as gather_exc:
                            logger.debug("Erreur lors de l'attente des tâches annulées: %s", gather_exc)

                    # Vérifier si une des tâches terminées a levé une exception
                    for task in done:
                        try:
                            exc = task.exception()
                            if exc is not None:
                                error = exc
                                logger.error("Erreur dans tâche: %s", error)
                        except asyncio.CancelledError:
                            # Tâche annulée, c'est normal
                            pass

                except Exception as exc:
                    error = exc
                    await request_stop()
                    for task in (audio_task, events_task):
                        if not task.done():
                            task.cancel()

                    # Attendre que les tâches annulées se terminent
                    try:
                        await asyncio.gather(
                            audio_task, events_task, return_exceptions=True
                        )
                    except Exception as gather_exc:
                        logger.debug("Erreur lors de l'attente des tâches annulées: %s", gather_exc)
                # Le context manager ferme automatiquement la session ici, proprement depuis la même tâche
                logger.debug("Session SDK fermée automatiquement par le context manager")
        except Exception as exc:
            error = exc
            logger.error("Session voix Realtime interrompue : %s", exc)
        finally:
            # Close audio recorder and get file paths
            inbound_audio_file = None
            outbound_audio_file = None
            mixed_audio_file = None
            if audio_recorder:
                try:
                    inbound_audio_file, outbound_audio_file, mixed_audio_file = audio_recorder.close()
                    logger.info("Audio recordings closed: inbound=%s, outbound=%s, mixed=%s",
                               inbound_audio_file, outbound_audio_file, mixed_audio_file)
                except Exception as e:
                    logger.error("Failed to close audio recorder: %s", e)

            # Le nettoyage de la session est géré par async with
            # Il nous reste juste à enregistrer les stats
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
