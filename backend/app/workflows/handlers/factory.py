"""Factory for creating configured state machine instances."""

from __future__ import annotations

from typing import TYPE_CHECKING

from ..runtime.state_machine import WorkflowStateMachine
from .agent import AgentNodeHandler
from .assign import AssignNodeHandler
from .condition import ConditionNodeHandler
from .end import EndNodeHandler
from .message import AssistantMessageNodeHandler, UserMessageNodeHandler
from .outbound_call import OutboundCallNodeHandler
from .parallel import ParallelJoinNodeHandler, ParallelSplitNodeHandler
from .start import StartNodeHandler
from .transform import TransformNodeHandler
from .vector_store import VectorStoreNodeHandler
from .voice_agent import VoiceAgentNodeHandler
from .wait import WaitNodeHandler
from .watch import WatchNodeHandler
from .while_loop import WhileNodeHandler
from .widget import WidgetNodeHandler

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

    # Register core workflow handlers
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

    # Register message handlers
    machine.register_handler("assistant_message", AssistantMessageNodeHandler())
    machine.register_handler("user_message", UserMessageNodeHandler())

    # Register specialized handlers
    machine.register_handler("widget", WidgetNodeHandler())
    machine.register_handler("json_vector_store", VectorStoreNodeHandler())

    # Agent handlers
    # Note: In v2, agent_executor is optional as dependencies come from runtime_vars
    agent_handler = AgentNodeHandler(agent_executor)
    machine.register_handler("agent", agent_handler)

    # Computer Use handler (reuses agent handler as it's just an agent with computer_use tool)
    machine.register_handler("computer_use", agent_handler)

    # Voice agent handler (separate from regular agent handler)
    machine.register_handler("voice_agent", VoiceAgentNodeHandler())

    # Telephony handlers
    machine.register_handler("outbound_call", OutboundCallNodeHandler())

    return machine
