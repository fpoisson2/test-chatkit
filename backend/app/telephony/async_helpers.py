"""Async utilities for interacting with asyncio event loops from threads."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable
from concurrent.futures import Future
from typing import Any


def schedule_coroutine_from_thread(
    coro: Awaitable[Any],
    loop: asyncio.AbstractEventLoop,
    *,
    callback_name: str = "callback",
    logger: logging.Logger | None = None,
) -> None:
    """Schedule a coroutine on an event loop from another thread.

    The helper mirrors :func:`asyncio.run_coroutine_threadsafe` while ensuring
    that any exception raised by the coroutine (or by the scheduling itself)
    is logged.  This avoids silent failures where the returned ``Future`` would
    otherwise hold the exception without surfacing it.
    """

    log = logger or logging.getLogger(__name__)

    try:
        future: Future[Any] = asyncio.run_coroutine_threadsafe(coro, loop)
    except Exception as exc:
        log.error("Failed to schedule %s: %s", callback_name, exc, exc_info=True)
        return

    def _check_exception(fut: Future[Any]) -> None:
        try:
            fut.result()
        except Exception as exc:
            log.error("Exception in %s: %s", callback_name, exc, exc_info=True)

    future.add_done_callback(_check_exception)

