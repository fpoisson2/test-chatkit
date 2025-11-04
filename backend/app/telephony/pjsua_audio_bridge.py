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
from typing import TYPE_CHECKING, Any

from .voice_bridge import RtpPacket

if TYPE_CHECKING:
    from .pjsua_adapter import PJSUACall

logger = logging.getLogger("chatkit.telephony.pjsua_audio_bridge")


class PJSUAAudioBridge:
    """Bridge audio entre PJSUA (8kHz) et TelephonyVoiceBridge (16kHz)."""

    # Audio format constants
    PJSUA_SAMPLE_RATE = 8000  # Telephony standard
    VOICE_BRIDGE_SAMPLE_RATE = 16000  # 16kHz pour ratio exact 2x avec 8kHz
    BYTES_PER_SAMPLE = 2  # PCM16 = 16-bit = 2 bytes
    CHANNELS = 1  # Mono

    # Frame sizes at 20ms intervals
    # 8kHz:  160 samples = 320 bytes
    # 16kHz: 320 samples = 640 bytes (exact 2x ratio)
    EXPECTED_FRAME_SIZE_8KHZ = 320
    EXPECTED_FRAME_SIZE_16KHZ = 640

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
        # CRITIQUE: Limité à 8 frames max (160ms) pour éviter accumulation de latence
        # Si queue pleine, les silences seront droppés en premier (TODO)
        self._outgoing_audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue(
            maxsize=8
        )

        # Event qui se déclenche quand on reçoit le premier paquet audio du téléphone
        # Cela confirme que le flux audio bidirectionnel est établi
        self._first_packet_received = asyncio.Event()

        # State used to preserve resampling continuity from 24kHz → 8kHz
        self._send_to_peer_state: Any = None

        # Counter for send_to_peer calls (for pacing diagnostics)
        self._send_to_peer_call_count = 0

        # Background task responsible for pacing audio sent to PJSUA
        loop = asyncio.get_running_loop()
        self._audio_sender_task: asyncio.Task[None] | None = loop.create_task(
            self._audio_sender_loop(),
            name="pjsua-audio-sender",
        )

    async def rtp_stream(
        self,
        media_active_event: asyncio.Event | None = None,
    ) -> AsyncIterator[RtpPacket]:
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
            logger.info(
                "⏳ RTP stream: attente que le média soit actif avant de commencer..."
            )
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

                # Signaler la réception du premier paquet pour confirmer que le flux
                # est établi
                if packet_count == 0:
                    logger.info(
                        "📥 Premier paquet audio reçu - flux confirmé (%d None avant)",
                        none_count,
                    )
                    self._first_packet_received.set()

                # Log périodiquement pour monitoring
                if packet_count < 5 or packet_count % 500 == 0:
                    logger.debug(
                        "📥 RTP stream #%d: reçu %d bytes @ 8kHz depuis PJSUA "
                        "(max_amplitude=%d)",
                        packet_count,
                        len(audio_8khz),
                        max_amplitude,
                    )

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
                        logger.info(
                            "✅ Rééchantillonné %d→%d bytes (8kHz→16kHz), ratio=2x exact",
                            len(audio_8khz),
                            len(audio_24khz),
                        )
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
                    logger.info(
                        "📤 Envoi RtpPacket à OpenAI: seq=%d, ts=%d, %d bytes",
                        self._sequence_number,
                        self._timestamp,
                        len(audio_24khz),
                    )

                # Update RTP metadata
                # At 16kHz: 20ms = 16000 samples/sec * 0.02 sec = 320 samples = 640 bytes
                # Timestamp MUST increment by exact 320 samples per frame for proper RTP timing
                SAMPLES_PER_FRAME_16KHZ = 320
                self._timestamp += SAMPLES_PER_FRAME_16KHZ
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

    async def send_to_peer(self, audio_16khz: bytes) -> None:
        """Send audio from VoiceBridge to PJSUA (16kHz → 8kHz).

        This is the callback passed to TelephonyVoiceBridge.run(send_to_peer=...).
        Receives 16kHz PCM from OpenAI, resamples to 8kHz, and sends to PJSUA.

        Args:
            audio_16khz: PCM16 audio at 16kHz from OpenAI (640 bytes per 20ms frame)
        """
        if len(audio_16khz) == 0:
            return

        self._send_to_peer_call_count += 1
        if self._send_to_peer_call_count <= 5:
            logger.info(
                "📤 send_to_peer #%d appelé avec %d bytes @ 16kHz (cadençage activé, expect 640)",
                self._send_to_peer_call_count,
                len(audio_16khz),
            )
        else:
            logger.debug(
                "📤 send_to_peer appelé avec %d bytes @ 16kHz",
                len(audio_16khz),
            )

        # Resample 16kHz → 8kHz (exact 2x downsampling)
        try:
            # ratecv renvoie également un état qui permet de préserver la
            # continuité entre les chunks. On le conserve pour réduire les
            # artefacts de rééchantillonnage sur les longs flux audio.
            audio_8khz, self._send_to_peer_state = audioop.ratecv(
                audio_16khz,
                self.BYTES_PER_SAMPLE,
                self.CHANNELS,
                self.VOICE_BRIDGE_SAMPLE_RATE,
                self.PJSUA_SAMPLE_RATE,
                self._send_to_peer_state,
            )
        except audioop.error as e:
            logger.warning("Resampling error (16kHz→8kHz): %s", e)
            self._send_to_peer_state = None
            return

        # Amplification dynamique pour garantir une amplitude minimale audible
        # OpenAI envoie parfois un audio très faible (amplitude ~7) qui est inaudible
        try:
            max_amplitude = audioop.max(audio_8khz, self.BYTES_PER_SAMPLE)
            if max_amplitude > 0:
                # Garantir une amplitude minimale audible
                min_target_amplitude = 1800
                if max_amplitude < min_target_amplitude:
                    gain = min_target_amplitude / max_amplitude
                    audio_8khz = audioop.mul(audio_8khz, self.BYTES_PER_SAMPLE, gain)
        except audioop.error as e:
            logger.warning("Audio processing error: %s", e)

        # Send to PJSUA in chunks of 320 bytes (20ms @ 8kHz, 16-bit, mono)
        # PJSUA expects 160 samples/frame × 2 bytes/sample = 320 bytes
        # Cadencing is handled by a background task to avoid blocking the caller
        chunk_size = 320
        chunks_sent = 0
        try:
            for i in range(0, len(audio_8khz), chunk_size):
                chunk = audio_8khz[i:i + chunk_size]
                await self._outgoing_audio_queue.put(chunk)
                chunks_sent += 1

            # Calculate total pacing duration for monitoring (20ms per chunk)
            pacing_duration_ms = chunks_sent * 20
            if self._send_to_peer_call_count <= 5:
                logger.info(
                    "✅ send_to_peer #%d: Enqueued %d chunks @ 8kHz vers PJSUA "
                    "(total: %d bytes, cadencé sur %d ms)",
                    self._send_to_peer_call_count,
                    chunks_sent,
                    len(audio_8khz),
                    pacing_duration_ms,
                )
            else:
                logger.debug(
                    "✅ Enqueued %d chunks @ 8kHz vers PJSUA (%d bytes, cadence %d ms)",
                    chunks_sent,
                    len(audio_8khz),
                    pacing_duration_ms,
                )
        except Exception as e:
            logger.warning("Failed to send audio to PJSUA: %s", e)

    def clear_audio_queue(self) -> int:
        """Clear the outgoing audio queue (used during interruptions).

        Returns:
            Number of frames cleared
        """
        cleared = self._adapter.clear_call_audio_queue(self._call)

        # Vider également la file d'attente utilisée pour le pacing asynchrone
        drained = 0
        while not self._outgoing_audio_queue.empty():
            try:
                self._outgoing_audio_queue.get_nowait()
                self._outgoing_audio_queue.task_done()
                drained += 1
            except asyncio.QueueEmpty:  # pragma: no cover - race condition
                break

        if drained:
            logger.debug("Cleared %d pending chunks from pacing queue", drained)

        # Réinitialiser l'état de resampling pour éviter des artefacts
        self._send_to_peer_state = None
        return cleared + drained

    def stop(self) -> None:
        """Stop the audio bridge."""
        logger.info("Stopping PJSUA audio bridge")
        self._stop_event.set()
        if self._audio_sender_task and not self._audio_sender_task.done():
            self._audio_sender_task.cancel()
        try:
            self._outgoing_audio_queue.put_nowait(None)
        except asyncio.QueueFull:
            pass
        self._send_to_peer_state = None

    async def _audio_sender_loop(self) -> None:
        """Background task responsible for pacing audio frames sent to PJSUA."""
        pacing_interval = 0.020  # 20ms between frames
        loop = asyncio.get_running_loop()
        next_send_time: float | None = None
        try:
            while True:
                chunk = await self._outgoing_audio_queue.get()
                if chunk is None:
                    self._outgoing_audio_queue.task_done()
                    break

                now = loop.time()
                if next_send_time is None:
                    next_send_time = now
                else:
                    # Si on a été inactif (ou très en retard), repartir de
                    # maintenant
                    if now - next_send_time > pacing_interval:
                        next_send_time = now

                sleep_for = next_send_time - now
                if sleep_for > 0:
                    await asyncio.sleep(sleep_for)
                    now = loop.time()

                try:
                    self._adapter.send_audio_to_call(self._call, chunk)
                finally:
                    self._outgoing_audio_queue.task_done()

                backlog = self._outgoing_audio_queue.qsize()
                if backlog == 0:
                    next_send_time = loop.time() + pacing_interval
                else:
                    next_send_time = loop.time()
                    await asyncio.sleep(0)
        except asyncio.CancelledError:
            logger.debug("Audio sender task cancelled")
            raise
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.exception("Error while pacing audio towards PJSUA: %s", exc)
        finally:
            while not self._outgoing_audio_queue.empty():
                try:
                    item = self._outgoing_audio_queue.get_nowait()
                except asyncio.QueueEmpty:  # pragma: no cover - race condition
                    break
                else:
                    self._outgoing_audio_queue.task_done()
                    if item is None:
                        continue
            logger.debug("Audio sender task terminated")

    @property
    def is_stopped(self) -> bool:
        """Check if the bridge has been stopped."""
        return self._stop_event.is_set()

    @property
    def first_packet_received_event(self) -> asyncio.Event:
        """Event déclenché quand le premier paquet audio du téléphone arrive."""
        return self._first_packet_received


async def create_pjsua_audio_bridge(
    call: PJSUACall,
    media_active_event: asyncio.Event | None = None,
) -> tuple[
    AsyncIterator[RtpPacket],
    Callable[[bytes], Awaitable[None]],
    Callable[[], int],
    asyncio.Event,
    asyncio.Event,
    PJSUAAudioBridge,
]:
    """Create audio bridge components for a PJSUA call.

    This convenience helper instantiates a bridge and returns the
    rtp_stream, send_to_peer, clear_queue, first_packet_received_event,
    pjsua_ready_event, and bridge instance for TelephonyVoiceBridge.run().

    Args:
        call: The PJSUA call to bridge
        media_active_event: Optional event that the RTP stream waits for
            before yielding packets. This prevents capturing noise before
            media is ready.

    Returns:
        Tuple containing:
            - rtp_stream generator consumed by VoiceBridge
            - send_to_peer coroutine callback
            - clear_queue callable for pending frames
            - first_packet_received_event signaling first RTP frame
            - pjsua_ready_event signaling when onFrameRequested fires
            - bridge instance for lifecycle management

    Example:
        ```python
        media_active = asyncio.Event()
        (
            rtp_stream,
            send_to_peer,
            clear_queue,
            first_packet_event,
            pjsua_ready_event,
            bridge,
        ) = await create_pjsua_audio_bridge(call, media_active)

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
    # Récupérer l'event frame_requested de CET appel (pas de l'adaptateur
    # global). Chaque appel a son propre event pour éviter les problèmes de
    # timing sur les appels successifs.
    pjsua_ready_event = call._frame_requested_event
    return (
        bridge.rtp_stream(media_active_event),
        bridge.send_to_peer,
        bridge.clear_audio_queue,
        bridge.first_packet_received_event,
        pjsua_ready_event,
        bridge,
    )


__all__ = [
    "PJSUAAudioBridge",
    "create_pjsua_audio_bridge",
]
