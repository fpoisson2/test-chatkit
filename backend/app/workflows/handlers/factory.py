"""Factory for creating configured state machine instances."""

from __future__ import annotations

from typing import TYPE_CHECKING

from ..runtime.state_machine import WorkflowStateMachine
from .agent import AgentNodeHandler
from .assign import AssignNodeHandler
from .condition import ConditionNodeHandler
from .end import EndNodeHandler
from .parallel import ParallelJoinNodeHandler, ParallelSplitNodeHandler
from .start import StartNodeHandler
from .transform import TransformNodeHandler
from .wait import WaitNodeHandler
from .watch import WatchNodeHandler
from .while_loop import WhileNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ..runtime.agent_executor import AgentStepExecutor


def create_state_machine(
    agent_executor: AgentStepExecutor | None = None,
) -> WorkflowStateMachine:
    """Create and configure a workflow state machine with all node handlers.

    Args:
        agent_executor: Optional AgentStepExecutor for agent nodes

    Returns:
        Configured WorkflowStateMachine instance with all implemented handlers
    """
    machine = WorkflowStateMachine()

    # Register all implemented handlers
    machine.register_handler("start", StartNodeHandler())
    machine.register_handler("end", EndNodeHandler())
    machine.register_handler("condition", ConditionNodeHandler())
    machine.register_handler("while", WhileNodeHandler())
    machine.register_handler("state", AssignNodeHandler())  # state = assign
    machine.register_handler("watch", WatchNodeHandler())
    machine.register_handler("transform", TransformNodeHandler())
    machine.register_handler("wait_for_user_input", WaitNodeHandler())
    machine.register_handler("parallel_split", ParallelSplitNodeHandler())
    machine.register_handler("parallel_join", ParallelJoinNodeHandler())

    # Agent handlers (require AgentStepExecutor)
    if agent_executor is not None:
        agent_handler = AgentNodeHandler(agent_executor)
        machine.register_handler("agent", agent_handler)
        machine.register_handler("voice_agent", agent_handler)

    # TODO: Implement remaining specialized handlers if needed:
    # - widget nodes (may use existing patterns)
    # - assistant_message / user_message nodes
    # - json_vector_store nodes
    # - outbound_call nodes (voice-specific)

    return machine
