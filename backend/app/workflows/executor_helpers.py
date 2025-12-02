"""Helper functions extracted from executor.py for agent execution.

These functions are needed by process_agent_step and were originally
closures in run_workflow. They're extracted here for reusability in v2.
"""

from __future__ import annotations

import json
import logging
import math
from collections.abc import Mapping, Sequence
from typing import Any

from chatkit.types import ThreadStreamEvent

from ..database import SessionLocal
from .executor import (
    WorkflowStepStreamUpdate,
    WorkflowStepSummary,
    _format_step_output,
)
from .runtime import ingest_vector_store_step
from .runtime.widget_streaming import _stream_response_widget

logger = logging.getLogger("chatkit.server")


def create_executor_helpers(
    *,
    on_stream_event=None,
    on_step_stream=None,
    active_branch_id=None,
    active_branch_label=None,
    generated_image_urls_dict=None,
):
    """Create all helper functions needed for agent execution.

    Returns a dict with all the callables needed by process_agent_step.

    Args:
        on_stream_event: Callback for stream events
        on_step_stream: Callback for step streaming
        active_branch_id: ID of active branch (for parallel execution)
        active_branch_label: Label of active branch
        generated_image_urls_dict: Shared dict for tracking generated images
    """

    def _branch_prefixed_slug(slug: str) -> str:
        if active_branch_id:
            return f"{active_branch_id}:{slug}"
        return slug

    def _branch_prefixed_title(title: str | None) -> str:
        if not active_branch_id:
            return title or ""
        prefix = active_branch_label or active_branch_id
        if title and title.strip():
            return f"[{prefix}] {title}"
        return f"[{prefix}]"

    def _node_title(step) -> str:
        """Get display title for a node."""
        return str(step.parameters.get("title", "")) if step.parameters else ""

    async def _emit_stream_event_wrapper(event: ThreadStreamEvent) -> None:
        if on_stream_event is None:
            return
        if active_branch_id:
            try:
                event.workflow_branch_id = active_branch_id  # type: ignore
            except Exception:
                pass
            if active_branch_label:
                try:
                    event.workflow_branch_label = active_branch_label  # type: ignore
                except Exception:
                    pass
        await on_stream_event(event)

    async def _emit_step_stream(update: WorkflowStepStreamUpdate) -> None:
        if on_step_stream is None:
            return
        if active_branch_id:
            update = WorkflowStepStreamUpdate(
                key=_branch_prefixed_slug(update.key),
                title=_branch_prefixed_title(update.title),
                index=update.index,
                delta=update.delta,
                text=update.text,
            )
        await on_step_stream(update)

    def _format_step_summary(
        step_key: str, title: str, payload: Any
    ) -> WorkflowStepSummary:
        formatted_output = _format_step_output(payload)
        summary = WorkflowStepSummary(
            key=_branch_prefixed_slug(step_key),
            title=_branch_prefixed_title(title),
            output=formatted_output,
        )
        return summary

    # Image generation helpers - use provided dict or create new one
    generated_image_urls = generated_image_urls_dict if generated_image_urls_dict is not None else {}

    def _consume_generated_image_urls(step_key: str) -> list[str]:
        return generated_image_urls.pop(step_key, [])

    def _unwrap_response_if_needed(output: Any) -> Any:
        """Unwrap response if it's wrapped with 'response' property.

        The OpenAI Responses API returns wrapped responses when using structured output.
        This function unwraps them to return the actual content.
        """
        if isinstance(output, dict) and len(output) == 1 and "response" in output:
            # This looks like a wrapped response from the API
            return output["response"]
        return output

    def _structured_output_as_json(output: Any) -> tuple[Any, str]:
        """Convert structured output to JSON."""
        # First, unwrap if needed
        output = _unwrap_response_if_needed(output)

        if isinstance(output, str):
            try:
                parsed = json.loads(output)
                # Unwrap parsed content too
                parsed = _unwrap_response_if_needed(parsed)
                return parsed, json.dumps(parsed, ensure_ascii=False)
            except (ValueError, TypeError):
                return output, json.dumps(output, ensure_ascii=False)
        else:
            try:
                serialized = json.dumps(output, ensure_ascii=False, indent=2)
                return output, serialized
            except TypeError:
                fallback = str(output)
                return output, fallback

    def _merge_generated_image_urls_into_payload(
        payload: Any, image_urls: Sequence[str]
    ) -> Any:
        """Merge image URLs into payload."""
        if not image_urls:
            return payload
        if isinstance(payload, dict):
            result = dict(payload)
            result["generated_image_urls"] = list(image_urls)
            return result
        elif isinstance(payload, str):
            return {
                "text": payload,
                "generated_image_urls": list(image_urls),
            }
        else:
            return {
                "output": payload,
                "generated_image_urls": list(image_urls),
            }

    def _append_generated_image_links(text: str, image_urls: Sequence[str]) -> str:
        """Append image links to text."""
        if not image_urls:
            return text
        links = _format_generated_image_links(image_urls)
        if text and text.strip():
            return f"{text}\n\n{links}"
        return links

    def _format_generated_image_links(image_urls: Sequence[str]) -> str:
        """Format image URLs as markdown links."""
        if not image_urls:
            return ""
        if len(image_urls) == 1:
            return f"![Image générée]({image_urls[0]})"
        return "\n".join(
            f"![Image générée {i+1}]({url})" for i, url in enumerate(image_urls)
        )

    def _coerce_bool(value: Any) -> bool:
        """Coerce value to boolean."""
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in ("true", "1", "yes")
        if isinstance(value, int):
            return value != 0
        return False

    def _should_wait_for_widget_action(node_kind: str, widget_config) -> bool:
        """Check if should wait for widget action."""
        # Import here to avoid circular dependency
        from ..chatkit_server.actions import _should_wait_for_widget_action as impl
        return impl(node_kind, widget_config)

    return {
        "branch_prefixed_slug": _branch_prefixed_slug,
        "node_title": _node_title,
        "emit_stream_event": _emit_stream_event_wrapper,
        "consume_generated_image_urls": _consume_generated_image_urls,
        "structured_output_as_json": _structured_output_as_json,
        "merge_generated_image_urls_into_payload": _merge_generated_image_urls_into_payload,
        "append_generated_image_links": _append_generated_image_links,
        "format_generated_image_links": _format_generated_image_links,
        "ingest_vector_store_step": ingest_vector_store_step,
        "stream_widget": _stream_response_widget,
        "should_wait_for_widget_action": _should_wait_for_widget_action,
        "session_factory": SessionLocal,
    }
