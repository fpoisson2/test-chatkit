from __future__ import annotations

import asyncio
import copy
import json
import logging
import math
import re
import uuid
from collections.abc import (
    Awaitable,
    Callable,
    Iterator,
    Mapping,
    Sequence,
)
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import (
    Any,
)

from agents import (
    Agent,
    RunConfig,
    Runner,
    TResponseInputItem,
)
from pydantic import BaseModel

from chatkit.agents import (
    AgentContext,
    ThreadItemConverter,
    stream_agent_response,
)

try:  # pragma: no cover - dépend de la version du SDK Agents installée
    from chatkit.agents import stream_widget as _sdk_stream_widget
except ImportError:  # pragma: no cover - compatibilité avec les anciennes versions
    _sdk_stream_widget = None  # type: ignore[assignment]
from chatkit.types import (
    AssistantMessageContent,
    AssistantMessageContentPartTextDelta,
    AssistantMessageItem,
    EndOfTurnItem,
    GeneratedImage,
    ImageTask,
    InferenceOptions,
    ThreadItem,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    ThreadItemUpdated,
    ThreadStreamEvent,
    UserMessageItem,
    UserMessageTextContent,
    WorkflowTaskAdded,
    WorkflowTaskUpdated,
)

from ..chatkit.agent_registry import (
    AGENT_BUILDERS,
    AGENT_RESPONSE_FORMATS,
    STEP_TITLES,
    _build_custom_agent,
    _create_response_format_from_pydantic,
)
from ..chatkit_server.actions import (
    _apply_widget_variable_values,
    _collect_widget_bindings,
    _ensure_widget_output_model,
    _json_safe_copy,
    _load_widget_definition,
    _parse_response_widget_config,
    _ResponseWidgetConfig,
    _should_wait_for_widget_action,
    _WidgetBinding,
)
from ..chatkit_server.context import (
    _clone_conversation_history_snapshot,
    _get_wait_state_metadata,
    _normalize_user_text,
    _set_wait_state_metadata,
)
from ..chatkit_server.workflow_runner import (
    _WorkflowStreamResult,
)
from ..config import get_settings
from ..database import SessionLocal
from ..image_utils import (
    append_generated_image_links,
    build_agent_image_absolute_url,
    format_generated_image_links,
    merge_generated_image_urls_into_payload,
    save_agent_image_file,
)
from ..models import WorkflowStep, WorkflowTransition
from ..vector_store.ingestion import (
    evaluate_state_expression,
    ingest_document,
    ingest_workflow_step,
    resolve_transform_value,
)
from ..widgets import WidgetLibraryService
from .service import (
    WorkflowService,
    resolve_start_auto_start,
    resolve_start_auto_start_assistant_message,
    resolve_start_auto_start_message,
)

logger = logging.getLogger("chatkit.server")

AGENT_IMAGE_VECTOR_STORE_SLUG = "chatkit-agent-images"

# ---------------------------------------------------------------------------
# Définition du workflow local exécuté par DemoChatKitServer
# ---------------------------------------------------------------------------


async def _build_user_message_history_items(
    *,
    converter: ThreadItemConverter | None,
    message: UserMessageItem | None,
    fallback_text: str,
) -> list[TResponseInputItem]:
    """Construit les éléments d'historique pour le message utilisateur courant."""

    normalized_fallback = _normalize_user_text(fallback_text)

    typed_parts: list[str] = []
    attachments_present = False
    if message is not None:
        attachments = getattr(message, "attachments", None) or []
        attachments_present = bool(attachments)
        for part in getattr(message, "content", []) or []:
            text_value = getattr(part, "text", None)
            normalized = _normalize_user_text(text_value) if text_value else ""
            if normalized:
                typed_parts.append(normalized)

    typed_text = "\n".join(typed_parts)

    items: list[TResponseInputItem] = []

    if converter is not None and message is not None:
        try:
            converted = await converter.to_agent_input(message)
        except Exception as exc:  # pragma: no cover - dépend du SDK installé
            logger.warning(
                "Impossible de convertir le message utilisateur courant en "
                "entrée agent",
                exc_info=exc,
            )
        else:
            if converted:
                if isinstance(converted, list):
                    items.extend(converted)
                else:  # pragma: no cover - API accepte aussi un seul item
                    items.append(converted)

    if normalized_fallback:
        if items:
            if attachments_present and not typed_text:
                items.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": normalized_fallback,
                            }
                        ],
                    }
                )
        else:
            items.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": normalized_fallback,
                        }
                    ],
                }
            )

    return items


class WorkflowInput(BaseModel):
    input_as_text: str
    auto_start_was_triggered: bool | None = None
    auto_start_assistant_message: str | None = None
    source_item_id: str | None = None


@dataclass
class WorkflowStepSummary:
    key: str
    title: str
    output: str


@dataclass
class WorkflowEndState:
    slug: str
    status_type: str | None
    status_reason: str | None
    message: str | None


@dataclass
class WorkflowRunSummary:
    steps: list[WorkflowStepSummary]
    final_output: dict[str, Any] | None
    final_node_slug: str | None = None
    end_state: WorkflowEndState | None = None


@dataclass
class WorkflowStepStreamUpdate:
    key: str
    title: str
    index: int
    delta: str
    text: str


@dataclass(frozen=True)
class WorkflowExecutionError(RuntimeError):
    def __init__(
        self,
        step: str,
        title: str,
        original_error: Exception,
        steps: list[WorkflowStepSummary],
    ) -> None:
        super().__init__(str(original_error))
        self.step = step
        self.title = title
        self.original_error = original_error
        self.steps = steps

    def __str__(self) -> str:
        return f"{self.title} ({self.step}) : {self.original_error}"


def _format_step_output(payload: Any) -> str:
    if payload is None:
        return "(aucune sortie)"

    if isinstance(payload, BaseModel):
        payload = payload.model_dump()

    if isinstance(payload, dict | list):
        try:
            return json.dumps(payload, ensure_ascii=False, indent=2)
        except TypeError:
            return str(payload)

    if isinstance(payload, str):
        text_value = payload.strip()
        if not text_value:
            return "(aucune sortie)"

        try:
            parsed = json.loads(text_value)
        except json.JSONDecodeError:
            return text_value

        if isinstance(parsed, dict | list):
            try:
                return json.dumps(parsed, ensure_ascii=False, indent=2)
            except TypeError:
                return str(parsed)
        return str(parsed)

    return str(payload)


def _resolve_watch_payload(context: Any, steps: Sequence[WorkflowStepSummary]) -> Any:
    if isinstance(context, Mapping):
        for key in (
            "output_structured",
            "output_parsed",
            "output_text",
            "output",
            "assistant_message",
        ):
            candidate = context.get(key)
            if candidate not in (None, "", {}):
                return candidate
    if context is not None:
        return context
    if steps:
        return steps[-1].output
    return None


async def run_workflow(
    workflow_input: WorkflowInput,
    *,
    agent_context: AgentContext[Any],
    on_step: Callable[[WorkflowStepSummary, int], Awaitable[None]] | None = None,
    on_step_stream: Callable[[WorkflowStepStreamUpdate], Awaitable[None]] | None = None,
    on_stream_event: Callable[[ThreadStreamEvent], Awaitable[None]] | None = None,
    on_widget_step: (
        Callable[
            [WorkflowStep, _ResponseWidgetConfig], Awaitable[Mapping[str, Any] | None]
        ]
        | None
    ) = None,
    workflow_service: WorkflowService | None = None,
    thread_item_converter: ThreadItemConverter | None = None,
    thread_items_history: list[ThreadItem] | None = None,
    current_user_message: UserMessageItem | None = None,
) -> WorkflowRunSummary:
    workflow_payload = workflow_input.model_dump()
    steps: list[WorkflowStepSummary] = []
    auto_started = bool(workflow_payload.get("auto_start_was_triggered"))
    initial_user_text = _normalize_user_text(workflow_payload["input_as_text"])
    workflow_payload["input_as_text"] = initial_user_text
    current_input_item_id = workflow_payload.get("source_item_id")
    if not isinstance(current_input_item_id, str) and current_user_message is not None:
        candidate_id = getattr(current_user_message, "id", None)
        current_input_item_id = candidate_id if isinstance(candidate_id, str) else None
    conversation_history: list[TResponseInputItem] = []
    thread = getattr(agent_context, "thread", None)
    pending_wait_state = (
        _get_wait_state_metadata(thread) if thread is not None else None
    )
    resume_from_wait_slug: str | None = None

    if pending_wait_state:
        restored_history = _clone_conversation_history_snapshot(
            pending_wait_state.get("conversation_history")
        )
        if restored_history:
            conversation_history.extend(restored_history)

    # Convertir l'historique des thread items si fourni
    # IMPORTANT : exclure le message utilisateur actuel (source_item_id)
    # pour éviter la duplication
    if thread_items_history and thread_item_converter:
        try:
            # Filtrer le message utilisateur actuel de l'historique
            filtered_history = [
                item
                for item in thread_items_history
                if not (
                    isinstance(current_input_item_id, str)
                    and item.id == current_input_item_id
                )
            ]
            if filtered_history:
                converted_history = await thread_item_converter.to_agent_input(
                    filtered_history
                )
                if converted_history:
                    conversation_history.extend(converted_history)
        except Exception as exc:
            logger.warning(
                "Impossible de convertir l'historique des thread items, poursuite "
                "sans historique",
                exc_info=exc,
            )

    # Ajouter le message utilisateur actuel
    restored_state: dict[str, Any] | None = None
    if pending_wait_state:
        stored_state = pending_wait_state.get("state")
        if isinstance(stored_state, Mapping):
            restored_state = copy.deepcopy(dict(stored_state))

    user_history_items = await _build_user_message_history_items(
        converter=thread_item_converter,
        message=current_user_message,
        fallback_text=initial_user_text,
    )
    if user_history_items:
        conversation_history.extend(user_history_items)
    state: dict[str, Any] = {
        "has_all_details": False,
        "infos_manquantes": initial_user_text,
        "should_finalize": False,
    }
    if restored_state:
        state.update(restored_state)
        state["infos_manquantes"] = initial_user_text
    final_output: dict[str, Any] | None = None
    last_step_context: dict[str, Any] | None = None

    service = workflow_service or WorkflowService()
    definition = service.get_current()

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

    assistant_message = _normalize_user_text(assistant_message_payload)
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

    nodes_by_slug: dict[str, WorkflowStep] = {
        step.slug: step for step in definition.steps if step.is_enabled
    }
    if not nodes_by_slug:
        raise WorkflowExecutionError(
            "configuration",
            "Configuration du workflow invalide",
            RuntimeError("Aucun nœud actif disponible"),
            [],
        )

    if pending_wait_state:
        waiting_slug = pending_wait_state.get("slug")
        waiting_input_id = pending_wait_state.get("input_item_id")
        stored_input_id = (
            waiting_input_id if isinstance(waiting_input_id, str) else None
        )
        current_input_id = (
            current_input_item_id if isinstance(current_input_item_id, str) else None
        )
        if (
            isinstance(waiting_slug, str)
            and waiting_slug in nodes_by_slug
            and stored_input_id
            and current_input_id
            and stored_input_id != current_input_id
        ):
            resume_from_wait_slug = waiting_slug

    transitions = [
        transition
        for transition in definition.transitions
        if transition.source_step.slug in nodes_by_slug
        and transition.target_step.slug in nodes_by_slug
    ]

    start_step = next(
        (step for step in nodes_by_slug.values() if step.kind == "start"),
        None,
    )
    if start_step is None:
        raise WorkflowExecutionError(
            "configuration",
            "Configuration du workflow invalide",
            RuntimeError("Nœud de début introuvable"),
            [],
        )

    agent_steps_ordered = [
        step
        for step in sorted(definition.steps, key=lambda s: s.position)
        if step.kind == "agent" and step.is_enabled and step.slug in nodes_by_slug
    ]

    agent_positions = {
        step.slug: index for index, step in enumerate(agent_steps_ordered, start=1)
    }
    total_runtime_steps = len(agent_steps_ordered)

    widget_configs_by_step: dict[str, _ResponseWidgetConfig] = {}

    def _register_widget_config(step: WorkflowStep) -> _ResponseWidgetConfig | None:
        widget_config = _parse_response_widget_config(step.parameters)
        if widget_config is None:
            return None
        widget_config = _ensure_widget_output_model(widget_config)
        widget_configs_by_step[step.slug] = widget_config
        return widget_config

    for step in nodes_by_slug.values():
        if step.kind == "widget":
            _register_widget_config(step)

    agent_instances: dict[str, Agent] = {}
    for step in agent_steps_ordered:
        logger.debug(
            "Paramètres bruts du step %s: %s",
            step.slug,
            (
                json.dumps(step.parameters, ensure_ascii=False)
                if step.parameters
                else "{}"
            ),
        )

        widget_config = _register_widget_config(step)

        agent_key = (step.agent_key or "").strip()
        builder = AGENT_BUILDERS.get(agent_key)
        overrides_raw = step.parameters or {}
        overrides = dict(overrides_raw)

        logger.info(
            "Construction de l'agent pour l'étape %s. widget_config: %s, "
            "output_model: %s",
            step.slug,
            widget_config is not None,
            widget_config.output_model if widget_config else None,
        )

        if widget_config is not None and widget_config.output_model is not None:
            # Retirer les anciens paramètres de widget pour éviter les conflits
            overrides.pop("response_format", None)
            overrides.pop("response_widget", None)
            overrides.pop("widget", None)

            # NE PAS définir output_type car cela cause des problèmes de
            # double-wrapping avec AgentOutputSchema dans le SDK. À la place,
            # utiliser seulement response_format.

            # Créer le response_format pour que l'API OpenAI utilise json_schema
            try:
                overrides["response_format"] = _create_response_format_from_pydantic(
                    widget_config.output_model
                )
                logger.info(
                    "response_format généré depuis le modèle widget pour l'étape %s",
                    step.slug,
                )
            except Exception as exc:
                logger.warning(
                    "Impossible de générer response_format depuis le modèle "
                    "widget : %s",
                    exc,
                )

        if builder is None:
            if agent_key:
                logger.warning(
                    "Aucun builder enregistré pour l'agent '%s', utilisation de la "
                    "configuration personnalisée.",
                    agent_key,
                )
            agent_instances[step.slug] = _build_custom_agent(overrides)
        else:
            agent_instances[step.slug] = builder(overrides)

    edges_by_source: dict[str, list[WorkflowTransition]] = {}
    for transition in transitions:
        edges_by_source.setdefault(transition.source_step.slug, []).append(transition)
    for edge_list in edges_by_source.values():
        edge_list.sort(key=lambda tr: tr.id or 0)

    def _sanitize_end_value(value: Any) -> str | None:
        if isinstance(value, str):
            cleaned = value.strip()
            if cleaned:
                return cleaned
        return None

    def _parse_end_state(step: WorkflowStep) -> WorkflowEndState:
        raw_params = step.parameters or {}
        params = raw_params if isinstance(raw_params, Mapping) else {}

        status_raw = params.get("status")
        status_type = None
        status_reason = None
        if isinstance(status_raw, Mapping):
            status_type = _sanitize_end_value(status_raw.get("type"))
            status_reason = (
                _sanitize_end_value(status_raw.get("reason")) or status_reason
            )

        for key in ("status_reason", "reason"):
            fallback = _sanitize_end_value(params.get(key))
            if fallback:
                status_reason = status_reason or fallback
                break

        message = _sanitize_end_value(params.get("message"))

        return WorkflowEndState(
            slug=step.slug,
            status_type=status_type,
            status_reason=status_reason,
            message=message,
        )

    def _resolve_assistant_message(step: WorkflowStep) -> str:
        raw_params = step.parameters or {}
        params = raw_params if isinstance(raw_params, Mapping) else {}
        message = params.get("message")
        if isinstance(message, str):
            return message
        fallback_text = params.get("text")
        if isinstance(fallback_text, str):
            return fallback_text
        status = params.get("status")
        if isinstance(status, Mapping):
            reason = status.get("reason")
            if isinstance(reason, str):
                return reason
        return ""

    @dataclass(frozen=True)
    class _AssistantStreamConfig:
        enabled: bool
        delay_seconds: float

    _DEFAULT_ASSISTANT_STREAM_DELAY_SECONDS = 0.03

    def _coerce_bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, int | float) and not isinstance(value, bool):
            return value != 0
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "1", "yes", "on"}:
                return True
            if normalized in {"false", "0", "no", "off"}:
                return False
        return False

    def _resolve_assistant_stream_config(step: WorkflowStep) -> _AssistantStreamConfig:
        raw_params = step.parameters or {}
        params = raw_params if isinstance(raw_params, Mapping) else {}
        enabled = _coerce_bool(params.get("simulate_stream"))
        delay_seconds = _DEFAULT_ASSISTANT_STREAM_DELAY_SECONDS
        raw_delay = params.get("simulate_stream_delay_ms")
        candidate: float | None = None
        if isinstance(raw_delay, int | float) and not isinstance(raw_delay, bool):
            candidate = float(raw_delay)
        elif isinstance(raw_delay, str):
            normalized = raw_delay.strip()
            if normalized:
                try:
                    candidate = float(normalized)
                except ValueError:
                    candidate = None
        if candidate is not None and math.isfinite(candidate) and candidate >= 0:
            delay_seconds = candidate / 1000.0
        return _AssistantStreamConfig(enabled=enabled, delay_seconds=delay_seconds)

    def _iter_stream_chunks(text: str) -> Iterator[str]:
        buffer = ""
        for character in text:
            buffer += character
            if character in {" ", "\n", "\t"} or len(buffer) >= 8:
                yield buffer
                buffer = ""
        if buffer:
            yield buffer

    async def _stream_assistant_message(text: str, *, delay_seconds: float) -> None:
        if on_stream_event is None:
            return
        assistant_item = AssistantMessageItem(
            id=agent_context.generate_id("message"),
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[AssistantMessageContent(text="")],
        )
        await on_stream_event(ThreadItemAddedEvent(item=assistant_item))
        first_chunk = True
        content_index = 0
        for chunk in _iter_stream_chunks(text):
            if not first_chunk and delay_seconds > 0:
                await asyncio.sleep(delay_seconds)
            first_chunk = False
            await on_stream_event(
                ThreadItemUpdated(
                    item_id=assistant_item.id,
                    update=AssistantMessageContentPartTextDelta(
                        content_index=content_index,
                        delta=chunk,
                    ),
                )
            )
        final_item = AssistantMessageItem(
            id=assistant_item.id,
            thread_id=assistant_item.thread_id,
            created_at=assistant_item.created_at,
            content=[AssistantMessageContent(text=text)],
        )
        await on_stream_event(ThreadItemDoneEvent(item=final_item))

    def _resolve_user_message(step: WorkflowStep) -> str:
        raw_params = step.parameters or {}
        params = raw_params if isinstance(raw_params, Mapping) else {}
        message = params.get("message")
        if isinstance(message, str):
            return message
        fallback_text = params.get("text")
        if isinstance(fallback_text, str):
            return fallback_text
        return ""

    def _resolve_wait_for_user_input_message(step: WorkflowStep) -> str:
        return _resolve_user_message(step)

    def _workflow_run_config(
        response_format: dict[str, Any] | None = None,
    ) -> RunConfig:
        metadata: dict[str, str] = {"__trace_source__": "agent-builder"}
        if definition.workflow_id is not None:
            metadata["workflow_db_id"] = str(definition.workflow_id)
        if definition.workflow and definition.workflow.slug:
            metadata["workflow_slug"] = definition.workflow.slug
        if definition.workflow and definition.workflow.display_name:
            metadata["workflow_name"] = definition.workflow.display_name
        try:
            if response_format is not None:
                return RunConfig(
                    trace_metadata=metadata, response_format=response_format
                )
        except TypeError:
            logger.debug(
                "RunConfig ne supporte pas response_format, utilisation de la "
                "configuration par défaut"
            )
        return RunConfig(trace_metadata=metadata)

    async def record_step(step_key: str, title: str, payload: Any) -> None:
        formatted_output = _format_step_output(payload)
        print(
            "[Workflow] Payload envoyé pour l'étape "
            f"{step_key} ({title}) :\n{formatted_output}"
        )
        summary = WorkflowStepSummary(
            key=step_key,
            title=title,
            output=formatted_output,
        )
        steps.append(summary)
        if on_step is not None:
            await on_step(summary, len(steps))

    def raise_step_error(step_key: str, title: str, error: Exception) -> None:
        raise WorkflowExecutionError(step_key, title, error, list(steps)) from error

    def _structured_output_as_json(output: Any) -> tuple[Any, str]:
        if hasattr(output, "model_dump"):
            try:
                parsed = output.model_dump(by_alias=True)
            except TypeError:
                parsed = output.model_dump()
            return parsed, json.dumps(parsed, ensure_ascii=False)
        if hasattr(output, "dict"):
            try:
                parsed = output.dict(by_alias=True)
            except TypeError:
                parsed = output.dict()
            return parsed, json.dumps(parsed, ensure_ascii=False)
        if isinstance(output, dict | list):
            return output, json.dumps(output, ensure_ascii=False)
        return output, str(output)

    def _assign_state_value(target_path: str, value: Any) -> None:
        path_parts = [part for part in target_path.split(".") if part]
        if not path_parts:
            raise ValueError("Chemin de mise à jour d'état manquant.")
        if path_parts[0] != "state":
            raise ValueError("Les mises à jour doivent commencer par 'state.'")
        cursor: Any = state
        for part in path_parts[1:-1]:
            next_value = cursor.get(part)
            if next_value is None:
                next_value = {}
                cursor[part] = next_value
            elif not isinstance(next_value, dict):
                raise ValueError(
                    f"Impossible d'écrire dans state.{part} : valeur existante "
                    "incompatible."
                )
            cursor = next_value
        cursor[path_parts[-1]] = value

    def _apply_state_node(step: WorkflowStep) -> None:
        params = step.parameters or {}
        operations = params.get("state")
        if operations is None:
            return
        if not isinstance(operations, list):
            raise ValueError("Le paramètre 'state' doit être une liste d'opérations.")
        for entry in operations:
            if not isinstance(entry, dict):
                raise ValueError(
                    "Chaque opération de mise à jour d'état doit être un objet."
                )
            target_raw = entry.get("target")
            target = str(target_raw).strip() if target_raw is not None else ""
            if not target:
                raise ValueError("Chaque opération doit préciser une cible 'target'.")
            value = evaluate_state_expression(
                entry.get("expression"),
                state=state,
                default_input_context=last_step_context,
            )
            logger.debug(
                "set_state: stockage de %s = %s (type: %s)",
                target,
                str(value)[:200] if value else "None",
                type(value).__name__,
            )
            _assign_state_value(target, value)

    def _extract_delta(event: ThreadStreamEvent) -> str:
        if isinstance(event, ThreadItemUpdated):
            update = event.update
            if isinstance(update, AssistantMessageContentPartTextDelta):
                return update.delta or ""
        return ""

    def _stringify_widget_value(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, BaseModel):
            try:
                value = value.model_dump(by_alias=True)
            except TypeError:
                value = value.model_dump()
        if isinstance(value, dict | list):
            try:
                return json.dumps(value, ensure_ascii=False)
            except TypeError:
                return str(value)
        return str(value)

    def _coerce_widget_binding_sequence_value(
        items: Sequence[str], binding: _WidgetBinding
    ) -> str | list[str]:
        normalized_items = [item for item in items if isinstance(item, str)]
        if not normalized_items:
            return [] if isinstance(binding.sample, list) else ""

        if isinstance(binding.sample, list):
            return normalized_items

        preferred_key = (binding.value_key or "").lower()
        component_type = (binding.component_type or "").lower()

        if preferred_key in {"src", "url", "href"} or component_type in {
            "image",
            "link",
        }:
            return normalized_items[0]

        if isinstance(binding.sample, str):
            return "\n".join(normalized_items)

        return normalized_items

    def _collect_widget_values_from_output(
        output: Any,
        *,
        bindings: Mapping[str, _WidgetBinding] | None = None,
    ) -> dict[str, str | list[str]]:
        """Aplati les sorties structurées en valeurs consommables par un widget."""

        collected: dict[str, str | list[str]] = {}

        def _normalize(candidate: Any) -> Any:
            if isinstance(candidate, BaseModel):
                try:
                    return candidate.model_dump(by_alias=True)
                except TypeError:
                    return candidate.model_dump()
            return candidate

        def _normalize_sequence_fields(
            mapping: dict[str, str | list[str]],
        ) -> dict[str, str | list[str]]:
            if not mapping:
                return mapping

            normalized: dict[str, str | list[str]] = {}
            for key, value in mapping.items():
                if isinstance(value, list):
                    suffix = key.rsplit(".", 1)[-1].lower()
                    if suffix in {"src", "url", "href"}:
                        normalized[key] = value[0] if value else ""
                        continue
                normalized[key] = value
            return normalized

        def _walk(current: Any, path: str) -> None:
            current = _normalize(current)
            if isinstance(current, dict):
                for key, value in current.items():
                    if not isinstance(key, str):
                        continue
                    next_path = f"{path}.{key}" if path else key
                    _walk(value, next_path)
                return
            if isinstance(current, list):
                simple_values: list[str] = []
                has_complex_items = False
                for item in current:
                    normalized = _normalize(item)
                    if isinstance(normalized, dict | list):
                        has_complex_items = True
                        break
                    simple_values.append(_stringify_widget_value(normalized))
                if simple_values and not has_complex_items and path:
                    collected[path] = simple_values
                    return
                for index, item in enumerate(current):
                    next_path = f"{path}.{index}" if path else str(index)
                    _walk(item, next_path)
                return
            if path:
                collected[path] = _stringify_widget_value(current)

        _walk(output, "")

        collected = _normalize_sequence_fields(collected)

        if not bindings:
            return collected

        enriched = dict(collected)
        consumed_keys: set[str] = set()
        for identifier, binding in bindings.items():
            path_parts: list[str] = []
            for step in binding.path:
                if isinstance(step, str):
                    path_parts.append(step)
                else:
                    path_parts.append(str(step))
            base_path = ".".join(path_parts)
            for suffix in ("value", "text", "src", "url", "href"):
                key = f"{base_path}.{suffix}" if base_path else suffix
                if key in collected:
                    value: str | list[str] = collected[key]
                    if isinstance(value, list):
                        value = _coerce_widget_binding_sequence_value(value, binding)
                    enriched[identifier] = value
                    if identifier != key:
                        consumed_keys.add(key)
                    break

        for key in consumed_keys:
            enriched.pop(key, None)

        return _normalize_sequence_fields(enriched)

    agent_image_tasks: dict[tuple[str, int, str], dict[str, Any]] = {}
    agent_step_generated_images: dict[str, list[dict[str, Any]]] = {}

    def _sanitize_identifier(value: str, fallback: str) -> str:
        candidate = value.strip()
        if not candidate:
            return fallback
        sanitized = re.sub(r"[^0-9A-Za-z_.-]", "-", candidate)
        sanitized = sanitized.strip("-") or fallback
        return sanitized[:190]

    def _register_image_generation_task(
        task: ImageTask,
        *,
        metadata: dict[str, Any],
    ) -> tuple[dict[str, Any], tuple[str, int, str]] | None:
        call_identifier = getattr(task, "call_id", None)
        if not isinstance(call_identifier, str) or not call_identifier.strip():
            return None
        call_id = call_identifier.strip()
        output_index_raw = getattr(task, "output_index", 0) or 0
        try:
            output_index = int(output_index_raw)
        except (TypeError, ValueError):
            output_index = 0
        raw_step_key = metadata.get("step_key")
        if isinstance(raw_step_key, str):
            canonical_step_key = raw_step_key.strip() or None
        else:
            canonical_step_key = None

        step_identifier_meta = canonical_step_key or metadata.get("step_slug")
        if isinstance(step_identifier_meta, str):
            step_identifier_meta = step_identifier_meta.strip()
        else:
            step_identifier_meta = None
        if not step_identifier_meta:
            fallback_identifier = getattr(task, "id", None)
            if isinstance(fallback_identifier, str):
                step_identifier_meta = fallback_identifier.strip() or None
        if not step_identifier_meta:
            step_identifier_meta = f"{call_id}:{output_index}"

        key = (call_id, output_index, step_identifier_meta)
        context = agent_image_tasks.get(key)
        base_context = {
            "call_id": call_id,
            "output_index": output_index,
            "step_slug": metadata.get("step_slug"),
            "step_title": metadata.get("step_title"),
            "agent_key": metadata.get("agent_key"),
            "agent_label": metadata.get("agent_label"),
            "thread_id": metadata.get("thread_id"),
            "step_key": canonical_step_key,
            "user_id": metadata.get("user_id"),
            "backend_public_base_url": metadata.get("backend_public_base_url"),
        }
        if context is None:
            context = dict(base_context)
            context["created_at"] = datetime.now(timezone.utc).isoformat()
            agent_image_tasks[key] = context
            logger.info(
                "Suivi d'une génération d'image (call_id=%s, index=%s, étape=%s)",
                call_id,
                output_index,
                context.get("step_slug") or "inconnue",
            )
        else:
            for entry_key, entry_value in base_context.items():
                if entry_value is not None:
                    context[entry_key] = entry_value
        return context, key

    def _register_generated_image_for_step(
        step_key: str | None, image_record: dict[str, Any]
    ) -> None:
        if not step_key:
            return
        agent_step_generated_images.setdefault(step_key, []).append(image_record)

    def _consume_generated_image_urls(step_key: str) -> list[str]:
        records = agent_step_generated_images.pop(step_key, [])
        urls: list[str] = []
        for record in records:
            url = record.get("local_file_url")
            if isinstance(url, str) and url:
                urls.append(url)
        return urls

    async def _persist_agent_image(
        context: dict[str, Any],
        key: tuple[str, int, str],
        task: ImageTask,
        image: GeneratedImage,
    ) -> None:
        raw_thread_id = str(context.get("thread_id") or "unknown-thread")
        normalized_thread = _sanitize_identifier(raw_thread_id, "thread")
        step_identifier_for_doc = (
            context.get("step_key") or context.get("step_slug") or "step"
        )
        normalized_step_identifier = _sanitize_identifier(
            str(step_identifier_for_doc), "step"
        )
        raw_doc_id = (
            f"{normalized_thread}-{key[0]}-{key[1]}-{normalized_step_identifier}"
        )
        doc_id = _sanitize_identifier(
            raw_doc_id, f"{normalized_thread}-{uuid.uuid4().hex[:8]}"
        )
        b64_payload = image.b64_json or ""
        partials = list(image.partials or [])
        local_file_path: str | None = None
        local_file_url: str | None = None
        absolute_file_url: str | None = None
        if b64_payload:
            local_file_path, local_file_url = save_agent_image_file(
                doc_id,
                b64_payload,
                output_format=getattr(image, "output_format", None),
            )
        if local_file_url:
            # lazy import pour éviter les dépendances globales
            from ..security import create_agent_image_token

            file_name = Path(local_file_url).name
            token_user = context.get("user_id")
            token = create_agent_image_token(
                file_name,
                user_id=str(token_user) if token_user else None,
                thread_id=raw_thread_id,
            )
            base_url = (
                context.get("backend_public_base_url")
                or get_settings().backend_public_base_url
            )
            absolute_file_url = build_agent_image_absolute_url(
                local_file_url,
                base_url=base_url,
                token=token,
            )
        payload = {
            "thread_id": raw_thread_id,
            "call_id": key[0],
            "output_index": key[1],
            "status": getattr(task, "status_indicator", None),
            "step_slug": context.get("step_slug"),
            "step_title": context.get("step_title"),
            "agent_key": context.get("agent_key"),
            "agent_label": context.get("agent_label"),
            "image": {
                "id": image.id,
                "b64_json": b64_payload,
                "data_url": image.data_url,
                "image_url": image.image_url,
                "output_format": image.output_format,
                "background": image.background,
                "quality": image.quality,
                "size": image.size,
                "partials": partials,
            },
        }
        if local_file_url:
            payload["image"]["local_file_relative_url"] = local_file_url
        if absolute_file_url:
            payload["image"]["local_file_url"] = absolute_file_url
        if local_file_path:
            payload["image"]["local_file_path"] = local_file_path
        metadata = {
            "thread_id": raw_thread_id,
            "call_id": key[0],
            "output_index": key[1],
            "step_slug": context.get("step_slug"),
            "step_title": context.get("step_title"),
            "agent_key": context.get("agent_key"),
            "agent_label": context.get("agent_label"),
            "stored_at": datetime.now(timezone.utc).isoformat(),
            "b64_length": len(b64_payload),
            "partials_count": len(partials),
        }
        if local_file_url:
            metadata["local_file_url"] = absolute_file_url or local_file_url
            metadata["local_file_relative_url"] = local_file_url
        if local_file_path:
            metadata["local_file_path"] = local_file_path
        logger.info(
            "Enregistrement de l'image générée dans %s (doc_id=%s, longueur_b64=%d)",
            AGENT_IMAGE_VECTOR_STORE_SLUG,
            doc_id,
            len(b64_payload),
        )
        await ingest_document(
            AGENT_IMAGE_VECTOR_STORE_SLUG,
            doc_id,
            payload,
            metadata,
            session_factory=SessionLocal,
        )
        image_record = {
            "doc_id": doc_id,
            "call_id": key[0],
            "output_index": key[1],
        }
        if local_file_url:
            image_record["local_file_url"] = absolute_file_url or local_file_url
            image_record["local_file_relative_url"] = local_file_url
        if local_file_path:
            image_record["local_file_path"] = local_file_path
        step_identifier = context.get("step_key") or context.get("step_slug")
        if isinstance(step_identifier, str):
            _register_generated_image_for_step(step_identifier, image_record)
        elif step_identifier is not None:
            _register_generated_image_for_step(str(step_identifier), image_record)
        context.setdefault("generated_images", []).append(image_record)
        logger.info(
            "Image %s enregistrée pour l'étape %s (call_id=%s)",
            doc_id,
            context.get("step_slug") or "inconnue",
            key[0],
        )

    def _evaluate_widget_variable_expression(
        expression: str, *, input_context: dict[str, Any] | None
    ) -> str | None:
        if not expression.strip():
            return None
        try:
            raw_value = evaluate_state_expression(
                expression,
                state=state,
                default_input_context=last_step_context,
                input_context=input_context,
            )
        except Exception as exc:  # pragma: no cover - dépend du contenu utilisateur
            logger.warning(
                "Impossible d'évaluer l'expression %s pour un widget : %s",
                expression,
                exc,
            )
            return None
        if raw_value is None:
            return None
        return _stringify_widget_value(raw_value)

    async def _stream_response_widget(
        config: _ResponseWidgetConfig,
        *,
        step_slug: str,
        step_title: str,
        step_context: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        widget_label = config.slug or config.definition_expression or step_slug

        definition: Any
        bindings = config.bindings

        if config.source == "variable":
            expression = config.definition_expression or ""
            if not expression:
                logger.warning(
                    "Expression de widget manquante pour l'étape %s", step_slug
                )
                return None
            try:
                definition_candidate = evaluate_state_expression(
                    expression,
                    state=state,
                    default_input_context=last_step_context,
                    input_context=step_context,
                )
            except Exception as exc:  # pragma: no cover - dépend du contenu utilisateur
                logger.warning(
                    "Impossible d'évaluer l'expression %s pour l'étape %s : %s",
                    expression,
                    step_slug,
                    exc,
                )
                return None

            definition = definition_candidate
            if isinstance(definition, BaseModel):
                try:
                    definition = definition.model_dump(by_alias=True)
                except TypeError:
                    definition = definition.model_dump()
            if isinstance(definition, str):
                try:
                    definition = json.loads(definition)
                except (
                    json.JSONDecodeError
                ) as exc:  # pragma: no cover - dépend du contenu
                    logger.warning(
                        "Le JSON renvoyé par %s est invalide pour l'étape %s : %s",
                        expression,
                        step_slug,
                        exc,
                    )
                    return None
            if not isinstance(definition, dict | list):
                logger.warning(
                    "L'expression %s doit renvoyer un objet JSON utilisable pour "
                    "le widget de l'étape %s",
                    expression,
                    step_slug,
                )
                return None
            if not bindings:
                bindings = _collect_widget_bindings(definition)
        else:
            if not config.slug:
                logger.warning("Slug de widget manquant pour l'étape %s", step_slug)
                return None
            definition = _load_widget_definition(
                config.slug, context=f"étape {step_slug}"
            )
            if definition is None:
                logger.warning(
                    "Widget %s introuvable pour l'étape %s",
                    config.slug,
                    step_slug,
                )
                return None

        resolved: dict[str, str | list[str]] = {}
        for variable_id, expression in config.variables.items():
            value = _evaluate_widget_variable_expression(
                expression, input_context=step_context
            )
            if value is None:
                continue
            resolved[variable_id] = value

        if step_context:
            for key in ("output_structured", "output_parsed", "output"):
                if key not in step_context:
                    continue
                auto_values = _collect_widget_values_from_output(
                    step_context[key], bindings=bindings
                )
                for identifier, value in auto_values.items():
                    resolved.setdefault(identifier, value)

        if resolved:
            matched = _apply_widget_variable_values(
                definition, resolved, bindings=bindings
            )
            missing = set(resolved) - matched
            if missing:
                logger.warning(
                    "Variables de widget non appliquées (%s) pour %s",
                    ", ".join(sorted(missing)),
                    widget_label,
                )

        try:
            widget = WidgetLibraryService._validate_widget(definition)
        except Exception as exc:  # pragma: no cover - dépend du SDK installé
            logger.exception(
                "Le widget %s est invalide après interpolation",
                widget_label,
                exc_info=exc,
            )
            return None

        if _sdk_stream_widget is None:
            logger.warning(
                "Le SDK Agents installé ne supporte pas stream_widget : "
                "impossible de diffuser %s",
                widget_label,
            )
            return None

        store = getattr(agent_context, "store", None)
        thread_metadata = getattr(agent_context, "thread", None)
        if store is None or thread_metadata is None:
            logger.warning(
                "Contexte Agent incomplet : impossible de diffuser le widget %s",
                widget_label,
            )
            return

        request_context = getattr(agent_context, "request_context", None)

        def _generate_item_id(item_type: str) -> str:
            try:
                return store.generate_item_id(
                    item_type,
                    thread_metadata,
                    request_context,
                )
            except (
                Exception
            ) as exc:  # pragma: no cover - dépend du stockage sous-jacent
                logger.exception(
                    "Impossible de générer un identifiant pour le widget %s",
                    widget_label,
                    exc_info=exc,
                )
                raise

        try:
            async for event in _sdk_stream_widget(
                thread_metadata,
                widget,
                generate_id=_generate_item_id,
            ):
                await on_stream_event(event)
        except Exception as exc:  # pragma: no cover - dépend du SDK Agents
            logger.exception(
                "Impossible de diffuser le widget %s pour %s",
                widget_label,
                step_title,
                exc_info=exc,
            )
            return None

        return widget

    def _should_forward_agent_event(
        event: ThreadStreamEvent, *, suppress: bool
    ) -> bool:
        if not suppress:
            return True
        return isinstance(event, EndOfTurnItem)

    async def run_agent_step(
        step_key: str,
        title: str,
        agent: Agent,
        *,
        agent_context: AgentContext[Any],
        run_context: Any | None = None,
        suppress_stream_events: bool = False,
        step_metadata: dict[str, Any] | None = None,
    ) -> _WorkflowStreamResult:
        step_index = len(steps) + 1
        metadata_for_images = dict(step_metadata or {})
        metadata_for_images["step_key"] = step_key
        metadata_for_images["step_slug"] = (
            metadata_for_images.get("step_slug") or step_key
        )
        metadata_for_images["step_title"] = (
            metadata_for_images.get("step_title") or title
        )
        if not metadata_for_images.get("agent_key"):
            metadata_for_images["agent_key"] = getattr(agent, "name", None)
        if not metadata_for_images.get("agent_label"):
            metadata_for_images["agent_label"] = getattr(
                agent, "name", None
            ) or getattr(agent, "model", None)
        thread_meta = getattr(agent_context, "thread", None)
        if not metadata_for_images.get("thread_id") and thread_meta is not None:
            metadata_for_images["thread_id"] = getattr(thread_meta, "id", None)

        request_context = getattr(agent_context, "request_context", None)
        if request_context is not None:
            metadata_for_images.setdefault(
                "user_id", getattr(request_context, "user_id", None)
            )
            metadata_for_images.setdefault(
                "backend_public_base_url",
                getattr(request_context, "public_base_url", None),
            )

        if not metadata_for_images.get("backend_public_base_url"):
            metadata_for_images["backend_public_base_url"] = (
                get_settings().backend_public_base_url
            )

        logger.info(
            "Démarrage de l'exécution de l'agent %s (étape=%s, index=%s)",
            metadata_for_images.get("agent_key")
            or metadata_for_images.get("agent_label")
            or step_key,
            metadata_for_images.get("step_slug"),
            step_index,
        )

        async def _inspect_event_for_images(event: ThreadStreamEvent) -> None:
            update = getattr(event, "update", None)
            if not isinstance(update, WorkflowTaskAdded | WorkflowTaskUpdated):
                return
            task = getattr(update, "task", None)
            if not isinstance(task, ImageTask):
                return
            registration = _register_image_generation_task(
                task, metadata=metadata_for_images
            )
            if registration is None:
                logger.debug(
                    "Impossible de suivre la génération d'image pour %s : "
                    "identifiant absent.",
                    metadata_for_images.get("step_slug"),
                )
                return
            context, key = registration
            image = task.images[0] if task.images else None
            status = getattr(task, "status_indicator", None) or "none"
            partial_count = len(image.partials) if image and image.partials else 0
            logger.info(
                "Progression image (étape=%s, call_id=%s, statut=%s, partiels=%d)",
                context.get("step_slug") or metadata_for_images.get("step_slug"),
                context.get("call_id"),
                status,
                partial_count,
            )
            if (
                status == "complete"
                and image
                and isinstance(image.b64_json, str)
                and image.b64_json
            ):
                if context.get("last_stored_b64") == image.b64_json:
                    logger.debug(
                        "Image finale déjà enregistrée pour l'appel %s.",
                        context.get("call_id"),
                    )
                    return
                await _persist_agent_image(context, key, task, image)
                context["last_stored_b64"] = image.b64_json
                agent_image_tasks.pop(key, None)
            elif status == "loading" and image and image.partials:
                logger.debug(
                    "Image partielle capturée pour l'appel %s (taille=%d).",
                    context.get("call_id"),
                    len(image.partials[-1]),
                )

        if on_step_stream is not None:
            await on_step_stream(
                WorkflowStepStreamUpdate(
                    key=step_key,
                    title=title,
                    index=step_index,
                    delta="",
                    text="",
                )
            )
        accumulated_text = ""
        response_format_override = getattr(agent, "_chatkit_response_format", None)
        if response_format_override is None:
            try:
                response_format_override = AGENT_RESPONSE_FORMATS.get(agent)
            except TypeError:
                logger.debug(
                    "Agent %s non hachable, impossible de récupérer le "
                    "response_format mémorisé.",
                    getattr(agent, "name", "<inconnu>"),
                )
        result = Runner.run_streamed(
            agent,
            input=[*conversation_history],
            run_config=_workflow_run_config(response_format_override),
            context=run_context,
        )
        try:
            async for event in stream_agent_response(agent_context, result):
                logger.debug(
                    "Évènement %s reçu pour l'étape %s",
                    getattr(event, "type", type(event).__name__),
                    metadata_for_images.get("step_slug"),
                )
                if on_stream_event is not None and _should_forward_agent_event(
                    event, suppress=suppress_stream_events
                ):
                    await on_stream_event(event)
                if on_step_stream is not None:
                    delta_text = _extract_delta(event)
                    if delta_text:
                        accumulated_text += delta_text
                        await on_step_stream(
                            WorkflowStepStreamUpdate(
                                key=step_key,
                                title=title,
                                index=step_index,
                                delta=delta_text,
                                text=accumulated_text,
                            )
                        )
                await _inspect_event_for_images(event)
        except Exception as exc:  # pragma: no cover
            raise_step_error(step_key, title, exc)

        conversation_history.extend([item.to_input_item() for item in result.new_items])
        if result.new_items:
            try:
                logger.debug(
                    "Éléments ajoutés par l'agent %s : %s",
                    agent_key,
                    json.dumps(
                        [item.to_input_item() for item in result.new_items],
                        ensure_ascii=False,
                        default=str,
                    ),
                )
            except TypeError:
                logger.debug(
                    "Éléments ajoutés par l'agent %s non sérialisables en JSON",
                    agent_key,
                )
        logger.info(
            "Fin de l'exécution de l'agent %s (étape=%s)",
            metadata_for_images.get("agent_key")
            or metadata_for_images.get("agent_label")
            or step_key,
            metadata_for_images.get("step_slug"),
        )
        return result

    def _node_title(step: WorkflowStep) -> str:
        if getattr(step, "display_name", None):
            return str(step.display_name)
        agent_key = getattr(step, "agent_key", None)
        if agent_key:
            return STEP_TITLES.get(agent_key, agent_key)
        return step.slug

    def _resolve_state_path(path: str) -> Any:
        value: Any = state
        for part in path.split("."):
            if isinstance(value, dict):
                value = value.get(part)
            else:
                return None
        return value

    def _stringify_branch_value(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, int | float):
            return str(value)
        if isinstance(value, str):
            trimmed = value.strip()
            return trimmed or None
        return None

    def _evaluate_condition_node(step: WorkflowStep) -> str | None:
        params = step.parameters or {}
        mode = str(params.get("mode", "truthy")).strip().lower()
        path = str(params.get("path", "")).strip()
        value = _resolve_state_path(path) if path else None

        if mode == "value":
            return _stringify_branch_value(value)

        if mode in {"equals", "not_equals"}:
            expected = _stringify_branch_value(params.get("value"))
            candidate = _stringify_branch_value(value)
            if expected is None:
                return "false" if mode == "equals" else "true"
            comparison = (candidate or "").lower() == expected.lower()
            if mode == "equals":
                return "true" if comparison else "false"
            return "false" if comparison else "true"

        if mode == "falsy":
            return "true" if not bool(value) else "false"

        return "true" if bool(value) else "false"

    def _next_edge(
        source_slug: str, branch: str | None = None
    ) -> WorkflowTransition | None:
        candidates = edges_by_source.get(source_slug, [])
        if not candidates:
            return None
        if branch is None:
            for edge in candidates:
                condition = (edge.condition or "default").lower()
                if condition in {"", "default"}:
                    return edge
            return candidates[0]
        branch_lower = branch.lower()
        for edge in candidates:
            if (edge.condition or "").lower() == branch_lower:
                return edge
        for edge in candidates:
            condition = (edge.condition or "default").lower()
            if condition in {"", "default"}:
                return edge
        return candidates[0]

    def _fallback_to_start(node_kind: str, node_slug: str) -> bool:
        nonlocal current_slug
        if not agent_steps_ordered:
            return False
        logger.debug(
            "Absence de transition apres le bloc %s %s, retour au debut %s",
            node_kind,
            node_slug,
            start_step.slug,
        )
        current_slug = start_step.slug
        return True

    current_slug = resume_from_wait_slug or start_step.slug
    final_node_slug: str | None = None
    final_end_state: WorkflowEndState | None = None
    guard = 0
    while guard < 1000:
        guard += 1
        current_node = nodes_by_slug.get(current_slug)
        if current_node is None:
            raise WorkflowExecutionError(
                "configuration",
                "Configuration du workflow invalide",
                RuntimeError(f"Nœud introuvable : {current_slug}"),
                list(steps),
            )

        final_node_slug = current_node.slug

        if current_node.kind == "end":
            final_end_state = _parse_end_state(current_node)
            break

        if current_node.kind == "start":
            transition = _next_edge(current_slug)
            if transition is None:
                raise WorkflowExecutionError(
                    "configuration",
                    "Configuration du workflow invalide",
                    RuntimeError("Aucune transition depuis le nœud de début"),
                    list(steps),
                )
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "condition":
            branch = _evaluate_condition_node(current_node)
            transition = _next_edge(current_slug, branch)
            if transition is None:
                branch_label = branch if branch is not None else "par défaut"
                raise WorkflowExecutionError(
                    "configuration",
                    "Configuration du workflow invalide",
                    RuntimeError(
                        f"Transition manquante pour la branche {branch_label} du "
                        f"nœud {current_slug}"
                    ),
                    list(steps),
                )
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "state":
            try:
                _apply_state_node(current_node)
            except Exception as exc:  # pragma: no cover - validation runtime
                raise_step_error(current_node.slug, _node_title(current_node), exc)

            transition = _next_edge(current_slug)
            if transition is None:
                if _fallback_to_start("state", current_node.slug):
                    continue
                break
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "watch":
            title = _node_title(current_node)
            payload_to_display = _resolve_watch_payload(last_step_context, steps)
            step_payload: Any = (
                payload_to_display
                if payload_to_display is not None
                else "Aucun payload disponible pour ce bloc."
            )

            await record_step(current_node.slug, title, step_payload)

            if on_stream_event is not None:
                if payload_to_display is None:
                    formatted_payload = "Aucune donnée issue du bloc précédent."
                else:
                    formatted_payload = _format_step_output(payload_to_display)
                    stripped = formatted_payload.strip()
                    if stripped.startswith("{") or stripped.startswith("["):
                        formatted_payload = f"```json\n{formatted_payload}\n```"
                notice_title = f"Bloc watch « {title or current_node.slug} »"
                assistant_message = AssistantMessageItem(
                    id=agent_context.generate_id("message"),
                    thread_id=agent_context.thread.id,
                    created_at=datetime.now(),
                    content=[
                        AssistantMessageContent(
                            text=f"{notice_title}\n\n{formatted_payload}"
                        )
                    ],
                )
                await on_stream_event(ThreadItemDoneEvent(item=assistant_message))

            transition = _next_edge(current_slug)
            if transition is None:
                if _fallback_to_start("watch", current_node.slug):
                    continue
                break
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "transform":
            title = _node_title(current_node)
            expressions_payload = current_node.parameters.get("expressions")
            if expressions_payload is None:
                transform_source: Any = {}
            elif isinstance(expressions_payload, dict | list):
                transform_source = copy.deepcopy(expressions_payload)
            else:
                raise WorkflowExecutionError(
                    current_node.slug,
                    title or current_node.slug,
                    ValueError(
                        "Le paramètre 'expressions' doit être un objet ou une liste."
                    ),
                    list(steps),
                )

            try:
                transform_output = resolve_transform_value(
                    transform_source,
                    state=state,
                    default_input_context=last_step_context,
                    input_context=last_step_context,
                )
            except Exception as exc:  # pragma: no cover - dépend des expressions
                raise_step_error(current_node.slug, title or current_node.slug, exc)

            await record_step(current_node.slug, title, transform_output)
            try:
                output_text = json.dumps(transform_output, ensure_ascii=False)
            except TypeError:
                output_text = str(transform_output)

            last_step_context = {
                "transform": transform_output,
                "output": transform_output,
                "output_parsed": transform_output,
                "output_structured": transform_output,
                "output_text": output_text,
            }

            transition = _next_edge(current_slug)
            if transition is None:
                if _fallback_to_start("transform", current_node.slug):
                    continue
                break
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "wait_for_user_input":
            transition = _next_edge(current_slug)
            pending_wait_state = (
                _get_wait_state_metadata(thread) if thread is not None else None
            )
            waiting_slug = (
                pending_wait_state.get("slug") if pending_wait_state else None
            )
            waiting_input_id = (
                pending_wait_state.get("input_item_id") if pending_wait_state else None
            )
            resumed = (
                pending_wait_state is not None
                and waiting_slug == current_node.slug
                and current_input_item_id
                and waiting_input_id != current_input_item_id
            )

            if resumed:
                next_slug = pending_wait_state.get("next_step_slug")
                if next_slug is None and transition is not None:
                    next_slug = transition.target_step.slug
                if thread is not None:
                    _set_wait_state_metadata(thread, None)
                last_step_context = {"user_message": initial_user_text}
                if not next_slug:
                    final_end_state = WorkflowEndState(
                        slug=current_node.slug,
                        status_type="closed",
                        status_reason=(
                            "Aucune transition disponible après le bloc d'attente."
                        ),
                        message=(
                            "Aucune transition disponible après le bloc d'attente."
                        ),
                    )
                    break
                current_slug = next_slug
                continue

            title = _node_title(current_node)
            raw_message = _resolve_wait_for_user_input_message(current_node)
            sanitized_message = _normalize_user_text(raw_message)
            display_payload = (
                sanitized_message or "En attente d'une réponse utilisateur."
            )
            wait_reason = display_payload

            await record_step(current_node.slug, title, display_payload)

            context_payload: dict[str, Any] = {"wait_for_user_input": True}
            if sanitized_message:
                context_payload["assistant_message"] = sanitized_message

            last_step_context = context_payload

            if sanitized_message and on_stream_event is not None:
                assistant_message = AssistantMessageItem(
                    id=agent_context.generate_id("message"),
                    thread_id=agent_context.thread.id,
                    created_at=datetime.now(),
                    content=[AssistantMessageContent(text=sanitized_message)],
                )
                await on_stream_event(ThreadItemAddedEvent(item=assistant_message))
                await on_stream_event(ThreadItemDoneEvent(item=assistant_message))

            wait_state_payload: dict[str, Any] = {
                "slug": current_node.slug,
                "input_item_id": current_input_item_id,
            }
            conversation_snapshot = _clone_conversation_history_snapshot(
                conversation_history
            )
            if conversation_snapshot:
                wait_state_payload["conversation_history"] = conversation_snapshot
            if transition is not None:
                wait_state_payload["next_step_slug"] = transition.target_step.slug
            if state:
                wait_state_payload["state"] = _json_safe_copy(state)
            if thread is not None:
                _set_wait_state_metadata(thread, wait_state_payload)

            final_end_state = WorkflowEndState(
                slug=current_node.slug,
                status_type="waiting",
                status_reason=wait_reason,
                message=wait_reason,
            )
            break

        if current_node.kind == "assistant_message":
            title = _node_title(current_node)
            raw_message = _resolve_assistant_message(current_node)
            sanitized_message = _normalize_user_text(raw_message)
            stream_config = _resolve_assistant_stream_config(current_node)

            await record_step(current_node.slug, title, sanitized_message or "")
            last_step_context = {"assistant_message": sanitized_message}

            if sanitized_message and on_stream_event is not None:
                if stream_config.enabled:
                    await _stream_assistant_message(
                        sanitized_message,
                        delay_seconds=stream_config.delay_seconds,
                    )
                else:
                    assistant_message = AssistantMessageItem(
                        id=agent_context.generate_id("message"),
                        thread_id=agent_context.thread.id,
                        created_at=datetime.now(),
                        content=[AssistantMessageContent(text=sanitized_message)],
                    )
                    await on_stream_event(ThreadItemAddedEvent(item=assistant_message))
                    await on_stream_event(ThreadItemDoneEvent(item=assistant_message))

            transition = _next_edge(current_slug)
            if transition is None:
                if _fallback_to_start("assistant_message", current_node.slug):
                    continue
                break
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "user_message":
            title = _node_title(current_node)
            raw_message = _resolve_user_message(current_node)
            sanitized_message = _normalize_user_text(raw_message)

            await record_step(current_node.slug, title, sanitized_message or "")
            last_step_context = {"user_message": sanitized_message}

            if sanitized_message and on_stream_event is not None:
                user_item = UserMessageItem(
                    id=agent_context.generate_id("message"),
                    thread_id=agent_context.thread.id,
                    created_at=datetime.now(),
                    content=[UserMessageTextContent(text=sanitized_message)],
                    attachments=[],
                    quoted_text=None,
                    inference_options=InferenceOptions(),
                )
                await on_stream_event(ThreadItemAddedEvent(item=user_item))
                await on_stream_event(ThreadItemDoneEvent(item=user_item))

            transition = _next_edge(current_slug)
            if transition is None:
                if _fallback_to_start("user_message", current_node.slug):
                    continue
                break
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "json_vector_store":
            title = _node_title(current_node)
            await ingest_workflow_step(
                config=current_node.parameters or {},
                step_slug=current_node.slug,
                step_title=title,
                step_context=last_step_context,
                state=state,
                default_input_context=last_step_context,
                session_factory=SessionLocal,
            )
            transition = _next_edge(current_slug)
            if transition is None:
                if _fallback_to_start("json_vector_store", current_node.slug):
                    continue
                break
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "widget":
            title = _node_title(current_node)
            widget_config = widget_configs_by_step.get(current_node.slug)
            if widget_config is None:
                logger.warning(
                    "Widget non configuré pour le nœud %s : aucune diffusion réalisée",
                    current_node.slug,
                )
            else:
                rendered_widget = await _stream_response_widget(
                    widget_config,
                    step_slug=current_node.slug,
                    step_title=title,
                    step_context=last_step_context,
                )
                action_payload: dict[str, Any] | None = None
                if on_widget_step is not None and _should_wait_for_widget_action(
                    current_node.kind, widget_config
                ):
                    result = await on_widget_step(current_node, widget_config)
                    if result is not None:
                        action_payload = dict(result)

                widget_identifier = (
                    widget_config.slug
                    if widget_config.source == "library"
                    else widget_config.definition_expression
                ) or current_node.slug
                step_payload: dict[str, Any] = {"widget": widget_identifier}
                if widget_config.source == "library" and widget_config.slug:
                    step_payload["widget_slug"] = widget_config.slug
                elif (
                    widget_config.source == "variable"
                    and widget_config.definition_expression
                ):
                    step_payload["widget_expression"] = (
                        widget_config.definition_expression
                    )
                if widget_config.source == "variable" and rendered_widget is not None:
                    step_payload["widget_definition"] = rendered_widget
                if action_payload is not None:
                    step_payload["action"] = action_payload

                await record_step(
                    current_node.slug,
                    title,
                    step_payload,
                )

                context_payload: dict[str, Any] = {"widget": widget_identifier}
                if widget_config.source == "library" and widget_config.slug:
                    context_payload["widget_slug"] = widget_config.slug
                elif (
                    widget_config.source == "variable"
                    and widget_config.definition_expression
                ):
                    context_payload["widget_expression"] = (
                        widget_config.definition_expression
                    )
                if rendered_widget is not None:
                    context_payload["widget_definition"] = rendered_widget
                if action_payload is not None:
                    context_payload["action"] = action_payload
                last_step_context = context_payload
            transition = _next_edge(current_slug)
            if transition is None:
                if _fallback_to_start(current_node.kind, current_node.slug):
                    continue
                break
            current_slug = transition.target_step.slug
            continue

        if current_node.kind != "agent":
            raise WorkflowExecutionError(
                "configuration",
                "Configuration du workflow invalide",
                RuntimeError(f"Type de nœud non géré : {current_node.kind}"),
                list(steps),
            )

        agent_key = current_node.agent_key or current_node.slug
        position = agent_positions.get(current_slug, total_runtime_steps)
        step_identifier = f"{agent_key}_{position}"
        agent = agent_instances[current_slug]
        title = _node_title(current_node)
        widget_config = widget_configs_by_step.get(current_node.slug)

        run_context: Any | None = None
        if last_step_context is not None:
            run_context = dict(last_step_context)

        # Injecter le contexte du bloc précédent dans l'historique de conversation
        if last_step_context is not None:
            context_text_parts: list[str] = []

            # Ajouter le texte de sortie si disponible
            output_text_value = last_step_context.get("output_text")
            if isinstance(output_text_value, str) and output_text_value.strip():
                context_text_parts.append(output_text_value.strip())

            # Ajouter une représentation structurée si disponible
            structured_payload = last_step_context.get("output_structured")
            if structured_payload is None:
                structured_payload = last_step_context.get("output_parsed")
            if structured_payload is None:
                structured_payload = last_step_context.get("output")
            if structured_payload is not None:
                if isinstance(structured_payload, dict | list):
                    try:
                        serialized_structured = json.dumps(
                            structured_payload,
                            ensure_ascii=False,
                            indent=2,
                        )
                    except TypeError:
                        serialized_structured = str(structured_payload)
                else:
                    serialized_structured = str(structured_payload)
                if serialized_structured.strip():
                    should_append = True
                    if context_text_parts:
                        normalized_structured = serialized_structured.strip()
                        if any(
                            normalized_structured == part.strip()
                            for part in context_text_parts
                        ):
                            should_append = False
                    if should_append:
                        context_text_parts.append(serialized_structured.strip())

            # Ajouter les URLs d'images générées si disponibles
            if "generated_image_urls" in last_step_context:
                image_urls_list = last_step_context["generated_image_urls"]
                if isinstance(image_urls_list, list) and image_urls_list:
                    for url in image_urls_list:
                        context_text_parts.append(f"Image générée : {url}")

            # Ajouter un message assistant avec le contexte si on a du contenu
            if context_text_parts:
                context_message = "\n\n".join(context_text_parts)
                conversation_history.append(
                    {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "output_text",
                                "text": context_message,
                            }
                        ],
                    }
                )

        if last_step_context is not None:
            logger.debug(
                "Contexte transmis à l'agent %s (étape=%s) : %s",
                agent_key,
                current_node.slug,
                json.dumps(last_step_context, ensure_ascii=False, default=str),
            )

        if conversation_history:
            try:
                logger.debug(
                    "Historique envoyé à l'agent %s : %s",
                    agent_key,
                    json.dumps(
                        conversation_history[-1], ensure_ascii=False, default=str
                    ),
                )
            except TypeError:
                logger.debug(
                    "Historique envoyé à l'agent %s (non sérialisable JSON)",
                    agent_key,
                )
        logger.debug(
            "État courant avant l'agent %s : %s",
            agent_key,
            json.dumps(state, ensure_ascii=False, default=str),
        )

        result_stream = await run_agent_step(
            step_identifier,
            title,
            agent,
            agent_context=agent_context,
            run_context=run_context,
            suppress_stream_events=widget_config is not None,
            step_metadata={
                "agent_key": agent_key,
                "step_slug": current_node.slug,
                "step_title": title,
            },
        )
        image_urls = _consume_generated_image_urls(step_identifier)
        links_text = format_generated_image_links(image_urls)

        parsed, text = _structured_output_as_json(result_stream.final_output)
        await record_step(
            step_identifier,
            title,
            merge_generated_image_urls_into_payload(
                result_stream.final_output, image_urls
            ),
        )
        last_step_context = {
            "agent_key": agent_key,
            "output": result_stream.final_output,
            "output_parsed": parsed,
            "output_structured": parsed,
            "output_text": append_generated_image_links(text, image_urls),
        }

        # Mémoriser la dernière sortie d'agent dans l'état global pour les
        # transitions suivantes.
        state["last_agent_key"] = agent_key
        state["last_agent_output"] = last_step_context.get("output")
        state["last_agent_output_text"] = last_step_context.get("output_text")
        structured_candidate = last_step_context.get("output_structured")
        if hasattr(structured_candidate, "model_dump"):
            try:
                structured_candidate = structured_candidate.model_dump(by_alias=True)
            except TypeError:
                structured_candidate = structured_candidate.model_dump()
        elif hasattr(structured_candidate, "dict"):
            try:
                structured_candidate = structured_candidate.dict(by_alias=True)
            except TypeError:
                structured_candidate = structured_candidate.dict()
        elif structured_candidate is not None and not isinstance(
            structured_candidate, dict | list | str
        ):
            structured_candidate = str(structured_candidate)
        state["last_agent_output_structured"] = structured_candidate
        generated_urls = last_step_context.get("generated_image_urls")
        if isinstance(generated_urls, list):
            state["last_generated_image_urls"] = [
                url for url in generated_urls if isinstance(url, str)
            ]
        else:
            state.pop("last_generated_image_urls", None)

        logger.debug(
            "État mis à jour après l'agent %s : %s",
            agent_key,
            json.dumps(state, ensure_ascii=False, default=str),
        )

        if image_urls:
            last_step_context["generated_image_urls"] = image_urls
            if links_text and on_stream_event is not None:
                links_message = AssistantMessageItem(
                    id=agent_context.generate_id("message"),
                    thread_id=agent_context.thread.id,
                    created_at=datetime.now(),
                    content=[AssistantMessageContent(text=links_text)],
                )
                await on_stream_event(ThreadItemAddedEvent(item=links_message))
                await on_stream_event(ThreadItemDoneEvent(item=links_message))

        await ingest_workflow_step(
            config=(current_node.parameters or {}).get("vector_store_ingestion"),
            step_slug=current_node.slug,
            step_title=title,
            step_context=last_step_context,
            state=state,
            default_input_context=last_step_context,
            session_factory=SessionLocal,
        )

        if widget_config is not None:
            rendered_widget = await _stream_response_widget(
                widget_config,
                step_slug=current_node.slug,
                step_title=title,
                step_context=last_step_context,
            )
            widget_identifier = (
                widget_config.slug
                if widget_config.source == "library"
                else widget_config.definition_expression
            ) or current_node.slug
            augmented_context = dict(last_step_context or {})
            augmented_context.setdefault("widget", widget_identifier)
            if widget_config.source == "library" and widget_config.slug:
                augmented_context.setdefault("widget_slug", widget_config.slug)
            elif (
                widget_config.source == "variable"
                and widget_config.definition_expression
            ):
                augmented_context.setdefault(
                    "widget_expression", widget_config.definition_expression
                )
            if rendered_widget is not None:
                augmented_context["widget_definition"] = rendered_widget

            if on_widget_step is not None and _should_wait_for_widget_action(
                current_node.kind, widget_config
            ):
                result = await on_widget_step(current_node, widget_config)
                if result is not None:
                    augmented_context["action"] = dict(result)

            last_step_context = augmented_context

        transition = _next_edge(current_slug)
        if transition is None:
            break
        current_slug = transition.target_step.slug

    if guard >= 1000:
        raise WorkflowExecutionError(
            "configuration",
            "Configuration du workflow invalide",
            RuntimeError("Nombre maximal d'étapes dépassé"),
            list(steps),
        )

    if final_node_slug is None:
        raise WorkflowExecutionError(
            "configuration",
            "Configuration du workflow invalide",
            RuntimeError("Impossible de déterminer le nœud final du workflow"),
            list(steps),
        )

    return WorkflowRunSummary(
        steps=steps,
        final_output=final_output,
        final_node_slug=final_node_slug,
        end_state=final_end_state,
    )
