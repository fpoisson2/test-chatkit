"""Handler for help_loop nodes.

A help_loop encapsulates a conversational support loop:
  1. Send an initial instruction/context message to the user
  2. Wait for user input
  3. Run an AI agent to provide help (socratic/diagnostic approach)
  4. Check exit condition (keyword match or max turns)
  5. If exit keyword detected → send success message, advance
  6. If max turns reached → send escalation message, advance or wait
  7. Otherwise → loop back and wait for the next user message
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import datetime
from typing import TYPE_CHECKING, Any

from chatkit.types import (
    AssistantMessageContent,
    AssistantMessageItem,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
)

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..runtime.state_machine import ExecutionContext, NodeResult

logger = logging.getLogger("chatkit.server")

# Keys used in context.state for tracking per-node progress
_PHASE_KEY_PREFIX = "help_loop_phase_"
_TURNS_KEY_PREFIX = "help_loop_turns_"


class HelpLoopHandler(BaseNodeHandler):
    """Handler for help_loop nodes.

    Parameters (node.parameters):
        instruction: str - Initial message / context shown to the student
        agent_prompt: str - System prompt for the help agent
        exit_keyword: str - Keyword the student types to exit the loop
        max_turns: int - Max conversation turns (default: 10)
        success_message: str - Message shown when student exits successfully
        escalation_message: str - Message shown when max turns reached
        escalation_behavior: str - "advance" or "wait_for_teacher"
        teacher_code: str - Optional bypass code
        model: str - AI model name
        model_provider_id: str - Provider ID
        model_provider_slug: str - Provider slug
    """

    async def execute(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
        from ..runtime.state_machine import NodeResult

        params = self._get_params(node)
        phase_key = f"{_PHASE_KEY_PREFIX}{node.slug}"
        turns_key = f"{_TURNS_KEY_PREFIX}{node.slug}"

        # Determine current phase
        phase = (context.state or {}).get(phase_key, "instruction")
        turns = (context.state or {}).get(turns_key, 0)

        logger.info(
            "[HELP_LOOP] node=%s phase=%s turns=%d",
            node.slug, phase, turns,
        )

        if phase == "instruction":
            return await self._phase_instruction(node, context, params, phase_key)

        if phase == "wait_input":
            return await self._phase_wait_input(node, context, params, phase_key)

        if phase == "respond":
            return await self._phase_respond(
                node, context, params, phase_key, turns_key, turns
            )

        if phase == "escalated":
            return await self._phase_escalated(node, context, params, phase_key)

        # Unknown phase, reset
        logger.warning("[HELP_LOOP] Unknown phase %s, resetting", phase)
        return NodeResult(
            next_slug=node.slug,
            context_updates={"state_updates": {phase_key: "instruction"}},
        )

    # ── Phase: instruction ──────────────────────────────────────────────

    async def _phase_instruction(
        self,
        node: WorkflowStep,
        context: ExecutionContext,
        params: dict[str, Any],
        phase_key: str,
    ) -> NodeResult:
        """Send the initial instruction message and transition to wait_input."""
        from ..runtime.state_machine import NodeResult

        instruction = params.get("instruction", "")
        if instruction:
            await self._send_assistant_message(node, context, instruction)

        # Record step
        if context.record_step:
            title = self._node_title(node)
            await context.record_step(node.slug, title, instruction or "Boucle d'aide")

        # Transition to wait phase
        state_updates = {phase_key: "wait_input"}
        if context.state is None:
            context.state = {}
        context.state.update(state_updates)

        return NodeResult(
            next_slug=node.slug,
            context_updates={
                "last_step_context": {"assistant_message": instruction},
            },
        )

    # ── Phase: wait_input ───────────────────────────────────────────────

    async def _phase_wait_input(
        self,
        node: WorkflowStep,
        context: ExecutionContext,
        params: dict[str, Any],
        phase_key: str,
        *,
        is_escalated: bool = False,
    ) -> NodeResult:
        """Wait for user input using the same pattern as WaitNodeHandler."""
        from ...chatkit_server.context import (
            _get_wait_state_metadata,
            _set_wait_state_metadata,
        )
        from ..executor import WorkflowEndState
        from ..utils import _clone_conversation_history_snapshot, _json_safe_copy, _normalize_user_text
        from ..runtime.state_machine import NodeResult

        thread = context.runtime_vars.get("thread")
        current_input_item_id = context.runtime_vars.get("current_input_item_id")
        initial_user_text = context.runtime_vars.get("initial_user_text")
        agent_context = context.runtime_vars.get("agent_context")
        current_user_message = context.runtime_vars.get("current_user_message")

        # Check if we're resuming from a wait
        pending_wait_state = (
            _get_wait_state_metadata(thread) if thread is not None else None
        )
        waiting_slug = pending_wait_state.get("slug") if pending_wait_state else None
        waiting_input_id = (
            pending_wait_state.get("input_item_id") if pending_wait_state else None
        )
        consumed_wait_inputs = context.runtime_vars.get("consumed_wait_inputs")
        if not isinstance(consumed_wait_inputs, dict):
            consumed_wait_inputs = {}
            context.runtime_vars["consumed_wait_inputs"] = consumed_wait_inputs
        already_consumed = consumed_wait_inputs.get(node.slug)

        resumed = (
            pending_wait_state is not None
            and waiting_slug == node.slug
            and current_input_item_id
            and waiting_input_id != current_input_item_id
            and already_consumed != current_input_item_id
        )

        if resumed:
            # User provided new input — extract it
            new_user_text = initial_user_text
            if current_user_message is not None:
                typed_parts: list[str] = []
                for part in getattr(current_user_message, "content", []) or []:
                    text_value = getattr(part, "text", None)
                    normalized = _normalize_user_text(text_value) if text_value else ""
                    if normalized:
                        typed_parts.append(normalized)
                if typed_parts:
                    new_user_text = "\n".join(typed_parts)

            context.runtime_vars["initial_user_text"] = new_user_text
            context.runtime_vars["pending_wait_state"] = None
            consumed_wait_inputs[node.slug] = current_input_item_id

            # Check teacher bypass code (if escalated)
            if is_escalated:
                teacher_code = params.get("teacher_code", "")
                if teacher_code and new_user_text and new_user_text.strip() == teacher_code.strip():
                    logger.info("[HELP_LOOP] Teacher bypass code matched")
                    success_msg = params.get("success_message", "C'est réglé!")
                    await self._send_assistant_message(node, context, success_msg)
                    state_updates = {phase_key: "instruction"}
                    if context.state:
                        context.state.update(state_updates)
                    next_slug = self._next_slug_or_fallback(node.slug, context)
                    return NodeResult(
                        next_slug=next_slug,
                        context_updates={
                            "last_step_context": {"user_message": new_user_text},
                        },
                    )

            # Check exit keyword
            exit_keyword = (params.get("exit_keyword") or "").strip().lower()
            if exit_keyword and new_user_text and exit_keyword in new_user_text.strip().lower():
                logger.info("[HELP_LOOP] Exit keyword matched: %s", exit_keyword)
                success_msg = params.get("success_message", "C'est réglé!")
                await self._send_assistant_message(node, context, success_msg)
                # Reset state and advance
                state_updates = {phase_key: "instruction", f"{_TURNS_KEY_PREFIX}{node.slug}": 0}
                if context.state:
                    context.state.update(state_updates)
                next_slug = self._next_slug_or_fallback(node.slug, context)
                return NodeResult(
                    next_slug=next_slug,
                    context_updates={
                        "last_step_context": {"user_message": new_user_text, "exit_reason": "keyword"},
                    },
                )

            # Transition to respond phase (AI will answer)
            state_updates = {phase_key: "respond"}
            if context.state:
                context.state.update(state_updates)
            return NodeResult(
                next_slug=node.slug,
                context_updates={
                    "last_step_context": {"user_message": new_user_text},
                },
            )

        # First time — pause workflow and wait for user
        input_masked = is_escalated and bool(params.get("masked", False))
        wait_state_payload: dict[str, Any] = {
            "slug": node.slug,
            "input_item_id": current_input_item_id,
        }
        if input_masked:
            wait_state_payload["input_masked"] = True

        conversation_snapshot = _clone_conversation_history_snapshot(
            context.conversation_history
        )
        if conversation_snapshot:
            wait_state_payload["conversation_history"] = conversation_snapshot

        next_slug_after_wait = node.slug
        wait_state_payload["next_step_slug"] = next_slug_after_wait

        if context.state:
            wait_state_payload["state"] = _json_safe_copy(context.state)

        wait_state_payload["snapshot"] = {
            "current_slug": node.slug,
            "steps": [
                {"key": step.key, "title": step.title}
                for step in context.steps
            ],
        }

        if thread is not None:
            _set_wait_state_metadata(thread, wait_state_payload)
            if agent_context is not None:
                store = getattr(agent_context, "store", None)
                request_context = getattr(agent_context, "request_context", None)
                if store is not None and request_context is not None:
                    try:
                        await store.save_thread(thread, context=request_context)
                    except Exception as e:
                        logger.warning(
                            "[HELP_LOOP] Failed to persist wait state: %s", e
                        )

        context.runtime_vars["final_end_state"] = WorkflowEndState(
            slug=node.slug,
            status_type="waiting",
            status_reason="En attente de la réponse de l'étudiant.",
            message="En attente de la réponse de l'étudiant.",
        )

        return NodeResult(
            finished=True,
            context_updates={
                "last_step_context": {"wait_for_user_input": True},
                "final_node_slug": node.slug,
            },
        )

    # ── Phase: respond ──────────────────────────────────────────────────

    async def _phase_respond(
        self,
        node: WorkflowStep,
        context: ExecutionContext,
        params: dict[str, Any],
        phase_key: str,
        turns_key: str,
        turns: int,
    ) -> NodeResult:
        """Generate AI response, check turn limit, then loop back to wait."""
        from ..runtime.state_machine import NodeResult

        max_turns = int(params.get("max_turns", 10))
        user_text = (context.last_step_context or {}).get("user_message", "")
        agent_prompt = params.get("agent_prompt", "")
        escalation_message = params.get(
            "escalation_message",
            "Le nombre maximum d'échanges a été atteint. Demandez de l'aide à votre enseignant.",
        )

        # Increment turns
        turns += 1
        if context.state is None:
            context.state = {}

        # Check turn limit
        if turns >= max_turns:
            await self._send_assistant_message(node, context, escalation_message)
            escalation_behavior = params.get("escalation_behavior", "advance")
            if escalation_behavior == "wait_for_teacher":
                state_updates = {
                    phase_key: "escalated",
                    turns_key: turns,
                }
                context.state.update(state_updates)
                return NodeResult(
                    next_slug=node.slug,
                    context_updates={
                        "last_step_context": {"exit_reason": "max_turns"},
                    },
                )
            else:
                # Advance to next node
                state_updates = {
                    phase_key: "instruction",
                    turns_key: 0,
                }
                context.state.update(state_updates)
                next_slug = self._next_slug_or_fallback(node.slug, context)
                return NodeResult(
                    next_slug=next_slug,
                    context_updates={
                        "last_step_context": {"exit_reason": "max_turns"},
                    },
                )

        # Generate AI response
        instruction = params.get("instruction", "")
        system_prompt = agent_prompt or (
            f"Tu es un assistant pédagogique.\n"
            f"Contexte: {instruction}\n"
            f"Aide l'étudiant de manière socratique. "
            f"Pose des questions ciblées pour identifier le problème. "
            f"Ne donne pas la solution complète d'emblée."
        )

        try:
            response_text = await self._run_agent(node, system_prompt, user_text)
        except Exception as e:
            logger.error("[HELP_LOOP] AI response error: %s", e, exc_info=True)
            response_text = "Je rencontre un problème technique. Pouvez-vous reformuler votre question?"

        await self._send_assistant_message(node, context, response_text)

        # Loop back to wait_input
        state_updates = {
            phase_key: "wait_input",
            turns_key: turns,
        }
        context.state.update(state_updates)

        return NodeResult(
            next_slug=node.slug,
            context_updates={
                "last_step_context": {"assistant_response": response_text},
            },
        )

    # ── Phase: escalated ────────────────────────────────────────────────

    async def _phase_escalated(
        self,
        node: WorkflowStep,
        context: ExecutionContext,
        params: dict[str, Any],
        phase_key: str,
    ) -> NodeResult:
        """After escalation, wait for teacher code."""
        return await self._phase_wait_input(
            node, context, params, phase_key, is_escalated=True
        )

    # ── Helpers ──────────────────────────────────────────────────────────

    def _get_params(self, node: WorkflowStep) -> dict[str, Any]:
        """Extract parameters from node."""
        raw = node.parameters or {}
        return dict(raw) if isinstance(raw, Mapping) else {}

    async def _send_assistant_message(
        self,
        node: WorkflowStep,
        context: ExecutionContext,
        message: str,
    ) -> None:
        """Send an assistant message to the user."""
        from ..executor import resolve_transform_value

        agent_context = context.runtime_vars.get("agent_context")
        emit_stream_event = context.runtime_vars.get("emit_stream_event")

        # Interpolate template variables
        interpolated = resolve_transform_value(
            message,
            state=context.state,
            default_input_context=context.last_step_context,
            input_context=context.last_step_context,
        )
        text = interpolated if isinstance(interpolated, str) else message

        if text and emit_stream_event is not None and agent_context is not None:
            assistant_item = AssistantMessageItem(
                id=agent_context.generate_id("message"),
                thread_id=agent_context.thread.id,
                created_at=datetime.now(),
                content=[AssistantMessageContent(text=text)],
                step_slug=node.slug,
            )
            await emit_stream_event(ThreadItemAddedEvent(item=assistant_item))
            await emit_stream_event(ThreadItemDoneEvent(item=assistant_item))

    def _resolve_agent_and_config(
        self, node: WorkflowStep, instructions: str
    ) -> tuple[Any, Any]:
        """Create an Agent instance and RunConfig using the agents SDK."""
        from agents import Agent, RunConfig
        from ...chatkit.agent_registry import (
            get_agent_provider_binding,
            create_litellm_model,
        )

        params = self._get_params(node)
        model_name = params.get("model", "") or "gpt-4o-mini"
        provider_id = params.get("model_provider_id", "")
        provider_slug = params.get("model_provider_slug", "")

        # Resolve provider binding
        provider_binding = None
        if provider_id or provider_slug:
            try:
                provider_binding = get_agent_provider_binding(provider_id, provider_slug)
                logger.info(
                    "[HELP_LOOP] Provider binding: id=%s, has_provider=%s",
                    provider_binding.provider_id if provider_binding else None,
                    provider_binding.provider is not None if provider_binding else False,
                )
            except Exception as e:
                logger.warning("[HELP_LOOP] Provider binding resolution failed: %s", e)

        model: Any = model_name
        if provider_binding is not None:
            if provider_binding.provider is not None:
                pass  # Native OpenAI provider
            else:
                model = create_litellm_model(model_name, provider_binding)

        agent = Agent(
            name=f"help_loop_{node.slug}",
            instructions=instructions,
            model=model,
        )

        run_config_kwargs: dict[str, Any] = {}
        if provider_binding is not None and provider_binding.provider is not None:
            run_config_kwargs["model_provider"] = provider_binding.provider
        run_config = RunConfig(**run_config_kwargs)

        return agent, run_config

    async def _run_agent(
        self,
        node: WorkflowStep,
        instructions: str,
        user_message: str,
    ) -> str:
        """Run a simple agent call using the agents SDK."""
        from agents import Runner

        agent, run_config = self._resolve_agent_and_config(node, instructions)
        result = await Runner.run(
            agent,
            input=user_message,
            run_config=run_config,
            max_turns=1,
        )
        return result.final_output or ""
