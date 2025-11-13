"""Buffer des événements de streaming pour reprise après déconnexion."""

from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict
from collections.abc import AsyncIterator
from typing import Any

logger = logging.getLogger("chatkit.server")


class EventBuffer:
    """Buffer des événements de streaming par thread pour permettre la reprise."""

    def __init__(self, ttl_seconds: int = 300) -> None:
        """
        Initialise le buffer d'événements.

        Args:
            ttl_seconds: Durée de vie des événements bufferisés en secondes (défaut: 5 min)
        """
        self._buffers: dict[str, list[tuple[float, Any]]] = defaultdict(list)
        self._ttl_seconds = ttl_seconds
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._cleanup_task: asyncio.Task[None] | None = None

    def start_cleanup_task(self) -> None:
        """Démarre la tâche de nettoyage périodique des buffers expirés."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def _cleanup_loop(self) -> None:
        """Nettoie périodiquement les événements expirés."""
        while True:
            try:
                await asyncio.sleep(60)  # Nettoyage toutes les minutes
                await self._cleanup_expired()
            except asyncio.CancelledError:
                break
            except Exception:  # pragma: no cover
                logger.exception("Erreur lors du nettoyage du buffer d'événements")

    async def _cleanup_expired(self) -> None:
        """Supprime les événements expirés de tous les buffers."""
        current_time = time.time()
        cutoff = current_time - self._ttl_seconds

        threads_to_remove = []
        for thread_id in list(self._buffers.keys()):
            async with self._locks[thread_id]:
                buffer = self._buffers[thread_id]
                # Garde seulement les événements non expirés
                self._buffers[thread_id] = [
                    (ts, event) for ts, event in buffer if ts > cutoff
                ]

                # Si le buffer est vide, le marquer pour suppression
                if not self._buffers[thread_id]:
                    threads_to_remove.append(thread_id)

        # Supprimer les buffers vides
        for thread_id in threads_to_remove:
            del self._buffers[thread_id]
            del self._locks[thread_id]

        if threads_to_remove:
            logger.debug(
                "Nettoyage de %d buffer(s) expiré(s): %s",
                len(threads_to_remove),
                threads_to_remove,
            )

    async def add_event(self, thread_id: str, event: Any) -> None:
        """
        Ajoute un événement au buffer du thread.

        Args:
            thread_id: ID du thread
            event: Événement à bufferiser
        """
        async with self._locks[thread_id]:
            timestamp = time.time()
            self._buffers[thread_id].append((timestamp, event))
            logger.debug(
                "Événement ajouté au buffer du thread %s (total: %d)",
                thread_id,
                len(self._buffers[thread_id]),
            )

    async def get_events_since(
        self, thread_id: str, after_item_id: str | None = None
    ) -> list[Any]:
        """
        Récupère les événements bufferisés depuis un item_id donné.

        Args:
            thread_id: ID du thread
            after_item_id: ID de l'item après lequel reprendre (None = tous les événements)

        Returns:
            Liste des événements bufferisés
        """
        async with self._locks[thread_id]:
            buffer = self._buffers.get(thread_id, [])

            if not buffer:
                return []

            # Si pas d'after_item_id, retourner tous les événements
            if after_item_id is None:
                events = [event for _, event in buffer]
                logger.debug(
                    "Récupération de tous les événements bufferisés du thread %s (%d)",
                    thread_id,
                    len(events),
                )
                return events

            # Chercher l'événement correspondant à after_item_id
            events = []
            found_marker = False
            for _, event in buffer:
                # Si on a trouvé le marqueur, ajouter tous les événements suivants
                if found_marker:
                    events.append(event)
                    continue

                # Chercher l'item_id dans l'événement
                item_id = self._extract_item_id(event)
                if item_id == after_item_id:
                    found_marker = True

            logger.debug(
                "Récupération des événements après %s du thread %s (%d événements)",
                after_item_id,
                thread_id,
                len(events),
            )
            return events

    def _extract_item_id(self, event: Any) -> str | None:
        """
        Extrait l'item_id d'un événement.

        Args:
            event: Événement dont extraire l'ID

        Returns:
            L'item_id ou None si non trouvé
        """
        # ThreadItemDoneEvent a un attribut 'item' avec un 'id'
        if hasattr(event, "item") and hasattr(event.item, "id"):
            return event.item.id

        # EndOfTurnItem a directement un 'id'
        if hasattr(event, "id"):
            return event.id

        return None

    async def clear_buffer(self, thread_id: str) -> None:
        """
        Vide le buffer d'un thread.

        Args:
            thread_id: ID du thread dont vider le buffer
        """
        async with self._locks[thread_id]:
            if thread_id in self._buffers:
                count = len(self._buffers[thread_id])
                del self._buffers[thread_id]
                logger.debug("Buffer du thread %s vidé (%d événements)", thread_id, count)

    async def stream_events_since(
        self, thread_id: str, after_item_id: str | None = None
    ) -> AsyncIterator[Any]:
        """
        Stream les événements bufferisés depuis un item_id donné.

        Args:
            thread_id: ID du thread
            after_item_id: ID de l'item après lequel reprendre

        Yields:
            Événements bufferisés
        """
        events = await self.get_events_since(thread_id, after_item_id)
        for event in events:
            yield event


__all__ = ["EventBuffer"]
