"""Gestion des attentes d'actions sur les widgets pour le serveur ChatKit."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Mapping

from chatkit.types import ThreadMetadata

logger = logging.getLogger("chatkit.server")


@dataclass
class _WidgetActionWaiter:
    slug: str | None
    widget_item_id: str | None
    event: asyncio.Event
    payload: Mapping[str, Any] | None = None


class WidgetWaiterRegistry:
    """Gestion concurrente des attentes d'interaction utilisateur sur un widget."""

    def __init__(self) -> None:
        self._waiters: dict[str, _WidgetActionWaiter] = {}
        self._lock = asyncio.Lock()

    async def wait_for_action(
        self,
        thread: ThreadMetadata,
        *,
        step_slug: str,
        widget_item_id: str | None,
    ) -> Mapping[str, Any] | None:
        waiter = _WidgetActionWaiter(
            slug=step_slug,
            widget_item_id=widget_item_id,
            event=asyncio.Event(),
        )
        async with self._lock:
            self._waiters[thread.id] = waiter

        logger.info(
            "En attente d'une action utilisateur pour le widget %s (item=%s)",
            step_slug,
            widget_item_id,
        )

        try:
            await waiter.event.wait()
            payload = waiter.payload
        finally:
            async with self._lock:
                existing = self._waiters.get(thread.id)
                if existing is waiter:
                    self._waiters.pop(thread.id, None)

        logger.info(
            "Action utilisateur détectée pour le widget %s, poursuite du workflow.",
            step_slug,
        )
        return payload

    async def signal(
        self,
        thread_id: str,
        *,
        widget_item_id: str | None,
        widget_slug: str | None,
        payload: Mapping[str, Any] | None = None,
    ) -> bool:
        async with self._lock:
            waiter = self._waiters.get(thread_id)
            if waiter is None:
                return False

            id_matches = (
                waiter.widget_item_id is None
                or widget_item_id is None
                or waiter.widget_item_id == widget_item_id
            )
            slug_matches = (
                waiter.slug is None
                or widget_slug is None
                or waiter.slug == widget_slug
            )

            if not id_matches and not slug_matches:
                logger.debug(
                    "Action reçue pour le widget %s (item=%s) alors que %s est attendu (item=%s).",
                    widget_slug,
                    widget_item_id,
                    waiter.slug,
                    waiter.widget_item_id,
                )
                return False

            if payload is not None:
                waiter.payload = payload
            waiter.event.set()
            return True


__all__ = ["WidgetWaiterRegistry", "_WidgetActionWaiter"]
