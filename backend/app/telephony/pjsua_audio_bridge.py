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

    # --- NOUVEAU : Constantes pour le découpage (chunking) ---
    # Paquets PJSUA = 20ms (160 samples * 2 bytes/sample = 320 bytes @ 8kHz)
    PJSUA_CHUNK_SIZE_BYTES = (PJSUA_SAMPLE_RATE // 50) * BYTES_PER_SAMPLE * CHANNELS

    # Traiter l'audio par blocs de 100ms (2400 samples * 2 bytes/sample = 4800 bytes @ 24kHz)
    # pour ne pas bloquer le thread pool trop longtemps sur un seul gros chunk.
    INTERNAL_CHUNK_SIZE_MS = 100
    INTERNAL_CHUNK_SIZE_BYTES = (VOICE_BRIDGE_SAMPLE_RATE // (1000 // INTERNAL_CHUNK_SIZE_MS)) * BYTES_PER_SAMPLE * CHANNELS
    
    # Délai de "yield" à l'event loop pour le cadencement (pacing)
    PACING_DELAY_SECONDS = 0.01 # 10ms

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
        self._first_packet_received = asyncio.Event()

        # --- NOUVEAU : Buffers et verrous pour le traitement audio sortant ---
        
        # État pour le rééchantillonnage 24kHz -> 8kHz (corrige la qualité audio)
        self._resample_state_24_to_8 = None
        
        # Buffer pour les trames partielles (corrige les fins de phrases coupées)
        self._partial_chunk_buffer = b""
        
        # Verrou pour protéger l'état de rééchantillonnage et le buffer partiel
        # contre les accès concurrents (car on utilise asyncio.to_thread)
        self._processing_lock = asyncio.Lock()
        
        # Note: self._outgoing_audio_queue n'est pas utilisé, 
        # la communication se fait par self._adapter.send_audio_to_call
        # self._outgoing_audio_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=100)


    async def rtp_stream(self) -> AsyncIterator[RtpPacket]:
        """Generate RTP packets from PJSUA audio (8kHz → 24kHz).

        This is consumed by TelephonyVoiceBridge.run(rtp_stream=...).
        Reads 8kHz PCM from PJSUA, resamples to 24kHz, and yields RtpPacket.

        Yields:
            RtpPacket with 24kHz PCM16 audio
        """
        logger.info("Starting RTP stream from PJSUA (8kHz → 24kHz)")
        resampling_state = None # L'état est local à ce générateur (flux entrant)

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
                    continue

                # Signaler la réception du premier paquet pour confirmer que le flux est établi
                if packet_count == 0:
                    logger.info("📥 Premier paquet audio reçu du téléphone - flux bidirectionnel confirmé (après %d None)", none_count)
                    self._first_packet_received.set()

                # Log first few packets for diagnostics
                max_amplitude = audioop.max(audio_8khz, self.BYTES_PER_SAMPLE)
                if packet_count < 5 or (packet_count % 100 == 0): # Log les 5 premiers, puis 1/100
                    logger.debug("📥 RTP stream #%d: reçu %d bytes @ 8kHz (max_amplitude=%d)",
                                 packet_count, len(audio_8khz), max_amplitude)

                # Resample 8kHz → 24kHz
                try:
                    # Cette opération est bloquante, mais sur de petits chunks (320b)
                    # c'est très rapide et acceptable. Le vrai problème est sur send_to_peer.
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
                samples_in_packet = len(audio_24khz) // self.BYTES_PER_SAMPLE
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

    # --- NOUVELLE FONCTION HELPER (SYNCHRONE) ---
    def _process_outgoing_chunk_sync(self, audio_24khz: bytes) -> bytes:
        """
        Fonction synchrone (bloquante) pour le thread pool.
        Traite un petit chunk d'audio (rééchantillonnage et normalisation).
        
        IMPORTANT: Cette fonction n'est PAS thread-safe en elle-même
        car elle modifie self._resample_state_24_to_8.
        Elle DOIT être appelée depuis un contexte qui détient self._processing_lock.
        """
        try:
            # 1. Resample 24kHz -> 8kHz, en PRÉSERVANT l'état
            # (Corrige la qualité audio / "clics")
            audio_8khz, self._resample_state_24_to_8 = audioop.ratecv(
                audio_24khz,
                self.BYTES_PER_SAMPLE,
                self.CHANNELS,
                self.VOICE_BRIDGE_SAMPLE_RATE,
                self.PJSUA_SAMPLE_RATE,
                self._resample_state_24_to_8,  # <-- Utilise et met à jour l'état
            )

            # 2. Normalize
            max_amplitude = audioop.max(audio_8khz, self.BYTES_PER_SAMPLE)
            if max_amplitude > 0:
                # Target: 60% de la plage (32767 * 0.6 = ~19660)
                target_amplitude = int(32767 * 0.6)
                gain = target_amplitude / max_amplitude
                # Limiter le gain: min 1.0 (pas de réduction), max 100.0
                gain = max(1.0, min(gain, 100.0))
                audio_8khz = audioop.mul(audio_8khz, self.BYTES_PER_SAMPLE, gain)
                # logger.debug("🔊 Audio normalisé (max=%d, gain=%.1fx, amplitude finale=%d)",
                #                max_amplitude, gain, int(max_amplitude * gain))
            
            return audio_8khz

        except audioop.error as e:
            logger.warning("Resampling/Normalization error (24kHz→8kHz): %s", e)
            return b""
        except Exception as e:
            logger.exception("Unknown error in _process_outgoing_chunk_sync: %s", e)
            return b""

    # --- FONCTION send_to_peer ENTIÈREMENT RÉÉCRITE ---
    async def send_to_peer(self, audio_24khz: bytes) -> None:
        """
        Envoie l'audio à PJSUA, en découpant les gros blocs pour ne pas
        bloquer l'event loop ou inonder la file d'attente.
        """
        if not audio_24khz:
            return

        logger.debug("📤 send_to_peer: reçu %d bytes @ 24kHz", len(audio_24khz))

        try:
            # Découpe le gros bloc entrant en petits chunks internes (ex: 100ms)
            for i in range(0, len(audio_24khz), self.INTERNAL_CHUNK_SIZE_BYTES):
                
                small_chunk_24khz = audio_24khz[i:i + self.INTERNAL_CHUNK_SIZE_BYTES]
                
                # Le verrou protège self._resample_state_24_to_8 et self._partial_chunk_buffer
                async with self._processing_lock:
                    
                    # 1. Exécute le travail CPU bloquant dans un thread séparé
                    # (Corrige le blocage de l'event loop)
                    audio_8khz = await asyncio.to_thread(
                        self._process_outgoing_chunk_sync,
                        small_chunk_24khz
                    )

                    if not audio_8khz:
                        continue

                    # 2. Ajoute le reste du buffer précédent (corrige fins de phrases)
                    combined_buffer = self._partial_chunk_buffer + audio_8khz
                    
                    frames_sent = 0
                    
                    # 3. Envoie tous les chunks complets de 320 bytes
                    while len(combined_buffer) >= self.PJSUA_CHUNK_SIZE_BYTES:
                        chunk_to_send = combined_buffer[:self.PJSUA_CHUNK_SIZE_BYTES]
                        self._adapter.send_audio_to_call(self._call, chunk_to_send)
                        combined_buffer = combined_buffer[self.PJSUA_CHUNK_SIZE_BYTES:]
                        frames_sent += 1

                    # 4. Sauvegarde le reste pour la prochaine fois
                    self._partial_chunk_buffer = combined_buffer
                    
                    if frames_sent > 0:
                        q_size = self._adapter.get_call_audio_queue_size(self._call)
                        logger.debug("✅ send_to_peer: %d frames enfilées (queue: %d frames, %.0f ms)",
                                     frames_sent, q_size, q_size * 20.0)
                    elif self._partial_chunk_buffer:
                         logger.debug("💾 %d bytes incomplets sauvegardés pour prochain chunk", len(self._partial_chunk_buffer))


                # 5. !!! TRÈS IMPORTANT : CADENCEMENT (PACING) !!!
                # Cède le contrôle à l'event loop pour laisser le consommateur
                # (onFrameRequested) vider la file d'attente.
                # (Corrige l'inondation du buffer et les "sauts")
                await asyncio.sleep(self.PACING_DELAY_SECONDS)

        except Exception as e:
            logger.exception("Failed in send_to_peer chunking loop: %s", e)

    # --- NOUVEAU : clear_audio_queue modifié pour nettoyer les buffers internes ---
    async def _clear_internal_buffers(self) -> None:
        """Nettoie de manière thread-safe les buffers internes."""
        async with self._processing_lock:
            logger.debug("Internal buffers cleared (resample state + partial chunk)")
            self._resample_state_24_to_8 = None
            self._partial_chunk_buffer = b""

    def clear_audio_queue(self) -> int:
        """Clear the outgoing audio queue (used during interruptions).

        Returns:
            Number of frames cleared
        """
        # Crée une tâche pour nettoyer les buffers internes sans bloquer
        # la fonction (qui est synchrone)
        asyncio.create_task(self._clear_internal_buffers())
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
    """Create audio bridge components for a PJSUA call. (INCHANGÉ)"""
    bridge = PJSUAAudioBridge(call)
    return bridge.rtp_stream(), bridge.send_to_peer, bridge.clear_audio_queue, bridge.first_packet_received_event, bridge


__all__ = [
    "PJSUAAudioBridge",
    "create_pjsua_audio_bridge",
]