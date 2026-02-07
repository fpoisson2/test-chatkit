"""Helpers for executing runtime workflow steps."""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from agents import Agent, TResponseInputItem
from chatkit.agents import AgentContext
from chatkit.types import (
    AssistantMessageContent,
    AssistantMessageItem,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    ThreadStreamEvent,
)

from ...chatkit_server.actions import _ResponseWidgetConfig
from ...models import WorkflowStep, WorkflowTransition

logger = logging.getLogger("chatkit.server")


@dataclass(slots=True)
class AgentStepResult:
    last_step_context: dict[str, Any] | None
    transition: WorkflowTransition | None


WidgetStepHook = Callable[
    [WorkflowStep, _ResponseWidgetConfig], Awaitable[Mapping[str, Any] | None]
]


async def process_agent_step(
    *,
    current_node: WorkflowStep,
    current_slug: str,
    agent_instances: Mapping[str, Agent],
    agent_positions: Mapping[str, int],
    total_runtime_steps: int,
    widget_configs_by_step: Mapping[str, _ResponseWidgetConfig],
    conversation_history: list[TResponseInputItem],
    last_step_context: dict[str, Any] | None,
    state: dict[str, Any],
    agent_context: AgentContext[Any],
    run_agent_step: Callable[..., Awaitable[Any]],
    consume_generated_image_urls: Callable[[str], Sequence[str]],
    structured_output_as_json: Callable[[Any], tuple[Any, str]],
    record_step: Callable[[str, str, Any], Awaitable[None]],
    merge_generated_image_urls_into_payload: Callable[[Any, Sequence[str]], Any],
    append_generated_image_links: Callable[[str, Sequence[str]], str],
    format_generated_image_links: Callable[[Sequence[str]], str],
    ingest_vector_store_step: Callable[..., Awaitable[None]],
    stream_widget: Callable[..., Awaitable[dict[str, Any] | None]],
    should_wait_for_widget_action: Callable[[str, _ResponseWidgetConfig], bool],
    on_widget_step: WidgetStepHook | None,
    emit_stream_event: Callable[[ThreadStreamEvent], Awaitable[None]] | None,
    on_stream_event: Callable[[ThreadStreamEvent], Awaitable[None]] | None,
    branch_prefixed_slug: Callable[[str], str],
    node_title: Callable[[WorkflowStep], str],
    next_edge: Callable[[str], WorkflowTransition | None],
    session_factory: Any,
) -> AgentStepResult:
    """Execute a single agent step and update runtime state."""

    agent_key = current_node.agent_key or current_node.slug
    position = agent_positions.get(current_slug, total_runtime_steps)
    base_step_identifier = f"{agent_key}_{position}"
    step_identifier = branch_prefixed_slug(base_step_identifier)
    agent = agent_instances[current_slug]
    title = node_title(current_node)
    widget_config = widget_configs_by_step.get(current_node.slug)

    run_context: Any | None = None
    if last_step_context is not None:
        run_context = dict(last_step_context)

    if last_step_context is not None:
        context_text_parts: list[str] = []

        output_text_value = last_step_context.get("output_text")
        if isinstance(output_text_value, str) and output_text_value.strip():
            context_text_parts.append(output_text_value.strip())

        structured_payload = last_step_context.get("output_structured")
        if structured_payload is None:
            structured_payload = last_step_context.get("output_parsed")
        if structured_payload is None:
            structured_payload = last_step_context.get("output")
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

        if "generated_image_urls" in last_step_context:
            image_urls_list = last_step_context["generated_image_urls"]
            if isinstance(image_urls_list, list) and image_urls_list:
                for url in image_urls_list:
                    context_text_parts.append(f"Image générée : {url}")

        if context_text_parts:
            context_message = "\n\n".join(context_text_parts)
            conversation_history.append(
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

    if last_step_context is not None:
        logger.debug(
            "Contexte transmis à l'agent %s (étape=%s) : %s",
            agent_key,
            current_node.slug,
            json.dumps(last_step_context, ensure_ascii=False, default=str),
        )

    if conversation_history:
        try:
            logger.debug(
                "Historique envoyé à l'agent %s : %s",
                agent_key,
                json.dumps(conversation_history[-1], ensure_ascii=False, default=str),
            )
        except TypeError:
            logger.debug(
                "Historique envoyé à l'agent %s (non sérialisable JSON)",
                agent_key,
            )
    logger.debug(
        "État courant avant l'agent %s : %s",
        agent_key,
        json.dumps(state, ensure_ascii=False, default=str),
    )

    model_settings = current_node.parameters.get("model_settings", {})
    display_response_in_chat = True
    if isinstance(model_settings, Mapping):
        raw_display_response = model_settings.get("response_in_chat")
        display_response_in_chat = (
            raw_display_response if isinstance(raw_display_response, bool) else True
        )

    result_stream = await run_agent_step(
        step_identifier,
        title,
        agent,
        agent_context=agent_context,
        run_context=run_context,
        suppress_stream_events=(widget_config is not None) or (not display_response_in_chat),
        step_metadata={
            "agent_key": agent_key,
            "step_slug": branch_prefixed_slug(current_node.slug),
            "step_title": title,
        },
    )
    image_urls = list(consume_generated_image_urls(step_identifier))
    links_text = format_generated_image_links(image_urls)

    parsed, text = structured_output_as_json(result_stream.final_output)
    await record_step(
        step_identifier,
        title,
        merge_generated_image_urls_into_payload(
            result_stream.final_output, image_urls
        ),
    )
    last_step_context = {
        "agent_key": agent_key,
        "output": result_stream.final_output,
        "output_parsed": parsed,
        "output_structured": parsed,
        "output_text": append_generated_image_links(text, image_urls),
    }

    if image_urls:
        last_step_context["generated_image_urls"] = list(image_urls)

    state["last_agent_key"] = agent_key
    state["last_agent_output"] = last_step_context.get("output")
    state["last_agent_output_text"] = last_step_context.get("output_text")
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
    state["last_agent_output_structured"] = structured_candidate
    generated_urls = last_step_context.get("generated_image_urls")
    if isinstance(generated_urls, list):
        state["last_generated_image_urls"] = [
            url for url in generated_urls if isinstance(url, str)
        ]
    else:
        state.pop("last_generated_image_urls", None)

    logger.debug(
        "État mis à jour après l'agent %s : %s",
        agent_key,
        json.dumps(state, ensure_ascii=False, default=str),
    )

    if (
        display_response_in_chat
        and links_text
        and on_stream_event is not None
        and emit_stream_event is not None
    ):
        links_message = AssistantMessageItem(
            id=agent_context.generate_id("message"),
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[AssistantMessageContent(text=links_text)],
        )
        await emit_stream_event(ThreadItemAddedEvent(item=links_message))
        await emit_stream_event(ThreadItemDoneEvent(item=links_message))

    await ingest_vector_store_step(
        (current_node.parameters or {}).get("vector_store_ingestion"),
        step_slug=branch_prefixed_slug(current_node.slug),
        step_title=title,
        step_context=last_step_context,
        state=state,
        default_input_context=last_step_context,
        session_factory=session_factory,
    )

    if widget_config is not None:
        rendered_widget = await stream_widget(
            widget_config,
            step_slug=branch_prefixed_slug(current_node.slug),
            step_title=title,
            step_context=last_step_context,
            state=state,
            last_step_context=last_step_context,
            agent_context=agent_context,
            emit_stream_event=emit_stream_event,
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

        if on_widget_step is not None and should_wait_for_widget_action(
            current_node.kind, widget_config
        ):
            result = await on_widget_step(current_node, widget_config)
            if result is not None:
                augmented_context["action"] = dict(result)

        last_step_context = augmented_context

    transition = next_edge(current_slug)
    return AgentStepResult(last_step_context=last_step_context, transition=transition)

