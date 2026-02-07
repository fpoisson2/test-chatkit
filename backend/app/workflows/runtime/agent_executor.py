"""Agent step executor with simplified interface using ExecutionContext."""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

from agents import Agent, TResponseInputItem
from chatkit.agents import AgentContext
from chatkit.types import (
    AssistantMessageContent,
    AssistantMessageItem,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    ThreadStreamEvent,
)

if TYPE_CHECKING:  # pragma: no cover
    from ...chatkit_server.actions import _ResponseWidgetConfig
    from ...models import WorkflowStep, WorkflowTransition
    from ..runtime.state_machine import ExecutionContext


logger = logging.getLogger("chatkit.server")


@dataclass(slots=True)
class AgentStepResult:
    """Result from executing an agent step."""

    last_step_context: dict[str, Any] | None
    transition: WorkflowTransition | None


@dataclass
class AgentExecutorDependencies:
    """Dependencies needed for agent execution.

    This consolidates all the specific dependencies needed by agent execution
    that aren't part of the general ExecutionContext.
    """

    agent_instances: Mapping[str, Agent]
    agent_positions: Mapping[str, int]
    total_runtime_steps: int
    widget_configs_by_step: Mapping[str, _ResponseWidgetConfig]
    agent_context: AgentContext[Any]
    run_agent_step: Callable[..., Awaitable[Any]]
    consume_generated_image_urls: Callable[[str], Sequence[str]]
    structured_output_as_json: Callable[[Any], tuple[Any, str]]
    merge_generated_image_urls_into_payload: Callable[[Any, Sequence[str]], Any]
    append_generated_image_links: Callable[[str, Sequence[str]], str]
    format_generated_image_links: Callable[[Sequence[str]], str]
    ingest_vector_store_step: Callable[..., Awaitable[None]]
    stream_widget: Callable[..., Awaitable[dict[str, Any] | None]]
    should_wait_for_widget_action: Callable[[str, _ResponseWidgetConfig], bool]
    on_widget_step: Callable[
        [WorkflowStep, _ResponseWidgetConfig], Awaitable[Mapping[str, Any] | None]
    ] | None
    emit_stream_event: Callable[[ThreadStreamEvent], Awaitable[None]] | None
    on_stream_event: Callable[[ThreadStreamEvent], Awaitable[None]] | None
    branch_prefixed_slug: Callable[[str], str]
    node_title: Callable[[WorkflowStep], str]
    session_factory: Any


class AgentStepExecutor:
    """Executes agent steps with simplified interface.

    Instead of 26 parameters, this accepts ExecutionContext + AgentExecutorDependencies.
    """

    def __init__(self, dependencies: AgentExecutorDependencies):
        """Initialize executor with dependencies."""
        self.deps = dependencies

    async def execute(
        self,
        current_node: WorkflowStep,
        context: ExecutionContext,
    ) -> AgentStepResult:
        """Execute agent step using context and dependencies.

        This is a refactored version of process_agent_step that:
        1. Accepts ExecutionContext instead of individual parameters
        2. Uses self.deps for agent-specific dependencies
        3. Maintains the exact same behavior as the original
        """
        current_slug = current_node.slug
        agent_key = current_node.agent_key or current_node.slug
        position = self.deps.agent_positions.get(current_slug, self.deps.total_runtime_steps)
        base_step_identifier = f"{agent_key}_{position}"
        step_identifier = self.deps.branch_prefixed_slug(base_step_identifier)
        agent = self.deps.agent_instances[current_slug]
        title = self.deps.node_title(current_node)
        widget_config = self.deps.widget_configs_by_step.get(current_node.slug)

        # Prepare run context
        run_context: Any | None = None
        if context.last_step_context is not None:
            run_context = dict(context.last_step_context)

        # Build conversation history from last step context
        if context.last_step_context is not None:
            self._append_context_to_history(context)

        # Debug logging
        if context.last_step_context is not None:
            logger.debug(
                "Contexte transmis à l'agent %s (étape=%s) : %s",
                agent_key,
                current_node.slug,
                json.dumps(context.last_step_context, ensure_ascii=False, default=str),
            )

        if context.conversation_history:
            try:
                logger.debug(
                    "Historique envoyé à l'agent %s : %s",
                    agent_key,
                    json.dumps(
                        context.conversation_history[-1], ensure_ascii=False, default=str
                    ),
                )
            except TypeError:
                logger.debug(
                    "Historique envoyé à l'agent %s (non sérialisable JSON)",
                    agent_key,
                )

        logger.debug(
            "État courant avant l'agent %s : %s",
            agent_key,
            json.dumps(context.state, ensure_ascii=False, default=str),
        )

        # Check if response should be displayed in chat
        model_settings = current_node.parameters.get("model_settings", {})
        display_response_in_chat = True
        if isinstance(model_settings, Mapping):
            raw_display_response = model_settings.get("response_in_chat")
            display_response_in_chat = (
                raw_display_response
                if isinstance(raw_display_response, bool)
                else True
            )

        # Execute agent step
        result_stream = await self.deps.run_agent_step(
            step_identifier,
            title,
            agent,
            agent_context=self.deps.agent_context,
            run_context=run_context,
            suppress_stream_events=(widget_config is not None) or (not display_response_in_chat),
            step_metadata={
                "agent_key": agent_key,
                "step_slug": self.deps.branch_prefixed_slug(current_node.slug),
                "step_title": title,
            },
        )

        # Collect generated images
        image_urls = list(self.deps.consume_generated_image_urls(step_identifier))
        links_text = self.deps.format_generated_image_links(image_urls)

        # Parse output and record step
        parsed, text = self.deps.structured_output_as_json(result_stream.final_output)
        if context.record_step:
            await context.record_step(
                step_identifier,
                title,
                self.deps.merge_generated_image_urls_into_payload(
                    result_stream.final_output, image_urls
                ),
            )

        # Build last step context
        last_step_context = {
            "agent_key": agent_key,
            "output": result_stream.final_output,
            "output_parsed": parsed,
            "output_structured": parsed,
            "output_text": self.deps.append_generated_image_links(text, image_urls),
        }

        if image_urls:
            last_step_context["generated_image_urls"] = list(image_urls)

        # Update state
        self._update_state(context, agent_key, last_step_context)

        logger.debug(
            "État mis à jour après l'agent %s : %s",
            agent_key,
            json.dumps(context.state, ensure_ascii=False, default=str),
        )

        # Stream image links if needed
        if (
            display_response_in_chat
            and links_text
            and self.deps.on_stream_event is not None
            and self.deps.emit_stream_event is not None
        ):
            links_message = AssistantMessageItem(
                id=self.deps.agent_context.generate_id("message"),
                thread_id=self.deps.agent_context.thread.id,
                created_at=datetime.now(),
                content=[AssistantMessageContent(text=links_text)],
            )
            await self.deps.emit_stream_event(ThreadItemAddedEvent(item=links_message))
            await self.deps.emit_stream_event(ThreadItemDoneEvent(item=links_message))

        # Ingest to vector store
        await self.deps.ingest_vector_store_step(
            (current_node.parameters or {}).get("vector_store_ingestion"),
            step_slug=self.deps.branch_prefixed_slug(current_node.slug),
            step_title=title,
            step_context=last_step_context,
            state=context.state,
            default_input_context=last_step_context,
            session_factory=self.deps.session_factory,
        )

        # Handle widgets
        if widget_config is not None:
            last_step_context = await self._handle_widget(
                current_node, widget_config, last_step_context, context
            )

        # Find next transition
        next_edge_func = context.runtime_vars.get("next_edge")
        transition = next_edge_func(current_slug) if next_edge_func else None

        return AgentStepResult(
            last_step_context=last_step_context, transition=transition
        )

    def _append_context_to_history(self, context: ExecutionContext) -> None:
        """Append last step context to conversation history."""
        if context.last_step_context is None:
            return

        context_text_parts: list[str] = []

        # Add output text
        output_text_value = context.last_step_context.get("output_text")
        if isinstance(output_text_value, str) and output_text_value.strip():
            context_text_parts.append(output_text_value.strip())

        # Add structured payload
        structured_payload = context.last_step_context.get("output_structured")
        if structured_payload is None:
            structured_payload = context.last_step_context.get("output_parsed")
        if structured_payload is None:
            structured_payload = context.last_step_context.get("output")

        if structured_payload is not None:
            if isinstance(structured_payload, dict | list):
                try:
                    serialized_structured = json.dumps(
                        structured_payload,
                        ensure_ascii=False,
                        indent=2,
                    )
                except TypeError:
                    serialized_structured = str(structured_payload)
            else:
                serialized_structured = str(structured_payload)

            if serialized_structured.strip():
                should_append = True
                if context_text_parts:
                    normalized_structured = serialized_structured.strip()
                    if any(
                        normalized_structured == part.strip()
                        for part in context_text_parts
                    ):
                        should_append = False
                if should_append:
                    context_text_parts.append(serialized_structured.strip())

        # Add generated images
        if "generated_image_urls" in context.last_step_context:
            image_urls_list = context.last_step_context["generated_image_urls"]
            if isinstance(image_urls_list, list) and image_urls_list:
                for url in image_urls_list:
                    context_text_parts.append(f"Image générée : {url}")

        # Append to history
        if context_text_parts:
            context_message = "\n\n".join(context_text_parts)
            context.conversation_history.append(
                {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "output_text",
                            "text": context_message,
                        }
                    ],
                }
            )

    def _update_state(
        self,
        context: ExecutionContext,
        agent_key: str,
        last_step_context: dict[str, Any],
    ) -> None:
        """Update workflow state with agent results."""
        context.state["last_agent_key"] = agent_key
        context.state["last_agent_output"] = last_step_context.get("output")
        context.state["last_agent_output_text"] = last_step_context.get("output_text")

        # Handle structured output
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

        # Handle generated image URLs
        generated_urls = last_step_context.get("generated_image_urls")
        if isinstance(generated_urls, list):
            context.state["last_generated_image_urls"] = [
                url for url in generated_urls if isinstance(url, str)
            ]
        else:
            context.state.pop("last_generated_image_urls", None)

    async def _handle_widget(
        self,
        current_node: WorkflowStep,
        widget_config: _ResponseWidgetConfig,
        last_step_context: dict[str, Any],
        context: ExecutionContext,
    ) -> dict[str, Any]:
        """Handle widget rendering and interaction."""
        rendered_widget = await self.deps.stream_widget(
            widget_config,
            step_slug=self.deps.branch_prefixed_slug(current_node.slug),
            step_title=self.deps.node_title(current_node),
            step_context=last_step_context,
            state=context.state,
            last_step_context=last_step_context,
            agent_context=self.deps.agent_context,
            emit_stream_event=self.deps.emit_stream_event,
        )

        widget_identifier = (
            widget_config.slug
            if widget_config.source == "library"
            else widget_config.definition_expression
        ) or current_node.slug

        augmented_context = dict(last_step_context)
        augmented_context.setdefault("widget", widget_identifier)

        if widget_config.source == "library" and widget_config.slug:
            augmented_context.setdefault("widget_slug", widget_config.slug)
        elif (
            widget_config.source == "variable"
            and widget_config.definition_expression
        ):
            augmented_context.setdefault(
                "widget_expression", widget_config.definition_expression
            )

        if rendered_widget is not None:
            augmented_context["widget_definition"] = rendered_widget

        if self.deps.on_widget_step is not None and self.deps.should_wait_for_widget_action(
            current_node.kind, widget_config
        ):
            result = await self.deps.on_widget_step(current_node, widget_config)
            if result is not None:
                augmented_context["action"] = dict(result)

        return augmented_context
