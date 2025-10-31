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
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import TYPE_CHECKING

from .voice_bridge import RtpPacket

if TYPE_CHECKING:
    from .pjsua_adapter import PJSUACall

logger = logging.getLogger("chatkit.telephony.pjsua_audio_bridge")
logger.setLevel(logging.DEBUG)  # Force DEBUG pour diagnostiquer l'audio


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
        self._outgoing_audio_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=100)

        # Event qui se déclenche quand on reçoit le premier paquet audio du téléphone
        # Cela confirme que le flux audio bidirectionnel est établi
        self._first_packet_received = asyncio.Event()

    async def rtp_stream(self) -> AsyncIterator[RtpPacket]:
        """Generate RTP packets from PJSUA audio (8kHz → 24kHz).

        This is consumed by TelephonyVoiceBridge.run(rtp_stream=...).
        Reads 8kHz PCM from PJSUA, resamples to 24kHz, and yields RtpPacket.

        Yields:
            RtpPacket with 24kHz PCM16 audio
        """
        logger.info("Starting RTP stream from PJSUA (8kHz → 24kHz)")
        resampling_state = None

        packet_count = 0
        try:
            while not self._stop_event.is_set():
                # Get audio from PJSUA (8kHz PCM16 mono)
                audio_8khz = await self._adapter.receive_audio_from_call(self._call)

                if audio_8khz is None:
                    # No audio available, wait a bit
                    await asyncio.sleep(0.01)  # 10ms
                    continue

                if len(audio_8khz) == 0:
                    continue

                # Signaler la réception du premier paquet pour confirmer que le flux est établi
                if packet_count == 0:
                    logger.info("📥 Premier paquet audio reçu du téléphone - flux bidirectionnel confirmé")
                    self._first_packet_received.set()

                # Log first few packets for diagnostics
                if packet_count < 5:
                    logger.debug("📥 RTP stream: reçu %d bytes @ 8kHz depuis PJSUA", len(audio_8khz))

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
                        logger.debug("✅ Rééchantillonné à %d bytes @ 24kHz", len(audio_24khz))
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
                    logger.debug("📤 Envoi RtpPacket à OpenAI: seq=%d, ts=%d, %d bytes",
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

    async def send_to_peer(self, audio_24khz: bytes) -> None:
        """Send audio from VoiceBridge to PJSUA (24kHz → 8kHz).

        This is the callback passed to TelephonyVoiceBridge.run(send_to_peer=...).
        Receives 24kHz PCM from OpenAI, resamples to 8kHz, and sends to PJSUA.

        Args:
            audio_24khz: PCM16 audio at 24kHz from OpenAI
        """
        if len(audio_24khz) == 0:
            return

        logger.debug("🔊 send_to_peer reçu %d bytes @ 24kHz depuis OpenAI", len(audio_24khz))

        # Resample 24kHz → 8kHz
        try:
            # Note: ratecv maintains state for better quality, but for send_to_peer
            # we get called with arbitrary chunks, so we can't maintain state easily.
            # Using None for state means each chunk is resampled independently.
            audio_8khz, _ = audioop.ratecv(
                audio_24khz,
                self.BYTES_PER_SAMPLE,
                self.CHANNELS,
                self.VOICE_BRIDGE_SAMPLE_RATE,
                self.PJSUA_SAMPLE_RATE,
                None,  # No state - each chunk is independent
            )
            logger.debug("✅ Resamplé à %d bytes @ 8kHz", len(audio_8khz))
        except audioop.error as e:
            logger.warning("Resampling error (24kHz→8kHz): %s", e)
            return

        # AMPLIFY audio because OpenAI sends very low amplitude audio
        # that gets treated as silence by PJSUA/PCMU codec
        # Gain factor of 3.0 (increase volume by 3x) - conservative to avoid clipping
        try:
            audio_8khz = audioop.mul(audio_8khz, self.BYTES_PER_SAMPLE, 3.0)
            logger.debug("🔊 Audio amplifié (gain=3.0x)")
        except audioop.error as e:
            logger.warning("Amplification error: %s", e)
            return

        # Send to PJSUA in chunks of 320 bytes (20ms @ 8kHz, 16-bit, mono)
        # PJSUA expects 160 samples/frame × 2 bytes/sample = 320 bytes
        chunk_size = 320
        try:
            for i in range(0, len(audio_8khz), chunk_size):
                chunk = audio_8khz[i:i + chunk_size]
                self._adapter.send_audio_to_call(self._call, chunk)
                logger.debug("📤 Chunk %d bytes envoyé vers PJSUA queue", len(chunk))
        except Exception as e:
            logger.warning("Failed to send audio to PJSUA: %s", e)

    def clear_audio_queue(self) -> int:
        """Clear the outgoing audio queue (used during interruptions).

        Returns:
            Number of frames cleared
        """
        return self._adapter.clear_call_audio_queue(self._call)

    def stop(self) -> None:
        """Stop the audio bridge."""
        logger.info("Stopping PJSUA audio bridge")
        self._stop_event.set()

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
) -> tuple[AsyncIterator[RtpPacket], Callable[[bytes], Awaitable[None]], Callable[[], int], asyncio.Event, "PJSUAAudioBridge"]:
    """Create audio bridge components for a PJSUA call.

    This is a convenience function that creates a bridge and returns the
    rtp_stream, send_to_peer, clear_queue, first_packet_received_event, and bridge instance for TelephonyVoiceBridge.run().

    Args:
        call: The PJSUA call to bridge

    Returns:
        Tuple of (rtp_stream, send_to_peer, clear_queue, first_packet_received_event, bridge) for VoiceBridge.run()

    Example:
        ```python
        rtp_stream, send_to_peer, clear_queue, first_packet_event, bridge = await create_pjsua_audio_bridge(call)

        # Attendre le premier paquet pour confirmer que le flux est établi
        await first_packet_event.wait()

        stats = await voice_bridge.run(
            runner=runner,
            client_secret=secret,
            model=model,
            instructions=instructions,
            voice=voice,
            rtp_stream=rtp_stream,
            send_to_peer=send_to_peer,
            clear_audio_queue=clear_queue,
        )

        # Nettoyer quand l'appel se termine
        bridge.stop()
        ```
    """
    bridge = PJSUAAudioBridge(call)
    return bridge.rtp_stream(), bridge.send_to_peer, bridge.clear_audio_queue, bridge.first_packet_received_event, bridge


__all__ = [
    "PJSUAAudioBridge",
    "create_pjsua_audio_bridge",
]
