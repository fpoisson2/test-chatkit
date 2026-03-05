"""In-memory pub/sub for live workflow content updates via SSE + polling."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class StepContentUpdate:
    """Event representing a live edit of a workflow step's message."""

    workflow_id: int
    step_slug: str
    new_text: str


class LiveUpdateManager:
    """Simple in-memory pub/sub for broadcasting step content changes.

    Also tracks per-workflow update timestamps for polling-based clients.
    """

    def __init__(self) -> None:
        self._subscribers: dict[int, list[asyncio.Queue[StepContentUpdate | None]]] = {}
        # Track last update timestamp per workflow for polling
        self._last_updated: dict[int, float] = {}

    def subscribe(self, workflow_id: int) -> asyncio.Queue[StepContentUpdate | None]:
        queue: asyncio.Queue[StepContentUpdate | None] = asyncio.Queue()
        self._subscribers.setdefault(workflow_id, []).append(queue)
        logger.info("Live update subscriber added for workflow %s (total: %s)",
                     workflow_id, len(self._subscribers[workflow_id]))
        return queue

    def unsubscribe(self, workflow_id: int, queue: asyncio.Queue[StepContentUpdate | None]) -> None:
        subs = self._subscribers.get(workflow_id, [])
        try:
            subs.remove(queue)
        except ValueError:
            pass
        if not subs:
            self._subscribers.pop(workflow_id, None)
        logger.info("Live update subscriber removed for workflow %s", workflow_id)

    def get_last_updated(self, workflow_id: int) -> float:
        return self._last_updated.get(workflow_id, 0.0)

    async def publish(self, event: StepContentUpdate) -> None:
        self._last_updated[event.workflow_id] = time.time()
        subs = self._subscribers.get(event.workflow_id, [])
        if not subs:
            return
        logger.info("Publishing live update for workflow %s step %s to %s subscriber(s)",
                     event.workflow_id, event.step_slug, len(subs))
        dead: list[asyncio.Queue[StepContentUpdate | None]] = []
        for queue in subs:
            try:
                queue.put_nowait(event)
            except Exception:
                dead.append(queue)
        for q in dead:
            self.unsubscribe(event.workflow_id, q)


# Global singleton
live_update_manager = LiveUpdateManager()
