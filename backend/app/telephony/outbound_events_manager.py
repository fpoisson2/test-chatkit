"""Gestionnaire d'événements pour les appels sortants."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

logger = logging.getLogger("chatkit.telephony.outbound_events")


class OutboundEventsManager:
    """Gère les connexions WebSocket pour les événements d'appels sortants."""

    def __init__(self):
        """Initialise le gestionnaire d'événements."""
        self._listeners: list[asyncio.Queue] = []
        self._lock = asyncio.Lock()

    async def register_listener(self) -> asyncio.Queue:
        """Enregistre un nouveau listener pour les événements d'appels.

        Returns:
            Queue pour recevoir les événements
        """
        async with self._lock:
            queue: asyncio.Queue = asyncio.Queue(maxsize=50)
            self._listeners.append(queue)
            logger.info("Registered outbound call events listener (total: %d)", len(self._listeners))
            return queue

    async def unregister_listener(self, queue: asyncio.Queue) -> None:
        """Désenregistre un listener.

        Args:
            queue: Queue du listener à supprimer
        """
        async with self._lock:
            try:
                self._listeners.remove(queue)
                logger.info("Unregistered outbound call events listener (remaining: %d)", len(self._listeners))
            except ValueError:
                pass

    async def emit_event(self, event: dict[str, Any]) -> None:
        """Émet un événement à tous les listeners.

        Args:
            event: Événement à émettre (doit contenir au minimum 'type' et 'call_id')
        """
        async with self._lock:
            if not self._listeners:
                logger.debug("No listeners for outbound call event: %s", event.get("type"))
                return

            event_json = json.dumps(event)
            logger.info("Broadcasting outbound call event: %s", event.get("type"))

            # Envoyer à toutes les queues
            for queue in self._listeners[:]:  # Copy list to avoid modification during iteration
                try:
                    queue.put_nowait(event_json)
                except asyncio.QueueFull:
                    logger.warning("Event queue full, dropping event")


# Instance globale
_outbound_events_manager: OutboundEventsManager | None = None


def get_outbound_events_manager() -> OutboundEventsManager:
    """Retourne l'instance globale du gestionnaire d'événements."""
    global _outbound_events_manager
    if _outbound_events_manager is None:
        _outbound_events_manager = OutboundEventsManager()
    return _outbound_events_manager
