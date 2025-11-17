"""Handler for agent nodes."""

from __future__ import annotations

import copy
import logging
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..runtime.agent_executor import AgentStepExecutor
    from ..runtime.state_machine import ExecutionContext, NodeResult


logger = logging.getLogger("chatkit.server")


class AgentNodeHandler(BaseNodeHandler):
    """Handler for agent and voice_agent nodes.

    Handles both:
    1. Regular agent execution (via AgentStepExecutor)
    2. Nested workflow execution (recursive call to run_workflow)
    """

    def __init__(self, agent_executor: AgentStepExecutor | None = None):
        """Initialize handler with optional agent executor."""
        self.agent_executor = agent_executor

    async def execute(self, node: WorkflowStep, context: ExecutionContext) -> NodeResult:
        """Execute agent node."""
        from ..runtime.state_machine import NodeResult

        # Check if this is a nested workflow
        nested_workflow_configs = context.runtime_vars.get(
            "nested_workflow_configs", {}
        )

        if node.slug in nested_workflow_configs:
            # Execute as nested workflow
            return await self._execute_nested_workflow(node, context)
        else:
            # Execute as regular agent
            return await self._execute_agent(node, context)

    async def _execute_agent(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
        """Execute regular agent step."""
        from ..runtime.state_machine import NodeResult

        if self.agent_executor is None:
            # Fallback if no executor provided
            raise RuntimeError(
                "AgentNodeHandler requires AgentStepExecutor. "
                "Create handler with: AgentNodeHandler(agent_executor)"
            )

        # Execute agent step using simplified executor
        result = await self.agent_executor.execute(node, context)

        # Update context
        context_updates = {"last_step_context": result.last_step_context}

        if result.transition:
            return NodeResult(
                next_slug=result.transition.target_step.slug,
                context_updates=context_updates,
            )
        else:
            return NodeResult(next_slug=None, context_updates=context_updates)

    async def _execute_nested_workflow(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
        """Execute nested workflow."""
        from ..executor import WorkflowExecutionError, run_workflow, _format_step_output
        from ..runtime.state_machine import NodeResult
        from ...chatkit_server.context import _clone_conversation_history_snapshot

        nested_workflow_configs = context.runtime_vars.get(
            "nested_workflow_configs", {}
        )
        widget_configs_by_step = context.runtime_vars.get(
            "widget_configs_by_step", {}
        )

        title = self._node_title(node)
        widget_config = widget_configs_by_step.get(node.slug)
        reference = nested_workflow_configs[node.slug]

        # Load nested workflow definition
        _load_nested_workflow_definition = context.runtime_vars.get(
            "load_nested_workflow_definition"
        )
        try:
            nested_definition = _load_nested_workflow_definition(reference)
        except Exception as exc:
            raise WorkflowExecutionError(
                node.slug, title or node.slug, exc, list(context.steps)
            )

        # Check for cycles
        workflow_call_stack = context.runtime_vars.get("workflow_call_stack", ())
        nested_identifiers = self._get_workflow_identifiers(nested_definition)

        for identifier in nested_identifiers:
            if identifier in workflow_call_stack:
                raise WorkflowExecutionError(
                    node.slug,
                    title or node.slug,
                    RuntimeError("Cycle de workflow imbriqué détecté."),
                    list(context.steps),
                )

        nested_call_stack = workflow_call_stack + tuple(
            identifier
            for identifier in nested_identifiers
            if identifier not in workflow_call_stack
        )

        # Execute nested workflow
        workflow_input = context.runtime_vars.get("workflow_input")
        agent_context = context.runtime_vars.get("agent_context")
        on_step = context.runtime_vars.get("on_step")
        on_step_stream = context.runtime_vars.get("on_step_stream")
        on_stream_event = context.runtime_vars.get("on_stream_event")
        on_widget_step = context.runtime_vars.get("on_widget_step")
        service = context.runtime_vars.get("workflow_service")
        thread_item_converter = context.runtime_vars.get("thread_item_converter")
        thread_items_history = context.runtime_vars.get("thread_items_history")
        current_user_message = context.runtime_vars.get("current_user_message")

        try:
            nested_summary = await run_workflow(
                workflow_input,
                agent_context=agent_context,
                on_step=on_step,
                on_step_stream=on_step_stream,
                on_stream_event=on_stream_event,
                on_widget_step=on_widget_step,
                workflow_service=service,
                workflow_definition=nested_definition,
                workflow_call_stack=nested_call_stack,
                thread_item_converter=thread_item_converter,
                thread_items_history=thread_items_history,
                current_user_message=current_user_message,
            )
        except WorkflowExecutionError as exc:
            raise WorkflowExecutionError(
                node.slug, title or node.slug, exc, list(context.steps)
            )
        except Exception as exc:
            raise WorkflowExecutionError(
                node.slug, title or node.slug, exc, list(context.steps)
            )

        # Merge nested workflow results
        if nested_summary.steps:
            context.steps.extend(nested_summary.steps)

        nested_history = _clone_conversation_history_snapshot(
            (nested_summary.state or {}).get("conversation_history")
        )
        if nested_history:
            context.conversation_history.extend(nested_history)

        # Build context from nested results
        nested_context = dict(nested_summary.last_context or {})
        last_step_context = self._build_nested_context(
            nested_definition, nested_summary, nested_context, node, context
        )

        # Update state
        self._update_state_from_nested(context, nested_context, last_step_context)

        # Record step
        workflow_payload = self._build_workflow_payload(
            nested_definition, nested_summary
        )
        if context.record_step:
            await context.record_step(
                node.slug,
                title,
                {
                    "workflow": workflow_payload,
                    "output": last_step_context.get("output"),
                },
            )

        # Handle vector store and widgets
        await self._handle_nested_post_processing(
            node, widget_config, last_step_context, context
        )

        # Check for wait state
        if (
            nested_summary.end_state is not None
            and nested_summary.end_state.status_type == "waiting"
        ):
            # Store end state and finish
            context_updates = {
                "last_step_context": last_step_context,
                "final_node_slug": node.slug,
            }
            from ..executor import WorkflowEndState
            context.runtime_vars["final_end_state"] = nested_summary.end_state
            return NodeResult(finished=True, context_updates=context_updates)

        # Find next transition
        transition = self._next_edge(context, node.slug)
        if transition is None:
            return NodeResult(next_slug=None, context_updates={"last_step_context": last_step_context})

        return NodeResult(
            next_slug=transition.target_step.slug,
            context_updates={"last_step_context": last_step_context},
        )

    def _get_workflow_identifiers(
        self, definition: Any
    ) -> list[tuple[str, str | int]]:
        """Extract workflow identifiers for cycle detection."""
        identifiers: list[tuple[str, str | int]] = []

        workflow_id = getattr(definition, "workflow_id", None)
        if isinstance(workflow_id, int) and workflow_id > 0:
            identifiers.append(("id", workflow_id))

        workflow_slug_raw = getattr(
            getattr(definition, "workflow", None), "slug", None
        )
        if isinstance(workflow_slug_raw, str) and workflow_slug_raw.strip():
            normalized_slug = workflow_slug_raw.strip().lower()
            identifiers.append(("slug", normalized_slug))

        return identifiers

    def _build_nested_context(
        self,
        nested_definition: Any,
        nested_summary: Any,
        nested_context: dict[str, Any],
        node: WorkflowStep,
        context: ExecutionContext,
    ) -> dict[str, Any]:
        """Build last_step_context from nested workflow results."""
        from ..executor import _resolve_watch_payload

        display_payload = _resolve_watch_payload(
            nested_context, nested_summary.steps
        )
        output_candidate = nested_context.get("output")
        if output_candidate is None:
            output_candidate = nested_summary.final_output
        if output_candidate is None:
            output_candidate = display_payload

        # Parse structured output
        structured_output_as_json = context.runtime_vars.get(
            "structured_output_as_json"
        )
        parsed, text_output = (
            structured_output_as_json(output_candidate)
            if structured_output_as_json and output_candidate is not None
            else (output_candidate, str(output_candidate or ""))
        )

        # Handle generated images
        generated_urls_raw = nested_context.get("generated_image_urls")
        sanitized_image_urls = (
            [url for url in generated_urls_raw if isinstance(url, str)]
            if isinstance(generated_urls_raw, list)
            else []
        )

        append_generated_image_links = context.runtime_vars.get(
            "append_generated_image_links"
        )
        output_text = (
            append_generated_image_links(text_output, sanitized_image_urls)
            if append_generated_image_links
            else text_output
        )

        nested_context.setdefault("output", output_candidate)
        nested_context.setdefault("output_parsed", parsed)
        nested_context.setdefault("output_structured", parsed)
        nested_context["output_text"] = output_text
        if sanitized_image_urls:
            nested_context["generated_image_urls"] = sanitized_image_urls

        # Set workflow identifiers
        workflow_id = getattr(nested_definition, "workflow_id", None)
        workflow_slug_raw = getattr(
            getattr(nested_definition, "workflow", None), "slug", None
        )
        normalized_slug = (
            workflow_slug_raw.strip().lower()
            if isinstance(workflow_slug_raw, str) and workflow_slug_raw.strip()
            else None
        )

        workflow_key = normalized_slug or workflow_id
        workflow_identifier = (
            f"workflow:{workflow_key}" if workflow_key is not None else node.slug
        )
        nested_context.setdefault("agent_key", workflow_identifier)

        return nested_context

    def _update_state_from_nested(
        self,
        context: ExecutionContext,
        nested_context: dict[str, Any],
        last_step_context: dict[str, Any],
    ) -> None:
        """Update workflow state with nested workflow results."""
        context.state["last_agent_key"] = last_step_context.get("agent_key")
        context.state["last_agent_output"] = last_step_context.get("output")
        context.state["last_agent_output_text"] = last_step_context.get("output_text")

        structured_candidate = last_step_context.get("output_structured")
        if hasattr(structured_candidate, "model_dump"):
            try:
                structured_candidate = structured_candidate.model_dump(by_alias=True)
            except TypeError:
                structured_candidate = structured_candidate.model_dump()
        elif hasattr(structured_candidate, "dict"):
            try:
                structured_candidate = structured_candidate.dict(by_alias=True)
            except TypeError:
                structured_candidate = structured_candidate.dict()
        elif structured_candidate is not None and not isinstance(
            structured_candidate, dict | list | str
        ):
            structured_candidate = str(structured_candidate)

        context.state["last_agent_output_structured"] = structured_candidate

        generated_urls = last_step_context.get("generated_image_urls")
        if isinstance(generated_urls, list):
            context.state["last_generated_image_urls"] = [
                url for url in generated_urls if isinstance(url, str)
            ]
        else:
            context.state.pop("last_generated_image_urls", None)

        # Append to conversation history if needed
        output_text = last_step_context.get("output_text", "")
        if output_text.strip():
            should_append = True
            if context.conversation_history:
                last_entry = context.conversation_history[-1]
                if (
                    isinstance(last_entry, Mapping)
                    and last_entry.get("role") == "assistant"
                ):
                    contents = last_entry.get("content")
                    if isinstance(contents, Sequence):
                        for content_item in contents:
                            if not isinstance(content_item, Mapping):
                                continue
                            text_value = content_item.get("text")
                            if (
                                isinstance(text_value, str)
                                and text_value.strip() == output_text.strip()
                            ):
                                should_append = False
                                break

            if should_append:
                context.conversation_history.append(
                    {
                        "role": "assistant",
                        "content": [
                            {"type": "output_text", "text": output_text.strip()},
                        ],
                    }
                )

    def _build_workflow_payload(
        self, nested_definition: Any, nested_summary: Any
    ) -> dict[str, Any]:
        """Build workflow payload for nested workflow."""
        workflow_id = getattr(nested_definition, "id", None)
        workflow_slug = getattr(
            getattr(nested_definition, "workflow", None), "slug", None
        )

        workflow_payload: dict[str, Any] = {
            "id": workflow_id,
            "slug": workflow_slug,
            "version_id": getattr(nested_definition, "id", None),
            "version": getattr(nested_definition, "version", None),
        }

        if nested_summary.end_state is not None:
            workflow_payload["end_state"] = {
                "slug": nested_summary.end_state.slug,
                "status_type": nested_summary.end_state.status_type,
                "status_reason": nested_summary.end_state.status_reason,
                "message": nested_summary.end_state.message,
            }

        return workflow_payload

    async def _handle_nested_post_processing(
        self,
        node: WorkflowStep,
        widget_config: Any,
        last_step_context: dict[str, Any],
        context: ExecutionContext,
    ) -> None:
        """Handle vector store ingestion and widget rendering for nested workflows."""
        # Vector store ingestion
        ingest_vector_store_step = context.runtime_vars.get("ingest_vector_store_step")
        if ingest_vector_store_step:
            branch_prefixed_slug = context.runtime_vars.get("branch_prefixed_slug")
            session_factory = context.runtime_vars.get("session_factory")
            await ingest_vector_store_step(
                (node.parameters or {}).get("vector_store_ingestion"),
                step_slug=branch_prefixed_slug(node.slug) if branch_prefixed_slug else node.slug,
                step_title=self._node_title(node),
                step_context=last_step_context,
                state=context.state,
                default_input_context=last_step_context,
                session_factory=session_factory,
            )

        # Widget handling
        if widget_config is not None:
            # TODO: Implement widget handling for nested workflows
            pass
