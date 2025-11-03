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

    # Optimized parameters (Point 1, 3)
    SILENCE_THRESHOLD = 4  # Amplitude minimale pour considérer comme non-silence (PCM16)
    MAX_TX_FRAMES = 2000  # Buffer max: 2000 frames = ~40s (OpenAI peut envoyer jusqu'à 30s d'audio à la fois)
    HIGH_WATERMARK = 1600  # Arrête production si queue >= 1600 frames (~32s)
    LOW_WATERMARK = 800   # Reprend production si queue <= 800 frames (~16s)

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

        # Silence gate to avoid amplifying background noise
        self._silence_threshold = 40

        # Counter for send_to_peer calls (for diagnostics)
        self._send_to_peer_call_count = 0

        # PULL-BASED: Queue de frames 8kHz (320B) que PJSUA pull via onFrameRequested
        # Pas de maxlen car on gère le drop-tail manuellement (évite drop-oldest automatique)
        self._tx_queue: deque[bytes] = deque()

        # Hysteresis backpressure: flag pour bloquer production quand queue >= HW
        self._production_blocked = False

        # État de rééchantillonnage 24kHz → 8kHz (préserve continuité entre chunks)
        self._resample_state_24_to_8: Any = None

        # Buffer pour bytes incomplets (< 320B @ 8kHz) entre appels send_to_peer
        # CRITIQUE: Ne jamais perdre ces bytes sinon les fins de phrases sont coupées!
        self._incomplete_audio_buffer: bytes = b""

        # Lock pour protéger l'état pendant le traitement concurrent
        self._processing_lock = asyncio.Lock()

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

        IMPORTANT: Aussi utilisé pour débloquer la production si queue <= LW
        après consommation, même si send_to_peer() n'est plus appelé.

        Returns:
            320 bytes PCM16 @ 8kHz, or None if queue empty
        """
        # CRITIQUE: Vérifier déblocage AVANT de consommer
        # Si production bloquée ET queue <= LW: débloquer immédiatement
        queue_len = len(self._tx_queue)
        if self._production_blocked and queue_len <= self.LOW_WATERMARK:
            self._production_blocked = False
            logger.info("✅ Production REPRISE dans get_next_frame: queue sous LW (%d <= %d frames)",
                       queue_len, self.LOW_WATERMARK)

        # Consommer une frame si disponible
        if queue_len > 0:
            return self._tx_queue.popleft()
        return None

    def _process_audio_sync(self, audio_24khz: bytes) -> bytes | None:
        """Traitement audio synchrone: rééchantillonnage 24kHz → 8kHz + normalisation.

        Cette fonction est CPU-intensive et doit être exécutée dans un thread séparé
        via asyncio.to_thread() pour ne pas bloquer l'event loop.

        Args:
            audio_24khz: PCM16 audio at 24kHz (peut être de taille variable)

        Returns:
            PCM16 audio at 8kHz, or None if silent audio should be dropped
        """
        if len(audio_24khz) == 0:
            return None

        try:
            # ÉTAPE 1: Rééchantillonnage 24kHz → 8kHz avec préservation d'état
            # Cela garantit une conversion fluide sans artefacts entre chunks
            audio_8khz, self._resample_state_24_to_8 = audioop.ratecv(
                audio_24khz,
                self.BYTES_PER_SAMPLE,
                self.CHANNELS,
                self.VOICE_BRIDGE_SAMPLE_RATE,
                self.PJSUA_SAMPLE_RATE,
                self._resample_state_24_to_8,  # Préserve l'état entre appels
            )
        except audioop.error as e:
            logger.warning("Erreur rééchantillonnage 24kHz→8kHz: %s", e)
            self._resample_state_24_to_8 = None  # Reset état en cas d'erreur
            return None

        try:
            # ÉTAPE 2: Analyse d'amplitude pour filtrage silence
            max_amplitude = audioop.max(audio_8khz, self.BYTES_PER_SAMPLE)

            # CRITIQUE: Ne jamais enqueuer du silence (évite bruit de fond)
            if max_amplitude <= self.SILENCE_THRESHOLD:
                return None  # Signal au caller de dropper ce chunk

            # ÉTAPE 3: Amplification si amplitude trop faible
            min_target_amplitude = 6000
            max_gain = 12.0
            if max_amplitude < min_target_amplitude:
                gain = min(min_target_amplitude / max_amplitude, max_gain)
                try:
                    audio_8khz = audioop.mul(audio_8khz, self.BYTES_PER_SAMPLE, gain)
                except audioop.error:
                    pass  # Garder l'audio original si overflow

            return audio_8khz

        except audioop.error as e:
            logger.warning("Erreur traitement audio (max/mul): %s", e)
            return None

    async def send_to_peer(self, audio_24khz: bytes) -> None:
        """Send audio from VoiceBridge to PJSUA (24kHz → 8kHz).

        NOUVELLE APPROCHE AVEC ASYNCIO.TO_THREAD + HYSTERESIS:
        1. Reçoit audio @ 24kHz (taille variable, généralement ~960B = 20ms)
        2. Déplace traitement CPU (ratecv/max/mul) dans thread séparé via asyncio.to_thread()
        3. Découpe en frames de 320B @ 8kHz (20ms)
        4. Hysteresis: si queue >= HW, bloque production jusqu'à queue <= LW
        5. Pas de boucles d'attente, juste drop immédiat si production bloquée

        Args:
            audio_24khz: PCM16 audio at 24kHz (variable size, typically ~960 bytes = 20ms)
        """
        if len(audio_24khz) == 0:
            return

        self._send_to_peer_call_count += 1

        # Log moins verbeux: tous les 100 appels
        if self._send_to_peer_call_count <= 3 or self._send_to_peer_call_count % 100 == 0:
            logger.info("📤 send_to_peer #%d: reçu %d bytes @ 24kHz",
                       self._send_to_peer_call_count, len(audio_24khz))

        try:
            # ÉTAPE 1: Traitement CPU dans thread séparé (non-bloquant pour event loop)
            # Le lock protège _resample_state_24_to_8 en cas d'appels concurrents
            async with self._processing_lock:
                audio_8khz = await asyncio.to_thread(
                    self._process_audio_sync,
                    audio_24khz
                )

            # Si _process_audio_sync retourne None, c'est du silence → dropper
            if audio_8khz is None:
                if self._send_to_peer_call_count <= 3:
                    logger.debug("🔇 Audio silence droppé après traitement")
                return

            # ÉTAPE 2: Découper en frames de 320B @ 8kHz (20ms)
            # CRITIQUE: Ajouter les bytes incomplets du chunk précédent au début!
            # Sinon les fins de phrases sont coupées
            FRAME_SIZE = 320  # 20ms @ 8kHz PCM16
            audio_8khz_with_prefix = self._incomplete_audio_buffer + audio_8khz

            frames_to_enqueue = []
            offset = 0

            while offset + FRAME_SIZE <= len(audio_8khz_with_prefix):
                frame = audio_8khz_with_prefix[offset:offset + FRAME_SIZE]
                frames_to_enqueue.append(frame)
                offset += FRAME_SIZE

            # Sauvegarder les bytes restants (< 320B) pour le prochain appel
            # CRUCIAL: Ne jamais perdre ces bytes!
            self._incomplete_audio_buffer = audio_8khz_with_prefix[offset:]

            if len(self._incomplete_audio_buffer) > 0 and self._send_to_peer_call_count <= 3:
                logger.debug("💾 %d bytes incomplets sauvegardés pour prochain chunk",
                           len(self._incomplete_audio_buffer))

            # ÉTAPE 3: Enqueuer chaque frame avec HYSTERESIS BACKPRESSURE
            frames_enqueued = 0
            for frame_8khz in frames_to_enqueue:
                queue_len = len(self._tx_queue)

                # Hysteresis: vérifier état actuel AVANT la condition
                # Si production NON bloquée ET queue >= HW: bloquer
                if not self._production_blocked and queue_len >= self.HIGH_WATERMARK:
                    self._production_blocked = True
                    logger.info("🛑 Production BLOQUÉE: queue atteint HW (%d >= %d frames)",
                               queue_len, self.HIGH_WATERMARK)

                # Si production BLOQUÉE ET queue <= LW: débloquer
                elif self._production_blocked and queue_len <= self.LOW_WATERMARK:
                    self._production_blocked = False
                    logger.info("✅ Production REPRISE: queue sous LW (%d <= %d frames)",
                               queue_len, self.LOW_WATERMARK)

                # Si production bloquée, dropper immédiatement (pas de boucle d'attente)
                if self._production_blocked:
                    if frames_enqueued == 0 and self._send_to_peer_call_count % 50 == 0:
                        logger.debug("⏸️  Frames droppées: production bloquée (queue=%d frames)", queue_len)
                    break  # Dropper le reste des frames de ce chunk

                # Sécurité: ne jamais dépasser MAX_TX_FRAMES même si production active
                if queue_len >= self.MAX_TX_FRAMES:
                    logger.warning("⚠️ Queue pleine (%d >= %d), dropping remaining frames",
                                 queue_len, self.MAX_TX_FRAMES)
                    break

                # Enqueuer la frame
                self._tx_queue.append(frame_8khz)
                frames_enqueued += 1

            # Log périodique pour monitoring
            if self._send_to_peer_call_count <= 3 or self._send_to_peer_call_count % 100 == 0:
                queue_size = len(self._tx_queue)
                logger.info("✅ send_to_peer #%d: %d frames enfilées (queue: %d frames, %d ms)",
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

        # Réinitialiser le flag de production bloquée
        self._production_blocked = False

        # Vider le buffer de bytes incomplets et réinitialiser l'état de rééchantillonnage
        # Important pour éviter artefacts audio lors de la reprise après interruption
        incomplete_bytes = len(self._incomplete_audio_buffer)
        self._incomplete_audio_buffer = b""
        self._resample_state_24_to_8 = None

        if incomplete_bytes > 0:
            logger.info("🧹 Audio queue cleared: %d frames, %d bytes incomplets vidés",
                       tx_cleared, incomplete_bytes)
        else:
            logger.info("🧹 Audio queue cleared: %d frames", tx_cleared)

        return tx_cleared

    def stop(self) -> None:
        """Stop the audio bridge."""
        logger.info("Stopping PJSUA audio bridge")
        self._stop_event.set()

        # Clear TX queue and reset production flag
        self._tx_queue.clear()
        self._production_blocked = False

        # Nettoyer le buffer incomplet et l'état de rééchantillonnage
        self._incomplete_audio_buffer = b""
        self._resample_state_24_to_8 = None

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
