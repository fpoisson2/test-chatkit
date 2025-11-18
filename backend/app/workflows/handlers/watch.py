"""Handler for watch/debug nodes."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..executor import WorkflowStepSummary
    from ..runtime.state_machine import ExecutionContext, NodeResult


class WatchNodeHandler(BaseNodeHandler):
    """Handler for watch nodes (kind='watch').

    Watch nodes display the output from the previous step for debugging purposes.
    """

    async def execute(self, node: WorkflowStep, context: ExecutionContext) -> NodeResult:
        """Execute watch node by recording current context."""
        from datetime import datetime

        from ..runtime.state_machine import NodeResult
        from chatkit.types import ThreadStreamEvent

        title = self._node_title(node)
        payload_to_display = self._resolve_watch_payload(
            context.last_step_context, context.steps
        )
        step_payload: Any = (
            payload_to_display
            if payload_to_display is not None
            else "Aucun payload disponible pour ce bloc."
        )

        # Record step
        if context.record_step:
            await context.record_step(node.slug, title, step_payload)

        # Stream event if callback provided
        on_stream_event = context.runtime_vars.get("on_stream_event")
        agent_context = context.runtime_vars.get("agent_context")
        if on_stream_event is not None and agent_context is not None:
            if payload_to_display is None:
                formatted_payload = "Aucune donnée issue du bloc précédent."
            else:
                formatted_payload = self._format_step_output(payload_to_display)
                stripped = formatted_payload.strip()
                if stripped.startswith("{") or stripped.startswith("["):
                    formatted_payload = f"```json\n{formatted_payload}\n```"

            # Create stream event
            from chatkit.types import (
                AssistantMessageContent,
                AssistantMessageItem,
                ThreadItemAddedEvent,
                ThreadItemDoneEvent,
            )

            message_item = AssistantMessageItem(
                id=agent_context.generate_id("message"),
                thread_id=agent_context.thread.id,
                created_at=datetime.now(),
                content=[AssistantMessageContent(text=formatted_payload)],
            )
            await on_stream_event(ThreadItemAddedEvent(item=message_item))
            await on_stream_event(ThreadItemDoneEvent(item=message_item))

        # Find next transition with fallback
        next_slug = self._next_slug_or_fallback(node.slug, context)
        return NodeResult(next_slug=next_slug)

    def _resolve_watch_payload(
        self, context_data: Any, steps: Sequence[WorkflowStepSummary]
    ) -> Any:
        """Extract the most relevant payload from context for display."""
        if isinstance(context_data, Mapping):
            for key in (
                "output_structured",
                "output_parsed",
                "output_text",
                "output",
                "assistant_message",
            ):
                candidate = context_data.get(key)
                if candidate not in (None, "", {}):
                    return candidate

        if context_data is not None:
            return context_data

        if steps:
            return steps[-1].output

        return None

    def _format_step_output(self, payload: Any) -> str:
        """Format payload for display."""
        from pydantic import BaseModel

        if payload is None:
            return "(aucune sortie)"

        if isinstance(payload, BaseModel):
            payload = payload.model_dump()

        if isinstance(payload, dict | list):
            try:
                return json.dumps(payload, ensure_ascii=False, indent=2)
            except TypeError:
                return str(payload)

        if isinstance(payload, str):
            text_value = payload.strip()
            if not text_value:
                return "(aucune sortie)"

            try:
                parsed = json.loads(text_value)
            except json.JSONDecodeError:
                return text_value

            if isinstance(parsed, dict | list):
                try:
                    return json.dumps(parsed, ensure_ascii=False, indent=2)
                except TypeError:
                    return str(parsed)
            return str(parsed)

        return str(payload)
