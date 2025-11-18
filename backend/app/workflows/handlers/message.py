"""Handlers for message nodes (assistant_message, user_message)."""

from __future__ import annotations

import asyncio
import logging
import math
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

from chatkit.types import (
    AssistantMessageContent,
    AssistantMessageItem,
    InferenceOptions,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    UserMessageItem,
    UserMessageTextContent,
)

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..runtime.state_machine import ExecutionContext, NodeResult


logger = logging.getLogger("chatkit.server")

_DEFAULT_ASSISTANT_STREAM_DELAY_SECONDS = 0.015


@dataclass(frozen=True)
class _AssistantStreamConfig:
    """Configuration for assistant message streaming."""

    enabled: bool
    delay_seconds: float


class AssistantMessageNodeHandler(BaseNodeHandler):
    """Handler for assistant_message nodes.

    Sends an assistant message to the user with optional streaming.
    """

    async def execute(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
        """Execute assistant_message node."""
        from ...chatkit_server.context import _normalize_user_text
        from ..runtime.state_machine import NodeResult

        title = self._node_title(node)
        agent_context = context.runtime_vars.get("agent_context")
        on_stream_event = context.runtime_vars.get("on_stream_event")
        emit_stream_event = context.runtime_vars.get("emit_stream_event")

        # Get message content
        raw_message = self._resolve_assistant_message(node)
        sanitized_message = _normalize_user_text(raw_message)
        stream_config = self._resolve_assistant_stream_config(node)

        # Record step
        if context.record_step:
            await context.record_step(node.slug, title, sanitized_message or "")

        last_step_context = {"assistant_message": sanitized_message}

        # Stream message to user if needed
        if sanitized_message and on_stream_event is not None and agent_context is not None:
            if stream_config.enabled and emit_stream_event is not None:
                # Stream with delay
                await self._stream_assistant_message(
                    sanitized_message,
                    agent_context,
                    emit_stream_event,
                    delay_seconds=stream_config.delay_seconds,
                )
            else:
                # Send immediately
                if emit_stream_event is not None:
                    assistant_message = AssistantMessageItem(
                        id=agent_context.generate_id("message"),
                        thread_id=agent_context.thread.id,
                        created_at=datetime.now(),
                        content=[AssistantMessageContent(text=sanitized_message)],
                    )
                    await emit_stream_event(ThreadItemAddedEvent(item=assistant_message))
                    await emit_stream_event(ThreadItemDoneEvent(item=assistant_message))

        # Find next transition
        transition = self._next_edge(context, node.slug)
        if transition is None:
            return NodeResult(
                next_slug=None, context_updates={"last_step_context": last_step_context}
            )

        return NodeResult(
            next_slug=transition.target_step.slug,
            context_updates={"last_step_context": last_step_context},
        )

    def _resolve_assistant_message(self, step: WorkflowStep) -> str:
        """Extract assistant message from node parameters."""
        raw_params = step.parameters or {}
        params = raw_params if isinstance(raw_params, Mapping) else {}
        message = params.get("message")
        if isinstance(message, str):
            return message
        fallback_text = params.get("text")
        if isinstance(fallback_text, str):
            return fallback_text
        status = params.get("status")
        if isinstance(status, Mapping):
            reason = status.get("reason")
            if isinstance(reason, str):
                return reason
        return ""

    def _resolve_assistant_stream_config(
        self, step: WorkflowStep
    ) -> _AssistantStreamConfig:
        """Extract stream configuration from node parameters."""
        raw_params = step.parameters or {}
        params = raw_params if isinstance(raw_params, Mapping) else {}

        # Check if streaming enabled
        enabled = self._coerce_bool(params.get("simulate_stream"))

        # Get delay in milliseconds
        delay_seconds = _DEFAULT_ASSISTANT_STREAM_DELAY_SECONDS
        raw_delay = params.get("simulate_stream_delay_ms")
        candidate: float | None = None

        if isinstance(raw_delay, int | float) and not isinstance(raw_delay, bool):
            candidate = float(raw_delay)
        elif isinstance(raw_delay, str):
            normalized = raw_delay.strip()
            if normalized:
                try:
                    candidate = float(normalized)
                except ValueError:
                    candidate = None

        if candidate is not None and math.isfinite(candidate) and candidate >= 0:
            delay_seconds = candidate / 1000.0

        return _AssistantStreamConfig(enabled=enabled, delay_seconds=delay_seconds)

    def _coerce_bool(self, value: Any) -> bool:
        """Coerce a value to boolean."""
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in ("true", "1", "yes")
        if isinstance(value, int):
            return value != 0
        return False

    def _iter_stream_chunks(self, text: str) -> Iterator[str]:
        """Split text into chunks for streaming."""
        buffer = ""
        for character in text:
            buffer += character
            if character in {" ", "\n", "\t"} or len(buffer) >= 8:
                yield buffer
                buffer = ""
        if buffer:
            yield buffer

    async def _stream_assistant_message(
        self,
        message: str,
        agent_context: Any,
        emit_stream_event: Any,
        delay_seconds: float,
    ) -> None:
        """Stream assistant message with delay between chunks."""
        message_id = agent_context.generate_id("message")
        thread_id = agent_context.thread.id

        # Start message
        assistant_item = AssistantMessageItem(
            id=message_id,
            thread_id=thread_id,
            created_at=datetime.now(),
            content=[AssistantMessageContent(text="")],
        )
        await emit_stream_event(ThreadItemAddedEvent(item=assistant_item))

        # Stream chunks
        for chunk in self._iter_stream_chunks(message):
            assistant_item = AssistantMessageItem(
                id=message_id,
                thread_id=thread_id,
                created_at=datetime.now(),
                content=[AssistantMessageContent(text=chunk)],
            )
            await emit_stream_event(ThreadItemAddedEvent(item=assistant_item))
            if delay_seconds > 0:
                await asyncio.sleep(delay_seconds)

        # Finish message
        assistant_item = AssistantMessageItem(
            id=message_id,
            thread_id=thread_id,
            created_at=datetime.now(),
            content=[AssistantMessageContent(text=message)],
        )
        await emit_stream_event(ThreadItemDoneEvent(item=assistant_item))


class UserMessageNodeHandler(BaseNodeHandler):
    """Handler for user_message nodes.

    Simulates a user message in the conversation.
    """

    async def execute(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
        """Execute user_message node."""
        from ...chatkit_server.context import _normalize_user_text
        from ..runtime.state_machine import NodeResult

        title = self._node_title(node)
        agent_context = context.runtime_vars.get("agent_context")
        on_stream_event = context.runtime_vars.get("on_stream_event")
        emit_stream_event = context.runtime_vars.get("emit_stream_event")

        # Get message content
        raw_message = self._resolve_user_message(node)
        sanitized_message = _normalize_user_text(raw_message)

        # Record step
        if context.record_step:
            await context.record_step(node.slug, title, sanitized_message or "")

        last_step_context = {"user_message": sanitized_message}

        # Stream message if needed
        if sanitized_message and on_stream_event is not None and agent_context is not None:
            if emit_stream_event is not None:
                user_item = UserMessageItem(
                    id=agent_context.generate_id("message"),
                    thread_id=agent_context.thread.id,
                    created_at=datetime.now(),
                    content=[UserMessageTextContent(text=sanitized_message)],
                    attachments=[],
                    quoted_text=None,
                    inference_options=InferenceOptions(),
                )
                await emit_stream_event(ThreadItemAddedEvent(item=user_item))
                await emit_stream_event(ThreadItemDoneEvent(item=user_item))

        # Find next transition
        transition = self._next_edge(context, node.slug)
        if transition is None:
            return NodeResult(
                next_slug=None, context_updates={"last_step_context": last_step_context}
            )

        return NodeResult(
            next_slug=transition.target_step.slug,
            context_updates={"last_step_context": last_step_context},
        )

    def _resolve_user_message(self, node: WorkflowStep) -> str:
        """Extract user message from node parameters."""
        raw_params = node.parameters or {}
        params = raw_params if isinstance(raw_params, Mapping) else {}
        message = params.get("message")
        if isinstance(message, str):
            return message
        fallback_text = params.get("text")
        if isinstance(fallback_text, str):
            return fallback_text
        return ""
