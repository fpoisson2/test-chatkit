"""In-memory pub/sub for live workflow content updates via SSE."""

from __future__ import annotations

import asyncio
import logging
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
    """Simple in-memory pub/sub for broadcasting step content changes."""

    def __init__(self) -> None:
        self._subscribers: dict[int, list[asyncio.Queue[StepContentUpdate | None]]] = {}

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

    async def publish(self, event: StepContentUpdate) -> None:
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
