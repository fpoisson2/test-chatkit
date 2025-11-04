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

        # Audio buffer for outgoing audio (from VoiceBridge to phone)
        # CRITIQUE: Limité à MAX_QUEUE_SIZE (10 frames = 200ms) pour éviter accumulation de latence
        # Si queue > HIGH_WATERMARK, les silences seront droppés en premier
        self._outgoing_audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue(
            maxsize=self.MAX_QUEUE_SIZE
        )

        # Event qui se déclenche quand on reçoit le premier paquet audio du téléphone
        # Cela confirme que le flux audio bidirectionnel est établi
        self._first_packet_received = asyncio.Event()

        # Latch pour verrouiller le timing d'envoi
        # Ne devient True que quand: media_active + first_frame + silence_primed
        # Empêche tout envoi audio prématuré (évite warnings "pas de slot audio")
        self._can_send_audio = False
        self._silence_primed = False

        # Queue watermark tracking
        self._queue_high_watermark_logged = False
        self._queue_low_watermark_logged = False

        # Flag pour drop pendant interruption utilisateur
        # Activé quand on détecte la voix de l'utilisateur (interrupt_response=True)
        # Désactivé quand l'assistant reprend (prochain chunk assistant)
        self._drop_until_next_assistant = False

        # High-quality resamplers (soxr if available, else audioop fallback)
        # These handle resampling state internally and provide better quality
        self._upsampler = get_resampler(
            from_rate=self.PJSUA_SAMPLE_RATE,
            to_rate=self.VOICE_BRIDGE_SAMPLE_RATE,
        )  # 8kHz → 24kHz
        self._downsampler = get_resampler(
            from_rate=self.VOICE_BRIDGE_SAMPLE_RATE,
            to_rate=self.PJSUA_SAMPLE_RATE,
        )  # 24kHz → 8kHz

        # Time-stretcher for catch-up mode (reduce latency without dropping frames)
        # Uses WSOLA to speed up playback 1.10-1.25x when queue builds up
        self._timestretch = create_timestretch(sample_rate=self.PJSUA_SAMPLE_RATE)

        # Catch-up mode state
        self._current_speed_ratio = 1.0  # Current playback speed (1.0 = normal)
        self._catchup_mode_active = False  # True when actively catching up

        # Remainder buffer for 24kHz → 8kHz downsampling
        # Accumule les bytes fractionnaires entre frames pour éviter padding/truncation
        self._downsample_remainder = b""

        # Buffer circulaire pour pacer côté sortie (playout)
        # Stocke les bytes 24kHz bruts avant découpage/resampling
        # Le ticker _playout_pacer_loop() extrait exactement 960 bytes toutes les 20ms
        self._playout_buffer_24k = bytearray()
        self._playout_buffer_lock = asyncio.Lock()

        # Remainder buffer for 8kHz → 24kHz upsampling
        # Accumule les bytes fractionnaires entre frames pour éviter padding/truncation
        # Exemple: ratecv produit 956 bytes au lieu de 960 → on accumule jusqu'à 960+
        self._upsample_remainder = b""

        # Timestamps pour mesurer latence E2E (downlink: modèle → PJSUA)
        self._latency_samples: list[float] = []  # Derniers N samples de latence
        self._latency_spike_count = 0

        # Counter for send_to_peer calls (for pacing diagnostics)
        self._send_to_peer_call_count = 0

        # Background task responsible for pacing audio sent to PJSUA
        loop = asyncio.get_running_loop()
        self._audio_sender_task: asyncio.Task[None] | None = loop.create_task(
            self._audio_sender_loop(),
            name="pjsua-audio-sender",
        )

        # Background task for playout pacer (extracts 1 frame/20ms from 24kHz buffer)
        self._playout_pacer_task: asyncio.Task[None] | None = loop.create_task(
            self._playout_pacer_loop(),
            name="playout-pacer",
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

    async def send_to_peer(self, audio_24khz: bytes) -> None:
        """Send audio from VoiceBridge to playout buffer.

        Cette fonction ne fait QUE remplir le buffer circulaire 24kHz.
        Le ticker _playout_pacer_loop() s'occupera du découpage/resampling strict à 20ms.

        Args:
            audio_24khz: PCM16 audio at 24kHz from OpenAI (taille variable)
        """
        if len(audio_24khz) == 0:
            return

        self._send_to_peer_call_count += 1

        # Vérifier si on doit dropper (interruption utilisateur)
        if self._drop_until_next_assistant:
            logger.debug("🗑️ Drop audio assistant (interruption utilisateur active)")
            # Vider le buffer de playout
            async with self._playout_buffer_lock:
                self._playout_buffer_24k.clear()
            return

        # Latch de timing: ne rien envoyer tant que media_active + first_frame + silence_primed
        # Évite les warnings "pas de slot audio" en début d'appel
        if not self._can_send_audio:
            # Buffer silencieusement, sera traité quand can_send_audio=True
            async with self._playout_buffer_lock:
                self._playout_buffer_24k.extend(audio_24khz)
            return

        # Ajouter au buffer circulaire (pas de découpage, pas de resampling)
        async with self._playout_buffer_lock:
            self._playout_buffer_24k.extend(audio_24khz)
            buffer_size = len(self._playout_buffer_24k)

        if self._send_to_peer_call_count <= 5:
            logger.info(
                "📤 send_to_peer #%d: reçu %d bytes, buffer total=%d bytes",
                self._send_to_peer_call_count,
                len(audio_24khz),
                buffer_size,
            )

    def clear_audio_queue(self) -> int:
        """Clear the outgoing audio queue (used during interruptions).

        Purge instantanée:
        - Vide la queue PJSUA
        - Vide le buffer send_to_peer (24kHz pré-resampling)
        - Active le flag drop pour ignorer les chunks assistant en vol
        - L'assistant doit appeler resume_after_interruption() quand il reprend

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

        # Vider le buffer de playout (24kHz pré-resampling)
        buffer_frames = len(self._playout_buffer_24k) / self.EXPECTED_FRAME_SIZE_24KHZ
        self._playout_buffer_24k.clear()

        # Activer le flag pour dropper tous les chunks assistant jusqu'à reprise
        self._drop_until_next_assistant = True

        # Réinitialiser l'état des resamplers pour éviter des artefacts
        self._downsampler.reset()
        self._upsampler.reset()

        if drained > 0 or buffer_frames > 0:
            logger.info(
                "🗑️ Purge interruption: queue=%d frames (8kHz), buffer=%.1f frames (24kHz), total~%.1f ms - drop activé",
                drained,
                buffer_frames,
                (drained + buffer_frames) * 20,
            )

        return cleared + drained + int(buffer_frames)

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
        - Silence primer envoyé (40ms)

        Déverrouille send_to_peer() pour commencer l'envoi TTS.
        """
        if not self._can_send_audio:
            self._can_send_audio = True
            buffer_size = len(self._playout_buffer_24k)
            logger.info(
                "🔓 Audio output enabled (buffer buffered during init: %d bytes = %.1f frames)",
                buffer_size,
                buffer_size / self.EXPECTED_FRAME_SIZE_24KHZ if buffer_size > 0 else 0,
            )
            # Le buffer accumulé sera traité par le playout pacer

    def stop(self) -> None:
        """Stop the audio bridge."""
        logger.info("Stopping PJSUA audio bridge")
        self._stop_event.set()
        if self._playout_pacer_task and not self._playout_pacer_task.done():
            self._playout_pacer_task.cancel()
        if self._audio_sender_task and not self._audio_sender_task.done():
            self._audio_sender_task.cancel()
        try:
            self._outgoing_audio_queue.put_nowait(None)
        except asyncio.QueueFull:
            pass

        # Reset resamplers and time-stretcher state
        self._downsampler.reset()
        self._upsampler.reset()
        self._timestretch.reset()

        # Reset catch-up mode state
        self._current_speed_ratio = 1.0
        self._catchup_mode_active = False

    async def _playout_pacer_loop(self) -> None:
        """Pacer côté sortie: extrait exactement 1 frame 24kHz toutes les 20ms.

        Pacer strict:
        - Cadence fixe 20ms (period = 0.020s)
        - Extrait EXACTEMENT 960 bytes (1 frame @ 24kHz) par tick
        - Resample à 8kHz (320 bytes)
        - Enqueue dans _outgoing_audio_queue pour _audio_sender_loop()
        - Si buffer vide: injecte silence (ne jamais sauter de tick)
        """
        import time

        period = 0.020  # 20ms strict
        loop = asyncio.get_running_loop()
        next_t = loop.time()

        # Silence de 960 bytes (20ms @ 24kHz PCM16 mono)
        SILENCE_24K = b'\x00' * self.EXPECTED_FRAME_SIZE_24KHZ

        frame_count = 0
        silence_injected_count = 0
        frames_resampled = 0

        try:
            while True:
                # Préparer le next tick
                next_t += period

                # Timestamp d'extraction (approxime t_model_in)
                t_extract = time.monotonic()

                # Extraire exactement 960 bytes du buffer circulaire
                async with self._playout_buffer_lock:
                    if len(self._playout_buffer_24k) >= self.EXPECTED_FRAME_SIZE_24KHZ:
                        # Extraire 1 frame
                        frame_24k = bytes(self._playout_buffer_24k[:self.EXPECTED_FRAME_SIZE_24KHZ])
                        del self._playout_buffer_24k[:self.EXPECTED_FRAME_SIZE_24KHZ]
                        buffer_size = len(self._playout_buffer_24k)
                        is_silence = False
                    else:
                        # Buffer vide: injecter silence
                        frame_24k = SILENCE_24K
                        buffer_size = len(self._playout_buffer_24k)
                        is_silence = True
                        silence_injected_count += 1

                # Resample cette frame: 960 bytes @ 24kHz → ~320 bytes @ 8kHz
                if not is_silence:
                    try:
                        frame_8k = self._downsampler.resample(frame_24k)
                        frames_resampled += 1
                    except Exception as e:
                        logger.warning("Resampling error (24kHz→8kHz): %s", e)
                        self._downsampler.reset()
                        # En cas d'erreur, injecter silence
                        frame_8k = b'\x00' * self.EXPECTED_FRAME_SIZE_8KHZ
                else:
                    # Silence: pas besoin de resample, juste convertir à 8kHz
                    frame_8k = b'\x00' * self.EXPECTED_FRAME_SIZE_8KHZ

                # Enqueue la frame @ 8kHz avec timestamp
                try:
                    # Stocker (frame, t_enqueue) pour mesurer latence plus tard
                    self._outgoing_audio_queue.put_nowait((frame_8k, t_extract))
                except asyncio.QueueFull:
                    # Queue pleine: dropper cette frame (rare)
                    logger.warning("🗑️ Playout pacer: queue pleine, drop frame")

                frame_count += 1

                # Log périodique
                if frame_count % 100 == 0:
                    logger.debug(
                        "📊 Playout pacer: %d frames, %d silence, buffer=%d bytes (%.1f frames)",
                        frames_resampled,
                        silence_injected_count,
                        buffer_size,
                        buffer_size / self.EXPECTED_FRAME_SIZE_24KHZ,
                    )

                # Sleep jusqu'au prochain tick (pacer strict)
                sleep_duration = max(0, next_t - loop.time())
                if sleep_duration > 0:
                    await asyncio.sleep(sleep_duration)

        except asyncio.CancelledError:
            logger.debug("Playout pacer task cancelled (processed %d frames, %d silence)", frame_count, silence_injected_count)
            raise
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.exception("Error in playout pacer loop: %s", exc)

    async def _audio_sender_loop(self) -> None:
        """Background task avec pacer strict 20ms pour envoyer frames vers PJSUA.

        Pacer strict:
        - Cadence fixe 20ms (period = 0.020s)
        - Envoie silence si queue vide (évite trous)
        - Mesure latence E2E: t_model_in → t_pjsua_pop
        - Log spikes (>120ms) pour diagnostics
        """
        import time

        period = 0.020  # 20ms strict
        loop = asyncio.get_running_loop()
        next_t = loop.time()

        # Silence de 320 bytes (20ms @ 8kHz PCM16 mono)
        SILENCE_8K = b'\x00' * self.EXPECTED_FRAME_SIZE_8KHZ

        frame_count = 0
        silence_sent_count = 0

        try:
            while True:
                # Préparer le next tick
                next_t += period

                # Mesurer la taille de queue AVANT de récupérer (pour catch-up)
                queue_size = self._outgoing_audio_queue.qsize()

                # Tenter de récupérer une frame (non-bloquant pour respecter timing)
                try:
                    item = self._outgoing_audio_queue.get_nowait()
                except asyncio.QueueEmpty:
                    # Queue vide: envoyer silence pour éviter trous
                    frame_8k = SILENCE_8K
                    t_model_in = None
                    silence_sent_count += 1
                else:
                    # Vérifier si c'est le signal de stop
                    if item is None:
                        self._outgoing_audio_queue.task_done()
                        break

                    # Dépack tuple (frame, timestamp)
                    frame_8k, t_model_in = item
                    self._outgoing_audio_queue.task_done()

                # CATCH-UP MODE: Adapter la vitesse de lecture selon la taille de queue
                # Politique adaptative pour réduire latence accumulée sans dropper:
                # - queue > 100 frames (~2s) → 1.25x speed
                # - queue > 50 frames (~1s) → 1.15x speed
                # - queue < 30 frames (~600ms) → 1.0x speed (normal)
                queue_size_ms = queue_size * 20  # Chaque frame = 20ms

                # Déterminer vitesse cible selon seuils
                if queue_size >= 100:  # 2000ms
                    target_speed = 1.25
                elif queue_size >= 50:  # 1000ms
                    target_speed = 1.15
                elif queue_size < 30:  # 600ms
                    target_speed = 1.0
                else:
                    # Zone d'hystérésis: garder vitesse actuelle
                    target_speed = self._current_speed_ratio

                # Mettre à jour vitesse actuelle
                if target_speed != self._current_speed_ratio:
                    was_active = self._catchup_mode_active
                    self._current_speed_ratio = target_speed
                    self._catchup_mode_active = (target_speed > 1.0)

                    # Log transitions
                    if self._catchup_mode_active and not was_active:
                        logger.info(
                            "🚀 Catch-up mode activé: vitesse %.2fx (queue=%d frames = %dms)",
                            target_speed, queue_size, queue_size_ms
                        )
                    elif not self._catchup_mode_active and was_active:
                        logger.info(
                            "✅ Catch-up mode désactivé: retour vitesse 1.00x (queue=%d frames = %dms)",
                            queue_size, queue_size_ms
                        )
                    elif self._catchup_mode_active:
                        logger.debug(
                            "⚡ Catch-up vitesse ajustée: %.2fx (queue=%d frames = %dms)",
                            target_speed, queue_size, queue_size_ms
                        )

                # Appliquer time-stretch si en mode catch-up (et pas silence)
                if self._catchup_mode_active and frame_8k != SILENCE_8K:
                    try:
                        stretched = self._timestretch.process(frame_8k, self._current_speed_ratio)
                        # Si time-stretch retourne vide (pas assez de data), utiliser frame originale
                        if len(stretched) > 0:
                            frame_8k = stretched
                    except Exception as e:
                        logger.warning("Erreur time-stretch: %s, utilisation frame originale", e)

                # t_pjsua_pop: moment où on consomme la frame pour PJSUA
                t_pjsua_pop = time.monotonic()

                # Calculer latence E2E si on a un timestamp
                if t_model_in is not None:
                    latency_ms = (t_pjsua_pop - t_model_in) * 1000
                    self._latency_samples.append(latency_ms)

                    # Garder seulement les 100 derniers samples
                    if len(self._latency_samples) > 100:
                        self._latency_samples.pop(0)

                    # Détecter spike (>120ms)
                    if latency_ms > 120:
                        self._latency_spike_count += 1
                        queue_size = self._outgoing_audio_queue.qsize()
                        if self._latency_spike_count <= 5 or self._latency_spike_count % 50 == 0:
                            logger.warning(
                                "⚠️ Latency spike #%d: %.1f ms (queue=%d frames)",
                                self._latency_spike_count,
                                latency_ms,
                                queue_size,
                            )

                    # Log latency périodiquement
                    if frame_count % 100 == 0 and len(self._latency_samples) >= 10:
                        avg_latency = sum(self._latency_samples[-10:]) / 10
                        logger.debug(
                            "📊 Latency E2E (avg derniers 10): %.1f ms, queue=%d frames",
                            avg_latency,
                            self._outgoing_audio_queue.qsize(),
                        )

                # Envoyer la frame à PJSUA
                try:
                    self._adapter.send_audio_to_call(self._call, frame_8k)
                except Exception as e:
                    logger.warning("Erreur send_audio_to_call: %s", e)

                frame_count += 1

                # Sleep jusqu'au prochain tick (pacer strict)
                sleep_duration = max(0, next_t - loop.time())
                if sleep_duration > 0:
                    await asyncio.sleep(sleep_duration)

        except asyncio.CancelledError:
            logger.debug("Audio sender task cancelled (sent %d frames, %d silence)", frame_count, silence_sent_count)
            raise
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.exception("Error in audio sender loop: %s", exc)
        finally:
            # Vider la queue
            while not self._outgoing_audio_queue.empty():
                try:
                    item = self._outgoing_audio_queue.get_nowait()
                except asyncio.QueueEmpty:  # pragma: no cover - race condition
                    break
                else:
                    self._outgoing_audio_queue.task_done()
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
