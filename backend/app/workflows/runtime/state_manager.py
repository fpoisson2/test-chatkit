from __future__ import annotations

import copy
import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from agents import TResponseInputItem
from chatkit.agents import AgentContext, ThreadItemConverter
from chatkit.types import ThreadItem, UserMessageItem

from ...chatkit_server.context import _get_wait_state_metadata
from ...models import WorkflowDefinition
from ..service import WorkflowService
from ..utils import _clone_conversation_history_snapshot, _normalize_user_text
from .history import _build_user_message_history_items

if TYPE_CHECKING:  # pragma: no cover - aide pour les outils de typage
    from ..executor import WorkflowInput, WorkflowRuntimeSnapshot, WorkflowStepSummary


logger = logging.getLogger("chatkit.server")


@dataclass
class WorkflowRuntimeContext:
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


class StateInitializer:
    """Prépare l'état runtime nécessaire à l'exécution d'un workflow."""

    def __init__(self, service: WorkflowService | None = None) -> None:
        self._service = service or WorkflowService()

    async def initialize(
        self,
        *,
        workflow_input: WorkflowInput,
        agent_context: AgentContext[Any],
        thread_item_converter: ThreadItemConverter | None,
        thread_items_history: Sequence[ThreadItem] | None,
        current_user_message: UserMessageItem | None,
        runtime_snapshot: WorkflowRuntimeSnapshot | None,
        workflow_definition: WorkflowDefinition | None,
        workflow_slug: str | None,
        workflow_call_stack: tuple[tuple[str, str | int], ...] | None,
    ) -> WorkflowRuntimeContext:
        workflow_payload = workflow_input.model_dump()
        steps: list[WorkflowStepSummary] = (
            runtime_snapshot.steps if runtime_snapshot is not None else []
        )
        auto_started = False
        thread = getattr(agent_context, "thread", None)
        pending_wait_state: Mapping[str, Any] | None = None
        conversation_history: list[TResponseInputItem]
        state: dict[str, Any]
        last_step_context: dict[str, Any] | None

        current_input_item_id = workflow_payload.get("source_item_id")

        logger.info(
            ">>> StateInitializer.initialize: runtime_snapshot is None = %s",
            runtime_snapshot is None,
        )

        if runtime_snapshot is None:
            auto_started = bool(workflow_payload.get("auto_start_was_triggered"))
            initial_user_text = _normalize_user_text(workflow_payload["input_as_text"])
            workflow_payload["input_as_text"] = initial_user_text
            conversation_history = []
            pending_wait_state = (
                _get_wait_state_metadata(thread) if thread is not None else None
            )
            if current_user_message is not None:
                candidate_id = getattr(current_user_message, "id", None)
                pending_wait_input_id = (
                    pending_wait_state.get("input_item_id")
                    if pending_wait_state
                    else None
                )
                if isinstance(candidate_id, str):
                    if (
                        isinstance(current_input_item_id, str)
                        and current_input_item_id != candidate_id
                        and pending_wait_input_id == current_input_item_id
                    ):
                        logger.info(
                            "[WAIT_TRACE] StateInitializer: keeping wait input id %s despite new message id %s",
                            current_input_item_id,
                            candidate_id,
                        )
                    elif isinstance(current_input_item_id, str) and (
                        current_input_item_id != candidate_id
                    ):
                        logger.debug(
                            "Override source_item_id %s with current user message id %s",
                            current_input_item_id,
                            candidate_id,
                        )
                        current_input_item_id = candidate_id
                    else:
                        current_input_item_id = candidate_id

            logger.info(
                "[WAIT_TRACE] StateInitializer: payload_source_item_id=%s, current_user_message_id=%s, "
                "pending_wait_state_slug=%s, pending_wait_input_id=%s, chosen_current_input_id=%s",
                workflow_payload.get("source_item_id"),
                getattr(current_user_message, "id", None),
                pending_wait_state.get("slug") if pending_wait_state else None,
                pending_wait_state.get("input_item_id") if pending_wait_state else None,
                current_input_item_id,
            )

            restored_from_wait_state = False
            if pending_wait_state:
                restored_history = _clone_conversation_history_snapshot(
                    pending_wait_state.get("conversation_history")
                )
                if restored_history:
                    conversation_history.extend(restored_history)
                    restored_from_wait_state = True
                    logger.debug(
                        "Historique restauré depuis wait state (%d items)",
                        len(restored_history)
                    )

            if thread_items_history and thread_item_converter:
                try:
                    # Filter out the current input message to avoid duplication
                    filtered_history = [
                        item
                        for item in thread_items_history
                        if not (
                            isinstance(current_input_item_id, str)
                            and item.id == current_input_item_id
                        )
                    ]

                    # If we restored from wait state, also filter out ALL user messages
                    # because they're already in the restored conversation history
                    # (or were intentionally excluded). This prevents old user messages
                    # from being re-added when the workflow restarts.
                    if restored_from_wait_state:
                        from chatkit.types import UserMessageItem
                        original_count = len(filtered_history)
                        filtered_history = [
                            item
                            for item in filtered_history
                            if not isinstance(item, UserMessageItem)
                        ]
                        if original_count > len(filtered_history):
                            logger.debug(
                                "Filtré %d message(s) user de thread_items_history "
                                "pour éviter duplication après restore wait state",
                                original_count - len(filtered_history)
                            )

                    # Debug: log user messages with attachments in history
                    from chatkit.types import UserMessageItem as UMI
                    for item in filtered_history:
                        if isinstance(item, UMI):
                            attachments = getattr(item, "attachments", []) or []
                            if attachments:
                                logger.info(
                                    "📎 History UserMessageItem found: id=%s, attachments_count=%d, attachments=%s",
                                    item.id,
                                    len(attachments),
                                    [{"id": a.id, "name": getattr(a, "name", None)} for a in attachments],
                                )

                    if filtered_history:
                        logger.info(
                            "📎 Converting %d thread items to agent input using %s",
                            len(filtered_history),
                            type(thread_item_converter).__name__,
                        )
                        converted_history = await thread_item_converter.to_agent_input(
                            filtered_history
                        )
                        if converted_history:
                            conversation_history.extend(converted_history)
                except Exception as exc:  # pragma: no cover - dépend du SDK Agents
                    logger.warning(
                        (
                            "Impossible de convertir l'historique des thread items,"
                            " poursuite sans historique"
                        ),
                        exc_info=exc,
                    )

            user_history_items = await _build_user_message_history_items(
                converter=thread_item_converter,
                message=current_user_message,
                fallback_text=initial_user_text,
            )
            if user_history_items:
                conversation_history.extend(user_history_items)

            restored_state: dict[str, Any] | None = None
            if pending_wait_state:
                stored_state = pending_wait_state.get("state")
                if isinstance(stored_state, Mapping):
                    restored_state = copy.deepcopy(dict(stored_state))

            state = {
                "has_all_details": False,
                "infos_manquantes": initial_user_text,
                "should_finalize": False,
                "state": {},  # Initialize nested state dict for while loop counters
            }
            if restored_state:
                state.update(restored_state)
                state["infos_manquantes"] = initial_user_text
            last_step_context = None
        else:
            initial_user_text = _normalize_user_text(
                workflow_payload.get("input_as_text", "")
            )
            conversation_history = copy.deepcopy(runtime_snapshot.conversation_history)
            state = copy.deepcopy(runtime_snapshot.state)
            last_step_context = (
                copy.deepcopy(runtime_snapshot.last_step_context)
                if runtime_snapshot.last_step_context is not None
                else None
            )

        definition: WorkflowDefinition
        if workflow_definition is not None:
            definition = workflow_definition
        else:
            if isinstance(workflow_slug, str) and workflow_slug.strip():
                definition = self._service.get_definition_by_slug(workflow_slug)
            else:
                definition = self._service.get_current()

        if workflow_call_stack is None:
            identifiers: list[tuple[str, str | int]] = []
            if definition.workflow_id is not None:
                identifiers.append(("id", int(definition.workflow_id)))
            workflow_slug_value = getattr(definition.workflow, "slug", None)
            if isinstance(workflow_slug_value, str) and workflow_slug_value.strip():
                identifiers.append(("slug", workflow_slug_value.strip().lower()))
            workflow_call_stack = tuple(identifiers)

        return WorkflowRuntimeContext(
            workflow_payload=workflow_payload,
            steps=steps,
            auto_started=auto_started,
            conversation_history=conversation_history,
            state=state,
            last_step_context=last_step_context,
            pending_wait_state=pending_wait_state,
            workflow_call_stack=workflow_call_stack,
            current_input_item_id=(
                current_input_item_id
                if isinstance(current_input_item_id, str)
                else None
            ),
            definition=definition,
            runtime_snapshot=runtime_snapshot,
            initial_user_text=initial_user_text,
        )
