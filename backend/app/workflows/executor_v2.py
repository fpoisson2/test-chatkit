"""State machine-based workflow executor (v2).

This is the new implementation that uses the modular state machine architecture
instead of the monolithic run_workflow function.
"""

# ruff: noqa: E501

from __future__ import annotations

import logging
import os
import re
import time
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Any

from .handlers.factory import create_state_machine
from .runtime.state_machine import ExecutionContext

# Import litellm for cost calculation (optional dependency)
try:
    import litellm
except ImportError:
    litellm = None


@dataclass
class UsageMetadata:
    """Metadata for token usage and cost tracking."""

    input_tokens: int = 0
    output_tokens: int = 0
    cost: float = 0.0
    model: str | None = None


@dataclass
class AssistantMessageUsageEvent:
    """Event emitted with usage information after an assistant message."""

    type: str = "assistant_message.usage"
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    item_id: str = ""
    usage: UsageMetadata = field(default_factory=UsageMetadata)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "type": self.type,
            "event_id": self.event_id,
            "item_id": self.item_id,
            "usage": asdict(self.usage),
        }


@dataclass
class WorkflowMetrics:
    executor_version: str
    workflow_slug: str
    execution_time_ms: float
    steps_count: int
    handler_calls: dict[str, int]
    errors: list[str]
    input_tokens: int = 0
    output_tokens: int = 0
    total_cost: float = 0.0
    agent_usage: dict[str, "TokenUsage"] = field(default_factory=dict)


@dataclass
class TokenUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cost: float = 0.0


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

    start_time = time.time()
    handler_calls: defaultdict[str, int] = defaultdict(int)
    total_usage = TokenUsage()
    agent_usage: dict[str, TokenUsage] = {}

    def _safe_int(value: Any) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0

    def _safe_float(value: Any) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    def _coerce_usage(raw_usage: Any) -> TokenUsage | None:
        if raw_usage is None:
            return None

        if isinstance(raw_usage, TokenUsage):
            return raw_usage

        input_tokens = 0
        output_tokens = 0
        cost = 0.0

        if isinstance(raw_usage, Mapping):
            input_tokens = _safe_int(
                raw_usage.get("input_tokens")
                or raw_usage.get("prompt_tokens")
                or raw_usage.get("promptTokens")
            )
            output_tokens = _safe_int(
                raw_usage.get("output_tokens")
                or raw_usage.get("completion_tokens")
                or raw_usage.get("completionTokens")
            )
            cost = _safe_float(
                raw_usage.get("cost")
                or raw_usage.get("total_cost")
                or raw_usage.get("response_cost")
            )
        else:
            input_tokens = _safe_int(
                getattr(raw_usage, "input_tokens", None)
                or getattr(raw_usage, "prompt_tokens", None)
            )
            output_tokens = _safe_int(
                getattr(raw_usage, "output_tokens", None)
                or getattr(raw_usage, "completion_tokens", None)
            )
            cost = _safe_float(
                getattr(raw_usage, "cost", None)
                or getattr(raw_usage, "total_cost", None)
                or getattr(raw_usage, "response_cost", None)
            )

        if input_tokens == 0 and output_tokens == 0 and cost == 0.0:
            return None

        return TokenUsage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost=cost,
        )

    def _pricing_for_model(model_name: str | None) -> Mapping[str, Any] | None:
        if not model_name:
            return None
        pricing_map = get_settings().workflow_model_pricing
        if not pricing_map:
            return None
        return pricing_map.get(model_name) or pricing_map.get(model_name.lower())

    def _calculate_cost(model_name: str | None, usage: TokenUsage) -> float:
        """Calculate cost using litellm if available, otherwise fall back to manual pricing."""
        # Try litellm.completion_cost() first
        if litellm is not None and model_name:
            try:
                cost = litellm.completion_cost(
                    model=model_name,
                    prompt="",  # We already have token counts
                    completion="",
                    prompt_tokens=usage.input_tokens,
                    completion_tokens=usage.output_tokens,
                )
                if cost and cost > 0:
                    return float(cost)
            except Exception as e:
                logger.debug(
                    "litellm.completion_cost failed for model %s: %s", model_name, e
                )

        # Fall back to manual pricing from settings
        pricing = _pricing_for_model(model_name)
        if not pricing:
            return 0.0

        input_rate = _safe_float(
            pricing.get("input_cost_per_token")
            or pricing.get("prompt_cost_per_token")
            or pricing.get("prompt_token_cost")
        )
        output_rate = _safe_float(
            pricing.get("output_cost_per_token")
            or pricing.get("completion_cost_per_token")
            or pricing.get("completion_token_cost")
        )

        return (usage.input_tokens * input_rate) + (usage.output_tokens * output_rate)

    def _record_usage(
        agent_key: str, model_name: str | None, usage: TokenUsage | None
    ) -> None:
        if usage is None:
            return

        agent_identifier = agent_key or "unknown"
        agent_metrics = agent_usage.setdefault(agent_identifier, TokenUsage())

        agent_metrics.input_tokens += usage.input_tokens
        agent_metrics.output_tokens += usage.output_tokens

        computed_cost = usage.cost or _calculate_cost(model_name, usage)
        agent_metrics.cost += computed_cost

        total_usage.input_tokens += usage.input_tokens
        total_usage.output_tokens += usage.output_tokens
        total_usage.cost += computed_cost

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
    pending_wait_state = initialization.pending_wait_state
    if pending_wait_state is None and runtime_snapshot:
        pending_wait_state = runtime_snapshot.wait_state

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
        model_override=workflow_input.model_override,
    )

    agent_instances = agent_setup.agent_instances
    nested_workflow_configs = agent_setup.nested_workflow_configs
    widget_configs_by_step = agent_setup.widget_configs_by_step

    # Find start node
    start_slug: str | None = None
    if runtime_snapshot and runtime_snapshot.current_slug:
        start_slug = runtime_snapshot.current_slug
    elif pending_wait_state and pending_wait_state.get("slug"):
        start_slug = str(pending_wait_state["slug"])
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
        from .executor import WorkflowStepSummary, _format_step_output

        # Format step summary (originally a closure in run_workflow_v1)
        formatted_output = _format_step_output(payload)
        summary = WorkflowStepSummary(
            key=step_key,  # No branch prefix needed in v2 as it's handled by helpers
            title=title,
            output=formatted_output,
        )
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
        handler_calls=handler_calls,
    )

    # Prepare agent-specific dependencies
    from agents import RunConfig, Runner
    from agents.mcp import MCPServer
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
    create_executor_helpers(
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

    def _register_image_generation_task(
        task: Any, metadata: dict[str, Any]
    ) -> tuple[dict[str, Any], str] | None:
        """Register image generation task for tracking."""
        call_id = getattr(task, "id", None) or getattr(task, "call_id", None)
        if not call_id:
            return None
        key = f"{metadata.get('step_slug')}:{call_id}"
        context = dict(metadata)
        context["call_id"] = call_id
        agent_image_tasks[key] = context
        return context, key

    async def _persist_agent_image(
        context_data: dict[str, Any], key: str, task: Any, image: Any
    ) -> None:
        """Persist generated image."""
        import uuid
        from pathlib import Path

        from ..image_utils import build_agent_image_absolute_url, save_agent_image_file
        from ..security import create_agent_image_token

        def _sanitize_identifier(raw: str, fallback: str) -> str:
            """Sanitize identifier for filenames."""
            if not isinstance(raw, str):
                return fallback
            sanitized = re.sub(r"[^a-zA-Z0-9_-]", "_", raw)
            if not sanitized or sanitized == "_":
                return fallback
            return sanitized[:200]

        # Use step_key (not step_slug) to match consume_generated_image_urls
        step_key = context_data.get("step_key")
        if not step_key:
            return

        # Generate doc_id like old executor
        raw_thread_id = str(context_data.get("thread_id") or "unknown-thread")
        normalized_thread = _sanitize_identifier(raw_thread_id, "thread")
        step_identifier_for_doc = step_key
        normalized_step_identifier = _sanitize_identifier(
            str(step_identifier_for_doc), "step"
        )

        # Parse key to extract call_id and output_index
        # key format is "step_slug:call_id"
        call_id = key.split(":")[-1] if ":" in key else key
        output_index = 0

        raw_doc_id = (
            f"{normalized_thread}-{call_id}-{output_index}-{normalized_step_identifier}"
        )
        doc_id = _sanitize_identifier(
            raw_doc_id, f"{normalized_thread}-{uuid.uuid4().hex[:8]}"
        )

        b64_payload = image.b64_json or ""
        if not b64_payload:
            return

        # Save image file to disk
        local_file_path, local_file_url = save_agent_image_file(
            doc_id,
            b64_payload,
            output_format=getattr(image, "output_format", None),
        )

        # Create absolute URL with token
        absolute_file_url: str | None = None
        if local_file_url:
            file_name = Path(local_file_url).name
            token_user = context_data.get("user_id")
            token = create_agent_image_token(
                file_name,
                user_id=str(token_user) if token_user else None,
                thread_id=raw_thread_id,
            )
            base_url = (
                context_data.get("backend_public_base_url")
                or get_settings().backend_public_base_url
            )
            absolute_file_url = build_agent_image_absolute_url(
                local_file_url,
                base_url=base_url,
                token=token,
            )

        # Store the URL in generated_image_urls using step_key
        # (must match the key used in consume_generated_image_urls)
        if absolute_file_url:
            generated_image_urls.setdefault(step_key, []).append(absolute_file_url)
        elif local_file_url:
            generated_image_urls.setdefault(step_key, []).append(local_file_url)
        else:
            # Fallback to data URL if file save failed
            url = f"data:image/png;base64,{b64_payload}"
            generated_image_urls.setdefault(step_key, []).append(url)

    # Track whether the current user's message has already been forwarded to an agent
    user_message_forwarded = False

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
        metadata_for_images["step_slug"] = (
            metadata_for_images.get("step_slug") or step_key
        )
        metadata_for_images["step_title"] = (
            metadata_for_images.get("step_title") or title
        )

        if not metadata_for_images.get("agent_key"):
            metadata_for_images["agent_key"] = getattr(agent, "name", None)
        if not metadata_for_images.get("agent_label"):
            metadata_for_images["agent_label"] = getattr(
                agent, "name", None
            ) or getattr(agent, "model", None)

        thread_meta = getattr(agent_context, "thread", None)
        if not metadata_for_images.get("thread_id") and thread_meta is not None:
            metadata_for_images["thread_id"] = getattr(thread_meta, "id", None)

        request_context = getattr(agent_context, "request_context", None)
        if request_context is not None:
            metadata_for_images.setdefault(
                "user_id", getattr(request_context, "user_id", None)
            )
            metadata_for_images.setdefault(
                "backend_public_base_url",
                getattr(request_context, "public_base_url", None),
            )

        if not metadata_for_images.get("backend_public_base_url"):
            metadata_for_images["backend_public_base_url"] = (
                get_settings().backend_public_base_url
            )

        async def _inspect_event_for_images(event: Any) -> None:
            """Inspect events for image generation tasks."""
            update = getattr(event, "update", None)
            if not isinstance(update, WorkflowTaskAdded | WorkflowTaskUpdated):
                return
            task = getattr(update, "task", None)
            if not isinstance(task, ImageTask):
                return

            logger.debug(
                f"_inspect_event_for_images: Found ImageTask, call_id={task.call_id}, status={task.status_indicator}"
            )
            registration = _register_image_generation_task(
                task, metadata=metadata_for_images
            )
            if registration is None:
                return
            context_data, key = registration
            image = task.images[0] if task.images else None
            status = getattr(task, "status_indicator", None) or "none"

            if (
                status == "complete"
                and image
                and isinstance(image.b64_json, str)
                and image.b64_json
            ):
                if context_data.get("last_stored_b64") == image.b64_json:
                    return
                logger.info(f"_persist_agent_image: Persisting image for key={key}")
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

        agent_identifier = metadata_for_images.get("agent_key") or step_key

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
            if (
                rendered_instructions is not None
                and rendered_instructions != raw_instructions
            ):
                overridden_instructions = raw_instructions
                try:
                    agent.instructions = rendered_instructions
                    instructions_overridden = True
                except Exception:
                    pass

        # Get provider binding
        provider_binding = agent_provider_bindings.get(context.current_slug)

        model_name: str | None = getattr(agent, "model", None)
        if provider_binding and not model_name:
            model_name = getattr(provider_binding, "provider_id", None) or getattr(
                provider_binding, "provider_slug", None
            )

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

        nonlocal user_message_forwarded

        # Prepare conversation history
        base_history = conversation_history
        if user_message_forwarded:
            base_history = [
                item
                for item in conversation_history
                if (
                    getattr(item, "role", None)
                    or (item.get("role") if hasattr(item, "get") else None)
                )
                != "user"
            ]

        conversation_history_input = _normalize_conversation_history_for_provider(
            base_history,
            getattr(provider_binding, "provider_slug", None)
            if provider_binding
            else None,
        )
        conversation_history_input = _deduplicate_conversation_history_items(
            conversation_history_input
        )

        # Handle previous_response_id
        sanitized_previous_response_id = _sanitize_previous_response_id(
            getattr(agent_context, "previous_response_id", None)
        )
        if sanitized_previous_response_id != getattr(
            agent_context, "previous_response_id", None
        ):
            try:
                agent_context.previous_response_id = sanitized_previous_response_id
            except Exception:
                pass

        if sanitized_previous_response_id:
            filtered_input = _filter_conversation_history_for_previous_response(
                conversation_history_input
            )
            conversation_history_input = filtered_input

        # Check for while loop iteration
        in_while_loop_iteration = False
        if "state" in state and isinstance(state["state"], dict):
            for key, value in state["state"].items():
                if (
                    isinstance(key, str)
                    and key.startswith("__while_")
                    and key.endswith("_counter")
                    and isinstance(value, int)
                    and value >= 1
                ):
                    in_while_loop_iteration = True
                    break

        # Check runtime_vars for current pending_wait_state status
        # (may have been cleared by wait node after resuming)
        current_pending_wait_state = context.runtime_vars.get(
            "pending_wait_state", pending_wait_state
        )

        if in_while_loop_iteration and (
            sanitized_previous_response_id or current_pending_wait_state
        ):
            conversation_history_input = []

        # Debug: log what's being sent to the LLM
        def _summarize_content(content):
            """Summarize content for logging."""
            if not content:
                return []
            result = []
            for item in content:
                if isinstance(item, dict):
                    item_type = item.get("type", "unknown")
                    if item_type in ("input_image", "input_file"):
                        data = item.get("image_url") or item.get("file_data") or ""
                        data_len = len(data) if isinstance(data, str) else 0
                        result.append(f"{item_type}(size={data_len})")
                    else:
                        result.append(item_type)
                elif hasattr(item, "type"):
                    result.append(getattr(item, "type", "unknown"))
                else:
                    result.append(str(type(item).__name__))
            return result

        for idx, msg in enumerate(
            conversation_history_input[:5]
        ):  # Log first 5 messages
            if isinstance(msg, dict):
                role = msg.get("role", "unknown")
                content = msg.get("content", [])
            else:
                role = getattr(msg, "role", "unknown")
                content = getattr(msg, "content", [])
            content_summary = (
                _summarize_content(content)
                if isinstance(content, list)
                else str(type(content))
            )
            logger.info(
                "📎 LLM Input[%d]: role=%s, content_types=%s",
                idx,
                role,
                content_summary,
            )

        try:
            result = Runner.run_streamed(
                agent,
                input=[*conversation_history_input],
                run_config=_workflow_run_config(
                    response_format_override, provider_binding=provider_binding
                ),
                context=runner_context,
                previous_response_id=sanitized_previous_response_id,
            )
            try:
                async for event in stream_agent_response(agent_context, result):
                    if _should_forward_agent_event(
                        event, suppress=suppress_stream_events
                    ):
                        await _emit_stream_event(event)
                    # Debug: log event type and check for usage attributes
                    event_usage = getattr(event, "usage", None)
                    event_model_usage = getattr(event, "model_usage", None)
                    event_usage_info = getattr(event, "usage_info", None)
                    if event_usage or event_model_usage or event_usage_info:
                        logger.info(
                            "Event with usage: type=%s, usage=%s, model_usage=%s, usage_info=%s",
                            getattr(event, "type", type(event)),
                            event_usage,
                            event_model_usage,
                            event_usage_info,
                        )
                    usage_from_event = _coerce_usage(
                        event_usage or event_model_usage or event_usage_info
                    )
                    if usage_from_event:
                        logger.info("Recorded usage from event: %s", usage_from_event)
                        _record_usage(agent_identifier, model_name, usage_from_event)
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
                        stored_response_id = existing_metadata.get(
                            "previous_response_id"
                        )
                        if stored_response_id != last_response_id:
                            existing_metadata["previous_response_id"] = last_response_id
                            should_persist_thread = True
                    else:
                        thread_metadata.metadata = {
                            "previous_response_id": last_response_id
                        }
                        should_persist_thread = True

                store = getattr(agent_context, "store", None)
                request_context = getattr(agent_context, "request_context", None)
                if (
                    should_persist_thread
                    and store is not None
                    and request_context is not None
                    and hasattr(store, "save_thread")
                ):
                    try:
                        await store.save_thread(
                            thread_metadata, context=request_context
                        )
                    except Exception:
                        pass

            # Update conversation history
            conversation_history.extend(
                [item.to_input_item() for item in result.new_items]
            )

            # Debug: log result attributes for usage extraction
            logger.info(
                "Result type: %s, all_attrs: %s",
                type(result),
                [a for a in dir(result) if not a.startswith("_")],
            )
            logger.info(
                "Result attributes: usage=%s, response=%s, model_usage=%s",
                getattr(result, "usage", "N/A"),
                type(getattr(result, "response", None)),
                getattr(result, "model_usage", "N/A"),
            )
            response_obj = getattr(result, "response", None)
            if response_obj:
                logger.info(
                    "Response type: %s, all_attrs: %s",
                    type(response_obj),
                    [a for a in dir(response_obj) if not a.startswith("_")],
                )
                logger.info(
                    "Response attributes: usage=%s",
                    getattr(response_obj, "usage", "N/A"),
                )
                # Check for LiteLLM hidden params (contains response_cost)
                hidden_params = getattr(response_obj, "_hidden_params", None)
                if hidden_params:
                    logger.info("Response _hidden_params: %s", hidden_params)

            # Also check for raw_responses or _raw_responses
            raw_responses = getattr(result, "raw_responses", None) or getattr(
                result, "_raw_responses", None
            )
            if raw_responses:
                logger.info("Found raw_responses: %s", type(raw_responses))

            usage_from_result = _coerce_usage(
                getattr(result, "usage", None)
                or getattr(getattr(result, "response", None), "usage", None)
                or getattr(result, "model_usage", None)
            )
            logger.debug("usage_from_result after coerce: %s", usage_from_result)
            if usage_from_result:
                _record_usage(agent_identifier, model_name, usage_from_result)

            # Debug: log agent_usage state
            logger.debug(
                "agent_usage dict after recording: %s",
                {
                    k: (v.input_tokens, v.output_tokens, v.cost)
                    for k, v in agent_usage.items()
                },
            )

            # Emit usage event for this agent step
            agent_step_usage = agent_usage.get(agent_identifier)
            logger.debug(
                "agent_step_usage for %s: %s", agent_identifier, agent_step_usage
            )

            # Debug: log new_items
            for idx, item in enumerate(result.new_items):
                item_type = getattr(item, "type", None)
                item_id = getattr(item, "id", None)
                raw_item = getattr(item, "raw_item", None)
                logger.debug(
                    "result.new_items[%d]: type=%s, id=%s, raw_item_type=%s, raw_item_id=%s",
                    idx,
                    item_type,
                    item_id,
                    getattr(raw_item, "type", None) if raw_item else None,
                    getattr(raw_item, "id", None) if raw_item else None,
                )

            if agent_step_usage and (
                agent_step_usage.input_tokens > 0 or agent_step_usage.output_tokens > 0
            ):
                # Find the assistant message item ID from result.new_items
                assistant_item_id = None
                for item in result.new_items:
                    item_type = getattr(item, "type", None)
                    if item_type == "message" or item_type == "assistant_message":
                        assistant_item_id = getattr(item, "id", None)
                        break
                    # Also check for MessageOutputItem which wraps the message
                    raw_item = getattr(item, "raw_item", None)
                    if raw_item and getattr(raw_item, "type", None) == "message":
                        assistant_item_id = getattr(raw_item, "id", None)
                        break

                if assistant_item_id:
                    usage_event = AssistantMessageUsageEvent(
                        item_id=assistant_item_id,
                        usage=UsageMetadata(
                            input_tokens=agent_step_usage.input_tokens,
                            output_tokens=agent_step_usage.output_tokens,
                            cost=agent_step_usage.cost,
                            model=model_name,
                        ),
                    )
                    await _emit_stream_event(usage_event)
                    logger.debug(
                        "Emitted usage event for %s: input=%d, output=%d, cost=$%.6f",
                        assistant_item_id,
                        agent_step_usage.input_tokens,
                        agent_step_usage.output_tokens,
                        agent_step_usage.cost,
                    )

            return result
        finally:
            if not user_message_forwarded:
                user_message_forwarded = True
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
    debug_enabled = os.getenv("WORKFLOW_DEBUG") == "true"

    # Démarrer un workflow ChatKit par défaut pour l'affichage
    try:
        from chatkit.types import (
            Workflow as ChatkitWorkflow,
            CustomSummary,
            WorkflowItem,
        )

        if agent_context.workflow_item is None:
            default_workflow = ChatkitWorkflow(
                type="reasoning",
                tasks=[],
                summary=CustomSummary(title="Workflow"),  # Titre par défaut
                expanded=True,
            )
            await agent_context.start_workflow(default_workflow)

            # Ajouter le workflow item au thread pour qu'il soit visible
            if agent_context.workflow_item is not None and on_stream_event is not None:
                workflow_item = WorkflowItem(
                    id=agent_context.workflow_item.id,
                    type="workflow",
                    workflow=agent_context.workflow_item.workflow,
                )
                from chatkit.types import ThreadItemAddedEvent

                await on_stream_event(ThreadItemAddedEvent(item=workflow_item))
                logger.info(
                    f"[WORKFLOW_INIT] Added workflow item {workflow_item.id} to thread"
                )

            logger.info("[WORKFLOW_INIT] Started default ChatKit workflow for display")
    except Exception as exc:
        logger.debug(f"Failed to start default workflow: {exc}")

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
            "voice_session_manager": initialization.voice_session_manager,
            "voice_overrides": initialization.voice_overrides,
            # Track pending_wait_state so wait node can clear it after resuming
            "pending_wait_state": pending_wait_state,
        }
    )

    if debug_enabled:
        context.runtime_vars["debug"] = True
        logger.debug("WORKFLOW_DEBUG actif : logs détaillés de l'exécution activés")

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
    except Exception:
        logger.exception("Error executing workflow with state machine")
        raise

    # Build result summary
    final_output = context.final_output or {}
    final_node_slug = context.final_node_slug

    # Get final end state if set
    final_end_state = context.runtime_vars.get("final_end_state")

    metrics = WorkflowMetrics(
        executor_version="v2",
        workflow_slug=(
            workflow_slug
            or getattr(getattr(definition, "workflow", None), "slug", "")
            or ""
        ),
        execution_time_ms=(time.time() - start_time) * 1000,
        steps_count=len(steps),
        handler_calls=dict(handler_calls),
        errors=[],
        input_tokens=total_usage.input_tokens,
        output_tokens=total_usage.output_tokens,
        total_cost=total_usage.cost,
        agent_usage={
            key: TokenUsage(
                input_tokens=value.input_tokens,
                output_tokens=value.output_tokens,
                cost=value.cost,
            )
            for key, value in agent_usage.items()
        },
    )

    if metrics.input_tokens or metrics.output_tokens:
        logger.info(
            "Workflow %s usage: input_tokens=%s output_tokens=%s cost=$%.6f",
            metrics.workflow_slug,
            metrics.input_tokens,
            metrics.output_tokens,
            metrics.total_cost,
        )

    return WorkflowRunSummary(
        steps=steps,
        state=state,
        final_output=final_output,
        last_context=last_step_context,
        final_node_slug=final_node_slug,
        end_state=final_end_state,
        metrics=metrics,
    )
