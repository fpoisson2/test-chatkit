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
    """Bridge audio entre PJSUA (8kHz) et TelephonyVoiceBridge (24kHz)."""

    # Audio format constants
    PJSUA_SAMPLE_RATE = 8000  # Telephony standard
    VOICE_BRIDGE_SAMPLE_RATE = 24000  # OpenAI Realtime API requires 24kHz
    BYTES_PER_SAMPLE = 2  # PCM16 = 16-bit = 2 bytes
    CHANNELS = 1  # Mono

    # Frame sizes at 20ms intervals
    # 8kHz:  160 samples = 320 bytes
    # 24kHz: 480 samples = 960 bytes (exact 3x ratio)
    # CRITIQUE: API OpenAI exige exactement 960 bytes par frame 20ms
    EXPECTED_FRAME_SIZE_8KHZ = 320
    EXPECTED_FRAME_SIZE_24KHZ = 960
    SAMPLES_PER_FRAME_24KHZ = 480

    # Burst control: limite l'enqueue à 3 frames max par tick
    # 3 frames @ 8kHz = 3×320 bytes = 960 bytes = 60ms de latence max par burst
    MAX_CHUNKS_PER_TICK = 3

    # Queue watermarks pour monitoring et drop de silence
    # Si queue > HIGH_WATERMARK (8 chunks = 160ms), dropper le silence
    # Si queue < LOW_WATERMARK (3 chunks = 60ms), mode normal
    HIGH_WATERMARK = 8
    LOW_WATERMARK = 3
    MAX_QUEUE_SIZE = 10  # Limite absolue avant drop forcé

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
        # CRITIQUE: Limité à MAX_QUEUE_SIZE (10 frames = 200ms) pour éviter accumulation de latence
        # Si queue > HIGH_WATERMARK, les silences seront droppés en premier
        self._outgoing_audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue(
            maxsize=self.MAX_QUEUE_SIZE
        )

        # Event qui se déclenche quand on reçoit le premier paquet audio du téléphone
        # Cela confirme que le flux audio bidirectionnel est établi
        self._first_packet_received = asyncio.Event()

        # Queue watermark tracking
        self._queue_high_watermark_logged = False
        self._queue_low_watermark_logged = False

        # State used to preserve resampling continuity from 24kHz → 8kHz
        self._send_to_peer_state: Any = None

        # Remainder buffer for 24kHz → 8kHz downsampling
        # Accumule les bytes fractionnaires entre frames pour éviter padding/truncation
        self._downsample_remainder = b""

        # Remainder buffer for 8kHz → 24kHz upsampling
        # Accumule les bytes fractionnaires entre frames pour éviter padding/truncation
        # Exemple: ratecv produit 956 bytes au lieu de 960 → on accumule jusqu'à 960+
        self._upsample_remainder = b""

        # State used to preserve resampling continuity from 8kHz → 24kHz
        self._upsample_state: Any = None

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

                # Resample 8kHz → 24kHz avec accumulation fractionnaire
                # CRITIQUE: Ne pas padder/truncate chaque frame individuellement
                # Au lieu de ça, accumuler dans _upsample_remainder jusqu'à avoir >= 960 bytes
                try:
                    resampled, self._upsample_state = audioop.ratecv(
                        audio_8khz,
                        self.BYTES_PER_SAMPLE,
                        self.CHANNELS,
                        self.PJSUA_SAMPLE_RATE,
                        self.VOICE_BRIDGE_SAMPLE_RATE,
                        self._upsample_state,
                    )

                    # Accumuler dans le buffer remainder
                    self._upsample_remainder += resampled

                    # Si on n'a pas encore 960 bytes, continuer à accumuler (skip cette frame)
                    if len(self._upsample_remainder) < self.EXPECTED_FRAME_SIZE_24KHZ:
                        if packet_count < 5:
                            logger.info(
                                "📊 Accumulation: resampled=%d bytes, buffer=%d bytes (attente de 960)",
                                len(resampled),
                                len(self._upsample_remainder),
                            )
                        continue

                    # Découper exactement 960 bytes depuis le buffer
                    audio_24khz = self._upsample_remainder[:self.EXPECTED_FRAME_SIZE_24KHZ]
                    self._upsample_remainder = self._upsample_remainder[self.EXPECTED_FRAME_SIZE_24KHZ:]

                    if packet_count < 5:
                        logger.info(
                            "✅ Frame 24kHz extraite: 960 bytes, remainder=%d bytes (pas de padding!)",
                            len(self._upsample_remainder),
                        )

                except audioop.error as e:
                    logger.warning("Resampling error (8kHz→24kHz): %s", e)
                    # Reset le buffer en cas d'erreur pour éviter accumulation de corruption
                    self._upsample_remainder = b""
                    self._upsample_state = None
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
                # At 24kHz: 20ms = 24000 samples/sec * 0.02 sec = 480 samples = 960 bytes
                # Timestamp MUST increment by exact 480 samples per frame for proper RTP timing
                self._timestamp += self.SAMPLES_PER_FRAME_24KHZ
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
            audio_24khz: PCM16 audio at 24kHz from OpenAI (960 bytes per 20ms frame)
        """
        if len(audio_24khz) == 0:
            return

        self._send_to_peer_call_count += 1
        if self._send_to_peer_call_count <= 5:
            logger.info(
                "📤 send_to_peer #%d appelé avec %d bytes @ 24kHz (cadençage activé, expect 960)",
                self._send_to_peer_call_count,
                len(audio_24khz),
            )
        else:
            logger.debug(
                "📤 send_to_peer appelé avec %d bytes @ 24kHz",
                len(audio_24khz),
            )

        # Resample 24kHz → 8kHz (3x downsampling) avec accumulation fractionnaire
        try:
            # ratecv renvoie également un état qui permet de préserver la
            # continuité entre les chunks. On le conserve pour réduire les
            # artefacts de rééchantillonnage sur les longs flux audio.
            resampled, self._send_to_peer_state = audioop.ratecv(
                audio_24khz,
                self.BYTES_PER_SAMPLE,
                self.CHANNELS,
                self.VOICE_BRIDGE_SAMPLE_RATE,
                self.PJSUA_SAMPLE_RATE,
                self._send_to_peer_state,
            )

            # Accumuler dans le buffer remainder
            self._downsample_remainder += resampled

        except audioop.error as e:
            logger.warning("Resampling error (24kHz→8kHz): %s", e)
            self._send_to_peer_state = None
            self._downsample_remainder = b""
            return

        # Découper en chunks de exactement 320 bytes depuis le buffer
        # PJSUA expects 160 samples/frame × 2 bytes/sample = 320 bytes
        # Cadencing is handled by a background task to avoid blocking the caller
        chunk_size = self.EXPECTED_FRAME_SIZE_8KHZ  # 320 bytes
        chunks_sent = 0
        chunks_dropped = 0

        # Extraire MAX_CHUNKS_PER_TICK (3) chunks max par tick pour éviter les bursts
        # Si OpenAI envoie 12kB d'un coup, on limite à 3×320=960 bytes (60ms) par tick
        try:
            while len(self._downsample_remainder) >= chunk_size and chunks_sent < self.MAX_CHUNKS_PER_TICK:
                # Vérifier l'état de la queue AVANT d'enqueuer
                queue_size = self._outgoing_audio_queue.qsize()

                # Watermark monitoring
                if queue_size >= self.HIGH_WATERMARK and not self._queue_high_watermark_logged:
                    logger.warning(
                        "⚠️ Queue audio haute (>= %d chunks = %d ms) - risque de latence",
                        self.HIGH_WATERMARK,
                        self.HIGH_WATERMARK * 20,
                    )
                    self._queue_high_watermark_logged = True
                    self._queue_low_watermark_logged = False
                elif queue_size < self.LOW_WATERMARK and not self._queue_low_watermark_logged:
                    if self._queue_high_watermark_logged:  # Seulement log si on était haut avant
                        logger.info("✅ Queue audio normale (< %d chunks)", self.LOW_WATERMARK)
                    self._queue_low_watermark_logged = True
                    self._queue_high_watermark_logged = False

                # Extraire exactement 320 bytes
                chunk = self._downsample_remainder[:chunk_size]
                self._downsample_remainder = self._downsample_remainder[chunk_size:]

                # Amplification dynamique pour garantir une amplitude minimale audible
                # OpenAI envoie parfois un audio très faible (amplitude ~7) qui est inaudible
                max_amplitude = 0
                try:
                    max_amplitude = audioop.max(chunk, self.BYTES_PER_SAMPLE)
                    if max_amplitude > 0:
                        # Garantir une amplitude minimale audible
                        min_target_amplitude = 1800
                        if max_amplitude < min_target_amplitude:
                            gain = min_target_amplitude / max_amplitude
                            chunk = audioop.mul(chunk, self.BYTES_PER_SAMPLE, gain)
                            # Recalculer max_amplitude après amplification
                            max_amplitude = audioop.max(chunk, self.BYTES_PER_SAMPLE)
                except audioop.error as e:
                    logger.warning("Audio processing error: %s", e)

                # Drop de silence si la queue est trop pleine (>= HIGH_WATERMARK)
                # Silence = max_amplitude très faible (< 100)
                is_silence = max_amplitude < 100
                if queue_size >= self.HIGH_WATERMARK and is_silence:
                    chunks_dropped += 1
                    if chunks_dropped <= 3:
                        logger.debug(
                            "🗑️ Drop silence (queue=%d/%d, amplitude=%d)",
                            queue_size,
                            self.MAX_QUEUE_SIZE,
                            max_amplitude,
                        )
                    continue  # Skip l'enqueue de ce chunk silencieux

                # Enqueue le chunk (avec try/except pour gérer QueueFull)
                try:
                    self._outgoing_audio_queue.put_nowait(chunk)
                    chunks_sent += 1
                except asyncio.QueueFull:
                    # Queue pleine: si c'est du silence, dropper; sinon logger warning
                    if is_silence:
                        chunks_dropped += 1
                        logger.debug("🗑️ Queue pleine - drop silence")
                    else:
                        logger.warning("⚠️ Queue pleine - audio NON-SILENCE perdu!")
                        chunks_dropped += 1

            # Calculate total pacing duration for monitoring (20ms per chunk)
            pacing_duration_ms = chunks_sent * 20
            if self._send_to_peer_call_count <= 5 or chunks_dropped > 0:
                logger.info(
                    "✅ send_to_peer #%d: Enqueued %d chunks (dropped %d silence) @ 8kHz vers PJSUA "
                    "(resampled=%d bytes, buffer_remainder=%d bytes, queue=%d/%d, cadencé sur %d ms)",
                    self._send_to_peer_call_count,
                    chunks_sent,
                    chunks_dropped,
                    len(resampled),
                    len(self._downsample_remainder),
                    self._outgoing_audio_queue.qsize(),
                    self.MAX_QUEUE_SIZE,
                    pacing_duration_ms,
                )
            else:
                logger.debug(
                    "✅ Enqueued %d chunks @ 8kHz vers PJSUA (queue=%d/%d, remainder=%d bytes)",
                    chunks_sent,
                    self._outgoing_audio_queue.qsize(),
                    self.MAX_QUEUE_SIZE,
                    len(self._downsample_remainder),
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
