"""Handler for agent nodes.

NOTE: This handler is a placeholder showing the structure.
For full implementation, process_agent_step needs to be refactored to accept
ExecutionContext instead of 20+ individual parameters.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..runtime.state_machine import ExecutionContext, NodeResult


logger = logging.getLogger("chatkit.server")


class AgentNodeHandler(BaseNodeHandler):
    """Handler for agent and voice_agent nodes.

    This is a placeholder. The actual implementation should:
    1. Check if it's a nested workflow -> call run_workflow recursively
    2. Otherwise -> call process_agent_step with proper context
    3. Handle while loop support for transitions

    TODO: Refactor process_agent_step to accept ExecutionContext instead of
    20+ individual parameters. This will allow a clean implementation here.
    """

    async def execute(self, node: WorkflowStep, context: ExecutionContext) -> NodeResult:
        """Execute agent node.

        NOTE: This is a simplified placeholder. Full implementation requires
        refactoring process_agent_step.
        """
        from ..runtime.state_machine import NodeResult

        # TODO: Implement nested workflow detection
        # TODO: Implement agent execution via process_agent_step
        # TODO: Handle widget rendering
        # TODO: Handle vector store ingestion
        # TODO: Handle conversation history updates

        raise NotImplementedError(
            "AgentNodeHandler requires refactoring process_agent_step first. "
            "See STATE_MACHINE_REFACTORING.md for details."
        )
