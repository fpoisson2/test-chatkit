"""Handler for start nodes."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..runtime.state_machine import ExecutionContext, NodeResult


class StartNodeHandler(BaseNodeHandler):
    """Handler for start nodes.

    Start nodes simply transition to the next node without any processing.
    """

    async def execute(self, node: WorkflowStep, context: ExecutionContext) -> NodeResult:
        """Execute start node by finding next transition."""
        from ..runtime.state_machine import NodeResult
        from ..executor import WorkflowExecutionError

        transition = self._next_edge(context, node.slug)
        if transition is None:
            raise WorkflowExecutionError(
                "configuration",
                "Configuration du workflow invalide",
                RuntimeError("Aucune transition depuis le nœud de début"),
                list(context.steps),
            )

        return NodeResult(next_slug=transition.target_step.slug)
