"""Utilitaires de streaming pour l'exécution des workflows ChatKit."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator, Coroutine

logger = logging.getLogger("chatkit.server")


def _log_background_exceptions(task: asyncio.Task[None]) -> None:
    try:
        exception = task.exception()
    except asyncio.CancelledError:  # pragma: no cover - annulation explicite
        logger.info("Traitement du workflow annulé")
        return
    except Exception:  # pragma: no cover - erreur lors de l'inspection
        logger.exception("Erreur lors de la récupération de l'exception de la tâche")
        return

    if exception:
        logger.exception("Erreur dans la tâche de workflow", exc_info=exception)


_STREAM_DONE = object()


class _WorkflowStreamResult:
    """Adaptateur minimal pour exposer les événements du workflow."""

    def __init__(
        self,
        *,
        runner: Coroutine[Any, Any, None],
        event_queue: asyncio.Queue[Any],
    ) -> None:
        self._event_queue = event_queue
        self._task = asyncio.create_task(runner)
        self._task.add_done_callback(_log_background_exceptions)

    async def stream_events(self) -> AsyncIterator[Any]:
        while True:
            event = await self._event_queue.get()
            if event is _STREAM_DONE:
                break
            yield event

        await self._task


__all__ = ["_WorkflowStreamResult", "_STREAM_DONE", "_log_background_exceptions"]
