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

        # Counter for send_to_peer calls (for diagnostics)
        self._send_to_peer_call_count = 0

        # PULL-BASED: Queue de frames 8kHz (320B) que PJSUA pull via onFrameRequested
        # Back-pressure: max 15 frames (300ms buffer) pour éviter les bursts
        self._tx_queue: deque[bytes] = deque(maxlen=15)

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

    def get_next_frame(self) -> bytes | None:
        """Get next audio frame for PJSUA to consume (called from onFrameRequested).

        This is called synchronously from PJSUA's audio thread, so we use
        a simple deque.popleft() which is atomic and thread-safe.

        Returns:
            320 bytes PCM16 @ 8kHz, or None if queue empty
        """
        if len(self._tx_queue) > 0:
            return self._tx_queue.popleft()
        return None

    async def send_to_peer(self, audio_24khz: bytes) -> None:
        """Send audio from VoiceBridge to PJSUA (24kHz → 8kHz).

        PULL-BASED APPROACH:
        1. Découpe audio_24khz en frames de 20ms (960B @ 24kHz) AVANT resample
        2. Resample chaque frame individuellement vers 8kHz (320B)
        3. Enfile dans _tx_queue avec back-pressure (max 15 frames)
        4. PJSUA pull directement depuis la queue via onFrameRequested (pas de pacer)

        Args:
            audio_24khz: PCM16 audio at 24kHz from OpenAI
        """
        if len(audio_24khz) == 0:
            return

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
                # Log si on va drop (queue déjà pleine)
                if len(self._tx_queue) >= 15:
                    if frames_enqueued == 0:  # Log seulement une fois par appel
                        logger.warning("⚠️ TX queue pleine (15 frames = 300ms), dropping oldest frames")

                self._tx_queue.append(frame_8khz)
                frames_enqueued += 1

            # Log périodique pour monitoring
            if self._send_to_peer_call_count <= 3 or self._send_to_peer_call_count % 100 == 0:
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
        # Clear TX queue (deque operations are atomic, no lock needed)
        tx_cleared = len(self._tx_queue)
        self._tx_queue.clear()

        # Réinitialiser l'état de resampling pour éviter des artefacts
        self._send_to_peer_state = None

        logger.info("🧹 Audio queue cleared: %d frames", tx_cleared)
        return tx_cleared

    def stop(self) -> None:
        """Stop the audio bridge."""
        logger.info("Stopping PJSUA audio bridge")
        self._stop_event.set()
        self._send_to_peer_state = None

        # Clear TX queue
        self._tx_queue.clear()

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

    # Attacher le bridge au call pour pouvoir y accéder depuis onCallMediaState
    call._audio_bridge = bridge

    # Récupérer l'event frame_requested de l'adaptateur pour savoir quand PJSUA est prêt à consommer
    pjsua_ready_event = call.adapter._frame_requested_event
    return bridge.rtp_stream(media_active_event), bridge.send_to_peer, bridge.clear_audio_queue, bridge.first_packet_received_event, pjsua_ready_event, bridge


__all__ = [
    "PJSUAAudioBridge",
    "create_pjsua_audio_bridge",
]
