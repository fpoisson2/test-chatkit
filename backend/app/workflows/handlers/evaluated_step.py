"""Handler for evaluated_step nodes.

An evaluated_step encapsulates the common pattern:
  1. Send an instruction message to the user
  2. Wait for user response
  3. Optionally check for a teacher bypass code
  4. Call an AI evaluator to assess the response
  5. If passed → send success message, continue
  6. If failed → send feedback, increment attempt counter
  7. If max attempts reached → send escalation message, wait again
  8. Otherwise → loop back and wait for another attempt
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
_PHASE_KEY_PREFIX = "evaluated_step_phase_"
_ATTEMPTS_KEY_PREFIX = "evaluated_step_attempts_"


class EvaluatedStepHandler(BaseNodeHandler):
    """Handler for evaluated_step nodes.

    Parameters (node.parameters):
        instruction: str - The instruction message shown to the student
        evaluation_prompt: str - System prompt for the AI evaluator
        feedback_prompt: str - System prompt for generating feedback on failure
        teacher_code: str - Optional bypass code (teacher can skip evaluation)
        max_attempts: int - Max attempts before escalation (default: 3)
        success_message: str - Message shown on successful evaluation
        escalation_message: str - Message shown when max attempts reached
        masked: bool - If true, mask user input (for password/code fields)
    """

    async def execute(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
        from ..runtime.state_machine import NodeResult

        params = self._get_params(node)
        phase_key = f"{_PHASE_KEY_PREFIX}{node.slug}"
        attempts_key = f"{_ATTEMPTS_KEY_PREFIX}{node.slug}"

        # Determine current phase
        phase = (context.state or {}).get(phase_key, "instruction")
        attempts = (context.state or {}).get(attempts_key, 0)

        logger.info(
            "[EVALUATED_STEP] node=%s phase=%s attempts=%d",
            node.slug, phase, attempts,
        )

        if phase == "instruction":
            return await self._phase_instruction(node, context, params, phase_key)

        if phase == "wait_input":
            return await self._phase_wait_input(node, context, params, phase_key)

        if phase == "evaluate":
            return await self._phase_evaluate(
                node, context, params, phase_key, attempts_key, attempts
            )

        if phase == "escalated":
            return await self._phase_escalated(node, context, params, phase_key)

        # Unknown phase, reset
        logger.warning("[EVALUATED_STEP] Unknown phase %s, resetting", phase)
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
        """Send the instruction message and transition to wait_input."""
        from ..runtime.state_machine import NodeResult

        instruction = params.get("instruction", "")
        if instruction:
            await self._send_assistant_message(node, context, instruction)

        # Record step
        if context.record_step:
            title = self._node_title(node)
            await context.record_step(node.slug, title, instruction or "Instruction")

        # Transition to wait phase
        state_updates = {phase_key: "wait_input"}
        if context.state is None:
            context.state = {}
        context.state.update(state_updates)

        # Continue immediately to wait_input (same node)
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

            # Check teacher bypass code
            teacher_code = params.get("teacher_code", "")
            if teacher_code and new_user_text and new_user_text.strip() == teacher_code.strip():
                logger.info("[EVALUATED_STEP] Teacher bypass code matched")
                success_msg = params.get("success_message", "Validé!")
                await self._send_assistant_message(node, context, success_msg)
                state_updates = {phase_key: "instruction"}  # Reset for reuse
                if context.state:
                    context.state.update(state_updates)
                next_slug = self._next_slug_or_fallback(node.slug, context)
                return NodeResult(
                    next_slug=next_slug,
                    context_updates={
                        "last_step_context": {"user_message": new_user_text},
                            },
                )

            # Transition to evaluate phase
            state_updates = {phase_key: "evaluate"}
            if context.state:
                context.state.update(state_updates)
            return NodeResult(
                next_slug=node.slug,
                context_updates={
                    "last_step_context": {"user_message": new_user_text},
                    },
            )

        # First time — pause workflow and wait for user
        # Only mask input during escalation phase (for teacher bypass code)
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

        next_slug_after_wait = node.slug  # Come back to same node
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
                            "[EVALUATED_STEP] Failed to persist wait state: %s", e
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

    # ── Phase: evaluate ─────────────────────────────────────────────────

    async def _phase_evaluate(
        self,
        node: WorkflowStep,
        context: ExecutionContext,
        params: dict[str, Any],
        phase_key: str,
        attempts_key: str,
        attempts: int,
    ) -> NodeResult:
        """Evaluate user response using AI, give feedback or advance."""
        from ..runtime.state_machine import NodeResult

        max_attempts = int(params.get("max_attempts", 3))
        user_text = (context.last_step_context or {}).get("user_message", "")
        instruction = params.get("instruction", "")
        evaluation_prompt = params.get("evaluation_prompt", "")
        feedback_prompt = params.get("feedback_prompt", "")
        success_message = params.get("success_message", "Bravo, c'est correct!")
        escalation_message = params.get(
            "escalation_message",
            "Vous avez atteint le nombre maximum de tentatives. Demandez de l'aide à votre enseignant.",
        )

        # Build evaluation messages for the AI
        eval_system = (
            f"Tu es un évaluateur pédagogique.\n\n"
            f"Consigne donnée à l'étudiant:\n{instruction}\n\n"
            f"Critères d'évaluation:\n{evaluation_prompt}\n\n"
            f"Réponds UNIQUEMENT par un JSON: "
            f'{{"passed": true/false, "feedback": "explication courte"}}'
        )
        eval_user = f"Réponse de l'étudiant:\n{user_text}"

        # Call AI for evaluation
        passed, feedback = await self._call_ai_evaluation(
            node, context, eval_system, eval_user
        )

        if passed:
            # Success — send success message and continue
            await self._send_assistant_message(node, context, success_message)
            state_updates = {
                phase_key: "instruction",
                attempts_key: 0,
            }
            if context.state:
                context.state.update(state_updates)
            next_slug = self._next_slug_or_fallback(node.slug, context)
            return NodeResult(
                next_slug=next_slug,
                context_updates={
                    "last_step_context": {"evaluation_result": "passed"},
                    },
            )

        # Failed — increment attempts
        attempts += 1
        if context.state is None:
            context.state = {}

        if attempts >= max_attempts:
            # Max attempts reached — escalate
            await self._send_assistant_message(node, context, escalation_message)
            state_updates = {
                phase_key: "escalated",
                attempts_key: attempts,
            }
            context.state.update(state_updates)
            # Go back to wait for teacher code or new attempt
            return NodeResult(
                next_slug=node.slug,
                context_updates={
                    "last_step_context": {"evaluation_result": "escalated"},
                    },
            )

        # Under max — send feedback and go back to wait
        if feedback_prompt:
            # Use AI to generate detailed feedback
            fb_system = (
                f"Tu es un tuteur pédagogique bienveillant.\n\n"
                f"Consigne:\n{instruction}\n\n"
                f"Instructions pour le feedback:\n{feedback_prompt}\n\n"
                f"L'évaluation a échoué. Voici le retour: {feedback}\n"
                f"Donne un feedback constructif et encourageant à l'étudiant. "
                f"Ne donne pas la réponse directement."
            )
            fb_user = f"Réponse de l'étudiant:\n{user_text}"
            feedback_text = await self._call_ai_feedback(
                node, context, fb_system, fb_user
            )
        else:
            feedback_text = feedback or "Ce n'est pas tout à fait ça. Essayez encore!"

        await self._send_assistant_message(node, context, feedback_text)

        state_updates = {
            phase_key: "wait_input",
            attempts_key: attempts,
        }
        context.state.update(state_updates)

        return NodeResult(
            next_slug=node.slug,
            context_updates={
                "last_step_context": {"evaluation_result": "retry", "feedback": feedback_text},
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
        """After escalation, wait for teacher code or continue."""
        # Reuse the wait logic — mask input for teacher bypass code
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
        """Create an Agent instance and RunConfig using the same provider chain
        as the agent block (agents SDK + provider binding)."""
        from agents import Agent, RunConfig
        from ...chatkit.agent_registry import (
            get_agent_provider_binding,
            create_litellm_model,
        )

        params = self._get_params(node)
        model_name = params.get("model", "") or "gpt-4o-mini"
        provider_id = params.get("model_provider_id", "")
        provider_slug = params.get("model_provider_slug", "")

        # Resolve provider binding (same path as agent block)
        provider_binding = None
        if provider_id or provider_slug:
            try:
                provider_binding = get_agent_provider_binding(provider_id, provider_slug)
                logger.info(
                    "[EVALUATED_STEP] Provider binding: id=%s, has_provider=%s",
                    provider_binding.provider_id if provider_binding else None,
                    provider_binding.provider is not None if provider_binding else False,
                )
            except Exception as e:
                logger.warning("[EVALUATED_STEP] Provider binding resolution failed: %s", e)

        # Build model (same logic as _instantiate_agent)
        model: Any = model_name
        if provider_binding is not None:
            if provider_binding.provider is not None:
                # Native OpenAI provider (api_base provided) — model stays as string,
                # provider goes into RunConfig
                pass
            else:
                # LiteLLM auto-routing
                model = create_litellm_model(model_name, provider_binding)

        agent = Agent(
            name=f"evaluated_step_{node.slug}",
            instructions=instructions,
            model=model,
        )

        # Build RunConfig (same as _workflow_run_config in executor_v2)
        run_config_kwargs: dict[str, Any] = {}
        if provider_binding is not None and provider_binding.provider is not None:
            run_config_kwargs["model_provider"] = provider_binding.provider
        run_config = RunConfig(**run_config_kwargs)

        logger.info(
            "[EVALUATED_STEP] Resolved model=%s, has_provider=%s",
            model_name,
            "model_provider" in run_config_kwargs,
        )
        return agent, run_config

    async def _run_agent(
        self,
        node: WorkflowStep,
        instructions: str,
        user_message: str,
    ) -> str:
        """Run a simple agent call using the agents SDK. Returns the text output."""
        from agents import Runner

        agent, run_config = self._resolve_agent_and_config(node, instructions)
        result = await Runner.run(
            agent,
            input=user_message,
            run_config=run_config,
            max_turns=1,
        )
        return result.final_output or ""

    async def _call_ai_evaluation(
        self,
        node: WorkflowStep,
        context: ExecutionContext,
        system_prompt: str,
        user_message: str,
    ) -> tuple[bool, str]:
        """Call AI to evaluate student response. Returns (passed, feedback)."""
        import json

        try:
            raw = await self._run_agent(node, system_prompt, user_message)
            logger.info("[EVALUATED_STEP] AI evaluation response: %s", raw[:200])

            # Parse JSON response (may be wrapped in markdown code block)
            json_str = raw.strip()
            if json_str.startswith("```"):
                lines = json_str.split("\n")
                json_str = "\n".join(
                    line for line in lines
                    if not line.strip().startswith("```")
                )

            result = json.loads(json_str)
            passed = bool(result.get("passed", False))
            feedback = str(result.get("feedback", ""))
            return passed, feedback

        except Exception as e:
            logger.error("[EVALUATED_STEP] AI evaluation error: %s", e, exc_info=True)
            return False, "Une erreur s'est produite lors de l'évaluation. Veuillez réessayer."

    async def _call_ai_feedback(
        self,
        node: WorkflowStep,
        context: ExecutionContext,
        system_prompt: str,
        user_message: str,
    ) -> str:
        """Call AI to generate feedback for the student."""
        try:
            return await self._run_agent(node, system_prompt, user_message) or "Essayez encore."
        except Exception as e:
            logger.error("[EVALUATED_STEP] AI feedback error: %s", e, exc_info=True)
            return "Ce n'est pas tout à fait correct. Veuillez réessayer."
