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
        from ...chatkit_server.context import _get_wait_state_metadata, _set_wait_state_metadata
        from ..executor import WorkflowEndState
        from ..runtime.state_machine import NodeResult
        from ..runtime.voice_context import _resolve_voice_agent_configuration

        # Get dependencies from context
        voice_session_manager = context.runtime_vars.get("voice_session_manager")
        if voice_session_manager is None:
            raise RuntimeError("voice_session_manager not available in runtime_vars")

        agent_context = context.runtime_vars.get("agent_context")
        thread = context.runtime_vars.get("thread")
        current_input_item_id = context.runtime_vars.get("current_input_item_id")
        emit_stream_event = context.runtime_vars.get("emit_stream_event")
        voice_overrides = context.runtime_vars.get("voice_overrides")

        # Check if we're resuming from a voice wait state
        pending_wait_state = (
            _get_wait_state_metadata(thread) if thread is not None else None
        )
        waiting_slug = (
            pending_wait_state.get("slug") if pending_wait_state else None
        )
        waiting_type = (
            pending_wait_state.get("type") if pending_wait_state else None
        )
        waiting_input_id = (
            pending_wait_state.get("input_item_id") if pending_wait_state else None
        )
        voice_transcripts = (
            pending_wait_state.get("voice_transcripts") if pending_wait_state else None
        )

        # Check if we're resuming from this voice session
        resumed = (
            pending_wait_state is not None
            and waiting_type == "voice"
            and waiting_slug == node.slug
            and current_input_item_id
            and waiting_input_id != current_input_item_id
            and voice_transcripts is not None
        )

        if resumed:
            # Resume from voice session - transcripts are ready
            logger.info("Reprise du workflow après session vocale pour l'étape %s", node.slug)

            next_slug = pending_wait_state.get("next_step_slug")
            if next_slug is None:
                next_slug = self._next_slug_or_fallback(node.slug, context)

            # Clear wait state
            if thread is not None:
                _set_wait_state_metadata(thread, None)

            # Build context with voice transcripts
            last_step_context = {
                "voice_transcripts": voice_transcripts,
            }

            if not next_slug:
                # No transition after voice session - finish workflow
                context.runtime_vars["final_end_state"] = WorkflowEndState(
                    slug=node.slug,
                    status_type="closed",
                    status_reason=(
                        "Aucune transition disponible après la session vocale."
                    ),
                    message=("Aucune transition disponible après la session vocale."),
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

        # First time hitting voice agent - start voice session
        logger.info("Démarrage d'une session vocale pour l'étape %s", node.slug)

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
