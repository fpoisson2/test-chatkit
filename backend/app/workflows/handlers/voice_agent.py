"""Handler for voice_agent nodes."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..runtime.state_machine import ExecutionContext, NodeResult


logger = logging.getLogger("chatkit.server")


class VoiceAgentNodeHandler(BaseNodeHandler):
    """Handler for voice_agent nodes.

    Voice agent nodes start a realtime voice session and pause the workflow
    until the user completes the voice interaction.
    """

    async def execute(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
        """Execute voice_agent step by starting a realtime voice session."""
        from ...chatkit_server.context import _set_wait_state_metadata
        from ..executor import WorkflowEndState
        from ..runtime.state_machine import NodeResult
        from ..runtime.voice_context import _resolve_voice_agent_configuration

        logger.info("Démarrage d'une session vocale pour l'étape %s", node.slug)

        # Get dependencies from context
        voice_session_manager = context.runtime_vars.get("voice_session_manager")
        if voice_session_manager is None:
            raise RuntimeError("voice_session_manager not available in runtime_vars")

        agent_context = context.runtime_vars.get("agent_context")
        thread = context.runtime_vars.get("thread")
        current_input_item_id = context.runtime_vars.get("current_input_item_id")
        emit_stream_event = context.runtime_vars.get("emit_stream_event")
        voice_overrides = context.runtime_vars.get("voice_overrides")

        # Resolve voice agent configuration
        voice_context, event_context = _resolve_voice_agent_configuration(
            node, overrides=voice_overrides
        )

        # Get user ID
        request_context = getattr(agent_context, "request_context", None)
        user_id = getattr(request_context, "user_id", None) if request_context else None
        if not user_id:
            user_id = "unknown"

        # Get title
        title = self._node_title(node)

        # Determine next step slug
        next_step_slug = self._next_slug_or_fallback(node.slug, context)

        # Start voice session
        result = await voice_session_manager.start_voice_session(
            current_step_slug=node.slug,
            title=title,
            voice_context=voice_context,
            event_context=event_context,
            agent_context=agent_context,
            user_id=user_id,
            conversation_history=context.conversation_history,
            state=context.state,
            thread=thread,
            current_input_item_id=current_input_item_id,
            next_step_slug=next_step_slug,
            record_step=context.record_step,
            emit_stream_event=emit_stream_event,
        )

        # Set wait state on thread
        if thread is not None:
            _set_wait_state_metadata(thread, result.wait_state_payload)

        # Set final end state to waiting
        context.runtime_vars["final_end_state"] = WorkflowEndState(
            slug=node.slug,
            status_type="waiting",
            status_reason="En attente de la session vocale",
            message="En attente de la session vocale",
        )

        logger.info("Session vocale démarrée pour l'étape %s", node.slug)

        # Return finished=True to stop workflow execution
        return NodeResult(
            finished=True,
            context_updates={
                "last_step_context": result.last_step_context,
                "final_node_slug": node.slug,
            },
        )
