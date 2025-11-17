"""Handlers for parallel execution nodes."""

from __future__ import annotations

import asyncio
import copy
import json
import logging
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep, WorkflowTransition
    from ..executor import WorkflowStepSummary
    from ..runtime.state_machine import ExecutionContext, NodeResult


logger = logging.getLogger("chatkit.server")


class ParallelJoinNodeHandler(BaseNodeHandler):
    """Handler for parallel_join nodes.

    Retrieves results from parallel execution and merges them into context.
    """

    async def execute(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
        """Execute parallel_join node."""
        from ..runtime.state_machine import NodeResult

        title = self._node_title(node)

        # Retrieve parallel outputs from state
        parallel_map = context.state.get("parallel_outputs")
        join_payload: Mapping[str, Any] | None = None
        if isinstance(parallel_map, Mapping):
            candidate = parallel_map.get(node.slug)
            if isinstance(candidate, Mapping):
                join_payload = candidate

        sanitized_join_payload = (
            copy.deepcopy(dict(join_payload)) if join_payload is not None else {}
        )

        # Record step
        if context.record_step:
            await context.record_step(node.slug, title, sanitized_join_payload)

        # Build context from join results
        join_context = {
            "parallel_join": sanitized_join_payload,
            "output": sanitized_join_payload,
            "output_structured": sanitized_join_payload,
            "output_parsed": sanitized_join_payload,
            "output_text": json.dumps(sanitized_join_payload, ensure_ascii=False),
        }

        # Clean up state - remove this join's data
        if isinstance(parallel_map, Mapping):
            updated_parallel = dict(parallel_map)
            updated_parallel.pop(node.slug, None)
            if updated_parallel:
                context.state["parallel_outputs"] = updated_parallel
            else:
                context.state.pop("parallel_outputs", None)

        # Find next transition
        transition = self._next_edge(context, node.slug)
        if transition is None:
            return NodeResult(
                next_slug=None, context_updates={"last_step_context": join_context}
            )

        return NodeResult(
            next_slug=transition.target_step.slug,
            context_updates={"last_step_context": join_context},
        )


class ParallelSplitNodeHandler(BaseNodeHandler):
    """Handler for parallel_split nodes.

    Executes multiple workflow branches concurrently and merges results.
    """

    async def execute(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
        """Execute parallel_split node."""
        from ..executor import WorkflowExecutionError, WorkflowRuntimeSnapshot, run_workflow
        from ..runtime.state_machine import NodeResult

        title = self._node_title(node)
        params = node.parameters or {}

        # Get join slug (required)
        join_slug_raw = params.get("join_slug")
        if not isinstance(join_slug_raw, str) or not join_slug_raw.strip():
            raise WorkflowExecutionError(
                node.slug,
                title or node.slug,
                RuntimeError("Parallel split sans jointure associée."),
                list(context.steps),
            )

        join_slug = join_slug_raw.strip()
        if join_slug not in context.nodes_by_slug:
            raise WorkflowExecutionError(
                node.slug,
                title or node.slug,
                RuntimeError(f"Nœud de jointure {join_slug} introuvable."),
                list(context.steps),
            )

        # Get outgoing edges (branches)
        outgoing = context.edges_by_source.get(node.slug, [])
        if len(outgoing) < 2:
            raise WorkflowExecutionError(
                node.slug,
                title or node.slug,
                RuntimeError("Parallel split sans branches sortantes suffisantes."),
                list(context.steps),
            )

        # Parse branch metadata
        branches_metadata: dict[str, str | None] = {}
        raw_branches = params.get("branches")
        if isinstance(raw_branches, Sequence):
            for entry in raw_branches:
                if isinstance(entry, Mapping):
                    slug_value = entry.get("slug")
                    if isinstance(slug_value, str) and slug_value.strip():
                        label_value = entry.get("label")
                        branches_metadata[slug_value.strip()] = (
                            label_value.strip()
                            if isinstance(label_value, str) and label_value.strip()
                            else None
                        )

        # Execute each branch concurrently
        async def _execute_branch(
            edge: WorkflowTransition,
        ) -> tuple[str, dict[str, Any], list[WorkflowStepSummary]]:
            """Execute a single branch of the parallel split."""
            branch_slug = edge.target_step.slug
            branch_label = branches_metadata.get(branch_slug)
            branch_steps: list[WorkflowStepSummary] = []

            # Create snapshot for this branch
            branch_snapshot = WorkflowRuntimeSnapshot(
                state=copy.deepcopy(context.state),
                conversation_history=copy.deepcopy(context.conversation_history),
                last_step_context=(
                    copy.deepcopy(context.last_step_context)
                    if context.last_step_context is not None
                    else None
                ),
                steps=branch_steps,
                current_slug=branch_slug,
                stop_at_slug=join_slug,
                branch_id=branch_slug,
                branch_label=branch_label,
            )

            # Get runtime dependencies for recursive call
            workflow_input = context.runtime_vars.get("workflow_input")
            agent_context = context.runtime_vars.get("agent_context")
            on_step_stream = context.runtime_vars.get("on_step_stream")
            on_stream_event = context.runtime_vars.get("on_stream_event")
            on_widget_step = context.runtime_vars.get("on_widget_step")
            workflow_service = context.runtime_vars.get("workflow_service")
            definition = context.runtime_vars.get("definition")
            workflow_slug = context.runtime_vars.get("workflow_slug")
            current_user_message = context.runtime_vars.get("current_user_message")
            workflow_call_stack = context.runtime_vars.get("workflow_call_stack", ())

            # Execute branch as sub-workflow
            branch_summary = await run_workflow(
                workflow_input,
                agent_context=agent_context,
                on_step=None,  # Don't stream individual steps during parallel execution
                on_step_stream=on_step_stream,
                on_stream_event=on_stream_event,
                on_widget_step=on_widget_step,
                workflow_service=workflow_service,
                workflow_definition=definition,
                workflow_slug=workflow_slug,
                thread_item_converter=None,
                thread_items_history=None,
                current_user_message=current_user_message,
                workflow_call_stack=workflow_call_stack,
                runtime_snapshot=branch_snapshot,
            )

            # Build branch payload
            branch_payload: dict[str, Any] = {
                "label": branch_label,
                "final_output": copy.deepcopy(branch_summary.final_output),
                "last_context": copy.deepcopy(branch_summary.last_context),
                "state": copy.deepcopy(branch_summary.state),
                "final_node_slug": branch_summary.final_node_slug,
                "steps": [
                    {
                        "key": summary.key,
                        "title": summary.title,
                        "output": summary.output,
                    }
                    for summary in branch_steps
                ],
            }

            return branch_slug, branch_payload, branch_steps

        # Execute all branches concurrently
        branch_tasks = [asyncio.create_task(_execute_branch(edge)) for edge in outgoing]
        branch_results = await asyncio.gather(*branch_tasks)

        # Merge branch results
        branches_payload: dict[str, Any] = {}
        branch_step_collections: list[list[WorkflowStepSummary]] = []
        for slug, payload, branch_steps in branch_results:
            branches_payload[slug] = payload
            branch_step_collections.append(branch_steps)

        # Build parallel payload
        parallel_payload = {
            "split_slug": node.slug,
            "join_slug": join_slug,
            "branches": branches_payload,
        }

        # Store results in state for join node to retrieve
        existing_parallel = context.state.get("parallel_outputs")
        if isinstance(existing_parallel, Mapping):
            updated_parallel = dict(existing_parallel)
        else:
            updated_parallel = {}
        updated_parallel[join_slug] = copy.deepcopy(parallel_payload)
        context.state["parallel_outputs"] = updated_parallel

        # Record step
        if context.record_step:
            await context.record_step(node.slug, title, parallel_payload)

        # Add branch steps to main workflow steps
        on_step = context.runtime_vars.get("on_step")
        for branch_steps in branch_step_collections:
            for summary in branch_steps:
                context.steps.append(summary)
                if on_step is not None:
                    await on_step(summary, len(context.steps))

        # Build context
        last_context_payload: dict[str, Any] = {
            "parallel_split": parallel_payload,
            "output": parallel_payload,
            "output_structured": parallel_payload,
            "output_parsed": parallel_payload,
            "output_text": json.dumps(parallel_payload, ensure_ascii=False),
        }

        # Jump directly to join node
        return NodeResult(
            next_slug=join_slug,
            context_updates={"last_step_context": last_context_payload},
        )
