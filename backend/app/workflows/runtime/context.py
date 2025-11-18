"""Helpers for initializing workflow runtime context."""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from agents import TResponseInputItem
from chatkit.agents import AgentContext, ThreadItemConverter

from ..utils import _normalize_user_text
# Model capabilities removed
from ...models import WorkflowDefinition
from ..service import (
    WorkflowService,
    resolve_start_auto_start,
    resolve_start_auto_start_assistant_message,
    resolve_start_auto_start_message,
)
from .state_manager import StateInitializer, WorkflowRuntimeContext
from .voice_context import _extract_voice_overrides
from .voice_session import VoiceSessionManager

if TYPE_CHECKING:  # pragma: no cover - typing only
    from chatkit.types import ThreadItem, UserMessageItem

    from ..executor import WorkflowInput, WorkflowRuntimeSnapshot, WorkflowStepSummary


logger = logging.getLogger("chatkit.server")


@dataclass(slots=True)
class RuntimeInitializationResult:
    """Aggregates the runtime state required by ``run_workflow``."""

    service: WorkflowService
    runtime_context: WorkflowRuntimeContext
    workflow_payload: dict[str, Any]
    steps: list[WorkflowStepSummary]
    auto_started: bool
    conversation_history: list[TResponseInputItem]
    state: dict[str, Any]
    last_step_context: dict[str, Any] | None
    pending_wait_state: Mapping[str, Any] | None
    workflow_call_stack: tuple[tuple[str, str | int], ...]
    current_input_item_id: str | None
    definition: WorkflowDefinition
    runtime_snapshot: WorkflowRuntimeSnapshot | None
    initial_user_text: str
    voice_overrides: Any
    voice_session_manager: VoiceSessionManager


async def initialize_runtime_context(
    workflow_input: WorkflowInput,
    *,
    agent_context: AgentContext[Any],
    workflow_service: WorkflowService | None = None,
    workflow_definition: WorkflowDefinition | None = None,
    workflow_slug: str | None = None,
    thread_item_converter: ThreadItemConverter | None = None,
    thread_items_history: Sequence[ThreadItem] | None = None,
    current_user_message: UserMessageItem | None = None,
    workflow_call_stack: tuple[tuple[str, str | int], ...] | None = None,
    runtime_snapshot: WorkflowRuntimeSnapshot | None = None,
) -> RuntimeInitializationResult:
    """Prepare the runtime environment for a workflow execution."""

    service = workflow_service or WorkflowService()
    state_initializer = StateInitializer(service)
    runtime_context = await state_initializer.initialize(
        workflow_input=workflow_input,
        agent_context=agent_context,
        thread_item_converter=thread_item_converter,
        thread_items_history=thread_items_history,
        current_user_message=current_user_message,
        runtime_snapshot=runtime_snapshot,
        workflow_definition=workflow_definition,
        workflow_slug=workflow_slug,
        workflow_call_stack=workflow_call_stack,
    )

    workflow_payload = runtime_context.workflow_payload
    steps = runtime_context.steps
    auto_started = runtime_context.auto_started
    conversation_history = runtime_context.conversation_history
    state = runtime_context.state
    last_step_context = runtime_context.last_step_context
    pending_wait_state = runtime_context.pending_wait_state
    workflow_call_stack = runtime_context.workflow_call_stack
    current_input_item_id = runtime_context.current_input_item_id
    definition = runtime_context.definition
    runtime_snapshot = runtime_context.runtime_snapshot
    initial_user_text = runtime_context.initial_user_text

    voice_overrides = _extract_voice_overrides(agent_context)
    voice_session_manager = VoiceSessionManager()

    should_auto_start = resolve_start_auto_start(definition)
    if not auto_started and not initial_user_text.strip() and should_auto_start:
        configured_message = _normalize_user_text(
            resolve_start_auto_start_message(definition)
        )
        if configured_message:
            auto_started = True
            initial_user_text = configured_message
            workflow_payload["input_as_text"] = initial_user_text
            conversation_history.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": configured_message,
                        }
                    ],
                }
            )
            state["infos_manquantes"] = configured_message

    assistant_message_payload = workflow_payload.get("auto_start_assistant_message")
    if not isinstance(assistant_message_payload, str):
        assistant_message_payload = resolve_start_auto_start_assistant_message(
            definition
        )
    assistant_message = _normalize_user_text(assistant_message_payload or "")
    if auto_started and assistant_message and not initial_user_text.strip():
        conversation_history.append(
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": assistant_message,
                    }
                ],
            }
        )

    return RuntimeInitializationResult(
        service=service,
        runtime_context=runtime_context,
        workflow_payload=workflow_payload,
        steps=steps,
        auto_started=auto_started,
        conversation_history=conversation_history,
        state=state,
        last_step_context=last_step_context,
        pending_wait_state=pending_wait_state,
        workflow_call_stack=workflow_call_stack,
        current_input_item_id=current_input_item_id,
        definition=definition,
        runtime_snapshot=runtime_snapshot,
        initial_user_text=initial_user_text,
        voice_overrides=voice_overrides,
        voice_session_manager=voice_session_manager,
    )

