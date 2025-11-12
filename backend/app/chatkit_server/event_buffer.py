"""Buffer global des événements de streaming par thread.

Permet aux clients qui se reconnectent de récupérer les événements
manqués pendant leur déconnexion.
"""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from datetime import datetime, timedelta
from typing import Any

logger = logging.getLogger("chatkit.server")


class ThreadEventBuffer:
    """Buffer global des événements récents par thread.

    Conserve les événements de streaming en mémoire pour permettre
    aux clients déconnectés de les récupérer lors de la reconnexion.
    """

    def __init__(
        self,
        max_events_per_thread: int = 200,
        retention_minutes: int = 30,
    ) -> None:
        """Initialize the event buffer.

        Args:
            max_events_per_thread: Nombre maximum d'événements à conserver par thread
            retention_minutes: Durée de conservation des buffers inactifs (minutes)
        """
        self._buffers: dict[str, deque] = {}
        self._last_activity: dict[str, datetime] = {}
        self._lock = asyncio.Lock()
        self._max_events = max_events_per_thread
        self._retention = timedelta(minutes=retention_minutes)

    async def add_event(self, thread_id: str, event: Any) -> None:
        """Ajoute un événement au buffer d'un thread.

        Args:
            thread_id: ID du thread
            event: Événement à bufferiser
        """
        async with self._lock:
            if thread_id not in self._buffers:
                self._buffers[thread_id] = deque(maxlen=self._max_events)

            self._buffers[thread_id].append(
                {"event": event, "timestamp": datetime.utcnow()}
            )
            self._last_activity[thread_id] = datetime.utcnow()

    async def get_buffered_events(
        self, thread_id: str, since: datetime | None = None
    ) -> list[Any]:
        """Récupère les événements bufferisés d'un thread.

        Args:
            thread_id: ID du thread
            since: Optionnel - ne retourner que les événements après cette date

        Returns:
            Liste des événements bufferisés
        """
        async with self._lock:
            if thread_id not in self._buffers:
                return []

            events = list(self._buffers[thread_id])

            if since:
                events = [e for e in events if e["timestamp"] > since]

            return [e["event"] for e in events]

    async def clear_thread(self, thread_id: str) -> None:
        """Supprime le buffer d'un thread.

        Args:
            thread_id: ID du thread à supprimer
        """
        async with self._lock:
            self._buffers.pop(thread_id, None)
            self._last_activity.pop(thread_id, None)

    async def cleanup_old_threads(self) -> None:
        """Supprime les buffers inactifs depuis > retention_minutes."""
        async with self._lock:
            now = datetime.utcnow()
            to_remove = [
                thread_id
                for thread_id, last_time in self._last_activity.items()
                if now - last_time > self._retention
            ]

            for thread_id in to_remove:
                del self._buffers[thread_id]
                del self._last_activity[thread_id]

            if to_remove:
                logger.info(
                    "Nettoyé %d buffers de threads inactifs", len(to_remove)
                )

    async def get_stats(self) -> dict[str, Any]:
        """Retourne des statistiques sur les buffers.

        Returns:
            Dictionnaire avec les statistiques
        """
        async with self._lock:
            return {
                "active_threads": len(self._buffers),
                "total_buffered_events": sum(
                    len(buf) for buf in self._buffers.values()
                ),
                "threads": {
                    thread_id: {
                        "event_count": len(buf),
                        "last_activity": self._last_activity[thread_id].isoformat(),
                    }
                    for thread_id, buf in self._buffers.items()
                },
            }


# Singleton global
_event_buffer = ThreadEventBuffer()
_cleanup_task: asyncio.Task | None = None


async def _periodic_cleanup() -> None:
    """Tâche de nettoyage périodique des buffers inactifs."""
    while True:
        try:
            await asyncio.sleep(300)  # Toutes les 5 minutes
            await _event_buffer.cleanup_old_threads()
        except asyncio.CancelledError:
            logger.info("Arrêt de la tâche de nettoyage du buffer d'événements")
            break
        except Exception as exc:  # pragma: no cover
            logger.exception(
                "Erreur dans la tâche de nettoyage du buffer", exc_info=exc
            )


def get_event_buffer() -> ThreadEventBuffer:
    """Retourne l'instance singleton du buffer d'événements.

    Démarre automatiquement la tâche de nettoyage périodique
    lors du premier appel.
    """
    global _cleanup_task

    if _cleanup_task is None:
        try:
            # Démarrer la tâche de nettoyage périodique
            _cleanup_task = asyncio.create_task(_periodic_cleanup())
            logger.info("Tâche de nettoyage du buffer d'événements démarrée")
        except RuntimeError:  # pragma: no cover - pas de event loop
            pass

    return _event_buffer
