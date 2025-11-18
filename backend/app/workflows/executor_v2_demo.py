"""Demonstration of simplified executor using state machine architecture.

This file shows how the monolithic run_workflow function can be simplified
using the state machine pattern. This is a work-in-progress refactoring.

Usage:
    Once all node handlers are implemented, this can replace the main
    run_workflow function in executor.py.
"""

from __future__ import annotations

import copy
import logging
from collections.abc import Awaitable, Callable, Mapping
from typing import TYPE_CHECKING, Any

from chatkit.agents import AgentContext, ThreadItemConverter

from ..chatkit_server.context import _clone_conversation_history_snapshot
from .handlers.factory import create_state_machine
from .runtime import initialize_runtime_context
from .runtime.state_machine import ExecutionContext

if TYPE_CHECKING:  # pragma: no cover
    from agents import TResponseInputItem
    from chatkit.types import ThreadItem, UserMessageItem

    from ..chatkit_server.actions import _ResponseWidgetConfig
    from ..chatkit_server.workflow_runner import _WorkflowStreamResult
    from ..models import WorkflowDefinition, WorkflowStep
    from .executor import (
        WorkflowEndState,
        WorkflowInput,
        WorkflowRunSummary,
        WorkflowRuntimeSnapshot,
        WorkflowStepStreamUpdate,
        WorkflowStepSummary,
    )
    from .runtime.agents import AgentSetupResult
    from .service import WorkflowService


logger = logging.getLogger("chatkit.server")


async def run_workflow_v2(
    workflow_input: WorkflowInput,
    *,
    agent_context: AgentContext[Any],
    on_step: Callable[[WorkflowStepSummary, int], Awaitable[None]] | None = None,
    on_step_stream: Callable[[WorkflowStepStreamUpdate], Awaitable[None]] | None = None,
    on_stream_event: Callable[[_WorkflowStreamResult], Awaitable[None]] | None = None,
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
    """Execute workflow using state machine architecture.

    This is a simplified version of run_workflow that uses the state machine
    pattern instead of a monolithic while loop with nested closures.

    The key improvements:
    - Each node type has its own handler class
    - Execution context is explicit, not closure variables
    - Clean separation of concerns
    - Easy to test individual handlers
    - Extensible for new node types
    """
    from .runtime.agents import build_edges_by_source

    # Initialize runtime (same as original)
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

    definition = initialization.definition
    state = initialization.state
    conversation_history = initialization.conversation_history
    last_step_context = initialization.last_step_context
    steps = initialization.steps

    # Build node and edge maps
    nodes_by_slug: dict[str, WorkflowStep] = {
        step.slug: step for step in definition.steps if step.is_enabled
    }
    if not nodes_by_slug:
        from .executor import WorkflowExecutionError
        raise WorkflowExecutionError(
            "configuration",
            "Configuration du workflow invalide",
            RuntimeError("Aucun nœud actif disponible"),
            [],
        )

    edges_by_source = build_edges_by_source(definition)

    # Find starting node
    current_slug = runtime_snapshot.current_slug if runtime_snapshot else None
    if not current_slug:
        start_nodes = [n for n in nodes_by_slug.values() if n.kind == "start"]
        if not start_nodes:
            from .executor import WorkflowExecutionError
            raise WorkflowExecutionError(
                "configuration",
                "Configuration du workflow invalide",
                RuntimeError("Aucun nœud de départ trouvé"),
                [],
            )
        current_slug = start_nodes[0].slug

    # Create record_step callback
    async def record_step(slug: str, title: str, payload: dict[str, Any]) -> None:
        from .executor import WorkflowStepSummary, _format_step_output

        step_summary = WorkflowStepSummary(
            key=slug,
            title=title,
            output=_format_step_output(payload),
        )
        steps.append(step_summary)
        if on_step:
            await on_step(step_summary, len(steps) - 1)

    # Create execution context
    context = ExecutionContext(
        state=state,
        conversation_history=conversation_history,
        last_step_context=last_step_context,
        steps=steps,
        nodes_by_slug=nodes_by_slug,
        edges_by_source=edges_by_source,
        current_slug=current_slug,
        record_step=record_step,
    )

    # Create and execute state machine
    machine = create_state_machine()
    context = await machine.execute(context)

    # Build final result (same as original)
    final_output = context.final_output
    final_node_slug = context.final_node_slug

    if final_output is None and isinstance(context.last_step_context, Mapping):
        candidate_output = context.last_step_context.get("output")
        if candidate_output is not None:
            final_output = candidate_output

    # Save conversation snapshot
    conversation_snapshot = _clone_conversation_history_snapshot(
        context.conversation_history
    )
    if conversation_snapshot:
        context.state["conversation_history"] = conversation_snapshot
    else:
        context.state.pop("conversation_history", None)

    # Extract end_state if present
    final_end_state: WorkflowEndState | None = None
    if context.last_step_context:
        end_state_raw = context.last_step_context.get("end_state")
        if isinstance(end_state_raw, Mapping):
            from .executor import WorkflowEndState
            final_end_state = WorkflowEndState(
                slug=end_state_raw.get("slug", ""),
                status_type=end_state_raw.get("status_type"),
                status_reason=end_state_raw.get("status_reason"),
                message=end_state_raw.get("message"),
            )

    from .executor import WorkflowRunSummary
    return WorkflowRunSummary(
        steps=list(context.steps),
        final_output=final_output,
        final_node_slug=final_node_slug,
        end_state=final_end_state,
        last_context=copy.deepcopy(context.last_step_context)
        if context.last_step_context is not None
        else None,
        state=copy.deepcopy(context.state),
    )
