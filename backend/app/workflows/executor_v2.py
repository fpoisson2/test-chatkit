"""State machine-based workflow executor (v2).

This is the new implementation that uses the modular state machine architecture
instead of the monolithic run_workflow function.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Mapping
from typing import TYPE_CHECKING, Any

from .handlers.factory import create_state_machine
from .runtime.agent_executor import AgentExecutorDependencies, AgentStepExecutor
from .runtime.state_machine import ExecutionContext, NodeResult

if TYPE_CHECKING:  # pragma: no cover
    from chatkit.types import ThreadItem, ThreadStreamEvent, UserMessageItem

    from ..models import WorkflowStep
    from ..services.workflow_service import WorkflowService
    from .executor import (
        WorkflowDefinition,
        WorkflowInput,
        WorkflowRunSummary,
        WorkflowRuntimeSnapshot,
        WorkflowStepStreamUpdate,
        WorkflowStepSummary,
        _ResponseWidgetConfig,
    )
    from .executor_helpers import AgentContext, ThreadItemConverter


logger = logging.getLogger("chatkit.server")


async def run_workflow_v2(
    workflow_input: WorkflowInput,
    *,
    agent_context: AgentContext[Any],
    on_step: Callable[[WorkflowStepSummary, int], Awaitable[None]] | None = None,
    on_step_stream: Callable[[WorkflowStepStreamUpdate], Awaitable[None]] | None = None,
    on_stream_event: Callable[[ThreadStreamEvent], Awaitable[None]] | None = None,
    on_widget_step: (
        Callable[
            [WorkflowStep, _ResponseWidgetConfig], Awaitable[Mapping[str, Any] | None]
        ]
        | None
    ) = None,
    workflow_service: WorkflowService | None = None,
    workflow_definition: WorkflowDefinition | None = None,
    workflow_slug: str | None = None,
    thread_item_converter: ThreadItemConverter | None = None,
    thread_items_history: list[ThreadItem] | None = None,
    current_user_message: UserMessageItem | None = None,
    workflow_call_stack: tuple[tuple[str, str | int], ...] | None = None,
    runtime_snapshot: WorkflowRuntimeSnapshot | None = None,
) -> WorkflowRunSummary:
    """Execute a workflow using the state machine architecture.

    This is the v2 implementation that uses modular handlers instead of
    a monolithic while loop.

    Args:
        workflow_input: Input data for the workflow
        agent_context: Agent execution context
        on_step: Callback for each completed step
        on_step_stream: Callback for step streaming updates
        on_stream_event: Callback for thread stream events
        on_widget_step: Callback for widget interactions
        workflow_service: Service for workflow operations
        workflow_definition: Pre-loaded workflow definition
        workflow_slug: Workflow identifier
        thread_item_converter: Converter for thread items
        thread_items_history: Historical thread items
        current_user_message: Current user message
        workflow_call_stack: Stack for nested workflow detection
        runtime_snapshot: Snapshot for resuming execution

    Returns:
        WorkflowRunSummary with execution results
    """
    from .executor import (
        WorkflowExecutionError,
        WorkflowRunSummary,
        initialize_runtime_context,
    )

    # Initialize runtime context (reuse existing logic)
    initialization = await initialize_runtime_context(
        workflow_input,
        agent_context=agent_context,
        workflow_service=workflow_service,
        workflow_definition=workflow_definition,
        workflow_slug=workflow_slug,
        thread_item_converter=thread_item_converter,
        thread_items_history=thread_items_history,
        current_user_message=current_user_message,
        workflow_call_stack=workflow_call_stack,
        runtime_snapshot=runtime_snapshot,
    )

    # Extract initialized values
    steps = initialization.steps
    conversation_history = initialization.conversation_history
    state = initialization.state
    last_step_context = initialization.last_step_context
    definition = initialization.definition
    current_input_item_id = initialization.current_input_item_id
    initial_user_text = initialization.initial_user_text

    # Build node maps
    nodes_by_slug: dict[str, WorkflowStep] = {
        step.slug: step for step in definition.steps if step.is_enabled
    }
    if not nodes_by_slug:
        raise WorkflowExecutionError(
            "configuration",
            "Configuration du workflow invalide",
            RuntimeError("Aucun nœud actif disponible"),
            [],
        )

    # Build edge maps
    from collections import defaultdict

    from .executor import AGENT_NODE_KINDS, build_edges_by_source, prepare_agents

    edges_by_source = build_edges_by_source(definition.transitions)

    # Prepare agent steps
    agent_steps_ordered = [
        step
        for step in sorted(definition.steps, key=lambda s: s.position)
        if (
            step.kind in AGENT_NODE_KINDS
            and step.is_enabled
            and step.slug in nodes_by_slug
        )
    ]

    agent_positions = {
        step.slug: index for index, step in enumerate(agent_steps_ordered, start=1)
    }

    # Prepare agents and extract configurations
    agent_setup = prepare_agents(
        definition=definition,
        service=initialization.service,
        agent_steps_ordered=agent_steps_ordered,
        nodes_by_slug=nodes_by_slug,
    )

    agent_instances = agent_setup.agent_instances
    nested_workflow_configs = agent_setup.nested_workflow_configs
    widget_configs_by_step = agent_setup.widget_configs_by_step

    # Find start node
    start_slug: str | None = None
    if runtime_snapshot and runtime_snapshot.current_slug:
        start_slug = runtime_snapshot.current_slug
    else:
        for node in nodes_by_slug.values():
            if node.kind == "start":
                start_slug = node.slug
                break

    if not start_slug:
        raise WorkflowExecutionError(
            "configuration",
            "Configuration du workflow invalide",
            RuntimeError("Aucun nœud de départ trouvé"),
            [],
        )

    # Create record_step function
    async def record_step(step_key: str, title: str, payload: Any) -> None:
        from .executor import _format_step_summary

        summary = _format_step_summary(step_key, title, payload)
        steps.append(summary)
        if on_step is not None:
            await on_step(summary, len(steps))

    # Create ExecutionContext
    context = ExecutionContext(
        state=state,
        conversation_history=conversation_history,
        last_step_context=last_step_context,
        steps=steps,
        nodes_by_slug=nodes_by_slug,
        edges_by_source=dict(edges_by_source),
        current_slug=start_slug,
        record_step=record_step,
    )

    # Populate runtime_vars with all dependencies
    thread = getattr(agent_context, "thread", None)
    context.runtime_vars.update(
        {
            "workflow_input": workflow_input,
            "agent_context": agent_context,
            "thread": thread,
            "on_step": on_step,
            "on_step_stream": on_step_stream,
            "on_stream_event": on_stream_event,
            "on_widget_step": on_widget_step,
            "workflow_service": workflow_service,
            "definition": definition,
            "workflow_slug": workflow_slug,
            "current_user_message": current_user_message,
            "workflow_call_stack": workflow_call_stack or (),
            "current_input_item_id": current_input_item_id,
            "initial_user_text": initial_user_text,
            "widget_configs_by_step": widget_configs_by_step,
            "nested_workflow_configs": nested_workflow_configs,
            "active_branch_id": None,
            "active_branch_label": None,
        }
    )

    # Create emit_stream_event wrapper
    if on_stream_event is not None:

        async def emit_stream_event(event: Any) -> None:
            if on_stream_event is not None:
                await on_stream_event(event)

        context.runtime_vars["emit_stream_event"] = emit_stream_event

    # Create AgentStepExecutor for agent nodes
    agent_executor = None
    if agent_context is not None:
        # Build agent dependencies
        agent_dependencies = AgentExecutorDependencies(
            agent_instances=agent_instances,
            agent_positions=agent_positions,
            widget_configs_by_step=widget_configs_by_step,
            nested_workflow_configs=nested_workflow_configs,
            definition=definition,
            agent_context=agent_context,
            workflow_service=workflow_service or initialization.service,
            on_step_stream=on_step_stream,
            on_stream_event=on_stream_event,
            on_widget_step=on_widget_step,
            workflow_slug=workflow_slug,
            current_user_message=current_user_message,
            workflow_call_stack=workflow_call_stack or (),
            workflow_input=workflow_input,
        )
        agent_executor = AgentStepExecutor(agent_dependencies)

    # Create state machine with all handlers
    machine = create_state_machine(agent_executor=agent_executor)

    # Execute workflow
    try:
        await machine.execute(context)
    except Exception as e:
        logger.exception("Error executing workflow with state machine")
        raise

    # Build result summary
    final_output = context.final_output or {}
    final_node_slug = context.final_node_slug

    # Get final end state if set
    final_end_state = context.runtime_vars.get("final_end_state")

    return WorkflowRunSummary(
        steps=steps,
        state=state,
        conversation_history=conversation_history,
        final_output=final_output,
        last_context=last_step_context,
        final_node_slug=final_node_slug,
        final_end_state=final_end_state,
    )
