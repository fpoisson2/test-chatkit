"""Factory for creating configured state machine instances."""

from __future__ import annotations

from ..runtime.state_machine import WorkflowStateMachine
from .condition import ConditionNodeHandler
from .end import EndNodeHandler
from .start import StartNodeHandler


def create_state_machine() -> WorkflowStateMachine:
    """Create and configure a workflow state machine with all node handlers.

    Returns:
        Configured WorkflowStateMachine instance
    """
    machine = WorkflowStateMachine()

    # Register basic handlers
    machine.register_handler("start", StartNodeHandler())
    machine.register_handler("end", EndNodeHandler())
    machine.register_handler("condition", ConditionNodeHandler())

    # TODO: Register remaining handlers as they are implemented:
    # machine.register_handler("while", WhileNodeHandler())
    # machine.register_handler("agent", AgentNodeHandler())
    # machine.register_handler("voice_agent", VoiceAgentNodeHandler())
    # machine.register_handler("assign", AssignNodeHandler())
    # machine.register_handler("parallel", ParallelNodeHandler())
    # etc...

    return machine
