"""Handler for wait_for_user_input nodes."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import datetime
from typing import TYPE_CHECKING, Any

from chatkit.types import AssistantMessageContent, AssistantMessageItem, ThreadItemAddedEvent, ThreadItemDoneEvent

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..runtime.state_machine import ExecutionContext, NodeResult


logger = logging.getLogger("chatkit.server")


class WaitNodeHandler(BaseNodeHandler):
    """Handler for wait_for_user_input nodes.

    Wait nodes pause workflow execution and store state, then resume when
    a new user message arrives.
    """

    async def execute(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
        """Execute wait_for_user_input node."""
        from ...chatkit_server.context import (
            _get_wait_state_metadata,
            _set_wait_state_metadata,
        )
        from ..executor import WorkflowEndState
        from ..utils import (
            _clone_conversation_history_snapshot,
            _json_safe_copy,
            _normalize_user_text,
        )
        from ..runtime.state_machine import NodeResult

        # Get runtime dependencies
        thread = context.runtime_vars.get("thread")
        current_input_item_id = context.runtime_vars.get("current_input_item_id")
        current_user_message = context.runtime_vars.get("current_user_message")
        runtime_current_input_id = context.runtime_vars.get("current_input_item_id")
        initial_user_text = context.runtime_vars.get("initial_user_text")
        agent_context = context.runtime_vars.get("agent_context")
        on_stream_event = context.runtime_vars.get("on_stream_event")

        # Check if we're resuming from a wait
        pending_wait_state = (
            _get_wait_state_metadata(thread) if thread is not None else None
        )
        waiting_slug = (
            pending_wait_state.get("slug") if pending_wait_state else None
        )
        waiting_input_id = (
            pending_wait_state.get("input_item_id") if pending_wait_state else None
        )
        current_message_id = (
            getattr(current_user_message, "id", None)
            if current_user_message is not None
            else None
        )
        resumed = (
            pending_wait_state is not None
            and waiting_slug == node.slug
            and current_message_id is not None
            and waiting_input_id is not None
            and waiting_input_id not in {current_message_id, runtime_current_input_id}
        )

        logger.info(
            "[WAIT_TRACE] Wait %s: pending_wait_state=%s, waiting_slug=%s, waiting_input_id=%s, current_message_id=%s, resumed=%s",
            node.slug,
            bool(pending_wait_state),
            waiting_slug,
            waiting_input_id,
            current_message_id,
            resumed,
        )

        if pending_wait_state:
            logger.info(
                "[WAIT_TRACE] Wait %s: pending_wait_state_keys=%s", node.slug, list(pending_wait_state.keys())
            )

        if resumed:
            # Resume from wait - user provided new message
            next_slug = pending_wait_state.get("next_step_slug")
            if next_slug is None:
                next_slug = self._next_slug_or_fallback(node.slug, context)

            logger.info(
                "[WAIT_TRACE] Wait %s: resuming with new user message id=%s -> next_slug=%s",
                node.slug,
                current_message_id,
                next_slug,
            )

            # Clear wait state
            if thread is not None:
                _set_wait_state_metadata(thread, None)

            # Build context with user message
            last_step_context = {"user_message": initial_user_text}

            if not next_slug:
                # No transition after wait - finish workflow
                context.runtime_vars["final_end_state"] = WorkflowEndState(
                    slug=node.slug,
                    status_type="closed",
                    status_reason=(
                        "Aucune transition disponible après le bloc d'attente."
                    ),
                    message=("Aucune transition disponible après le bloc d'attente."),
                )
                return NodeResult(
                    finished=True,
                    context_updates={
                        "last_step_context": last_step_context,
                        "final_node_slug": node.slug,
                    },
                )

            # Continue to next node
            return NodeResult(
                next_slug=next_slug,
                context_updates={"last_step_context": last_step_context},
            )

        # First time hitting wait - pause workflow
        title = self._node_title(node)

        # Get wait message
        raw_message = self._resolve_wait_message(node)
        sanitized_message = _normalize_user_text(raw_message)
        display_payload = sanitized_message or "En attente d'une réponse utilisateur."
        wait_reason = display_payload

        # Record step
        if context.record_step:
            await context.record_step(node.slug, title, display_payload)

        # Build context
        context_payload: dict[str, Any] = {"wait_for_user_input": True}
        if sanitized_message:
            context_payload["assistant_message"] = sanitized_message

        last_step_context = context_payload

        # Stream message to user if needed
        if sanitized_message and on_stream_event is not None and agent_context is not None:
            emit_stream_event = context.runtime_vars.get("emit_stream_event")
            if emit_stream_event is not None:
                assistant_message = AssistantMessageItem(
                    id=agent_context.generate_id("message"),
                    thread_id=agent_context.thread.id,
                    created_at=datetime.now(),
                    content=[AssistantMessageContent(text=sanitized_message)],
                )
                await emit_stream_event(ThreadItemAddedEvent(item=assistant_message))
                await emit_stream_event(ThreadItemDoneEvent(item=assistant_message))

        # Build and save wait state
        # Prefer the previously saved wait input when the runtime payload points to the same message,
        # even if the reconstructed current_user_message has a different id (e.g., snapshot restore).
        chosen_input_id: str | None
        if (
            pending_wait_state
            and waiting_input_id is not None
            and waiting_input_id == runtime_current_input_id
        ):
            chosen_input_id = waiting_input_id
        elif current_message_id is not None:
            chosen_input_id = current_message_id
        elif waiting_input_id is not None:
            chosen_input_id = waiting_input_id
        else:
            chosen_input_id = current_input_item_id

        wait_state_payload: dict[str, Any] = {
            "slug": node.slug,
            "input_item_id": chosen_input_id,
        }

        logger.info(
            "[WAIT_TRACE] Wait %s: saving wait state with input_item_id=%s (current=%s, waiting=%s, runtime_current_input=%s)",
            node.slug,
            wait_state_payload.get("input_item_id"),
            current_message_id,
            waiting_input_id,
            current_input_item_id,
        )

        conversation_snapshot = _clone_conversation_history_snapshot(
            context.conversation_history
        )
        if conversation_snapshot:
            wait_state_payload["conversation_history"] = conversation_snapshot

        # Store next slug with fallback logic
        next_slug_after_wait = self._next_slug_or_fallback(node.slug, context)
        if next_slug_after_wait is not None:
            wait_state_payload["next_step_slug"] = next_slug_after_wait

        if context.state:
            wait_state_payload["state"] = _json_safe_copy(context.state)

        # Add snapshot for workflow monitoring
        snapshot_payload: dict[str, Any] = {
            "current_slug": node.slug,
            "steps": [
                {"key": step.key, "title": step.title}
                for step in context.steps
            ],
        }
        wait_state_payload["snapshot"] = snapshot_payload

        if thread is not None:
            _set_wait_state_metadata(thread, wait_state_payload)

        # Set final end state to waiting
        context.runtime_vars["final_end_state"] = WorkflowEndState(
            slug=node.slug,
            status_type="waiting",
            status_reason=wait_reason,
            message=wait_reason,
        )

        # Finish execution with wait state
        return NodeResult(
            finished=True,
            context_updates={
                "last_step_context": last_step_context,
                "final_node_slug": node.slug,
            },
        )

    def _resolve_wait_message(self, node: WorkflowStep) -> str:
        """Extract wait message from node parameters."""
        raw_params = node.parameters or {}
        params = raw_params if isinstance(raw_params, Mapping) else {}
        message = params.get("message")
        if isinstance(message, str):
            return message
        fallback_text = params.get("text")
        if isinstance(fallback_text, str):
            return fallback_text
        return ""
