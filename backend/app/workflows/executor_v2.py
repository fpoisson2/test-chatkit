"""State machine-based workflow executor (v2).

This is the new implementation that uses the modular state machine architecture
instead of the monolithic run_workflow function.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Mapping
from typing import TYPE_CHECKING, Any

from .handlers.factory import create_state_machine
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

    # Prepare agent-specific dependencies
    from agents import RunConfig, Runner
    from chatkit.agents import stream_agent_response
    from chatkit.types import (
        AssistantMessageContentPartTextDelta,
        EndOfTurnItem,
        ImageTask,
        ThreadItemUpdated,
        WorkflowTaskAdded,
        WorkflowTaskUpdated,
    )

    from ..chatkit.agent_registry import AGENT_RESPONSE_FORMATS
    from ..chatkit_server.mcp import MCPServer
    from ..chatkit_server.workflow_runner import _WorkflowStreamResult
    from ..config import get_settings
    from .executor import (
        WorkflowAgentRunContext,
        WorkflowExecutionError,
        WorkflowStepStreamUpdate,
        _deduplicate_conversation_history_items,
        _filter_conversation_history_for_previous_response,
        _normalize_conversation_history_for_provider,
        _sanitize_previous_response_id,
    )
    from .executor_helpers import create_executor_helpers
    from .template_utils import render_agent_instructions

    # Get agent provider bindings
    agent_provider_bindings = agent_setup.agent_provider_bindings

    # Get pending wait state
    pending_wait_state = runtime_snapshot.wait_state if runtime_snapshot else None

    # Local helper functions (originally closures in run_workflow_v1)
    def _extract_delta(event: Any) -> str:
        """Extract text delta from stream event."""
        if isinstance(event, ThreadItemUpdated):
            update = event.update
            if isinstance(update, AssistantMessageContentPartTextDelta):
                return update.delta or ""
        return ""

    def _should_forward_agent_event(event: Any, *, suppress: bool) -> bool:
        """Check if agent event should be forwarded to stream."""
        if not suppress:
            return True
        return isinstance(event, EndOfTurnItem)

    def _workflow_run_config(
        response_format: dict[str, Any] | None = None,
        *,
        provider_binding: Any | None = None,
    ) -> Any:
        """Create RunConfig for agent execution."""
        metadata: dict[str, str] = {"__trace_source__": "agent-builder"}
        if definition.workflow_id is not None:
            metadata["workflow_db_id"] = str(definition.workflow_id)
        if definition.workflow and definition.workflow.slug:
            metadata["workflow_slug"] = definition.workflow.slug
        if definition.workflow and definition.workflow.display_name:
            metadata["workflow_name"] = definition.workflow.display_name
        kwargs: dict[str, Any] = {"trace_metadata": metadata}
        if provider_binding is not None and provider_binding.provider is not None:
            kwargs["model_provider"] = provider_binding.provider
        try:
            if response_format is not None:
                return RunConfig(response_format=response_format, **kwargs)
        except TypeError:
            logger.debug(
                "RunConfig ne supporte pas response_format, utilisation de la "
                "configuration par défaut"
            )
        return RunConfig(**kwargs)

    # Track image generation tasks and URLs
    agent_image_tasks: dict[str, dict[str, Any]] = {}
    generated_image_urls: dict[str, list[str]] = {}

    # Create helper functions for streaming with shared image URLs dict
    helpers = create_executor_helpers(
        on_stream_event=on_stream_event,
        on_step_stream=on_step_stream,
        active_branch_id=None,
        active_branch_label=None,
        generated_image_urls_dict=generated_image_urls,
    )

    async def _emit_stream_event(event: Any) -> None:
        if on_stream_event is not None:
            await on_stream_event(event)

    async def _emit_step_stream(update: Any) -> None:
        if on_step_stream is not None:
            await on_step_stream(update)

    def _register_image_generation_task(task: Any, metadata: dict[str, Any]) -> tuple[dict[str, Any], str] | None:
        """Register image generation task for tracking."""
        call_id = getattr(task, "id", None) or getattr(task, "call_id", None)
        if not call_id:
            return None
        key = f"{metadata.get('step_slug')}:{call_id}"
        context = dict(metadata)
        context["call_id"] = call_id
        agent_image_tasks[key] = context
        return context, key

    async def _persist_agent_image(context_data: dict[str, Any], key: str, task: Any, image: Any) -> None:
        """Persist generated image."""
        step_slug = context_data.get("step_slug")
        if step_slug:
            url = f"data:image/png;base64,{image.b64_json}"
            generated_image_urls.setdefault(step_slug, []).append(url)

    # Create run_agent_step function
    async def run_agent_step(
        step_key: str,
        title: str,
        agent: Any,
        *,
        agent_context: Any,
        run_context: Any | None = None,
        suppress_stream_events: bool = False,
        step_metadata: dict[str, Any] | None = None,
    ) -> _WorkflowStreamResult:
        """Execute an agent step with streaming support."""
        step_index = len(steps) + 1
        metadata_for_images = dict(step_metadata or {})
        metadata_for_images["step_key"] = step_key
        metadata_for_images["step_slug"] = metadata_for_images.get("step_slug") or step_key
        metadata_for_images["step_title"] = metadata_for_images.get("step_title") or title

        if not metadata_for_images.get("agent_key"):
            metadata_for_images["agent_key"] = getattr(agent, "name", None)
        if not metadata_for_images.get("agent_label"):
            metadata_for_images["agent_label"] = getattr(agent, "name", None) or getattr(agent, "model", None)

        thread_meta = getattr(agent_context, "thread", None)
        if not metadata_for_images.get("thread_id") and thread_meta is not None:
            metadata_for_images["thread_id"] = getattr(thread_meta, "id", None)

        request_context = getattr(agent_context, "request_context", None)
        if request_context is not None:
            metadata_for_images.setdefault("user_id", getattr(request_context, "user_id", None))
            metadata_for_images.setdefault("backend_public_base_url", getattr(request_context, "public_base_url", None))

        if not metadata_for_images.get("backend_public_base_url"):
            metadata_for_images["backend_public_base_url"] = get_settings().backend_public_base_url

        async def _inspect_event_for_images(event: Any) -> None:
            """Inspect events for image generation tasks."""
            update = getattr(event, "update", None)
            if not isinstance(update, WorkflowTaskAdded | WorkflowTaskUpdated):
                return
            task = getattr(update, "task", None)
            if not isinstance(task, ImageTask):
                return
            registration = _register_image_generation_task(task, metadata=metadata_for_images)
            if registration is None:
                return
            context_data, key = registration
            image = task.images[0] if task.images else None
            status = getattr(task, "status_indicator", None) or "none"

            if status == "complete" and image and isinstance(image.b64_json, str) and image.b64_json:
                if context_data.get("last_stored_b64") == image.b64_json:
                    return
                await _persist_agent_image(context_data, key, task, image)
                context_data["last_stored_b64"] = image.b64_json
                agent_image_tasks.pop(key, None)

        await _emit_step_stream(
            WorkflowStepStreamUpdate(
                key=step_key,
                title=title,
                index=step_index,
                delta="",
                text="",
            )
        )

        accumulated_text = ""
        response_format_override = getattr(agent, "_chatkit_response_format", None)
        if response_format_override is None:
            try:
                response_format_override = AGENT_RESPONSE_FORMATS.get(agent)
            except TypeError:
                pass

        if isinstance(run_context, WorkflowAgentRunContext):
            runner_context = run_context
        else:
            runner_context = WorkflowAgentRunContext(
                agent_context=agent_context,
                step_context=run_context if isinstance(run_context, Mapping) else None,
            )

        # Handle instruction rendering
        raw_instructions = getattr(agent, "instructions", None)
        overridden_instructions: Any = None
        instructions_overridden = False
        if isinstance(raw_instructions, str):
            rendered_instructions = render_agent_instructions(
                raw_instructions,
                state=state,
                last_step_context=last_step_context,
                run_context=run_context if isinstance(run_context, Mapping) else None,
            )
            if rendered_instructions is not None and rendered_instructions != raw_instructions:
                overridden_instructions = raw_instructions
                try:
                    agent.instructions = rendered_instructions
                    instructions_overridden = True
                except Exception:
                    pass

        # Get provider binding
        provider_binding = agent_provider_bindings.get(context.current_slug)

        # Connect MCP servers
        mcp_servers = getattr(agent, "mcp_servers", None)
        connected_mcp_servers: list[Any] = []
        if mcp_servers:
            for server in mcp_servers:
                if isinstance(server, MCPServer):
                    try:
                        await server.connect()
                        connected_mcp_servers.append(server)
                    except Exception:
                        pass

            if connected_mcp_servers:
                try:
                    agent.mcp_servers = connected_mcp_servers
                except Exception:
                    pass
            else:
                try:
                    agent.mcp_servers = []
                except Exception:
                    pass

        # Prepare conversation history
        conversation_history_input = _normalize_conversation_history_for_provider(
            conversation_history,
            getattr(provider_binding, "provider_slug", None) if provider_binding else None,
        )
        conversation_history_input = _deduplicate_conversation_history_items(conversation_history_input)

        # Handle previous_response_id
        sanitized_previous_response_id = _sanitize_previous_response_id(
            getattr(agent_context, "previous_response_id", None)
        )
        if sanitized_previous_response_id != getattr(agent_context, "previous_response_id", None):
            try:
                agent_context.previous_response_id = sanitized_previous_response_id
            except Exception:
                pass

        if sanitized_previous_response_id:
            filtered_input = _filter_conversation_history_for_previous_response(conversation_history_input)
            conversation_history_input = filtered_input

        # Check for while loop iteration
        in_while_loop_iteration = False
        if "state" in state and isinstance(state["state"], dict):
            for key, value in state["state"].items():
                if isinstance(key, str) and key.startswith("__while_") and key.endswith("_counter") and isinstance(value, int) and value >= 1:
                    in_while_loop_iteration = True
                    break

        if in_while_loop_iteration and (sanitized_previous_response_id or pending_wait_state):
            conversation_history_input = []

        try:
            result = Runner.run_streamed(
                agent,
                input=[*conversation_history_input],
                run_config=_workflow_run_config(response_format_override, provider_binding=provider_binding),
                context=runner_context,
                previous_response_id=sanitized_previous_response_id,
            )
            try:
                async for event in stream_agent_response(agent_context, result):
                    if _should_forward_agent_event(event, suppress=suppress_stream_events):
                        await _emit_stream_event(event)
                    delta_text = _extract_delta(event)
                    if delta_text:
                        accumulated_text += delta_text
                        await _emit_step_stream(
                            WorkflowStepStreamUpdate(
                                key=step_key,
                                title=title,
                                index=step_index,
                                delta=delta_text,
                                text=accumulated_text,
                            )
                        )
                    await _inspect_event_for_images(event)
            except Exception as exc:
                raise WorkflowExecutionError(step_key, title, exc, list(steps)) from exc

            # Handle response_id persistence
            last_response_id = getattr(result, "last_response_id", None)
            if last_response_id is not None:
                agent_context.previous_response_id = last_response_id
                thread_metadata = getattr(agent_context, "thread", None)
                should_persist_thread = False
                if thread_metadata is not None:
                    existing_metadata = getattr(thread_metadata, "metadata", None)
                    if isinstance(existing_metadata, Mapping):
                        stored_response_id = existing_metadata.get("previous_response_id")
                        if stored_response_id != last_response_id:
                            existing_metadata["previous_response_id"] = last_response_id
                            should_persist_thread = True
                    else:
                        thread_metadata.metadata = {"previous_response_id": last_response_id}
                        should_persist_thread = True

                store = getattr(agent_context, "store", None)
                request_context = getattr(agent_context, "request_context", None)
                if should_persist_thread and store is not None and request_context is not None and hasattr(store, "save_thread"):
                    try:
                        await store.save_thread(thread_metadata, context=request_context)
                    except Exception:
                        pass

            # Update conversation history
            conversation_history.extend([item.to_input_item() for item in result.new_items])
            return result
        finally:
            # Cleanup MCP servers
            for server in connected_mcp_servers:
                try:
                    await server.cleanup()
                except Exception:
                    pass

            # Restore instructions
            if instructions_overridden:
                try:
                    agent.instructions = overridden_instructions
                except Exception:
                    pass

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
            "agent_instances": agent_instances,
            "agent_positions": agent_positions,
            "run_agent_step": run_agent_step,
            "generated_image_urls": generated_image_urls,
        }
    )

    # Create emit_stream_event wrapper
    if on_stream_event is not None:

        async def emit_stream_event(event: Any) -> None:
            if on_stream_event is not None:
                await on_stream_event(event)

        context.runtime_vars["emit_stream_event"] = emit_stream_event

    # Create state machine with all handlers
    # Note: AgentNodeHandler will access dependencies via context.runtime_vars
    machine = create_state_machine(agent_executor=None)

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
