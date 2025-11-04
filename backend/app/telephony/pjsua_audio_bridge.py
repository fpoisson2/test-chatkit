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
from .call_diagnostics import get_diagnostics_manager
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
        # ARCHITECTURE PULL avec contrôle doux (ring buffer @ 8kHz)
        # ====================
        # Ring buffer @ 8kHz: PJSUA pull via AudioMediaPort.onFrameRequested()
        # Thread-safe car callback PJSUA est synchrone (pas asyncio)
        self._ring_buffer_8k = bytearray()
        self._ring_lock = threading.Lock()

        # Staging buffer @ 8kHz: accumule frames de 160 samples avant injection contrôlée
        self._staging_frames_8k: list[bytes] = []  # Liste de frames de 320 bytes (160 samples)

        # Resamplers
        self._downsampler = get_resampler(
            from_rate=self.VOICE_BRIDGE_SAMPLE_RATE,
            to_rate=self.PJSUA_SAMPLE_RATE,
        )  # 24kHz → 8kHz (utilisé dans send_to_peer)

        self._upsampler = get_resampler(
            from_rate=self.PJSUA_SAMPLE_RATE,
            to_rate=self.VOICE_BRIDGE_SAMPLE_RATE,
        )  # 8kHz → 24kHz (utilisé pour RTP vers OpenAI)

        # Time-stretcher @ 8kHz pour ratio dynamique doux
        self._timestretch_8k = create_timestretch(sample_rate=self.PJSUA_SAMPLE_RATE)

        # Contrôle doux du ring buffer (±6% max, pas 12%)
        # Target: 8 frames (160ms), Low: 6 frames (120ms), High: 10 frames (200ms)
        self.RING_TARGET = 8    # 160ms - cible idéale
        self.RING_LOW = 6       # 120ms - hystérésis basse
        self.RING_HIGH = 10     # 200ms - hystérésis haute
        self.RING_OVERFLOW = 24 # 480ms - drop d'urgence si dépassé
        self.RING_SAFE = 16     # 320ms - revenir ici après overflow

        # Ratio dynamique doux: ratio = clamp(1 + k*(ring - target), 0.96, 1.06)
        self.RATIO_K = 0.01     # Coefficient de réactivité (1% par frame d'écart)
        self._speed_ratio = 1.0

        # Leaky bucket pour limiter injection à ~1 frame/20ms
        self._last_injection_time = 0.0  # timestamp de dernière injection
        self._injection_credits = 0.0    # crédits accumulés (1 crédit = 1 frame injectable)
        self._max_injection_credits = 3.0  # max 3 frames de burst (60ms)

        # Remainder buffer for 8kHz resampling (partial frame)
        self._resample_remainder_8k = b""

        # Remainder buffer for 8kHz → 24kHz upsampling
        self._upsample_remainder = b""

        # Counter for diagnostics
        self._send_to_peer_call_count = 0
        self._frames_pulled = 0
        self._silence_pulled = 0
        self._drops_overflow = 0  # Frames droppées par overflow d'urgence (> 480ms)
        self._frames_injected = 0 # Frames injectées du staging vers ring
        self._frames_staged = 0   # Frames reçues et mises dans staging

        # Timing diagnostics (latence E2E)
        self._t0_first_rtp = None       # Premier RTP entrant
        self._t1_response_create = None # Envoi response.create
        self._t2_first_tts_chunk = None # Premier chunk audio TTS reçu
        self._t3_first_send_to_peer = None  # Premier send_to_peer
        self._t4_first_real_pull = None # Premier PULL non-silence

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
        none_count_during_call = 0
        try:
            while not self._stop_event.is_set():
                # Get audio from PJSUA (8kHz PCM16 mono)
                audio_8khz = await self._adapter.receive_audio_from_call(self._call)

                if audio_8khz is None:
                    none_count += 1

                    # Après le premier packet, envoyer du silence au lieu d'attendre
                    # pour éviter les sautillements audibles
                    if packet_count > 0:
                        none_count_during_call += 1
                        # Générer 160 samples (20ms) de silence @ 8kHz
                        audio_8khz = bytes(320)  # 160 samples × 2 bytes/sample = 320 bytes
                        if none_count_during_call % 100 == 1:  # Log toutes les 2 secondes
                            logger.debug("📭 Queue audio vide pendant l'appel - envoi de silence (count=%d)", none_count_during_call)
                        # CRITIQUE : Attendre 10ms pour ne pas boucler à fond
                        await asyncio.sleep(0.01)
                    else:
                        # Avant le premier packet, attendre la connexion du bridge
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
                    import time
                    self._t0_first_rtp = time.monotonic()
                    logger.info(
                        "📥 [t0=%.3fs] Premier paquet audio reçu - flux confirmé (%d None avant)",
                        self._t0_first_rtp, none_count,
                    )
                    self._first_packet_received.set()

                    # 📊 Diagnostic: Enregistrer le none_count pour détection de lag
                    if hasattr(self._call, 'chatkit_call_id') and self._call.chatkit_call_id:
                        diag_manager = get_diagnostics_manager()  # Import déjà fait en haut du fichier
                        diag = diag_manager.get_call(self._call.chatkit_call_id)
                        if diag:
                            diag.none_packets_before_audio = none_count
                            diag.phase_first_rtp.start()
                            diag.phase_first_rtp.end(none_packets=none_count)

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

            # 📊 Diagnostic: Enregistrer le none_count_during_call pour analyse de sautillements
            if hasattr(self._call, 'chatkit_call_id') and self._call.chatkit_call_id:
                diag_manager = get_diagnostics_manager()  # Import déjà fait en haut du fichier
                diag = diag_manager.get_call(self._call.chatkit_call_id)
                if diag:
                    diag.none_packets_during_call = none_count_during_call
                    if none_count_during_call > 0:
                        logger.info("📊 Diagnostic: %d None packets pendant l'appel (remplacés par silence)", none_count_during_call)

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
        """Retourne la taille du ring buffer en frames.

        ATTENTION: Doit être appelé avec self._ring_lock acquis.
        """
        return len(self._ring_buffer_8k) // self.EXPECTED_FRAME_SIZE_8KHZ

    async def send_to_peer(self, audio_24khz: bytes) -> None:
        """Send audio from VoiceBridge - remplit uniquement staging buffer.

        NOUVELLE ARCHITECTURE (tick 20ms dédié):
        1. Resample 24kHz → 8kHz
        2. Découpe en frames de 160 samples (320 bytes)
        3. Ajoute dans staging buffer (PAS d'injection ici)
        4. L'injection staging→ring est faite par get_next_frame_8k() (tick 20ms)

        Args:
            audio_24khz: PCM16 audio at 24kHz from OpenAI (taille variable)
        """
        if len(audio_24khz) == 0:
            return

        self._send_to_peer_call_count += 1

        # Timing diagnostic: premier send_to_peer (t3)
        if self._send_to_peer_call_count == 1 and self._t3_first_send_to_peer is None:
            import time
            self._t3_first_send_to_peer = time.monotonic()
            if self._t0_first_rtp is not None:
                delta = (self._t3_first_send_to_peer - self._t0_first_rtp) * 1000
                logger.info(
                    "📤 [t3=%.3fs, Δt0→t3=%.1fms] Premier send_to_peer",
                    self._t3_first_send_to_peer, delta
                )

        # Vérifier si on doit dropper (interruption utilisateur)
        if self._drop_until_next_assistant:
            logger.debug("🗑️ Drop audio assistant (interruption utilisateur active)")
            # Vider le ring buffer ET le staging buffer
            with self._ring_lock:
                self._ring_buffer_8k.clear()
                self._staging_frames_8k.clear()
                self._resample_remainder_8k = b""
            return

        # Latch de timing: ne rien envoyer tant que media_active + first_frame + silence_primed
        if not self._can_send_audio:
            return

        # 1) Resample 24kHz → 8kHz
        try:
            audio_8khz = self._downsampler.resample(audio_24khz)
        except Exception as e:
            logger.warning("Erreur resampling 24kHz→8kHz: %s", e)
            self._downsampler.reset()
            return

        # 2) Découpe en frames de 160 samples (320 bytes) et ajoute au staging
        with self._ring_lock:
            # Combiner avec remainder
            audio_8khz = self._resample_remainder_8k + audio_8khz

            # Découper en frames de 320 bytes
            frames_added = 0
            while len(audio_8khz) >= self.EXPECTED_FRAME_SIZE_8KHZ:
                frame = audio_8khz[:self.EXPECTED_FRAME_SIZE_8KHZ]
                audio_8khz = audio_8khz[self.EXPECTED_FRAME_SIZE_8KHZ:]
                self._staging_frames_8k.append(frame)
                frames_added += 1
                self._frames_staged += 1

            # Garder remainder
            self._resample_remainder_8k = audio_8khz

            staging_len = len(self._staging_frames_8k)
            ring_len = self._ring_len_frames()

        # Log (premiers appels ou activité significative)
        if self._send_to_peer_call_count <= 10 or frames_added > 5:
            logger.info(
                "📤 send_to_peer #%d: %d bytes @ 24kHz → +%d staged, staging=%d, ring=%d",
                self._send_to_peer_call_count,
                len(audio_24khz),
                frames_added,
                staging_len,
                ring_len,
            )

    def _inject_from_staging_to_ring(self) -> int:
        """Injecte des frames du staging vers le ring - tick 20ms dédié.

        NOUVELLE LOGIQUE (anti-starvation proactif):
        - Si ring < 4 et staging>0: remplir rapidement jusqu'à TARGET (8 frames)
        - Si 4 <= ring <= HIGH: injecter exactement 1 frame par tick (20ms)
        - Drop d'urgence seulement si ring >= OVERFLOW (24 frames = 480ms)
        - Guard: ne jamais dépasser RING_MAX (30 frames = 600ms max latence)

        Returns:
            Nombre de frames injectées
        """
        RING_STARVATION_THRESHOLD = 4  # < 4 frames = 80ms = risque de silence
        RING_MAX = 30  # 600ms - guard anti-latence excessive

        with self._ring_lock:
            ring_len = self._ring_len_frames()
            staging_len = len(self._staging_frames_8k)

            # Pas de staging: rien à injecter
            if staging_len == 0:
                return 0

            # ANTI-STARVATION PROACTIF: si ring < 4, remplir rapidement jusqu'à TARGET
            if ring_len < RING_STARVATION_THRESHOLD:
                frames_to_inject = min(self.RING_TARGET - ring_len, staging_len)
                if frames_to_inject > 1:  # Log seulement si injection multiple
                    logger.debug(
                        "⚡ Anti-starvation: ring=%d < %d, injection rapide de %d frames → ring=%d (staging=%d)",
                        ring_len, RING_STARVATION_THRESHOLD, frames_to_inject,
                        ring_len + frames_to_inject, staging_len
                    )
            # OVERFLOW: ne rien injecter, juste drop si nécessaire
            elif ring_len >= self.RING_OVERFLOW:
                if ring_len > self.RING_SAFE:
                    # Drop 1 frame du ring
                    del self._ring_buffer_8k[:self.EXPECTED_FRAME_SIZE_8KHZ]
                    self._drops_overflow += 1
                    logger.warning(
                        "🚨 Drop d'urgence (overflow): ring %d → %d frames",
                        ring_len, ring_len - 1
                    )
                return 0
            # NORMAL: injecter exactement 1 frame par tick (20ms)
            else:
                frames_to_inject = 1

            # GUARD: ne jamais dépasser RING_MAX (anti-latence excessive)
            space_available = RING_MAX - ring_len
            if frames_to_inject > space_available:
                frames_to_inject = max(0, space_available)
                if space_available <= 0:
                    logger.debug(
                        "⚠️ Ring buffer full (ring=%d >= max=%d), skipping injection",
                        ring_len, RING_MAX
                    )
                    return 0

            # Injecter les frames
            frames_injected = 0
            for _ in range(frames_to_inject):
                if len(self._staging_frames_8k) == 0:
                    break
                frame = self._staging_frames_8k.pop(0)
                self._ring_buffer_8k.extend(frame)
                frames_injected += 1
                self._frames_injected += 1

            return frames_injected

    def get_next_frame_8k(self) -> bytes:
        """Pull 1 frame (320 bytes @ 8kHz) avec ratio dynamique et anti-starvation.

        Appelé par AudioMediaPort.onFrameRequested() (callback synchrone PJSUA).
        Mode PULL: PJSUA demande l'audio à son rythme (20ms/frame = tick).

        ARCHITECTURE (tick 20ms):
        1. Injecter staging → ring (anti-starvation si ring=0)
        2. Calculer ratio dynamique SANS JAMAIS RALENTIR en pénurie
        3. Pull 1 frame du ring (ou silence si vide)
        4. Time-stretch si ratio > 1.0

        Returns:
            320 bytes PCM16 @ 8kHz (silence si buffer vide)
        """
        SILENCE_8K = b'\x00' * self.EXPECTED_FRAME_SIZE_8KHZ

        # 1) TICK 20ms: Injecter staging → ring (anti-starvation intégré)
        self._inject_from_staging_to_ring()

        with self._ring_lock:
            buffer_size = len(self._ring_buffer_8k)
            buffer_frames = buffer_size / self.EXPECTED_FRAME_SIZE_8KHZ
            ring_len = int(buffer_frames)

            # 2) Calculer ratio dynamique SANS RALENTIR en pénurie
            # - Si ring <= LOW (6): ratio = 1.00 (JAMAIS ralentir!)
            # - Si ring > HIGH (10): ratio = min(1 + k*(ring-target), 1.06)
            # - Sinon: ratio = 1.00 (zone de stabilité)
            if ring_len <= self.RING_LOW:
                # Pénurie: JAMAIS ralentir (ratio < 1.00)
                self._speed_ratio = 1.00
            elif ring_len > self.RING_HIGH:
                # Surplus: accélérer doucement (max 1.06x)
                self._speed_ratio = min(1.06,
                    1.0 + self.RATIO_K * (ring_len - self.RING_TARGET)
                )
            else:
                # Zone de stabilité LOW < ring <= HIGH: pas de stretch
                self._speed_ratio = 1.00

            # 3) Extraire 1 frame si disponible
            if buffer_size >= self.EXPECTED_FRAME_SIZE_8KHZ:
                frame_8k = bytes(self._ring_buffer_8k[:self.EXPECTED_FRAME_SIZE_8KHZ])
                del self._ring_buffer_8k[:self.EXPECTED_FRAME_SIZE_8KHZ]
                is_silence = False
                self._frames_pulled += 1

                # Timing diagnostic: premier pull non-silence (t4)
                if self._t4_first_real_pull is None and self._frames_pulled == 1:
                    import time
                    self._t4_first_real_pull = time.monotonic()
                    if self._t3_first_send_to_peer is not None:
                        delta = (self._t4_first_real_pull - self._t3_first_send_to_peer) * 1000
                        logger.info(
                            "🎵 [t4=%.3fs, Δt3→t4=%.1fms] Premier PULL non-silence",
                            self._t4_first_real_pull, delta
                        )
            else:
                # Buffer vide: retourner silence
                frame_8k = SILENCE_8K
                is_silence = True
                self._silence_pulled += 1

        # 4) Appliquer time-stretch si ratio > 1.0 (accélération uniquement, jamais ralentir)
        if self._speed_ratio > 1.01 and not is_silence:
            try:
                stretched = self._timestretch_8k.process(frame_8k, self._speed_ratio)
                if len(stretched) > 0:
                    frame_8k = stretched
            except Exception as e:
                logger.warning("Erreur time-stretch @ 8kHz: %s, utilisation frame originale", e)

        # Log périodique avec statistiques détaillées
        if (self._frames_pulled + self._silence_pulled) % 100 == 0:
            with self._ring_lock:
                staging_len = len(self._staging_frames_8k)

            logger.debug(
                "📊 PULL stats: %d pulled, %d silence, %d overflow drops, ratio=%.3fx, ring=%d, staging=%d",
                self._frames_pulled,
                self._silence_pulled,
                self._drops_overflow,
                self._speed_ratio,
                ring_len,
                staging_len,
            )

        return frame_8k

    def clear_audio_queue(self) -> int:
        """Clear the ring buffer and staging buffer (used during interruptions).

        Purge instantanée:
        - Vide le ring buffer @ 8kHz ET le staging buffer
        - Active le flag drop pour ignorer les chunks assistant en vol
        - L'assistant doit appeler resume_after_interruption() quand il reprend

        Returns:
            Number of frames cleared from ring
        """
        # Vider le ring buffer ET le staging buffer thread-safe
        with self._ring_lock:
            buffer_size = len(self._ring_buffer_8k)
            buffer_frames = buffer_size / self.EXPECTED_FRAME_SIZE_8KHZ
            staging_frames = len(self._staging_frames_8k)

            self._ring_buffer_8k.clear()
            self._staging_frames_8k.clear()
            self._resample_remainder_8k = b""

        # Activer le flag pour dropper tous les chunks assistant jusqu'à reprise
        self._drop_until_next_assistant = True

        # Réinitialiser l'état des resamplers pour éviter des artefacts
        self._downsampler.reset()
        self._upsampler.reset()
        self._timestretch_8k.reset()

        if buffer_frames > 0 or staging_frames > 0:
            logger.info(
                "🗑️ Purge interruption: ring=%.1f frames, staging=%d frames - drop activé",
                buffer_frames,
                staging_frames,
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
        # Log statistiques finales détaillées
        with self._ring_lock:
            staging_remaining = len(self._staging_frames_8k)
            ring_remaining = self._ring_len_frames()

        logger.info(
            "🛑 Audio bridge final stats: %d staged, %d injected, %d pulled, %d silence, %d overflow drops",
            self._frames_staged,
            self._frames_injected,
            self._frames_pulled,
            self._silence_pulled,
            self._drops_overflow,
        )

        if self._drops_overflow > 0:
            overflow_rate = (self._drops_overflow / self._frames_injected * 100) if self._frames_injected > 0 else 0
            logger.warning(
                "⚠️ Overflow drops: %d frames (%.1f%% of injected)",
                self._drops_overflow,
                overflow_rate,
            )

        if staging_remaining > 0 or ring_remaining > 0:
            logger.info(
                "📊 Remaining buffers: staging=%d frames, ring=%d frames",
                staging_remaining,
                ring_remaining,
            )

        logger.info("Stopping PJSUA audio bridge")
        self._stop_event.set()

        # Clear ring buffer and staging buffer
        with self._ring_lock:
            self._ring_buffer_8k.clear()
            self._staging_frames_8k.clear()
            self._resample_remainder_8k = b""

        # Reset resamplers and time-stretcher state
        self._downsampler.reset()
        self._upsampler.reset()
        self._timestretch_8k.reset()

        # Reset state
        self._speed_ratio = 1.0

    def reset_all(self) -> None:
        """Reset agressif de tout l'état au début d'un nouvel appel.

        CRITICAL: Appelé APRÈS CONFIRMED et AVANT de déverrouiller l'envoi TTS.
        Casse tout état résiduel (buffers, WSOLA, resamplers, jitter).
        """
        logger.info("🔄 Reset agressif de l'audio bridge (nouveau appel)")

        with self._ring_lock:
            # 1. Clear tous les buffers
            self._ring_buffer_8k.clear()
            self._staging_frames_8k.clear()
            self._resample_remainder_8k = b""
            self._upsample_remainder = b""

            # 2. Reset counters
            self._send_to_peer_call_count = 0
            self._frames_pulled = 0
            self._silence_pulled = 0
            self._drops_overflow = 0
            self._frames_injected = 0
            self._frames_staged = 0

            # 3. Reset timing/ratio
            self._speed_ratio = 1.0
            self._last_injection_time = 0.0
            self._injection_credits = 0.0

            # 4. Reset flags
            self._can_send_audio = False
            self._drop_until_next_assistant = False

            # 5. Reset timing diagnostics
            self._t0_first_rtp = None
            self._t1_response_create = None
            self._t2_first_tts_chunk = None
            self._t3_first_send_to_peer = None
            self._t4_first_real_pull = None

        # 6. Reset WSOLA (time-stretcher) - casse l'état interne
        self._timestretch_8k.reset()

        # 6. Reset resamplers - reinit pour éviter état résiduel
        # Note: get_resampler crée de nouvelles instances
        self._downsampler.reset()
        self._upsampler.reset()

        logger.info("✅ Reset agressif terminé - état vierge")

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

    # 📊 Diagnostic: Stocker le call_id ChatKit dans le bridge
    if hasattr(call, 'chatkit_call_id'):
        bridge._chatkit_call_id = call.chatkit_call_id

    # Stocker le bridge sur le call pour que AudioMediaPort puisse le récupérer
    # Le port sera créé plus tard dans onCallMediaState() et pourra accéder au bridge
    call._audio_bridge = bridge
    logger.info("✅ Bridge stocké sur Call (sera connecté au port quand créé)")

    # Récupérer l'event frame_requested de CET appel (pas de l'adaptateur
    # global). Chaque appel a son propre event pour éviter les problèmes de
    # timing sur les appels successifs.
    pjsua_ready_event = call._frame_requested_event

    # Créer une fonction pour vider la queue ENTRANTE (silence accumulé)
    # Cette fonction appelle l'adaptateur pour vider _incoming_audio_queue
    def clear_incoming_queue() -> int:
        """Vide la queue audio entrante (silence accumulé avant session)."""
        return call.adapter.clear_call_incoming_audio_queue(call)

    return (
        bridge.rtp_stream(media_active_event),
        bridge.send_to_peer,
        clear_incoming_queue,  # Vide la queue ENTRANTE au lieu de la queue sortante
        bridge.first_packet_received_event,
        pjsua_ready_event,
        bridge,
    )


__all__ = [
    "PJSUAAudioBridge",
    "create_pjsua_audio_bridge",
]
