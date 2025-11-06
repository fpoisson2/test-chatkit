from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from ..vector_store.ingestion import ingest_workflow_step


async def ingest_vector_store_step(
    config: Mapping[str, Any] | None,
    *,
    step_slug: str,
    step_title: str,
    step_context: Mapping[str, Any] | None,
    state: Mapping[str, Any],
    default_input_context: Mapping[str, Any] | None,
    session_factory: Callable[[], Any],
    ingest_step: Callable[..., Awaitable[Any]] | None = None,
) -> None:
    """Wrapper autour :func:`ingest_workflow_step` avec paramètres standardisés."""

    if ingest_step is None:
        handler = ingest_workflow_step
    else:
        handler = ingest_step

    if handler is None:
        return

    if not isinstance(config, Mapping):
        return

    await handler(
        config=config,
        step_slug=step_slug,
        step_title=step_title,
        step_context=step_context,
        state=state,
        default_input_context=default_input_context,
        session_factory=session_factory,
    )
