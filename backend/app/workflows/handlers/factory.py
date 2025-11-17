"""Factory for creating configured state machine instances."""

from __future__ import annotations

from ..runtime.state_machine import WorkflowStateMachine
from .agent import AgentNodeHandler
from .assign import AssignNodeHandler
from .condition import ConditionNodeHandler
from .end import EndNodeHandler
from .start import StartNodeHandler
from .watch import WatchNodeHandler
from .while_loop import WhileNodeHandler


def create_state_machine() -> WorkflowStateMachine:
    """Create and configure a workflow state machine with all node handlers.

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

    # Agent handlers (placeholder - needs refactoring)
    # machine.register_handler("agent", AgentNodeHandler())
    # machine.register_handler("voice_agent", AgentNodeHandler())

    # TODO: Implement remaining handlers:
    # - parallel/parallel_split nodes
    # - wait nodes
    # - widget nodes
    # - image generation nodes
    # - custom task nodes

    return machine
