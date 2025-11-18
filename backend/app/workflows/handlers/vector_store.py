"""Handler for json_vector_store nodes."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..runtime.state_machine import ExecutionContext, NodeResult


logger = logging.getLogger("chatkit.server")


class VectorStoreNodeHandler(BaseNodeHandler):
    """Handler for json_vector_store nodes.

    Ingests data into vector store for retrieval.
    """

    async def execute(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
        """Execute json_vector_store node."""
        from ...db.connection import SessionLocal
        from ..executor_helpers import ingest_vector_store_step
        from ..runtime.state_machine import NodeResult

        title = self._node_title(node)

        # Get branch prefix for slug
        active_branch_id = context.runtime_vars.get("active_branch_id")
        branch_prefixed_slug = (
            f"{active_branch_id}:{node.slug}" if active_branch_id else node.slug
        )

        # Ingest into vector store
        await ingest_vector_store_step(
            node.parameters or {},
            step_slug=branch_prefixed_slug,
            step_title=title,
            step_context=context.last_step_context,
            state=context.state,
            default_input_context=context.last_step_context,
            session_factory=SessionLocal,
        )

        # Find next transition
        transition = self._next_edge(context, node.slug)
        if transition is None:
            return NodeResult(next_slug=None)

        return NodeResult(next_slug=transition.target_step.slug)
