"""Utility helpers for managing asynchronous tasks in telephony flows."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

logger = logging.getLogger("chatkit.telephony.task_utils")


class AsyncTaskLimiter:
    """Utility to throttle background tasks while ensuring cleanup on shutdown."""

    def __init__(self, *, name: str, max_pending: int) -> None:
        self._name = name
        self._semaphore = asyncio.Semaphore(max_pending)
        self._tasks: set[asyncio.Task[None]] = set()

    @property
    def pending(self) -> int:
        return len(self._tasks)

    async def submit(self, coro: Awaitable[None]) -> None:
        """Schedule *coro* once a slot is available."""

        await self._semaphore.acquire()

        async def _runner() -> None:
            try:
                await coro
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.error("Erreur dans %s: %s", self._name, exc)
            finally:
                self._semaphore.release()

        task = asyncio.create_task(_runner())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def cancel_pending(self) -> None:
        """Cancel all running tasks and wait for their completion."""

        if not self._tasks:
            return

        for task in list(self._tasks):
            task.cancel()

        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()


class StopController:
    """Coordinate shutdown for voice bridge components."""

    def __init__(
        self,
        *,
        stop_event: asyncio.Event,
        session_getter: Callable[[], Any | None],
        task_limiter: AsyncTaskLimiter | None = None,
        logger_: logging.Logger | None = None,
    ) -> None:
        self._stop_event = stop_event
        self._session_getter = session_getter
        self._task_limiter = task_limiter
        self._stop_requested = False
        self._lock = asyncio.Lock()
        self._logger = logger_ or logging.getLogger("chatkit.telephony.voice_bridge")

    @property
    def stop_requested(self) -> bool:
        return self._stop_requested

    async def request_stop(self) -> None:
        async with self._lock:
            if self._stop_requested:
                self._logger.debug("request_stop() déjà appelé, ignorer")
                return
            self._stop_requested = True

        self._stop_event.set()

        session = self._session_getter()
        if session is None:
            self._logger.debug("Session non créée, ignorer request_stop()")
        else:
            try:
                from agents.realtime.model_inputs import (
                    RealtimeModelSendRawMessage,
                )

                await session._model.send_event(  # type: ignore[protected-access]
                    RealtimeModelSendRawMessage(message={"type": "response.cancel"})
                )
                self._logger.debug("✅ Réponse en cours annulée avant fermeture")
            except asyncio.CancelledError:
                self._logger.debug(
                    "response.cancel annulé (task en cours d'annulation)"
                )
            except Exception as exc:
                self._logger.debug(
                    "response.cancel échoué (peut-être pas de réponse active): %s",
                    exc,
                )

            try:
                from agents.realtime.model_inputs import (
                    RealtimeModelSendRawMessage,
                )

                await session._model.send_event(  # type: ignore[protected-access]
                    RealtimeModelSendRawMessage(
                        message={"type": "input_audio_buffer.clear"}
                    )
                )
                self._logger.debug("✅ Buffer audio d'entrée vidé avant fermeture")
            except asyncio.CancelledError:
                self._logger.debug(
                    "input_audio_buffer.clear annulé (task en cours d'annulation)"
                )
            except Exception as exc:
                self._logger.debug("input_audio_buffer.clear échoué: %s", exc)

        if self._task_limiter is not None:
            await self._task_limiter.cancel_pending()

