"""Handler for guided_exercise nodes.

A guided_exercise combines evaluated_step + help_loop in a single block:
  1. Send instruction to the student
  2. Wait for response
  3. Evaluate with AI (pass/fail)
  4. On pass → success message, advance to next node
  5. On fail (under max attempts) → feedback, retry
  6. On fail (max attempts reached) → enter help mode
  7. Help mode: conversational AI support loop (wait → respond → wait...)
  8. On exit keyword in help mode → reset attempts, back to evaluation
  9. On max help turns → escalate (advance or wait for teacher code)
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

_PHASE_KEY_PREFIX = "guided_exercise_phase_"
_ATTEMPTS_KEY_PREFIX = "guided_exercise_attempts_"
_HELP_TURNS_KEY_PREFIX = "guided_exercise_help_turns_"


class GuidedExerciseHandler(BaseNodeHandler):
    """Handler for guided_exercise nodes.

    Parameters (node.parameters):
        instruction: str - Exercise prompt shown to student
        evaluation_prompt: str - Criteria for AI evaluation (pass/fail)
        feedback_prompt: str - Instructions for generating feedback on failure
        help_agent_prompt: str - System prompt for the help agent in help mode
        exit_keyword: str - Keyword to exit help mode and retry
        max_attempts: int - Max eval attempts before entering help mode (default: 3)
        max_help_turns: int - Max conversation turns in help mode (default: 10)
        success_message: str - Message on pass
        escalation_message: str - Message when help mode exhausted
        escalation_behavior: str - "advance" or "wait_for_teacher"
        teacher_code: str - Optional bypass code
        masked: bool - Mask input during escalation (teacher code)
        model: str - AI model name
        model_provider_id: str
        model_provider_slug: str
    """

    async def execute(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
        from ..runtime.state_machine import NodeResult

        params = self._get_params(node)
        phase_key = f"{_PHASE_KEY_PREFIX}{node.slug}"
        attempts_key = f"{_ATTEMPTS_KEY_PREFIX}{node.slug}"
        help_turns_key = f"{_HELP_TURNS_KEY_PREFIX}{node.slug}"

        phase = (context.state or {}).get(phase_key, "instruction")
        attempts = (context.state or {}).get(attempts_key, 0)
        help_turns = (context.state or {}).get(help_turns_key, 0)

        logger.info(
            "[GUIDED_EXERCISE] node=%s phase=%s attempts=%d help_turns=%d",
            node.slug, phase, attempts, help_turns,
        )

        if phase == "instruction":
            return await self._phase_instruction(node, context, params, phase_key)

        if phase == "wait_input":
            return await self._phase_wait_input(node, context, params, phase_key)

        if phase == "evaluate":
            return await self._phase_evaluate(
                node, context, params, phase_key, attempts_key, help_turns_key, attempts
            )

        if phase == "help_mode":
            return await self._phase_help_mode(node, context, params, phase_key)

        if phase == "wait_help":
            return await self._phase_wait_help(node, context, params, phase_key)

        if phase == "respond_help":
            return await self._phase_respond_help(
                node, context, params, phase_key, attempts_key, help_turns_key, help_turns
            )

        if phase == "escalated":
            return await self._phase_escalated(node, context, params, phase_key)

        # Unknown phase, reset
        logger.warning("[GUIDED_EXERCISE] Unknown phase %s, resetting", phase)
        return NodeResult(
            next_slug=node.slug,
            context_updates={"state_updates": {phase_key: "instruction"}},
        )

    # ── Phase: instruction ──────────────────────────────────────────────

    async def _phase_instruction(
        self, node: WorkflowStep, context: ExecutionContext,
        params: dict[str, Any], phase_key: str,
    ) -> NodeResult:
        from ..runtime.state_machine import NodeResult

        instruction = params.get("instruction", "")
        if instruction:
            await self._send_assistant_message(node, context, instruction)

        if context.record_step:
            title = self._node_title(node)
            await context.record_step(node.slug, title, instruction or "Exercice guidé")

        state_updates = {phase_key: "wait_input"}
        if context.state is None:
            context.state = {}
        context.state.update(state_updates)

        return NodeResult(
            next_slug=node.slug,
            context_updates={"last_step_context": {"assistant_message": instruction}},
        )

    # ── Phase: wait_input (evaluation attempt) ──────────────────────────

    async def _phase_wait_input(
        self, node: WorkflowStep, context: ExecutionContext,
        params: dict[str, Any], phase_key: str,
    ) -> NodeResult:
        return await self._wait_for_user(
            node, context, params, phase_key,
            next_phase="evaluate",
            is_escalated=False,
        )

    # ── Phase: evaluate ─────────────────────────────────────────────────

    async def _phase_evaluate(
        self, node: WorkflowStep, context: ExecutionContext,
        params: dict[str, Any], phase_key: str,
        attempts_key: str, help_turns_key: str, attempts: int,
    ) -> NodeResult:
        from ..runtime.state_machine import NodeResult

        max_attempts = int(params.get("max_attempts", 3))
        user_text = (context.last_step_context or {}).get("user_message", "")
        instruction = params.get("instruction", "")
        evaluation_prompt = params.get("evaluation_prompt", "")
        feedback_prompt = params.get("feedback_prompt", "")
        success_message = params.get("success_message", "Bravo, c'est correct!")

        # AI evaluation
        eval_system = (
            f"Tu es un évaluateur pédagogique.\n\n"
            f"Consigne donnée à l'étudiant:\n{instruction}\n\n"
            f"Critères d'évaluation:\n{evaluation_prompt}\n\n"
            f"Réponds UNIQUEMENT par un JSON: "
            f'{{"passed": true/false, "feedback": "explication courte"}}'
        )
        eval_user = f"Réponse de l'étudiant:\n{user_text}"

        passed, feedback = await self._call_ai_evaluation(
            node, context, eval_system, eval_user
        )

        if context.state is None:
            context.state = {}

        if passed:
            await self._send_assistant_message(node, context, success_message)
            context.state.update({
                phase_key: "instruction",
                attempts_key: 0,
                help_turns_key: 0,
            })
            next_slug = self._next_slug_or_fallback(node.slug, context)
            return NodeResult(
                next_slug=next_slug,
                context_updates={"last_step_context": {"evaluation_result": "passed"}},
            )

        # Failed
        attempts += 1

        if attempts >= max_attempts:
            # Enter help mode
            context.state.update({
                phase_key: "help_mode",
                attempts_key: attempts,
                help_turns_key: 0,
            })
            return NodeResult(
                next_slug=node.slug,
                context_updates={"last_step_context": {"evaluation_result": "help_mode"}},
            )

        # Under max — feedback and retry
        if feedback_prompt:
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

        context.state.update({
            phase_key: "wait_input",
            attempts_key: attempts,
        })

        return NodeResult(
            next_slug=node.slug,
            context_updates={"last_step_context": {"evaluation_result": "retry", "feedback": feedback_text}},
        )

    # ── Phase: help_mode (enter help loop) ──────────────────────────────

    async def _phase_help_mode(
        self, node: WorkflowStep, context: ExecutionContext,
        params: dict[str, Any], phase_key: str,
    ) -> NodeResult:
        from ..runtime.state_machine import NodeResult

        # Send help mode intro message
        exit_keyword = (params.get("exit_keyword") or "réglé").strip()
        help_intro = params.get(
            "help_intro_message",
            f"Tu sembles avoir besoin d'aide. Décris-moi ce qui te bloque et je vais "
            f"essayer de te guider. Quand tu penses avoir compris, écris « {exit_keyword} » "
            f"pour réessayer."
        )
        await self._send_assistant_message(node, context, help_intro)

        if context.state is None:
            context.state = {}
        context.state.update({phase_key: "wait_help"})

        return NodeResult(
            next_slug=node.slug,
            context_updates={"last_step_context": {"assistant_message": help_intro}},
        )

    # ── Phase: wait_help (wait for user in help loop) ───────────────────

    async def _phase_wait_help(
        self, node: WorkflowStep, context: ExecutionContext,
        params: dict[str, Any], phase_key: str,
    ) -> NodeResult:
        return await self._wait_for_user(
            node, context, params, phase_key,
            next_phase="respond_help",
            is_escalated=False,
            check_exit_keyword=True,
        )

    # ── Phase: respond_help (AI help response) ──────────────────────────

    async def _phase_respond_help(
        self, node: WorkflowStep, context: ExecutionContext,
        params: dict[str, Any], phase_key: str,
        attempts_key: str, help_turns_key: str, help_turns: int,
    ) -> NodeResult:
        from ..runtime.state_machine import NodeResult

        max_help_turns = int(params.get("max_help_turns", 10))
        user_text = (context.last_step_context or {}).get("user_message", "")
        instruction = params.get("instruction", "")
        help_agent_prompt = params.get("help_agent_prompt", "")
        escalation_message = params.get(
            "escalation_message",
            "Le nombre maximum d'échanges a été atteint. Demandez de l'aide à votre enseignant.",
        )

        help_turns += 1
        if context.state is None:
            context.state = {}

        # Check turn limit
        if help_turns >= max_help_turns:
            await self._send_assistant_message(node, context, escalation_message)
            escalation_behavior = params.get("escalation_behavior", "advance")
            if escalation_behavior == "wait_for_teacher":
                context.state.update({
                    phase_key: "escalated",
                    help_turns_key: help_turns,
                })
                return NodeResult(
                    next_slug=node.slug,
                    context_updates={"last_step_context": {"exit_reason": "max_help_turns"}},
                )
            else:
                context.state.update({
                    phase_key: "instruction",
                    attempts_key: 0,
                    help_turns_key: 0,
                })
                next_slug = self._next_slug_or_fallback(node.slug, context)
                return NodeResult(
                    next_slug=next_slug,
                    context_updates={"last_step_context": {"exit_reason": "max_help_turns"}},
                )

        # Generate AI help response
        system_prompt = help_agent_prompt or (
            f"Tu es un tuteur pédagogique bienveillant.\n"
            f"Contexte de l'exercice: {instruction}\n"
            f"L'étudiant a échoué plusieurs tentatives et a besoin d'aide.\n"
            f"Aide-le de manière socratique. Pose des questions ciblées pour identifier "
            f"le problème. Ne donne pas la solution complète d'emblée."
        )

        try:
            response_text = await self._run_agent(node, system_prompt, user_text)
        except Exception as e:
            logger.error("[GUIDED_EXERCISE] AI help error: %s", e, exc_info=True)
            response_text = "Je rencontre un problème technique. Pouvez-vous reformuler?"

        await self._send_assistant_message(node, context, response_text)

        context.state.update({
            phase_key: "wait_help",
            help_turns_key: help_turns,
        })

        return NodeResult(
            next_slug=node.slug,
            context_updates={"last_step_context": {"assistant_response": response_text}},
        )

    # ── Phase: escalated ────────────────────────────────────────────────

    async def _phase_escalated(
        self, node: WorkflowStep, context: ExecutionContext,
        params: dict[str, Any], phase_key: str,
    ) -> NodeResult:
        return await self._wait_for_user(
            node, context, params, phase_key,
            next_phase="evaluate",
            is_escalated=True,
        )

    # ── Core: unified wait-for-user ─────────────────────────────────────

    async def _wait_for_user(
        self, node: WorkflowStep, context: ExecutionContext,
        params: dict[str, Any], phase_key: str,
        *, next_phase: str, is_escalated: bool = False,
        check_exit_keyword: bool = False,
    ) -> NodeResult:
        """Shared wait logic for all phases that need user input."""
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

            # Teacher bypass code check
            if is_escalated:
                teacher_code = params.get("teacher_code", "")
                if teacher_code and new_user_text and new_user_text.strip() == teacher_code.strip():
                    logger.info("[GUIDED_EXERCISE] Teacher bypass code matched")
                    success_msg = params.get("success_message", "Validé!")
                    await self._send_assistant_message(node, context, success_msg)
                    if context.state is None:
                        context.state = {}
                    context.state.update({phase_key: "instruction"})
                    next_slug = self._next_slug_or_fallback(node.slug, context)
                    return NodeResult(
                        next_slug=next_slug,
                        context_updates={"last_step_context": {"user_message": new_user_text}},
                    )

            # Exit keyword check (help mode → back to evaluation)
            if check_exit_keyword:
                exit_keyword = (params.get("exit_keyword") or "").strip().lower()
                if exit_keyword and new_user_text and exit_keyword in new_user_text.strip().lower():
                    logger.info("[GUIDED_EXERCISE] Exit keyword matched, back to evaluation")
                    ready_msg = params.get(
                        "help_exit_message",
                        "D'accord, réessayons! Donne-moi ta réponse."
                    )
                    await self._send_assistant_message(node, context, ready_msg)
                    if context.state is None:
                        context.state = {}
                    attempts_key = f"{_ATTEMPTS_KEY_PREFIX}{node.slug}"
                    context.state.update({
                        phase_key: "wait_input",
                        attempts_key: 0,  # Reset attempts for fresh evaluation
                    })
                    return NodeResult(
                        next_slug=node.slug,
                        context_updates={"last_step_context": {"exit_reason": "keyword", "user_message": new_user_text}},
                    )

            # Transition to next phase
            if context.state is None:
                context.state = {}
            context.state.update({phase_key: next_phase})
            return NodeResult(
                next_slug=node.slug,
                context_updates={"last_step_context": {"user_message": new_user_text}},
            )

        # First time — set up wait state
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

        wait_state_payload["next_step_slug"] = node.slug

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
                            "[GUIDED_EXERCISE] Failed to persist wait state: %s", e
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

    # ── Helpers ──────────────────────────────────────────────────────────

    def _get_params(self, node: WorkflowStep) -> dict[str, Any]:
        raw = node.parameters or {}
        return dict(raw) if isinstance(raw, Mapping) else {}

    async def _send_assistant_message(
        self, node: WorkflowStep, context: ExecutionContext, message: str,
    ) -> None:
        from ..executor import resolve_transform_value

        agent_context = context.runtime_vars.get("agent_context")
        emit_stream_event = context.runtime_vars.get("emit_stream_event")

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
        from agents import Agent, RunConfig
        from ...chatkit.agent_registry import (
            get_agent_provider_binding,
            create_litellm_model,
        )

        params = self._get_params(node)
        model_name = params.get("model", "") or "gpt-4o-mini"
        provider_id = params.get("model_provider_id", "")
        provider_slug = params.get("model_provider_slug", "")

        provider_binding = None
        if provider_id or provider_slug:
            try:
                provider_binding = get_agent_provider_binding(provider_id, provider_slug)
            except Exception as e:
                logger.warning("[GUIDED_EXERCISE] Provider binding resolution failed: %s", e)

        model: Any = model_name
        if provider_binding is not None:
            if provider_binding.provider is not None:
                pass
            else:
                model = create_litellm_model(model_name, provider_binding)

        agent = Agent(
            name=f"guided_exercise_{node.slug}",
            instructions=instructions,
            model=model,
        )

        run_config_kwargs: dict[str, Any] = {}
        if provider_binding is not None and provider_binding.provider is not None:
            run_config_kwargs["model_provider"] = provider_binding.provider
        run_config = RunConfig(**run_config_kwargs)

        return agent, run_config

    async def _run_agent(
        self, node: WorkflowStep, instructions: str, user_message: str,
    ) -> str:
        from agents import Runner

        agent, run_config = self._resolve_agent_and_config(node, instructions)
        result = await Runner.run(
            agent, input=user_message, run_config=run_config, max_turns=1,
        )
        return result.final_output or ""

    async def _call_ai_evaluation(
        self, node: WorkflowStep, context: ExecutionContext,
        system_prompt: str, user_message: str,
    ) -> tuple[bool, str]:
        import json

        try:
            raw = await self._run_agent(node, system_prompt, user_message)
            logger.info("[GUIDED_EXERCISE] AI evaluation response: %s", raw[:200])

            json_str = raw.strip()
            if json_str.startswith("```"):
                lines = json_str.split("\n")
                json_str = "\n".join(
                    line for line in lines if not line.strip().startswith("```")
                )

            result = json.loads(json_str)
            passed = bool(result.get("passed", False))
            feedback = str(result.get("feedback", ""))
            return passed, feedback

        except Exception as e:
            logger.error("[GUIDED_EXERCISE] AI evaluation error: %s", e, exc_info=True)
            return False, "Une erreur s'est produite lors de l'évaluation. Veuillez réessayer."

    async def _call_ai_feedback(
        self, node: WorkflowStep, context: ExecutionContext,
        system_prompt: str, user_message: str,
    ) -> str:
        try:
            return await self._run_agent(node, system_prompt, user_message) or "Essayez encore."
        except Exception as e:
            logger.error("[GUIDED_EXERCISE] AI feedback error: %s", e, exc_info=True)
            return "Ce n'est pas tout à fait correct. Veuillez réessayer."
