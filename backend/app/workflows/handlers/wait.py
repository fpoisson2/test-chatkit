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
        initial_user_text = context.runtime_vars.get("initial_user_text")
        agent_context = context.runtime_vars.get("agent_context")
        on_stream_event = context.runtime_vars.get("on_stream_event")
        current_user_message = context.runtime_vars.get("current_user_message")
        thread_item_converter = context.runtime_vars.get("thread_item_converter")

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

        logger.info(
            "[WAIT_DEBUG] node=%s, thread=%s, pending_wait_state=%s, "
            "waiting_slug=%s, waiting_input_id=%s, current_input_item_id=%s",
            node.slug,
            "exists" if thread is not None else "None",
            "exists" if pending_wait_state else "None",
            waiting_slug,
            waiting_input_id,
            current_input_item_id,
        )

        resumed = (
            pending_wait_state is not None
            and waiting_slug == node.slug
            and current_input_item_id
            and waiting_input_id != current_input_item_id
        )

        logger.info("[WAIT_DEBUG] resumed=%s", resumed)

        if resumed:
            # Resume from wait - user provided new message
            next_slug = pending_wait_state.get("next_step_slug")
            if next_slug is None:
                next_slug = self._next_slug_or_fallback(node.slug, context)

            # NOTE: We intentionally do NOT clear the wait state from the
            # thread metadata here.  The on_step_stream callback persists the
            # thread whenever the current step changes; if we cleared the wait
            # state in memory now, that save would also wipe it from the DB.
            # If the student then disconnects before the *next* wait/widget
            # node saves its own state, the workflow would have no fallback
            # and restart from scratch.
            #
            # Instead we leave the old wait state in the thread metadata.  The
            # next wait or widget node will overwrite it with its own state.
            # Worst case (student leaves before the next node), the workflow
            # resumes at the *previous* wait node rather than at the beginning.

            # Clear pending_wait_state in runtime_vars so that agent steps
            # in while loops don't incorrectly clear conversation history
            # (see executor_v2.py lines 820-823)
            context.runtime_vars["pending_wait_state"] = None

            # Get the text from the NEW user message (not initial_user_text which is stale)
            new_user_text = initial_user_text  # Default fallback
            if current_user_message is not None:
                # Extract text from current_user_message
                typed_parts: list[str] = []
                for part in getattr(current_user_message, "content", []) or []:
                    text_value = getattr(part, "text", None)
                    normalized = _normalize_user_text(text_value) if text_value else ""
                    if normalized:
                        typed_parts.append(normalized)
                if typed_parts:
                    new_user_text = "\n".join(typed_parts)
                    logger.info(
                        "[WAIT_DEBUG] Extracted new user text from current_user_message: %s",
                        new_user_text[:100] if new_user_text else "empty"
                    )

            # Update runtime_vars with new user text so subsequent nodes use it
            context.runtime_vars["initial_user_text"] = new_user_text

            # NOTE: We do NOT add the user message to conversation_history here because
            # the StateInitializer already adds it when the workflow resumes (see
            # state_manager.py lines 177-183). Adding it here would cause duplication.

            # Build context with user message
            last_step_context = {"user_message": new_user_text}

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
        wait_state_payload: dict[str, Any] = {
            "slug": node.slug,
            "input_item_id": current_input_item_id,
        }

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

            # CRITICAL: Persist thread with wait state immediately to ensure
            # the wait state survives if the user leaves and returns via LTI.
            # Without this, the workflow would restart from the beginning.
            if agent_context is not None:
                store = getattr(agent_context, "store", None)
                request_context = getattr(agent_context, "request_context", None)
                if store is not None and request_context is not None:
                    try:
                        await store.save_thread(thread, context=request_context)
                        logger.info(
                            "[WAIT_DEBUG] Thread %s wait state persisted immediately",
                            getattr(thread, "id", "unknown"),
                        )
                    except Exception as persist_exc:
                        logger.warning(
                            "[WAIT_DEBUG] Failed to persist wait state for thread %s: %s",
                            getattr(thread, "id", "unknown"),
                            persist_exc,
                        )

        # Set final end state to waiting
        context.runtime_vars["final_end_state"] = WorkflowEndState(
            slug=node.slug,
            status_type="waiting",
            status_reason=wait_reason,
            message=wait_reason,
        )

        logger.info(
            "[WAIT_DEBUG] Pausing workflow at node=%s, returning finished=True, "
            "wait_state_saved=%s",
            node.slug,
            thread is not None,
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
