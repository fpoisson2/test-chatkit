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
import threading
import time
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import TYPE_CHECKING, Any

from .audio_resampler import get_resampler
from .audio_timestretch import create_timestretch
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

    # Pacer strict: frames de 20ms exactement
    # FRAME @ 8kHz = 320 bytes (20ms), FRAME @ 24kHz = 960 bytes (20ms)
    # Queue cible: 4 frames (80ms) - optimal pour téléphonie temps réel
    # Queue max: 6 frames (120ms) - hard cap pour éviter latence excessive
    TARGET_QUEUE_FRAMES = 4   # 4 frames = 80ms - cible optimale
    MAX_QUEUE_FRAMES = 6      # 6 frames = 120ms - hard cap

    # Anciens watermarks conservés pour compatibilité
    HIGH_WATERMARK = TARGET_QUEUE_FRAMES  # Alias
    LOW_WATERMARK = 3    # 60ms - reprise d'enfilage
    MAX_QUEUE_SIZE = MAX_QUEUE_FRAMES  # Alias

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

        # Event qui se déclenche quand on reçoit le premier paquet audio du téléphone
        # Cela confirme que le flux audio bidirectionnel est établi
        self._first_packet_received = asyncio.Event()

        # Event qui se déclenche quand le port audio PJSUA est complètement prêt
        # Set seulement après:
        # - onCallMediaState(ACTIVE)
        # - AudioMediaPort créé et bridgé
        # - Premier onFrameRequested reçu (signal que PJSUA peut consommer)
        # IMPORTANT: Utilise le _frame_requested_event du call, qui est set dans onFrameRequested()
        self._port_ready_event = call._frame_requested_event

        # Latch pour verrouiller le timing d'envoi
        # Ne devient True que quand: media_active + first_frame + silence_primed
        # Empêche tout envoi audio prématuré (évite warnings "pas de slot audio")
        self._can_send_audio = False

        # Flag pour drop pendant interruption utilisateur
        # Activé quand on détecte la voix de l'utilisateur (interrupt_response=True)
        # Désactivé quand l'assistant reprend (prochain chunk assistant)
        self._drop_until_next_assistant = False

        # ====================
        # ARCHITECTURE PULL (ring buffer @ 8kHz)
        # ====================
        # Ring buffer @ 8kHz: PJSUA pull via AudioMediaPort.onFrameRequested()
        # Thread-safe car callback PJSUA est synchrone (pas asyncio)
        self._ring_buffer_8k = bytearray()
        self._ring_lock = threading.Lock()

        # Staging buffer @ 8kHz: accumule audio resamplé avant admission control
        self._stage_8k = bytearray()

        # Resamplers
        self._downsampler = get_resampler(
            from_rate=self.VOICE_BRIDGE_SAMPLE_RATE,
            to_rate=self.PJSUA_SAMPLE_RATE,
        )  # 24kHz → 8kHz (utilisé dans send_to_peer)

        self._upsampler = get_resampler(
            from_rate=self.PJSUA_SAMPLE_RATE,
            to_rate=self.VOICE_BRIDGE_SAMPLE_RATE,
        )  # 8kHz → 24kHz (utilisé pour RTP vers OpenAI)

        # Time-stretcher @ 8kHz pour catch-up
        self._timestretch_8k = create_timestretch(sample_rate=self.PJSUA_SAMPLE_RATE)

        # Catch-up state (bornes conservatrices)
        # Target: 6 frames (120ms), High: 9 frames (180ms), Cap: 12 frames (240ms)
        # Ratio: 1.12-1.20x max (jamais 1.30x)
        self._speed_ratio = 1.0
        self._catchup_active = False
        self._last_rate_change_time = 0.0

        # Admission control thresholds
        self.TARGET_FRAMES = 6   # 120ms
        self.HIGH_FRAMES = 9     # 180ms → activer catch-up 1.12x
        self.CAP_FRAMES = 12     # 240ms → ne pas dépasser

        # Remainder buffer for 8kHz → 24kHz upsampling
        self._upsample_remainder = b""

        # Counter for diagnostics
        self._send_to_peer_call_count = 0
        self._frames_pulled = 0
        self._silence_pulled = 0
        self._drops_admission = 0  # Frames droppées par admission control

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
                    # Utilise soxr (high quality) si disponible, sinon audioop (fallback)
                    resampled = self._upsampler.resample(audio_8khz)

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

                except Exception as e:
                    logger.warning("Resampling error (8kHz→24kHz): %s", e)
                    # Reset le buffer en cas d'erreur pour éviter accumulation de corruption
                    self._upsample_remainder = b""
                    self._upsampler.reset()
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

    def send_prime_silence_direct(self, num_frames: int = 1) -> None:
        """Envoie du silence de prime DIRECTEMENT dans le ring buffer @ 8kHz.

        Le silence de prime ne doit PAS créer de backlog.
        Il est injecté directement dans le ring buffer.

        Args:
            num_frames: Nombre de frames de silence à envoyer (défaut: 1 = 20ms, démarrage sec)
        """
        # Silence à 8kHz (320 bytes = 20ms @ 8kHz PCM16 mono)
        silence_8k = b'\x00' * self.EXPECTED_FRAME_SIZE_8KHZ * num_frames

        logger.info(
            "🔇 Injection silence de prime direct: %d frames (=%dms) dans ring buffer @ 8kHz",
            num_frames,
            num_frames * 20
        )

        # Injecter dans le ring buffer thread-safe
        with self._ring_lock:
            self._ring_buffer_8k.extend(silence_8k)

        logger.info("✅ Silence de prime injecté directement dans ring buffer @ 8kHz")

    def _ring_len_frames(self) -> int:
        """Retourne la taille du ring buffer en frames (thread-safe)."""
        return len(self._ring_buffer_8k) // self.EXPECTED_FRAME_SIZE_8KHZ

    async def send_to_peer(self, audio_24khz: bytes) -> None:
        """Send audio from VoiceBridge to ring buffer @ 8kHz avec admission control.

        ARCHITECTURE PULL + ADMISSION CONTROL:
        1. Resample 24kHz → 8kHz dans staging buffer
        2. Découpe en frames de 320 bytes
        3. AVANT d'enfiler chaque frame:
           - Vérifie free space (CAP_FRAMES - ring_len)
           - Si free <= 0: drop la frame (compte _drops_admission)
           - Sinon: enqueue dans ring buffer
        4. Gère catch-up hystérésis selon ring_len

        Args:
            audio_24khz: PCM16 audio at 24kHz from OpenAI (taille variable)
        """
        if len(audio_24khz) == 0:
            return

        self._send_to_peer_call_count += 1

        # Vérifier si on doit dropper (interruption utilisateur)
        if self._drop_until_next_assistant:
            logger.debug("🗑️ Drop audio assistant (interruption utilisateur active)")
            # Vider le ring buffer ET le staging buffer
            with self._ring_lock:
                self._ring_buffer_8k.clear()
                self._stage_8k.clear()
            return

        # Latch de timing: ne rien envoyer tant que media_active + first_frame + silence_primed
        # Évite les warnings "pas de slot audio" en début d'appel
        if not self._can_send_audio:
            # Skip silencieusement (ne pas bufferiser avant que PJSUA soit prêt)
            return

        # 1) Resample 24kHz → 8kHz dans staging buffer
        try:
            audio_8khz = self._downsampler.resample(audio_24khz)
        except Exception as e:
            logger.warning("Erreur resampling 24kHz→8kHz: %s", e)
            self._downsampler.reset()
            return

        self._stage_8k.extend(audio_8khz)

        # 2) Découpe staging buffer en frames de 320 bytes avec admission control
        frames_admitted = 0
        frames_dropped = 0

        while len(self._stage_8k) >= self.EXPECTED_FRAME_SIZE_8KHZ:
            frame = bytes(self._stage_8k[:self.EXPECTED_FRAME_SIZE_8KHZ])
            del self._stage_8k[:self.EXPECTED_FRAME_SIZE_8KHZ]

            # 3) Admission control AVANT ring
            with self._ring_lock:
                ring_len = self._ring_len_frames()
                free = self.CAP_FRAMES - ring_len

                if free <= 0:
                    # Pas de place: drop cette frame
                    self._drops_admission += 1
                    frames_dropped += 1
                    continue

                # Catch-up hystérésis (set flag, appliqué dans get_next_frame_8k)
                if ring_len >= self.HIGH_FRAMES and not self._catchup_active:
                    self._catchup_active = True
                    self._speed_ratio = 1.12
                    self._last_rate_change_time = time.monotonic()
                    logger.info(
                        "🚀 Catch-up activé: vitesse %.2fx (buffer=%d frames = %dms)",
                        self._speed_ratio, ring_len, ring_len * 20
                    )
                elif ring_len <= self.TARGET_FRAMES and self._catchup_active:
                    self._catchup_active = False
                    self._speed_ratio = 1.0
                    self._last_rate_change_time = time.monotonic()
                    logger.info(
                        "✅ Catch-up désactivé: retour vitesse 1.00x (buffer=%d frames = %dms)",
                        ring_len, ring_len * 20
                    )

                # 4) Enqueue
                self._ring_buffer_8k.extend(frame)
                frames_admitted += 1

        # Log (premiers appels ou si drop)
        if self._send_to_peer_call_count <= 5 or frames_dropped > 0:
            with self._ring_lock:
                ring_len = self._ring_len_frames()
            logger.info(
                "📤 send_to_peer #%d: %d bytes @ 24kHz → +%d frames, -%d drops, ring=%d frames (%dms)",
                self._send_to_peer_call_count,
                len(audio_24khz),
                frames_admitted,
                frames_dropped,
                ring_len,
                ring_len * 20,
            )

    def get_next_frame_8k(self) -> bytes:
        """Pull 1 frame (320 bytes @ 8kHz) depuis le ring buffer avec catch-up WSOLA.

        Appelé par AudioMediaPort.onFrameRequested() (callback synchrone PJSUA).
        Mode PULL: PJSUA demande l'audio à son rythme (20ms/frame).

        Admission control et catch-up state sont gérés dans send_to_peer().
        Cette méthode extrait simplement 1 frame et applique time-stretch si nécessaire.

        Returns:
            320 bytes PCM16 @ 8kHz (silence si buffer vide)
        """
        SILENCE_8K = b'\x00' * self.EXPECTED_FRAME_SIZE_8KHZ

        with self._ring_lock:
            buffer_size = len(self._ring_buffer_8k)
            buffer_frames = buffer_size / self.EXPECTED_FRAME_SIZE_8KHZ

            # Extraire 1 frame si disponible
            if buffer_size >= self.EXPECTED_FRAME_SIZE_8KHZ:
                frame_8k = bytes(self._ring_buffer_8k[:self.EXPECTED_FRAME_SIZE_8KHZ])
                del self._ring_buffer_8k[:self.EXPECTED_FRAME_SIZE_8KHZ]
                is_silence = False
                self._frames_pulled += 1
            else:
                # Buffer vide: retourner silence
                frame_8k = SILENCE_8K
                is_silence = True
                self._silence_pulled += 1

        # Appliquer time-stretch @ 8kHz si en mode catch-up (et pas silence)
        # Le catch-up state est géré dans send_to_peer()
        if self._catchup_active and not is_silence:
            try:
                stretched = self._timestretch_8k.process(frame_8k, self._speed_ratio)
                if len(stretched) > 0:
                    frame_8k = stretched
            except Exception as e:
                logger.warning("Erreur time-stretch @ 8kHz: %s, utilisation frame originale", e)

        # Log périodique
        if (self._frames_pulled + self._silence_pulled) % 100 == 0:
            logger.debug(
                "📊 PULL stats: %d frames, %d silence, %d drops, ring=%d frames (%dms)",
                self._frames_pulled,
                self._silence_pulled,
                self._drops_admission,
                int(buffer_frames),
                int(buffer_frames * 20),
            )

        return frame_8k

    def clear_audio_queue(self) -> int:
        """Clear the ring buffer and staging buffer (used during interruptions).

        Purge instantanée:
        - Vide le ring buffer @ 8kHz ET le staging buffer
        - Active le flag drop pour ignorer les chunks assistant en vol
        - L'assistant doit appeler resume_after_interruption() quand il reprend

        Returns:
            Number of frames cleared
        """
        # Vider le ring buffer ET le staging buffer thread-safe
        with self._ring_lock:
            buffer_size = len(self._ring_buffer_8k)
            buffer_frames = buffer_size / self.EXPECTED_FRAME_SIZE_8KHZ
            self._ring_buffer_8k.clear()
            self._stage_8k.clear()  # Vider aussi le staging buffer

        # Activer le flag pour dropper tous les chunks assistant jusqu'à reprise
        self._drop_until_next_assistant = True

        # Réinitialiser l'état des resamplers pour éviter des artefacts
        self._downsampler.reset()
        self._upsampler.reset()

        if buffer_frames > 0:
            logger.info(
                "🗑️ Purge interruption: ring buffer=%.1f frames @ 8kHz (%.0f ms) - drop activé",
                buffer_frames,
                buffer_frames * 20,
            )

        return int(buffer_frames)

    def resume_after_interruption(self) -> None:
        """Désactive le drop mode - appelé quand l'assistant reprend après interruption."""
        if self._drop_until_next_assistant:
            logger.info("✅ Assistant reprend - désactivation du drop mode")
            self._drop_until_next_assistant = False

    def enable_audio_output(self) -> None:
        """Active l'envoi audio après vérification des conditions.

        À appeler après:
        - onCallMediaState actif
        - Premier onFrameRequested reçu
        - Silence primer envoyé (20ms)

        Déverrouille send_to_peer() pour commencer l'envoi TTS.
        """
        if not self._can_send_audio:
            self._can_send_audio = True
            with self._ring_lock:
                buffer_size = len(self._ring_buffer_8k)
                buffer_frames = buffer_size / self.EXPECTED_FRAME_SIZE_8KHZ
            logger.info(
                "🔓 Audio output enabled (ring buffer @ 8kHz: %.1f frames = %.0fms)",
                buffer_frames,
                buffer_frames * 20,
            )

    def stop(self) -> None:
        """Stop the audio bridge."""
        logger.info("Stopping PJSUA audio bridge")
        self._stop_event.set()

        # Clear ring buffer
        with self._ring_lock:
            self._ring_buffer_8k.clear()

        # Reset resamplers and time-stretcher state
        self._downsampler.reset()
        self._upsampler.reset()
        self._timestretch_8k.reset()

        # Reset catch-up mode state
        self._speed_ratio = 1.0
        self._catchup_active = False

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

    # Stocker le bridge sur le call pour que AudioMediaPort puisse le récupérer
    # Le port sera créé plus tard dans onCallMediaState() et pourra accéder au bridge
    call._audio_bridge = bridge
    logger.info("✅ Bridge stocké sur Call (sera connecté au port quand créé)")

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
