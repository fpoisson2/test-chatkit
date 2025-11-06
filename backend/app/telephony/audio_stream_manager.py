"""Gestionnaire de streaming audio en temps réel pour les appels sortants."""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger("chatkit.telephony.audio_stream")


class AudioStreamManager:
    """Gère les connexions WebSocket pour le streaming audio en temps réel."""

    def __init__(self):
        """Initialise le gestionnaire de streaming audio."""
        self._streams: dict[str, list[asyncio.Queue]] = {}  # call_id -> list of queues
        self._lock = asyncio.Lock()

    async def register_listener(self, call_id: str) -> asyncio.Queue:
        """Enregistre un nouveau listener pour un appel.

        Args:
            call_id: ID de l'appel

        Returns:
            Queue pour recevoir les chunks audio
        """
        async with self._lock:
            if call_id not in self._streams:
                self._streams[call_id] = []
            queue: asyncio.Queue = asyncio.Queue(maxsize=100)  # Buffer 100 chunks
            self._streams[call_id].append(queue)
            logger.info("Registered audio listener for call %s (total: %d)", call_id, len(self._streams[call_id]))
            return queue

    async def unregister_listener(self, call_id: str, queue: asyncio.Queue) -> None:
        """Désenregistre un listener.

        Args:
            call_id: ID de l'appel
            queue: Queue du listener à supprimer
        """
        async with self._lock:
            if call_id in self._streams:
                try:
                    self._streams[call_id].remove(queue)
                    logger.info("Unregistered audio listener for call %s (remaining: %d)", call_id, len(self._streams[call_id]))
                    if not self._streams[call_id]:
                        del self._streams[call_id]
                except ValueError:
                    pass

    async def broadcast_audio(self, call_id: str, audio_data: bytes, channel: str = "mixed") -> None:
        """Diffuse un chunk audio à tous les listeners d'un appel.

        Args:
            call_id: ID de l'appel
            audio_data: Données audio PCM
            channel: Canal audio ('inbound', 'outbound', ou 'mixed')
        """
        async with self._lock:
            if call_id not in self._streams or not self._streams[call_id]:
                return

            # Créer le paquet audio avec métadonnées
            packet = {
                "type": "audio",
                "channel": channel,
                "data": audio_data,
                "timestamp": asyncio.get_event_loop().time(),
            }

            # Envoyer à toutes les queues
            for queue in self._streams[call_id][:]:  # Copy list to avoid modification during iteration
                try:
                    # Non-blocking put avec timeout
                    queue.put_nowait(packet)
                except asyncio.QueueFull:
                    logger.warning("Audio queue full for call %s, dropping packet", call_id)

    async def close_call(self, call_id: str) -> None:
        """Ferme tous les streams pour un appel.

        Args:
            call_id: ID de l'appel
        """
        async with self._lock:
            if call_id in self._streams:
                # Envoyer un paquet de fin à tous les listeners
                end_packet = {
                    "type": "end",
                    "timestamp": asyncio.get_event_loop().time(),
                }
                for queue in self._streams[call_id]:
                    try:
                        queue.put_nowait(end_packet)
                    except asyncio.QueueFull:
                        pass
                del self._streams[call_id]
                logger.info("Closed all audio streams for call %s", call_id)


# Instance globale
_audio_stream_manager: AudioStreamManager | None = None


def get_audio_stream_manager() -> AudioStreamManager:
    """Récupère l'instance globale du gestionnaire de streaming audio."""
    global _audio_stream_manager
    if _audio_stream_manager is None:
        _audio_stream_manager = AudioStreamManager()
    return _audio_stream_manager
