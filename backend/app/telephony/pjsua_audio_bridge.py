"""Audio bridge between PJSUA (8kHz) and VoiceBridge (24kHz).

This module handles:
- Audio format conversion (8kHz ↔ 24kHz)
- Interface adaptation (PJSUA queues ↔ RTP stream iterator)
- Bidirectional audio flow management
"""

from __future__ import annotations

import asyncio
import audioop
import logging
import time
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import TYPE_CHECKING, Any

from .voice_bridge import RtpPacket

if TYPE_CHECKING:
    from .pjsua_adapter import PJSUACall

logger = logging.getLogger("chatkit.telephony.pjsua_audio_bridge")


class PJSUAAudioBridge:
    """Bridge audio entre PJSUA (8kHz) et TelephonyVoiceBridge (24kHz)."""

    # Audio format constants
    PJSUA_SAMPLE_RATE = 8000  # Telephony standard
    VOICE_BRIDGE_SAMPLE_RATE = 24000  # OpenAI Realtime API
    BYTES_PER_SAMPLE = 2  # PCM16 = 16-bit = 2 bytes
    CHANNELS = 1  # Mono

    def __init__(self, call: PJSUACall) -> None:
        """Initialize the audio bridge for a specific call.

        Args:
            call: The PJSUA call to bridge audio for
        """
        self._call = call
        self._adapter = call.adapter
        self._stop_event = asyncio.Event()
        self._sequence_number = 0
        self._timestamp = 0

        # Audio buffer for outgoing audio (from VoiceBridge to phone)
        self._outgoing_audio_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=1000)

        # Event qui se déclenche quand on reçoit le premier paquet audio du téléphone
        # Cela confirme que le flux audio bidirectionnel est établi
        self._first_packet_received = asyncio.Event()

        # State used to preserve resampling continuity from 24kHz → 8kHz
        self._send_to_peer_state: Any = None

        # Silence gate to avoid amplifying background noise
        self._silence_threshold = 40

        # Counter for send_to_peer calls (for pacing diagnostics)
        self._send_to_peer_call_count = 0

        # HARD REAL-TIME PACING: Queue de frames 8kHz (320B) prêtes à envoyer
        # Back-pressure: max 15 frames (300ms buffer) pour éviter les bursts
        self._tx_queue: deque[bytes] = deque(maxlen=15)
        self._tx_queue_lock = asyncio.Lock()

        # Task de pacing qui envoie 1 frame toutes les 20ms strict
        self._pacer_task: asyncio.Task | None = None
        self._pacer_frames_sent = 0

    async def rtp_stream(self, media_active_event: asyncio.Event | None = None) -> AsyncIterator[RtpPacket]:
        """Generate RTP packets from PJSUA audio (8kHz → 24kHz).

        This is consumed by TelephonyVoiceBridge.run(rtp_stream=...).
        Reads 8kHz PCM from PJSUA, resamples to 24kHz, and yields RtpPacket.

        Args:
            media_active_event: Event to wait for before starting to yield packets.
                               This prevents capturing noise before media is ready.

        Yields:
            RtpPacket with 24kHz PCM16 audio
        """
        # CRITIQUE: Attendre que le média soit actif avant de commencer à yield
        # Sinon on capture du bruit du jitter buffer non initialisé
        if media_active_event is not None:
            logger.info("⏳ RTP stream: attente que le média soit actif avant de commencer...")
            await media_active_event.wait()
            logger.info("✅ RTP stream: média actif, démarrage de la capture audio")

        logger.info("Starting RTP stream from PJSUA (8kHz → 24kHz)")
        resampling_state = None

        packet_count = 0
        none_count = 0
        try:
            while not self._stop_event.is_set():
                # Get audio from PJSUA (8kHz PCM16 mono)
                audio_8khz = await self._adapter.receive_audio_from_call(self._call)

                if audio_8khz is None:
                    # No audio available, wait a bit
                    none_count += 1
                    await asyncio.sleep(0.01)  # 10ms
                    continue

                if len(audio_8khz) == 0:
                    logger.info("⚠️ Audio reçu mais len=0")
                    continue

                # Calculer l'amplitude pour diagnostic
                max_amplitude = audioop.max(audio_8khz, self.BYTES_PER_SAMPLE)

                # Signaler la réception du premier paquet pour confirmer que le flux est établi
                if packet_count == 0:
                    logger.info("📥 Premier paquet audio reçu du téléphone - flux bidirectionnel confirmé (après %d None)", none_count)
                    self._first_packet_received.set()

                # Log périodiquement pour monitoring
                if packet_count < 5 or packet_count % 500 == 0:
                    logger.debug("📥 RTP stream #%d: reçu %d bytes @ 8kHz depuis PJSUA (max_amplitude=%d)",
                               packet_count, len(audio_8khz), max_amplitude)

                # Resample 8kHz → 24kHz
                try:
                    audio_24khz, resampling_state = audioop.ratecv(
                        audio_8khz,
                        self.BYTES_PER_SAMPLE,
                        self.CHANNELS,
                        self.PJSUA_SAMPLE_RATE,
                        self.VOICE_BRIDGE_SAMPLE_RATE,
                        resampling_state,
                    )

                    if packet_count < 5:
                        logger.info("✅ Rééchantillonné à %d bytes @ 24kHz", len(audio_24khz))
                except audioop.error as e:
                    logger.warning("Resampling error (8kHz→24kHz): %s", e)
                    continue

                # Create RTP packet
                # Note: VoiceBridge will decode this with _decode_packet()
                # Since we're already providing PCM, we use codec "pcm" (input_codec)
                packet = RtpPacket(
                    payload=audio_24khz,
                    timestamp=self._timestamp,
                    sequence_number=self._sequence_number,
                    payload_type=0,  # Standard for PCMU, but we're using PCM
                    marker=False,
                )

                if packet_count < 5:
                    logger.info("📤 Envoi RtpPacket à OpenAI: seq=%d, ts=%d, %d bytes",
                                self._sequence_number, self._timestamp, len(audio_24khz))

                # Update RTP metadata
                # At 24kHz: 20ms = 24000 samples/sec * 0.02 sec = 480 samples
                samples_in_packet = len(audio_24khz) // self.BYTES_PER_SAMPLE
                self._timestamp += samples_in_packet
                self._sequence_number = (self._sequence_number + 1) % 65536

                packet_count += 1
                yield packet

        except asyncio.CancelledError:
            logger.info("RTP stream cancelled")
            raise
        except Exception as e:
            logger.exception("Error in RTP stream: %s", e)
            raise
        finally:
            logger.info("RTP stream ended")

    async def _pacer_loop(self) -> None:
        """Hard real-time pacing loop: envoie 1 frame (320B @ 8kHz) toutes les 20ms strict.

        Utilise time.monotonic() pour garantir un timing précis indépendant des drifts système.
        Stop proprement quand self._stop_event est set.
        """
        logger.info("🚀 Démarrage de la boucle de pacing (1 frame/20ms @ 8kHz)")

        FRAME_DURATION = 0.020  # 20ms entre chaque frame
        next_send_time = time.monotonic()

        try:
            while not self._stop_event.is_set():
                now = time.monotonic()

                # Si on est en retard, rattraper mais sans burst (max 1 frame/tick)
                if now > next_send_time:
                    next_send_time = now

                # Récupérer 1 frame de la queue TX
                frame: bytes | None = None
                async with self._tx_queue_lock:
                    if len(self._tx_queue) > 0:
                        frame = self._tx_queue.popleft()

                if frame is not None:
                    # Envoyer immédiatement vers PJSUA
                    try:
                        self._adapter.send_audio_to_call(self._call, frame)
                        self._pacer_frames_sent += 1

                        # Log périodique (tous les 100 frames = 2 secondes)
                        if self._pacer_frames_sent % 100 == 0:
                            async with self._tx_queue_lock:
                                queue_size = len(self._tx_queue)
                            logger.debug("📤 Pacer: envoyé %d frames (queue: %d frames, %d ms buffered)",
                                       self._pacer_frames_sent, queue_size, queue_size * 20)
                    except Exception as e:
                        logger.warning("Erreur envoi frame vers PJSUA: %s", e)

                # Programmer prochaine deadline
                next_send_time += FRAME_DURATION

                # Sleep jusqu'à la prochaine deadline
                sleep_duration = next_send_time - time.monotonic()
                if sleep_duration > 0:
                    await asyncio.sleep(sleep_duration)
                else:
                    # On est en retard, yield pour éviter de bloquer la loop
                    await asyncio.sleep(0)

        except asyncio.CancelledError:
            logger.info("🛑 Pacer loop cancelled")
            raise
        except Exception as e:
            logger.exception("❌ Erreur dans pacer loop: %s", e)
        finally:
            logger.info("🛑 Pacer loop terminé (frames envoyés: %d)", self._pacer_frames_sent)

    async def send_to_peer(self, audio_24khz: bytes) -> None:
        """Send audio from VoiceBridge to PJSUA (24kHz → 8kHz).

        HARD REAL-TIME APPROACH:
        1. Découpe audio_24khz en frames de 20ms (960B @ 24kHz) AVANT resample
        2. Resample chaque frame individuellement vers 8kHz (320B)
        3. Enfile dans _tx_queue avec back-pressure (max 15 frames)
        4. La pacer loop (_pacer_loop) envoie 1 frame/20ms strict

        Args:
            audio_24khz: PCM16 audio at 24kHz from OpenAI
        """
        if len(audio_24khz) == 0:
            return

        # Démarrer la pacer task si pas déjà lancée
        if self._pacer_task is None or self._pacer_task.done():
            self._pacer_task = asyncio.create_task(self._pacer_loop())
            logger.info("🚀 Pacer task créée")

        self._send_to_peer_call_count += 1

        # Log moins verbeux: tous les 100 appels au lieu de 5
        if self._send_to_peer_call_count <= 3 or self._send_to_peer_call_count % 100 == 0:
            logger.info("📤 send_to_peer #%d: reçu %d bytes @ 24kHz",
                       self._send_to_peer_call_count, len(audio_24khz))

        # ÉTAPE 1: Découper en frames de 20ms @ 24kHz (960 bytes)
        # 20ms @ 24kHz = 24000 samples/sec × 0.020 sec = 480 samples × 2 bytes = 960 bytes
        FRAME_SIZE_24KHZ = 960
        frames_enqueued = 0

        try:
            for i in range(0, len(audio_24khz), FRAME_SIZE_24KHZ):
                frame_24khz = audio_24khz[i:i + FRAME_SIZE_24KHZ]

                # Si frame incomplète, skip (on ne veut que des frames complètes de 20ms)
                if len(frame_24khz) < FRAME_SIZE_24KHZ:
                    if self._send_to_peer_call_count <= 3:
                        logger.debug("⚠️ Frame incomplète ignorée: %d bytes", len(frame_24khz))
                    continue

                # ÉTAPE 2: Resample cette frame vers 8kHz (320 bytes)
                try:
                    frame_8khz, self._send_to_peer_state = audioop.ratecv(
                        frame_24khz,
                        self.BYTES_PER_SAMPLE,
                        self.CHANNELS,
                        self.VOICE_BRIDGE_SAMPLE_RATE,
                        self.PJSUA_SAMPLE_RATE,
                        self._send_to_peer_state,
                    )
                except audioop.error as e:
                    logger.warning("Resampling error (24kHz→8kHz): %s", e)
                    self._send_to_peer_state = None
                    continue

                # ÉTAPE 3: Amplification dynamique pour garantir audibilité
                try:
                    max_amplitude = audioop.max(frame_8khz, self.BYTES_PER_SAMPLE)
                    if max_amplitude == 0:
                        # Silence complet
                        frame_8khz = bytes(len(frame_8khz))
                    else:
                        # Boost si amplitude trop faible
                        min_target_amplitude = 6000
                        max_gain = 12.0
                        if max_amplitude < min_target_amplitude:
                            gain = min(min_target_amplitude / max_amplitude, max_gain)
                            try:
                                frame_8khz = audioop.mul(frame_8khz, self.BYTES_PER_SAMPLE, gain)
                            except audioop.error:
                                pass  # Garder l'audio original si overflow
                except audioop.error as e:
                    logger.warning("Audio processing error: %s", e)

                # ÉTAPE 4: Ajouter à la queue TX avec back-pressure
                # Si queue pleine (15 frames), deque drop automatiquement le plus vieux (maxlen=15)
                async with self._tx_queue_lock:
                    # Log si on va drop (queue déjà pleine)
                    if len(self._tx_queue) >= 15:
                        if frames_enqueued == 0:  # Log seulement une fois par appel
                            logger.warning("⚠️ TX queue pleine (15 frames = 300ms), dropping oldest frames")

                    self._tx_queue.append(frame_8khz)
                    frames_enqueued += 1

            # Log périodique pour monitoring
            if self._send_to_peer_call_count <= 3 or self._send_to_peer_call_count % 100 == 0:
                async with self._tx_queue_lock:
                    queue_size = len(self._tx_queue)
                logger.info("✅ send_to_peer #%d: %d frames enfilées (queue: %d frames, %d ms buffered)",
                           self._send_to_peer_call_count, frames_enqueued, queue_size, queue_size * 20)

        except Exception as e:
            logger.warning("Failed to process audio: %s", e)

    def clear_audio_queue(self) -> int:
        """Clear the outgoing audio queue (used during interruptions).

        Returns:
            Number of frames cleared
        """
        # Clear adapter queue
        cleared = self._adapter.clear_call_audio_queue(self._call)

        # Clear TX queue (synchronously - we're in sync context)
        # Use asyncio.run_coroutine_threadsafe if called from sync thread
        try:
            loop = asyncio.get_running_loop()
            # Dans async context
            async def _clear():
                async with self._tx_queue_lock:
                    tx_cleared = len(self._tx_queue)
                    self._tx_queue.clear()
                    return tx_cleared
            # Schedule and wait
            future = asyncio.ensure_future(_clear())
            tx_cleared = loop.run_until_complete(future)
            cleared += tx_cleared
        except RuntimeError:
            # Pas de loop running, on est dans un contexte sync
            # Clear directement (pas de lock nécessaire)
            tx_cleared = len(self._tx_queue)
            self._tx_queue.clear()
            cleared += tx_cleared

        # Réinitialiser l'état de resampling pour éviter des artefacts
        self._send_to_peer_state = None

        logger.info("🧹 Audio queue cleared: %d frames", cleared)
        return cleared

    def stop(self) -> None:
        """Stop the audio bridge and pacer task."""
        logger.info("Stopping PJSUA audio bridge")
        self._stop_event.set()
        self._send_to_peer_state = None

        # Cancel pacer task si elle tourne
        if self._pacer_task is not None and not self._pacer_task.done():
            self._pacer_task.cancel()
            logger.info("🛑 Pacer task cancelled")

    @property
    def is_stopped(self) -> bool:
        """Check if the bridge has been stopped."""
        return self._stop_event.is_set()

    @property
    def first_packet_received_event(self) -> asyncio.Event:
        """Event qui se déclenche quand le premier paquet audio du téléphone est reçu."""
        return self._first_packet_received


async def create_pjsua_audio_bridge(
    call: PJSUACall,
    media_active_event: asyncio.Event | None = None,
) -> tuple[AsyncIterator[RtpPacket], Callable[[bytes], Awaitable[None]], Callable[[], int], asyncio.Event, asyncio.Event, "PJSUAAudioBridge"]:
    """Create audio bridge components for a PJSUA call.

    This is a convenience function that creates a bridge and returns the
    rtp_stream, send_to_peer, clear_queue, first_packet_received_event, pjsua_ready_event, and bridge instance for TelephonyVoiceBridge.run().

    Args:
        call: The PJSUA call to bridge
        media_active_event: Optional event that the RTP stream will wait for before yielding packets.
                           This prevents capturing noise before media is ready.

    Returns:
        Tuple of (rtp_stream, send_to_peer, clear_queue, first_packet_received_event, pjsua_ready_event, bridge) for VoiceBridge.run()

    Example:
        ```python
        media_active = asyncio.Event()
        rtp_stream, send_to_peer, clear_queue, first_packet_event, pjsua_ready_event, bridge = await create_pjsua_audio_bridge(call, media_active)

        # Attendre que PJSUA soit prêt à consommer l'audio avant speak_first
        await pjsua_ready_event.wait()

        stats = await voice_bridge.run(
            runner=runner,
            client_secret=secret,
            model=model,
            instructions=instructions,
            voice=voice,
            rtp_stream=rtp_stream,
            send_to_peer=send_to_peer,
            clear_audio_queue=clear_queue,
            pjsua_ready_to_consume=pjsua_ready_event,
        )

        # Nettoyer quand l'appel se termine
        bridge.stop()
        ```
    """
    bridge = PJSUAAudioBridge(call)
    # Récupérer l'event frame_requested de l'adaptateur pour savoir quand PJSUA est prêt à consommer
    pjsua_ready_event = call.adapter._frame_requested_event
    return bridge.rtp_stream(media_active_event), bridge.send_to_peer, bridge.clear_audio_queue, bridge.first_packet_received_event, pjsua_ready_event, bridge


__all__ = [
    "PJSUAAudioBridge",
    "create_pjsua_audio_bridge",
]
