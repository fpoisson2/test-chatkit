# ruff: noqa: I001,UP038
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
from agents.mcp import MCPServer
from chatkit.agents import (
    AgentContext,
    ThreadItemConverter,
    stream_agent_response,
)
from pydantic import BaseModel

try:  # pragma: no cover - dépend de la version du SDK Agents installée
    from chatkit.agents import stream_widget as _sdk_stream_widget
except ImportError:  # pragma: no cover - compatibilité avec les anciennes versions
    _sdk_stream_widget = None  # type: ignore[assignment]

from chatkit.types import (
    AssistantMessageContent,
    AssistantMessageContentPartTextDelta,
    AssistantMessageItem,
    CustomTask,
    EndOfTurnItem,
    GeneratedImage,
    ImageTask,
    InferenceOptions,
    TaskItem,
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
    AgentProviderBinding,
    _build_custom_agent,
    _create_response_format_from_pydantic,
    get_agent_provider_binding,
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
from ..model_capabilities import ModelCapabilities, lookup_model_capabilities
from ..models import Workflow, WorkflowDefinition, WorkflowStep, WorkflowTransition
from ..realtime_runner import close_voice_session, open_voice_session
from ..token_sanitizer import sanitize_model_like
from ..vector_store.ingestion import (
    evaluate_state_expression,
    ingest_document,
    ingest_workflow_step,
    resolve_transform_value,
)
from ..widgets import WidgetLibraryService
from .service import (
    WorkflowNotFoundError,
    WorkflowService,
    WorkflowValidationError,
    WorkflowVersionNotFoundError,
    resolve_start_auto_start,
    resolve_start_auto_start_assistant_message,
    resolve_start_auto_start_message,
)

logger = logging.getLogger("chatkit.server")

AGENT_NODE_KINDS = frozenset({"agent", "voice_agent"})
AGENT_IMAGE_VECTOR_STORE_SLUG = "chatkit-agent-images"


def _normalize_conversation_history_for_provider(
    items: Sequence[TResponseInputItem],
    provider_slug: str | None,
) -> Sequence[TResponseInputItem]:
    """Adapt conversation history to the provider capabilities when needed.

    Groq's compatibility layer for the OpenAI Responses API currently rejects
    `input_text` and `output_text` content blocks. When we know that the
    provider is Groq we therefore coerce these types to the more widely
    supported `text` variant.
    """

    if not provider_slug or provider_slug.lower() != "groq":
        return items

    changed = False
    normalized: list[TResponseInputItem] = []
    for item in items:
        if isinstance(item, Mapping):
            copied_item = copy.deepcopy(item)
            content = copied_item.get("content")
            if isinstance(content, list):
                for index, part in enumerate(content):
                    if not isinstance(part, Mapping):
                        continue
                    part_type = part.get("type")
                    if (
                        isinstance(part_type, str)
                        and part_type in {"input_text", "output_text"}
                    ):
                        coerced_part = dict(part)
                        coerced_part["type"] = "text"
                        content[index] = coerced_part
                        changed = True
            normalized.append(copied_item)
        else:
            normalized.append(item)

    if not changed:
        return items
    return normalized

# ---------------------------------------------------------------------------
# Définition du workflow local exécuté par DemoChatKitServer
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _VoicePreferenceOverrides:
    model: str | None
    instructions: str | None
    voice: str | None
    prompt_variables: dict[str, str]
    provider_id: str | None
    provider_slug: str | None

    def is_empty(self) -> bool:
        return not (
            (self.model and self.model.strip())
            or (self.instructions and self.instructions.strip())
            or (self.voice and self.voice.strip())
            or (self.provider_id and self.provider_id.strip())
            or (self.provider_slug and self.provider_slug.strip())
            or self.prompt_variables
        )


def _extract_voice_overrides(
    agent_context: AgentContext[Any],
) -> _VoicePreferenceOverrides | None:
    request_context = getattr(agent_context, "request_context", None)
    if request_context is None:
        return None

    model = getattr(request_context, "voice_model", None)
    instructions = getattr(request_context, "voice_instructions", None)
    voice = getattr(request_context, "voice_voice", None)
    prompt_variables_raw = getattr(
        request_context, "voice_prompt_variables", None
    )
    if isinstance(prompt_variables_raw, Mapping):
        prompt_variables = {
            str(key).strip(): "" if value is None else str(value)
            for key, value in prompt_variables_raw.items()
            if isinstance(key, str) and key.strip()
        }
    else:
        prompt_variables = {}

    provider_id_raw = getattr(request_context, "voice_model_provider_id", None)
    provider_slug_raw = getattr(request_context, "voice_model_provider_slug", None)

    sanitized_model = model if isinstance(model, str) and model.strip() else None
    sanitized_instructions = (
        instructions if isinstance(instructions, str) and instructions.strip() else None
    )
    sanitized_voice = voice if isinstance(voice, str) and voice.strip() else None
    sanitized_provider_id = (
        provider_id_raw.strip()
        if isinstance(provider_id_raw, str) and provider_id_raw.strip()
        else None
    )
    sanitized_provider_slug = (
        provider_slug_raw.strip().lower()
        if isinstance(provider_slug_raw, str) and provider_slug_raw.strip()
        else None
    )
    overrides = _VoicePreferenceOverrides(
        sanitized_model,
        sanitized_instructions,
        sanitized_voice,
        prompt_variables,
        sanitized_provider_id,
        sanitized_provider_slug,
    )

    return None if overrides.is_empty() else overrides


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
    last_context: dict[str, Any] | None = None
    state: dict[str, Any] | None = None


@dataclass
class WorkflowRuntimeSnapshot:
    state: dict[str, Any]
    conversation_history: list[TResponseInputItem]
    last_step_context: dict[str, Any] | None
    steps: list[WorkflowStepSummary]
    current_slug: str
    stop_at_slug: str | None = None
    branch_id: str | None = None
    branch_label: str | None = None


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
        object.__setattr__(self, "step", step)
        object.__setattr__(self, "title", title)
        object.__setattr__(self, "original_error", original_error)
        object.__setattr__(self, "steps", steps)

    def __str__(self) -> str:
        return f"{self.title} ({self.step}) : {self.original_error}"


class WorkflowAgentRunContext(Mapping[str, Any]):
    """Context transmis aux tools d'agent lors d'une étape de workflow.

    Il combine l'``AgentContext`` actuel et, si disponible, le contexte de
    l'étape précédente pour conserver la compatibilité avec les usages existants
    reposant sur un dictionnaire.
    """

    def __init__(
        self,
        *,
        agent_context: AgentContext[Any],
        step_context: Mapping[str, Any] | None = None,
    ) -> None:
        self.agent_context = agent_context
        self.step_context: dict[str, Any] = (
            dict(step_context) if isinstance(step_context, Mapping) else {}
        )

    def __getitem__(self, key: str) -> Any:
        return self.step_context[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self.step_context)

    def __len__(self) -> int:
        return len(self.step_context)

    def get(self, key: str, default: Any | None = None) -> Any:
        return self.step_context.get(key, default)


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
    workflow_definition: WorkflowDefinition | None = None,
    workflow_slug: str | None = None,
    thread_item_converter: ThreadItemConverter | None = None,
    thread_items_history: list[ThreadItem] | None = None,
    current_user_message: UserMessageItem | None = None,
    workflow_call_stack: tuple[tuple[str, str | int], ...] | None = None,
    runtime_snapshot: WorkflowRuntimeSnapshot | None = None,
) -> WorkflowRunSummary:
    workflow_payload = workflow_input.model_dump()
    steps: list[WorkflowStepSummary] = (
        runtime_snapshot.steps if runtime_snapshot is not None else []
    )
    auto_started = False
    thread = getattr(agent_context, "thread", None)
    pending_wait_state: Mapping[str, Any] | None = None
    resume_from_wait_slug: str | None = None
    conversation_history: list[TResponseInputItem]
    state: dict[str, Any]
    last_step_context: dict[str, Any] | None

    current_input_item_id = workflow_payload.get("source_item_id")

    if runtime_snapshot is None:
        auto_started = bool(workflow_payload.get("auto_start_was_triggered"))
        initial_user_text = _normalize_user_text(workflow_payload["input_as_text"])
        workflow_payload["input_as_text"] = initial_user_text
        conversation_history = []
        pending_wait_state = (
            _get_wait_state_metadata(thread) if thread is not None else None
        )
        if (
            not isinstance(current_input_item_id, str)
            and current_user_message is not None
        ):
            candidate_id = getattr(current_user_message, "id", None)
            current_input_item_id = (
                candidate_id if isinstance(candidate_id, str) else None
            )

        if pending_wait_state:
            restored_history = _clone_conversation_history_snapshot(
                pending_wait_state.get("conversation_history")
            )
            if restored_history:
                conversation_history.extend(restored_history)

        if thread_items_history and thread_item_converter:
            try:
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

    final_output: dict[str, Any] | None = None

    voice_overrides = _extract_voice_overrides(agent_context)

    service = workflow_service or WorkflowService()

    model_capability_index: dict[tuple[str, str, str], ModelCapabilities] = {}
    get_capabilities = getattr(service, "get_available_model_capabilities", None)
    if callable(get_capabilities):
        try:
            model_capability_index = get_capabilities()
        except Exception:  # pragma: no cover - dépend de la persistance
            logger.warning(
                "Impossible de récupérer les capacités des modèles disponibles",
                exc_info=True,
            )
            model_capability_index = {}

    definition: WorkflowDefinition
    if workflow_definition is not None:
        definition = workflow_definition
    else:
        if isinstance(workflow_slug, str) and workflow_slug.strip():
            definition = service.get_definition_by_slug(workflow_slug)
        else:
            definition = service.get_current()

    if workflow_call_stack is None:
        identifiers: list[tuple[str, str | int]] = []
        if definition.workflow_id is not None:
            identifiers.append(("id", int(definition.workflow_id)))
        workflow_slug_value = getattr(definition.workflow, "slug", None)
        if isinstance(workflow_slug_value, str) and workflow_slug_value.strip():
            identifiers.append(("slug", workflow_slug_value.strip().lower()))
        workflow_call_stack = tuple(identifiers)

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
        elif (
            isinstance(waiting_slug, str)
            and waiting_slug in nodes_by_slug
            and isinstance(pending_wait_state.get("voice_transcripts"), list)
            and pending_wait_state.get("voice_transcripts")
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
        if (
            step.kind in AGENT_NODE_KINDS
            and step.is_enabled
            and step.slug in nodes_by_slug
        )
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
    agent_provider_bindings: dict[str, AgentProviderBinding | None] = {}
    agent_model_capabilities: dict[str, ModelCapabilities | None] = {}
    nested_workflow_configs: dict[str, dict[str, Any]] = {}
    nested_workflow_definition_cache: dict[
        tuple[str, str | int], WorkflowDefinition
    ] = {}
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

        if step.kind == "voice_agent":
            _register_widget_config(step)
            continue

        widget_config = _register_widget_config(step)

        workflow_reference = (step.parameters or {}).get("workflow")
        if step.kind == "agent" and isinstance(workflow_reference, Mapping):
            nested_workflow_configs[step.slug] = dict(workflow_reference)
            logger.info(
                "Étape %s configurée pour un workflow imbriqué : %s",
                step.slug,
                workflow_reference,
            )
            continue

        agent_key = (step.agent_key or "").strip()
        builder = AGENT_BUILDERS.get(agent_key)
        overrides_raw = step.parameters or {}
        overrides = dict(overrides_raw)

        raw_provider_id = overrides_raw.get("model_provider_id")
        provider_id = (
            raw_provider_id.strip() if isinstance(raw_provider_id, str) else None
        )
        raw_provider_slug = overrides_raw.get("model_provider_slug")
        if not isinstance(raw_provider_slug, str) or not raw_provider_slug.strip():
            fallback_slug = overrides_raw.get("model_provider")
            raw_provider_slug = (
                fallback_slug if isinstance(fallback_slug, str) else None
            )
        provider_slug = (
            raw_provider_slug.strip().lower()
            if isinstance(raw_provider_slug, str)
            else None
        )

        model_name = overrides_raw.get("model")
        capability: ModelCapabilities | None = None
        if isinstance(model_name, str):
            capability = lookup_model_capabilities(
                model_capability_index,
                name=model_name,
                provider_id=provider_id,
                provider_slug=provider_slug,
            )
        agent_model_capabilities[step.slug] = capability

        overrides.pop("model_provider_id", None)
        overrides.pop("model_provider_slug", None)
        overrides.pop("model_provider", None)

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

        provider_binding = None
        if provider_id or provider_slug:
            provider_binding = get_agent_provider_binding(provider_id, provider_slug)
            if provider_binding is None:
                logger.warning(
                    "Impossible de résoudre le fournisseur %s (id=%s) pour l'étape %s",
                    provider_slug or "<inconnu>",
                    provider_id or "<aucun>",
                    step.slug,
                )
        agent_provider_bindings[step.slug] = provider_binding

    def _load_nested_workflow_definition(
        reference: Mapping[str, Any]
    ) -> WorkflowDefinition:
        workflow_id_candidate = reference.get("id")
        slug_candidate = reference.get("slug")
        errors: list[str] = []

        if isinstance(workflow_id_candidate, int) and workflow_id_candidate > 0:
            cache_key = ("id", workflow_id_candidate)
            cached_definition = nested_workflow_definition_cache.get(cache_key)
            if cached_definition is not None:
                return cached_definition

            try:
                workflow = service.get_workflow(workflow_id_candidate)
            except WorkflowNotFoundError:
                errors.append(f"id={workflow_id_candidate}")
            else:
                version_id = getattr(workflow, "active_version_id", None)
                if version_id is None:
                    raise RuntimeError(
                        f"Le workflow imbriqué {workflow_id_candidate} "
                        "n'a pas de version active."
                    )
                try:
                    definition = service.get_version(workflow_id_candidate, version_id)
                except WorkflowVersionNotFoundError as exc:
                    raise RuntimeError(
                        "Version active introuvable pour le workflow "
                        f"{workflow_id_candidate}."
                    ) from exc
                nested_workflow_definition_cache[cache_key] = definition
                return definition

        if isinstance(slug_candidate, str):
            normalized_slug = slug_candidate.strip()
            if normalized_slug:
                cache_key = ("slug", normalized_slug)
                cached_definition = nested_workflow_definition_cache.get(cache_key)
                if cached_definition is not None:
                    return cached_definition
                try:
                    definition = service.get_definition_by_slug(normalized_slug)
                except WorkflowValidationError:
                    errors.append(f"slug={normalized_slug}")
                else:
                    nested_workflow_definition_cache[cache_key] = definition
                    return definition

        details = ", ".join(errors) if errors else "configuration inconnue"
        raise RuntimeError(f"Workflow imbriqué introuvable ({details}).")

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

    stop_at_slug = runtime_snapshot.stop_at_slug if runtime_snapshot else None
    active_branch_id = runtime_snapshot.branch_id if runtime_snapshot else None
    active_branch_label = (
        runtime_snapshot.branch_label if runtime_snapshot else None
    )

    def _branch_prefixed_slug(slug: str) -> str:
        if active_branch_id:
            return f"{active_branch_id}:{slug}"
        return slug

    def _branch_prefixed_title(title: str | None) -> str:
        if not active_branch_id:
            return title or ""
        prefix = active_branch_label or active_branch_id
        if title and title.strip():
            return f"[{prefix}] {title}"
        return f"[{prefix}]"

    async def _emit_stream_event(event: ThreadStreamEvent) -> None:
        if on_stream_event is None:
            return
        if active_branch_id:
            try:
                event.workflow_branch_id = active_branch_id  # type: ignore[attr-defined]
            except Exception:
                pass
            if active_branch_label:
                try:
                    event.workflow_branch_label = active_branch_label  # type: ignore[attr-defined]
                except Exception:
                    pass
        await on_stream_event(event)

    async def _emit_step_stream(update: WorkflowStepStreamUpdate) -> None:
        if on_step_stream is None:
            return
        if active_branch_id:
            update = WorkflowStepStreamUpdate(
                key=_branch_prefixed_slug(update.key),
                title=_branch_prefixed_title(update.title),
                index=update.index,
                delta=update.delta,
                text=update.text,
            )
        await on_step_stream(update)

    def _format_step_summary(
        step_key: str, title: str, payload: Any
    ) -> WorkflowStepSummary:
        formatted_output = _format_step_output(payload)
        summary = WorkflowStepSummary(
            key=_branch_prefixed_slug(step_key),
            title=_branch_prefixed_title(title),
            output=formatted_output,
        )
        return summary

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
        await _emit_stream_event(ThreadItemAddedEvent(item=assistant_item))
        first_chunk = True
        content_index = 0
        for chunk in _iter_stream_chunks(text):
            if not first_chunk and delay_seconds > 0:
                await asyncio.sleep(delay_seconds)
            first_chunk = False
            await _emit_stream_event(
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
        await _emit_stream_event(ThreadItemDoneEvent(item=final_item))

    _VOICE_DEFAULT_START_MODE = "auto"
    _VOICE_DEFAULT_STOP_MODE = "manual"
    _VOICE_TOOL_DEFAULTS: dict[str, bool] = {
        "response": True,
        "transcription": True,
        "function_call": False,
    }
    _VOICE_DEFAULT_TURN_DETECTION: dict[str, Any] = {
        "type": "semantic_vad",
        "create_response": True,
        "interrupt_response": True,
    }
    _VOICE_DEFAULT_INPUT_AUDIO_FORMAT: dict[str, Any] = {
        "type": "audio/pcm",
        "rate": 24_000,
    }
    _VOICE_DEFAULT_OUTPUT_AUDIO_FORMAT: dict[str, Any] = {
        "type": "audio/pcm",
        "rate": 24_000,
    }
    _VOICE_DEFAULT_INPUT_AUDIO_TRANSCRIPTION: dict[str, Any] = {
        "model": "gpt-4o-mini-transcribe",
        "language": "fr-CA",
    }
    _VOICE_DEFAULT_INPUT_AUDIO_NOISE_REDUCTION: dict[str, Any] = {
        "type": "near_field",
    }
    _VOICE_DEFAULT_MODALITIES = ["audio"]
    _VOICE_DEFAULT_SPEED = 1.0

    def _resolve_voice_agent_configuration(
        step: WorkflowStep,
        *,
        overrides: _VoicePreferenceOverrides | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        params_raw = step.parameters or {}
        params = params_raw if isinstance(params_raw, Mapping) else {}

        settings = get_settings()

        def _sanitize_text(value: Any) -> str:
            if isinstance(value, str):
                candidate = value.strip()
                if candidate:
                    return candidate
            return ""

        def _resolve_value(
            key: str,
            *,
            override_value: str | None,
            fallback: str,
        ) -> str:
            override_candidate = (
                override_value.strip() if isinstance(override_value, str) else None
            )
            if override_candidate:
                return override_candidate
            step_candidate = _sanitize_text(params.get(key))
            if step_candidate:
                return step_candidate
            return fallback

        def _merge_mapping(
            default: Mapping[str, Any], override: Any
        ) -> dict[str, Any]:
            merged = copy.deepcopy(default)
            if isinstance(override, Mapping):
                for key, value in override.items():
                    if isinstance(value, Mapping) and isinstance(
                        merged.get(key), Mapping
                    ):
                        merged[key] = _merge_mapping(merged[key], value)
                    else:
                        merged[key] = value
            return merged

        voice_model = _resolve_value(
            "model",
            override_value=getattr(overrides, "model", None),
            fallback=settings.chatkit_realtime_model,
        )
        instructions = _resolve_value(
            "instructions",
            override_value=getattr(overrides, "instructions", None),
            fallback=settings.chatkit_realtime_instructions,
        )
        voice_id = _resolve_value(
            "voice",
            override_value=getattr(overrides, "voice", None),
            fallback=settings.chatkit_realtime_voice,
        )

        provider_id_override = getattr(overrides, "provider_id", None)
        provider_slug_override = getattr(overrides, "provider_slug", None)

        raw_provider_id = params.get("model_provider_id")
        step_provider_id = (
            raw_provider_id.strip()
            if isinstance(raw_provider_id, str) and raw_provider_id.strip()
            else None
        )
        raw_provider_slug = params.get("model_provider_slug")
        if not isinstance(raw_provider_slug, str) or not raw_provider_slug.strip():
            fallback_slug = params.get("model_provider")
            raw_provider_slug = (
                fallback_slug if isinstance(fallback_slug, str) else None
            )
        step_provider_slug = (
            raw_provider_slug.strip().lower()
            if isinstance(raw_provider_slug, str) and raw_provider_slug.strip()
            else None
        )

        provider_id = (
            provider_id_override
            if provider_id_override
            else step_provider_id
        )
        provider_slug = (
            provider_slug_override
            if provider_slug_override
            else step_provider_slug
        )

        realtime_raw = params.get("realtime")
        realtime = realtime_raw if isinstance(realtime_raw, Mapping) else {}

        def _sanitize_mode(value: Any, *, default: str) -> str:
            if isinstance(value, str):
                normalized = value.strip().lower()
                if normalized in {"manual", "auto"}:
                    return normalized
            return default

        start_mode = _sanitize_mode(
            realtime.get("start_mode"), default=_VOICE_DEFAULT_START_MODE
        )
        stop_mode = _sanitize_mode(
            realtime.get("stop_mode"), default=_VOICE_DEFAULT_STOP_MODE
        )

        tools_raw = realtime.get("tools")
        tools_mapping = tools_raw if isinstance(tools_raw, Mapping) else {}
        tools_permissions: dict[str, bool] = {}
        for key, default in _VOICE_TOOL_DEFAULTS.items():
            candidate = tools_mapping.get(key)
            if candidate is None:
                tools_permissions[key] = default
            else:
                tools_permissions[key] = _coerce_bool(candidate)

        realtime_config = {
            "start_mode": start_mode,
            "stop_mode": stop_mode,
            "tools": tools_permissions,
        }

        turn_detection_raw = realtime.get("turn_detection")
        if turn_detection_raw is False:
            pass
        elif isinstance(turn_detection_raw, Mapping):
            realtime_config["turn_detection"] = _merge_mapping(
                _VOICE_DEFAULT_TURN_DETECTION, turn_detection_raw
            )
        else:
            realtime_config["turn_detection"] = copy.deepcopy(
                _VOICE_DEFAULT_TURN_DETECTION
            )

        input_format_raw = realtime.get("input_audio_format")
        if isinstance(input_format_raw, Mapping):
            realtime_config["input_audio_format"] = _merge_mapping(
                _VOICE_DEFAULT_INPUT_AUDIO_FORMAT, input_format_raw
            )
        else:
            realtime_config["input_audio_format"] = copy.deepcopy(
                _VOICE_DEFAULT_INPUT_AUDIO_FORMAT
            )

        output_format_raw = realtime.get("output_audio_format")
        if isinstance(output_format_raw, Mapping):
            realtime_config["output_audio_format"] = _merge_mapping(
                _VOICE_DEFAULT_OUTPUT_AUDIO_FORMAT, output_format_raw
            )
        else:
            realtime_config["output_audio_format"] = copy.deepcopy(
                _VOICE_DEFAULT_OUTPUT_AUDIO_FORMAT
            )

        noise_reduction_raw = realtime.get("input_audio_noise_reduction")
        if isinstance(noise_reduction_raw, Mapping):
            realtime_config["input_audio_noise_reduction"] = _merge_mapping(
                _VOICE_DEFAULT_INPUT_AUDIO_NOISE_REDUCTION,
                noise_reduction_raw,
            )
        else:
            realtime_config["input_audio_noise_reduction"] = copy.deepcopy(
                _VOICE_DEFAULT_INPUT_AUDIO_NOISE_REDUCTION
            )

        transcription_raw = realtime.get("input_audio_transcription")
        if transcription_raw is False:
            pass
        else:
            transcription_config = _merge_mapping(
                _VOICE_DEFAULT_INPUT_AUDIO_TRANSCRIPTION,
                transcription_raw if isinstance(transcription_raw, Mapping) else {},
            )
            if instructions and not transcription_config.get("prompt"):
                transcription_config["prompt"] = instructions
            realtime_config["input_audio_transcription"] = transcription_config

        modalities_raw = realtime.get("modalities")
        if isinstance(modalities_raw, Sequence) and not isinstance(
            modalities_raw, (str, bytes, bytearray)
        ):
            sanitized_modalities: list[str] = []
            for entry in modalities_raw:
                if isinstance(entry, str):
                    candidate = entry.strip().lower()
                    if candidate and candidate not in sanitized_modalities:
                        sanitized_modalities.append(candidate)
            if "audio" not in sanitized_modalities:
                sanitized_modalities.append("audio")
            realtime_config["modalities"] = (
                sanitized_modalities or list(_VOICE_DEFAULT_MODALITIES)
            )
        else:
            realtime_config["modalities"] = list(_VOICE_DEFAULT_MODALITIES)

        speed_raw = realtime.get("speed")
        if isinstance(speed_raw, (int, float)):
            realtime_config["speed"] = float(speed_raw)
        else:
            realtime_config["speed"] = _VOICE_DEFAULT_SPEED

        tool_definitions = params.get("tools")
        sanitized_candidate = _json_safe_copy(tool_definitions)
        sanitized_tools = (
            sanitized_candidate if isinstance(sanitized_candidate, list) else []
        )

        handoffs_definitions = params.get("handoffs")
        sanitized_handoffs_candidate = _json_safe_copy(handoffs_definitions)
        sanitized_handoffs = (
            sanitized_handoffs_candidate
            if isinstance(sanitized_handoffs_candidate, list)
            else []
        )

        def _summarize_tool(entry: Any) -> dict[str, Any] | None:
            if not isinstance(entry, Mapping):
                return None
            summary: dict[str, Any] = {}
            tool_type = entry.get("type")
            if isinstance(tool_type, str) and tool_type.strip():
                summary["type"] = tool_type.strip()
            name_value = entry.get("name")
            if isinstance(name_value, str) and name_value.strip():
                summary["name"] = name_value.strip()
            title_value = entry.get("title") or entry.get("workflow_title")
            if isinstance(title_value, str) and title_value.strip():
                summary["title"] = title_value.strip()
            identifier_value = entry.get("identifier") or entry.get(
                "workflow_identifier"
            )
            if isinstance(identifier_value, str) and identifier_value.strip():
                summary["identifier"] = identifier_value.strip()
            description_value = entry.get("description")
            if isinstance(description_value, str) and description_value.strip():
                summary["description"] = description_value.strip()
            workflow_ref = entry.get("workflow")
            if isinstance(workflow_ref, Mapping):
                workflow_slug = workflow_ref.get("slug")
                if isinstance(workflow_slug, str) and workflow_slug.strip():
                    summary["workflow_slug"] = workflow_slug.strip()
                workflow_id = workflow_ref.get("id") or workflow_ref.get("workflow_id")
                if isinstance(workflow_id, int) and workflow_id > 0:
                    summary["workflow_id"] = workflow_id
            return summary or None

        tool_metadata = [
            summary
            for summary in (_summarize_tool(entry) for entry in sanitized_tools)
            if summary
        ]

        voice_context = {
            "model": voice_model,
            "voice": voice_id,
            "instructions": instructions,
            "realtime": realtime_config,
            "tools": sanitized_tools,
        }
        if sanitized_handoffs:
            voice_context["handoffs"] = sanitized_handoffs
        if provider_id:
            voice_context["model_provider_id"] = provider_id
        if provider_slug:
            voice_context["model_provider_slug"] = provider_slug
        if tool_metadata:
            voice_context["tool_metadata"] = tool_metadata
        prompt_variables: dict[str, str] = {}
        if overrides is not None and overrides.prompt_variables:
            prompt_variables = dict(overrides.prompt_variables)
        if prompt_variables:
            voice_context["prompt_variables"] = prompt_variables

        event_context = {
            "model": voice_model,
            "voice": voice_id,
            "instructions": instructions,
            "realtime": realtime_config,
            "tools": sanitized_tools,
            "tool_definitions": sanitized_tools,
        }
        if sanitized_handoffs:
            event_context["handoffs"] = sanitized_handoffs
        if provider_id:
            event_context["model_provider_id"] = provider_id
        if provider_slug:
            event_context["model_provider_slug"] = provider_slug
        if tool_metadata:
            event_context["tool_metadata"] = tool_metadata
        if prompt_variables:
            event_context["prompt_variables"] = prompt_variables

        return voice_context, event_context

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
        *,
        provider_binding: AgentProviderBinding | None = None,
    ) -> RunConfig:
        metadata: dict[str, str] = {"__trace_source__": "agent-builder"}
        if definition.workflow_id is not None:
            metadata["workflow_db_id"] = str(definition.workflow_id)
        if definition.workflow and definition.workflow.slug:
            metadata["workflow_slug"] = definition.workflow.slug
        if definition.workflow and definition.workflow.display_name:
            metadata["workflow_name"] = definition.workflow.display_name
        kwargs: dict[str, Any] = {"trace_metadata": metadata}
        if provider_binding is not None:
            kwargs["model_provider"] = provider_binding.provider
        try:
            if response_format is not None:
                return RunConfig(response_format=response_format, **kwargs)
        except TypeError:
            logger.debug(
                "RunConfig ne supporte pas response_format, utilisation de la "
                "configuration par défaut"
            )
        return RunConfig(**kwargs)

    async def record_step(step_key: str, title: str, payload: Any) -> None:
        summary = _format_step_summary(step_key, title, payload)
        print(
            "[Workflow] Payload envoyé pour l'étape "
            f"{summary.key} ({summary.title}) :\n{summary.output}"
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
                await _emit_stream_event(event)
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

        await _emit_step_stream(
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
        if isinstance(run_context, WorkflowAgentRunContext):
            runner_context = run_context
        else:
            runner_context = WorkflowAgentRunContext(
                agent_context=agent_context,
                step_context=run_context if isinstance(run_context, Mapping) else None,
            )

        provider_binding = agent_provider_bindings.get(current_slug)
        model_capabilities = agent_model_capabilities.get(current_slug)

        should_strip_reasoning_summary = False
        provider_slug: str | None = None
        if provider_binding is not None:
            provider_slug = (provider_binding.provider_slug or "").lower()
            if provider_slug == "groq":
                should_strip_reasoning_summary = True

        if (
            model_capabilities is not None
            and not model_capabilities.supports_reasoning_summary
        ):
            should_strip_reasoning_summary = True

        if should_strip_reasoning_summary:
            try:
                agent.model_settings = sanitize_model_like(
                    agent.model_settings, allow_reasoning_summary=False
                )
            except Exception:
                logger.debug(
                    "Impossible de nettoyer reasoning.summary pour le modèle %s",
                    getattr(agent, "name", "<inconnu>"),
                    exc_info=True,
                )

        # Connecter les serveurs MCP si présents AVANT de démarrer l'agent
        mcp_servers = getattr(agent, "mcp_servers", None)
        connected_mcp_servers: list[MCPServer] = []
        if mcp_servers:
            for server in mcp_servers:
                if isinstance(server, MCPServer):
                    try:
                        await server.connect()
                        connected_mcp_servers.append(server)
                        logger.debug(
                            "Serveur MCP %s connecté pour l'agent %s",
                            getattr(server, "name", "<inconnu>"),
                            getattr(agent, "name", "<inconnu>"),
                        )
                    except Exception as exc:
                        logger.warning(
                            "Impossible de connecter le serveur MCP %s : %s",
                            getattr(server, "name", "<inconnu>"),
                            exc,
                            exc_info=True,
                        )

            # Mettre à jour agent.mcp_servers pour ne garder que les serveurs connectés
            if connected_mcp_servers:
                try:
                    agent.mcp_servers = connected_mcp_servers
                    logger.debug(
                        "%d serveur(s) MCP connecté(s) sur %d configuré(s) "
                        "pour l'agent %s",
                        len(connected_mcp_servers),
                        len(mcp_servers),
                        getattr(agent, "name", "<inconnu>"),
                    )
                except Exception as exc:
                    logger.warning(
                        "Impossible de mettre à jour agent.mcp_servers : %s",
                        exc,
                    )
            else:
                # Aucun serveur connecté, vider la liste
                try:
                    agent.mcp_servers = []
                    logger.warning(
                        "Aucun serveur MCP n'a pu se connecter pour l'agent %s",
                        getattr(agent, "name", "<inconnu>"),
                    )
                except Exception as exc:
                    logger.warning(
                        "Impossible de vider agent.mcp_servers : %s",
                        exc,
                    )

        conversation_history_input = _normalize_conversation_history_for_provider(
            conversation_history,
            provider_slug,
        )

        try:
            result = Runner.run_streamed(
                agent,
                input=[*conversation_history_input],
                run_config=_workflow_run_config(
                    response_format_override, provider_binding=provider_binding
                ),
                context=runner_context,
                previous_response_id=(
                    None
                    if model_capabilities is not None
                    and not model_capabilities.supports_previous_response_id
                    else getattr(agent_context, "previous_response_id", None)
                ),
            )
            try:
                async for event in stream_agent_response(agent_context, result):
                    logger.debug(
                        "Évènement %s reçu pour l'étape %s",
                        getattr(event, "type", type(event).__name__),
                        metadata_for_images.get("step_slug"),
                    )
                    if _should_forward_agent_event(
                        event, suppress=suppress_stream_events
                    ):
                        await _emit_stream_event(event)
                    delta_text = _extract_delta(event)
                    if delta_text:
                        accumulated_text += delta_text
                        await _emit_step_stream(
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

            last_response_id = getattr(result, "last_response_id", None)
            if last_response_id is not None and (
                model_capabilities is None
                or model_capabilities.supports_previous_response_id
            ):
                agent_context.previous_response_id = last_response_id
                thread_metadata = getattr(agent_context, "thread", None)
                should_persist_thread = False
                if thread_metadata is not None:
                    existing_metadata = getattr(thread_metadata, "metadata", None)
                    if isinstance(existing_metadata, Mapping):
                        stored_response_id = existing_metadata.get(
                            "previous_response_id"
                        )
                        if stored_response_id != last_response_id:
                            existing_metadata["previous_response_id"] = last_response_id
                            should_persist_thread = True
                    else:
                        thread_metadata.metadata = {
                            "previous_response_id": last_response_id
                        }
                        should_persist_thread = True

                store = getattr(agent_context, "store", None)
                request_context = getattr(agent_context, "request_context", None)
                if (
                    should_persist_thread
                    and store is not None
                    and request_context is not None
                    and hasattr(store, "save_thread")
                ):
                    try:
                        await store.save_thread(  # type: ignore[arg-type]
                            thread_metadata,
                            context=request_context,
                        )
                    # pragma: no cover - persistance best effort
                    except Exception as exc:
                        logger.warning(
                            (
                                "Impossible d'enregistrer previous_response_id "
                                "pour le fil %s"
                            ),
                            getattr(
                                thread_metadata,
                                "id",
                                "<inconnu>",
                            ),
                            exc_info=exc,
                        )

            conversation_history.extend(
                [item.to_input_item() for item in result.new_items]
            )
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
        finally:
            # Déconnecter les serveurs MCP
            for server in connected_mcp_servers:
                try:
                    await server.cleanup()
                    logger.debug(
                        "Serveur MCP %s nettoyé pour l'agent %s",
                        getattr(server, "name", "<inconnu>"),
                        getattr(agent, "name", "<inconnu>"),
                    )
                except Exception as exc:
                    logger.warning(
                        "Erreur lors du nettoyage du serveur MCP %s : %s",
                        getattr(server, "name", "<inconnu>"),
                        exc,
                    )

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

    async def _run_parallel_split(step: WorkflowStep) -> str:
        nonlocal last_step_context
        params = step.parameters or {}
        join_slug_raw = params.get("join_slug")
        if not isinstance(join_slug_raw, str) or not join_slug_raw.strip():
            raise WorkflowExecutionError(
                step.slug,
                _node_title(step) or step.slug,
                RuntimeError("Parallel split sans jointure associée."),
                list(steps),
            )

        join_slug = join_slug_raw.strip()
        if join_slug not in nodes_by_slug:
            raise WorkflowExecutionError(
                step.slug,
                _node_title(step) or step.slug,
                RuntimeError(f"Nœud de jointure {join_slug} introuvable."),
                list(steps),
            )

        outgoing = edges_by_source.get(step.slug, [])
        if len(outgoing) < 2:
            raise WorkflowExecutionError(
                step.slug,
                _node_title(step) or step.slug,
                RuntimeError("Parallel split sans branches sortantes suffisantes."),
                list(steps),
            )

        branches_metadata: dict[str, str | None] = {}
        raw_branches = params.get("branches")
        if isinstance(raw_branches, Sequence):
            for entry in raw_branches:
                if isinstance(entry, Mapping):
                    slug_value = entry.get("slug")
                    if isinstance(slug_value, str) and slug_value.strip():
                        label_value = entry.get("label")
                        branches_metadata[slug_value.strip()] = (
                            label_value.strip()
                            if isinstance(label_value, str) and label_value.strip()
                            else None
                        )

        async def _execute_branch(
            edge: WorkflowTransition,
        ) -> tuple[str, dict[str, Any], list[WorkflowStepSummary]]:
            branch_slug = edge.target_step.slug
            branch_label = branches_metadata.get(branch_slug)
            branch_steps: list[WorkflowStepSummary] = []
            branch_snapshot = WorkflowRuntimeSnapshot(
                state=copy.deepcopy(state),
                conversation_history=copy.deepcopy(conversation_history),
                last_step_context=(
                    copy.deepcopy(last_step_context)
                    if last_step_context is not None
                    else None
                ),
                steps=branch_steps,
                current_slug=branch_slug,
                stop_at_slug=join_slug,
                branch_id=branch_slug,
                branch_label=branch_label,
            )

            branch_summary = await run_workflow(
                workflow_input,
                agent_context=agent_context,
                on_step=None,
                on_step_stream=on_step_stream,
                on_stream_event=on_stream_event,
                on_widget_step=on_widget_step,
                workflow_service=workflow_service,
                workflow_definition=definition,
                workflow_slug=workflow_slug,
                thread_item_converter=None,
                thread_items_history=None,
                current_user_message=current_user_message,
                workflow_call_stack=workflow_call_stack,
                runtime_snapshot=branch_snapshot,
            )

            branch_payload: dict[str, Any] = {
                "label": branch_label,
                "final_output": copy.deepcopy(branch_summary.final_output),
                "last_context": copy.deepcopy(branch_summary.last_context),
                "state": copy.deepcopy(branch_summary.state),
                "final_node_slug": branch_summary.final_node_slug,
                "steps": [
                    {
                        "key": summary.key,
                        "title": summary.title,
                        "output": summary.output,
                    }
                    for summary in branch_steps
                ],
            }

            return branch_slug, branch_payload, branch_steps

        branch_tasks = [
            asyncio.create_task(_execute_branch(edge)) for edge in outgoing
        ]
        branch_results = await asyncio.gather(*branch_tasks)

        branches_payload: dict[str, Any] = {}
        branch_step_collections: list[list[WorkflowStepSummary]] = []
        for slug, payload, branch_steps in branch_results:
            branches_payload[slug] = payload
            branch_step_collections.append(branch_steps)

        parallel_payload = {
            "split_slug": step.slug,
            "join_slug": join_slug,
            "branches": branches_payload,
        }

        existing_parallel = state.get("parallel_outputs")
        if isinstance(existing_parallel, Mapping):
            updated_parallel = dict(existing_parallel)
        else:
            updated_parallel = {}
        updated_parallel[join_slug] = copy.deepcopy(parallel_payload)
        state["parallel_outputs"] = updated_parallel

        title = _node_title(step)
        await record_step(step.slug, title, parallel_payload)

        for branch_steps in branch_step_collections:
            for summary in branch_steps:
                steps.append(summary)
                if on_step is not None:
                    await on_step(summary, len(steps))

        last_context_payload: dict[str, Any] = {
            "parallel_split": parallel_payload,
            "output": parallel_payload,
            "output_structured": parallel_payload,
            "output_parsed": parallel_payload,
            "output_text": json.dumps(parallel_payload, ensure_ascii=False),
        }

        last_step_context = last_context_payload

        return join_slug

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

    if runtime_snapshot is not None:
        current_slug = runtime_snapshot.current_slug
    else:
        current_slug = resume_from_wait_slug or start_step.slug
    final_node_slug: str | None = None
    final_end_state: WorkflowEndState | None = None
    guard = 0
    while guard < 1000:
        guard += 1
        if stop_at_slug is not None and current_slug == stop_at_slug:
            final_node_slug = current_slug
            break
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
                await _emit_stream_event(
                    ThreadItemDoneEvent(item=assistant_message)
                )

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
                await _emit_stream_event(ThreadItemAddedEvent(item=assistant_message))
                await _emit_stream_event(ThreadItemDoneEvent(item=assistant_message))

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

        if current_node.kind == "voice_agent":
            title = _node_title(current_node)
            try:
                voice_context, event_context = _resolve_voice_agent_configuration(
                    current_node,
                    overrides=voice_overrides,
                )
            except Exception as exc:
                raise_step_error(current_node.slug, title or current_node.slug, exc)

            voice_wait_state: Mapping[str, Any] | None = None
            if (
                pending_wait_state
                and pending_wait_state.get("slug") == current_node.slug
            ):
                voice_wait_state = pending_wait_state

            transcripts_payload = None
            if voice_wait_state is not None:
                stored_session_context = voice_wait_state.get("voice_session")
                if isinstance(stored_session_context, Mapping):
                    for key, value in stored_session_context.items():
                        if key not in voice_context or not voice_context[key]:
                            voice_context[key] = value
                transcripts_payload = voice_wait_state.get("voice_transcripts")
                if not transcripts_payload:
                    final_end_state = WorkflowEndState(
                        slug=current_node.slug,
                        status_type="waiting",
                        status_reason="En attente des transcriptions vocales.",
                        message="En attente des transcriptions vocales.",
                    )
                    break

                status_info = voice_wait_state.get("voice_session_status")
                if isinstance(status_info, Mapping):
                    voice_context["session_status"] = dict(status_info)

            if transcripts_payload is not None:
                normalized_transcripts: list[dict[str, Any]] = []

                is_sequence = isinstance(transcripts_payload, Sequence)
                is_textual = isinstance(
                    transcripts_payload, str | bytes | bytearray
                )
                iterable = (
                    transcripts_payload if is_sequence and not is_textual else []
                )

                # Vérifier si les messages ont déjà été créés (via l'endpoint
                # /transcripts). Si oui, ne pas les créer à nouveau pour éviter
                # les doublons.
                voice_messages_created = voice_wait_state.get(
                    "voice_messages_created", False
                )

                for entry in iterable:
                    if not isinstance(entry, Mapping):
                        continue
                    role_raw = entry.get("role")
                    if not isinstance(role_raw, str):
                        continue
                    normalized_role = role_raw.strip().lower()
                    if normalized_role not in {"user", "assistant"}:
                        continue
                    text_raw = entry.get("text")
                    if not isinstance(text_raw, str):
                        continue
                    text_value = text_raw.strip()
                    if not text_value:
                        continue
                    transcript_entry: dict[str, Any] = {
                        "role": normalized_role,
                        "text": text_value,
                    }
                    status_raw = entry.get("status")
                    if isinstance(status_raw, str) and status_raw.strip():
                        transcript_entry["status"] = status_raw.strip()
                    normalized_transcripts.append(transcript_entry)

                    if normalized_role == "user":
                        conversation_history.append(
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "input_text",
                                        "text": text_value,
                                    }
                                ],
                            }
                        )
                        # Ne créer le message que s'il n'a pas déjà été ajouté au thread
                        if (
                            not voice_messages_created
                            and on_stream_event is not None
                            and agent_context.thread is not None
                        ):
                            user_item = UserMessageItem(
                                id=agent_context.generate_id("message"),
                                thread_id=agent_context.thread.id,
                                created_at=datetime.now(),
                                content=[UserMessageTextContent(text=text_value)],
                                attachments=[],
                                quoted_text=None,
                                inference_options=InferenceOptions(),
                            )
                            await _emit_stream_event(
                                ThreadItemAddedEvent(item=user_item)
                            )
                            await _emit_stream_event(
                                ThreadItemDoneEvent(item=user_item)
                            )
                    else:
                        conversation_history.append(
                            {
                                "role": "assistant",
                                "content": [
                                    {
                                        "type": "output_text",
                                        "text": text_value,
                                    }
                                ],
                            }
                        )
                        # Ne créer le message que s'il n'a pas déjà été ajouté au thread
                        if (
                            not voice_messages_created
                            and on_stream_event is not None
                            and agent_context.thread is not None
                        ):
                            assistant_item = AssistantMessageItem(
                                id=agent_context.generate_id("message"),
                                thread_id=agent_context.thread.id,
                                created_at=datetime.now(),
                                content=[AssistantMessageContent(text=text_value)],
                            )
                            await _emit_stream_event(
                                ThreadItemAddedEvent(item=assistant_item)
                            )
                            await _emit_stream_event(
                                ThreadItemDoneEvent(item=assistant_item)
                            )

                if not normalized_transcripts:
                    final_end_state = WorkflowEndState(
                        slug=current_node.slug,
                        status_type="waiting",
                        status_reason="En attente des transcriptions vocales.",
                        message="En attente des transcriptions vocales.",
                    )
                    break

                step_output = {"transcripts": normalized_transcripts}
                output_text = "\n\n".join(
                    f"{entry['role']}: {entry['text']}"
                    for entry in normalized_transcripts
                )
                last_step_context = {
                    "voice_transcripts": normalized_transcripts,
                    "voice_session": voice_context,
                    "output": step_output,
                    "output_parsed": step_output,
                    "output_structured": step_output,
                    "output_text": output_text,
                }
                agent_key = current_node.agent_key or current_node.slug
                state["last_voice_session"] = voice_context
                state["last_voice_transcripts"] = normalized_transcripts
                state["last_agent_key"] = agent_key
                state["last_agent_output"] = step_output
                state["last_agent_output_text"] = output_text
                state["last_agent_output_structured"] = step_output
                state.pop("voice_session_active", None)

                session_identifier = voice_context.get("session_id")
                if not session_identifier:
                    stored_session = voice_wait_state.get("voice_session")
                    if isinstance(stored_session, Mapping):
                        session_identifier = stored_session.get("session_id")
                if not session_identifier:
                    stored_event = voice_wait_state.get("voice_event")
                    if isinstance(stored_event, Mapping):
                        event_payload = stored_event.get("event")
                        if isinstance(event_payload, Mapping):
                            session_identifier = event_payload.get("session_id")

                if session_identifier:
                    try:
                        await close_voice_session(
                            session_id=str(session_identifier)
                        )
                    except Exception as exc:  # pragma: no cover - nettoyage best effort
                        logger.debug(
                            "Impossible de fermer la session Realtime %s : %s",
                            voice_context.get("session_id"),
                            exc,
                        )

                await record_step(current_node.slug, title, step_output)

                await ingest_workflow_step(
                    config=(current_node.parameters or {}).get(
                        "vector_store_ingestion"
                    ),
                    step_slug=_branch_prefixed_slug(current_node.slug),
                    step_title=title,
                    step_context=last_step_context,
                    state=state,
                    default_input_context=last_step_context,
                    session_factory=SessionLocal,
                )

                if thread is not None:
                    _set_wait_state_metadata(thread, None)
                pending_wait_state = None

                transition = _next_edge(current_slug)
                if transition is None:
                    break
                current_slug = transition.target_step.slug
                continue

            request_context = getattr(agent_context, "request_context", None)
            user_id = None
            if request_context is not None:
                user_id = getattr(request_context, "user_id", None)
            if not isinstance(user_id, str) or not user_id.strip():
                thread_meta = getattr(agent_context, "thread", None)
                fallback_id = getattr(thread_meta, "id", None)
                user_id = str(fallback_id or "voice-user")

            metadata_payload: dict[str, Any] = {
                "step_slug": current_node.slug,
            }
            thread_meta = getattr(agent_context, "thread", None)
            if thread_meta is not None and getattr(thread_meta, "id", None):
                metadata_payload["thread_id"] = thread_meta.id
            if title:
                metadata_payload["step_title"] = title
            realtime_config = event_context.get("realtime")
            if isinstance(realtime_config, Mapping):
                tool_permissions = realtime_config.get("tools")
                if isinstance(tool_permissions, Mapping):
                    metadata_payload["tool_permissions"] = dict(tool_permissions)

            try:
                session_handle = await open_voice_session(
                    user_id=user_id,
                    model=event_context["model"],
                    voice=event_context.get("voice"),
                    instructions=event_context["instructions"],
                    provider_id=event_context.get("model_provider_id"),
                    provider_slug=event_context.get("model_provider_slug"),
                    realtime=event_context.get("realtime"),
                    tools=event_context.get("tools"),
                    handoffs=event_context.get("handoffs"),
                    metadata=metadata_payload,
                )
            except Exception as exc:
                raise_step_error(current_node.slug, title or current_node.slug, exc)

            realtime_secret = session_handle.payload
            voice_context["session_id"] = session_handle.session_id
            voice_context["client_secret"] = realtime_secret
            event_context["session_id"] = session_handle.session_id

            realtime_event = {
                "type": "realtime.event",
                "step": {"slug": current_node.slug, "title": title},
                "event": {
                    "type": "history",
                    "session_id": session_handle.session_id,
                    "session": event_context,
                    "client_secret": realtime_secret,
                    "tool_permissions": event_context["realtime"]["tools"],
                },
            }

            if on_stream_event is not None and agent_context.thread is not None:
                task_item = TaskItem(
                    id=agent_context.generate_id("task"),
                    thread_id=agent_context.thread.id,
                    created_at=datetime.now(),
                    task=CustomTask(
                        title=title,
                        content=json.dumps(realtime_event, ensure_ascii=False),
                    ),
                )
                await _emit_stream_event(ThreadItemAddedEvent(item=task_item))
                await _emit_stream_event(ThreadItemDoneEvent(item=task_item))

            step_payload = {
                "status": "waiting_for_voice",
                "voice_session": voice_context,
            }
            await record_step(current_node.slug, title, step_payload)

            last_step_context = {"voice_session": voice_context}
            state["voice_session_active"] = True
            state["last_voice_session"] = voice_context

            wait_state_payload: dict[str, Any] = {
                "slug": current_node.slug,
                "input_item_id": current_input_item_id,
                "type": "voice",
                # Stocker l'événement pour que le frontend puisse le récupérer.
                "voice_event": realtime_event,
            }
            conversation_snapshot = _clone_conversation_history_snapshot(
                conversation_history
            )
            if conversation_snapshot:
                wait_state_payload["conversation_history"] = conversation_snapshot
            wait_state_payload["state"] = _json_safe_copy(state)

            transition = _next_edge(current_slug)
            if transition is not None:
                wait_state_payload["next_step_slug"] = transition.target_step.slug
            if thread is not None:
                _set_wait_state_metadata(thread, wait_state_payload)

            final_end_state = WorkflowEndState(
                slug=current_node.slug,
                status_type="waiting",
                status_reason="Session vocale en cours",
                message="Session vocale en cours",
            )
            break

        if current_node.kind == "outbound_call":
            from ..telephony.outbound_call_manager import get_outbound_call_manager
            from ..models import SipAccount

            title = _node_title(current_node)
            params = current_node.parameters or {}

            # Résoudre le numéro à appeler (peut être une variable)
            to_number_raw = params.get("to_number", "")
            # Pour l'instant, utilise directement la valeur
            # TODO: Implémenter la résolution de templates {{state.phone_number}}
            to_number = to_number_raw

            # Récupérer les paramètres
            voice_workflow_id = params.get("voice_workflow_id")
            sip_account_id = params.get("sip_account_id")
            wait_for_completion = params.get("wait_for_completion", True)

            # Validation
            if not to_number or not isinstance(to_number, str):
                raise WorkflowExecutionError(
                    "configuration",
                    f"Numéro de téléphone invalide: {to_number}",
                    step=current_node.slug,
                    steps=list(steps),
                )

            if not voice_workflow_id:
                raise WorkflowExecutionError(
                    "configuration",
                    "voice_workflow_id est requis pour un appel sortant",
                    step=current_node.slug,
                    steps=list(steps),
                )

            # Résoudre le workflow vocal vers sa définition active
            if isinstance(voice_workflow_id, str):
                if voice_workflow_id.isdigit():
                    voice_workflow_id_value = int(voice_workflow_id)
                else:
                    voice_workflow_id_value = voice_workflow_id
            else:
                voice_workflow_id_value = voice_workflow_id

            session_factory = getattr(service, "_session_factory", None)
            if callable(session_factory):
                database_session = session_factory()
            else:
                database_session = SessionLocal()
            close_session_immediately = True

            try:
                resolved_voice_definition: WorkflowDefinition | None = None
                if database_session:
                    if isinstance(voice_workflow_id_value, int):
                        resolved_voice_definition = database_session.get(
                            WorkflowDefinition, voice_workflow_id_value
                        )
                        if resolved_voice_definition is None:
                            workflow_entry = database_session.get(
                                Workflow, voice_workflow_id_value
                            )
                            if (
                                workflow_entry
                                and workflow_entry.active_version_id is not None
                            ):
                                resolved_voice_definition = database_session.get(
                                    WorkflowDefinition,
                                    workflow_entry.active_version_id,
                                )
                    elif isinstance(voice_workflow_id_value, str):
                        workflow_entry = (
                            database_session.query(Workflow)
                            .filter(Workflow.slug == voice_workflow_id_value)
                            .first()
                        )
                        if (
                            workflow_entry
                            and workflow_entry.active_version_id is not None
                        ):
                            resolved_voice_definition = database_session.get(
                                WorkflowDefinition,
                                workflow_entry.active_version_id,
                            )

                if resolved_voice_definition is None:
                    raise WorkflowExecutionError(
                        "configuration",
                        "Workflow vocal introuvable ou sans version active",
                        step=current_node.slug,
                        steps=list(steps),
                    )

                # Récupérer le compte SIP (ou utiliser le défaut)
                if not sip_account_id and database_session:
                    default_account = database_session.query(SipAccount).filter_by(
                        is_default=True, is_active=True
                    ).first()
                    if default_account:
                        sip_account_id = default_account.id

                if not sip_account_id:
                    raise WorkflowExecutionError(
                        "configuration",
                        "Aucun compte SIP configuré pour les appels sortants",
                        step=current_node.slug,
                        steps=list(steps),
                    )

                # Récupérer from_number depuis le compte SIP
                if database_session:
                    sip_account = database_session.query(SipAccount).filter_by(
                        id=sip_account_id
                    ).first()
                    from_number = sip_account.contact_host if sip_account else "unknown"
                else:
                    from_number = "unknown"

                # Préparer les métadonnées
                metadata = {
                    "triggered_by_workflow_id": (
                        workflow_definition.id if workflow_definition else None
                    ),
                    "triggered_by_session_id": (
                        agent_context.thread.id if agent_context else None
                    ),
                    "trigger_node_slug": current_node.slug,
                    "trigger_context": params.get("metadata", {}),
                }

                # Initier l'appel
                outbound_manager = get_outbound_call_manager()
                if not database_session:
                    raise WorkflowExecutionError(
                        "configuration",
                        "Session de base de données non disponible",
                        step=current_node.slug,
                        steps=list(steps),
                    )

                call_session = await outbound_manager.initiate_call(
                    db=database_session,
                    to_number=to_number,
                    from_number=from_number,
                    workflow_id=resolved_voice_definition.id,
                    sip_account_id=sip_account_id,
                    metadata=metadata,
                )

                await record_step(
                    current_node.slug,
                    title,
                    f"Appel sortant vers {to_number}",
                )

                # Attendre la fin de l'appel si demandé
                if wait_for_completion:
                    logger.info(
                        "Attente de la fin de l'appel sortant %s",
                        call_session.call_id,
                    )
                    await call_session.wait_until_complete()

                    # Récupérer le résultat de l'appel
                    call_result = await outbound_manager.get_call_status(
                        database_session, call_session.call_id
                    )

                    if call_result:
                        last_step_context = {
                            "outbound_call": {
                                "call_id": call_result["call_id"],
                                "call_status": call_result["status"],
                                "answered": call_result["status"] == "completed",
                                "duration_seconds": call_result.get("duration_seconds"),
                                "to_number": to_number,
                            }
                        }
                    else:
                        last_step_context = {
                            "outbound_call": {
                                "call_id": call_session.call_id,
                                "call_status": "unknown",
                                "answered": False,
                                "to_number": to_number,
                            }
                        }
                else:
                    # Mode fire-and-forget
                    close_session_immediately = False

                    async def _close_session_when_call_finishes(
                        session: Any, outbound_session: Any
                    ) -> None:
                        try:
                            await outbound_session.wait_until_complete()
                        finally:
                            session.close()

                    asyncio.create_task(
                        _close_session_when_call_finishes(
                            database_session,
                            call_session,
                        )
                    )
                    last_step_context = {
                        "outbound_call": {
                            "call_id": call_session.call_id,
                            "call_status": "initiated",
                            "to_number": to_number,
                        }
                    }

            except Exception as exc:
                logger.error(
                    "Erreur lors de l'appel sortant vers %s: %s",
                    to_number,
                    exc,
                )
                raise_step_error(current_node.slug, title, exc)
            finally:
                if close_session_immediately and database_session is not None:
                    database_session.close()

            transition = _next_edge(current_slug)
            if transition is None:
                if _fallback_to_start("outbound_call", current_node.slug):
                    continue
                break
            current_slug = transition.target_step.slug
            continue

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
                    await _emit_stream_event(
                        ThreadItemAddedEvent(item=assistant_message)
                    )
                    await _emit_stream_event(
                        ThreadItemDoneEvent(item=assistant_message)
                    )

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
                await _emit_stream_event(ThreadItemAddedEvent(item=user_item))
                await _emit_stream_event(ThreadItemDoneEvent(item=user_item))

            transition = _next_edge(current_slug)
            if transition is None:
                if _fallback_to_start("user_message", current_node.slug):
                    continue
                break
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "parallel_split":
            join_slug = await _run_parallel_split(current_node)
            current_slug = join_slug
            continue

        if current_node.kind == "parallel_join":
            title = _node_title(current_node)
            parallel_map = state.get("parallel_outputs")
            join_payload: Mapping[str, Any] | None = None
            if isinstance(parallel_map, Mapping):
                candidate = parallel_map.get(current_node.slug)
                if isinstance(candidate, Mapping):
                    join_payload = candidate

            sanitized_join_payload = (
                copy.deepcopy(dict(join_payload)) if join_payload is not None else {}
            )

            await record_step(current_node.slug, title, sanitized_join_payload)

            join_context = {
                "parallel_join": sanitized_join_payload,
                "output": sanitized_join_payload,
                "output_structured": sanitized_join_payload,
                "output_parsed": sanitized_join_payload,
                "output_text": json.dumps(
                    sanitized_join_payload, ensure_ascii=False
                ),
            }
            last_step_context = join_context

            if isinstance(parallel_map, Mapping):
                updated_parallel = dict(parallel_map)
                updated_parallel.pop(current_node.slug, None)
                if updated_parallel:
                    state["parallel_outputs"] = updated_parallel
                else:
                    state.pop("parallel_outputs", None)

            transition = _next_edge(current_slug)
            if transition is None:
                if _fallback_to_start(current_node.kind, current_node.slug):
                    continue
                break
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "json_vector_store":
            title = _node_title(current_node)
            await ingest_workflow_step(
                config=current_node.parameters or {},
                step_slug=_branch_prefixed_slug(current_node.slug),
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
                    step_slug=_branch_prefixed_slug(current_node.slug),
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

        if (
            current_node.kind in AGENT_NODE_KINDS
            and current_node.slug in nested_workflow_configs
        ):
            title = _node_title(current_node)
            widget_config = widget_configs_by_step.get(current_node.slug)
            reference = nested_workflow_configs[current_node.slug]

            try:
                nested_definition = _load_nested_workflow_definition(reference)
            except Exception as exc:  # pragma: no cover - accès base de données
                raise_step_error(current_node.slug, title or current_node.slug, exc)

            nested_identifiers: list[tuple[str, str | int]] = []
            nested_workflow_id = getattr(nested_definition, "workflow_id", None)
            if isinstance(nested_workflow_id, int) and nested_workflow_id > 0:
                nested_identifiers.append(("id", nested_workflow_id))
            nested_workflow_slug_raw = getattr(
                getattr(nested_definition, "workflow", None), "slug", None
            )
            normalized_nested_slug: str | None = None
            if (
                isinstance(nested_workflow_slug_raw, str)
                and nested_workflow_slug_raw.strip()
            ):
                normalized_nested_slug = nested_workflow_slug_raw.strip().lower()
                nested_identifiers.append(("slug", normalized_nested_slug))

            for identifier in nested_identifiers:
                if identifier in workflow_call_stack:
                    raise_step_error(
                        current_node.slug,
                        title or current_node.slug,
                        RuntimeError("Cycle de workflow imbriqué détecté."),
                    )

            nested_call_stack = workflow_call_stack + tuple(
                identifier
                for identifier in nested_identifiers
                if identifier not in workflow_call_stack
            )

            try:
                nested_summary = await run_workflow(
                    workflow_input,
                    agent_context=agent_context,
                    on_step=on_step,
                    on_step_stream=on_step_stream,
                    on_stream_event=on_stream_event,
                    on_widget_step=on_widget_step,
                    workflow_service=service,
                    workflow_definition=nested_definition,
                    workflow_call_stack=nested_call_stack,
                    thread_item_converter=thread_item_converter,
                    thread_items_history=thread_items_history,
                    current_user_message=current_user_message,
                )
            except WorkflowExecutionError as exc:
                raise_step_error(current_node.slug, title or current_node.slug, exc)
            except Exception as exc:  # pragma: no cover - garde défensive
                raise_step_error(current_node.slug, title or current_node.slug, exc)

            if nested_summary.steps:
                steps.extend(nested_summary.steps)

            nested_history = _clone_conversation_history_snapshot(
                (nested_summary.state or {}).get("conversation_history")
            )
            if nested_history:
                conversation_history.extend(nested_history)

            nested_context = dict(nested_summary.last_context or {})
            display_payload = _resolve_watch_payload(
                nested_context, nested_summary.steps
            )
            output_candidate = nested_context.get("output")
            if output_candidate is None:
                output_candidate = nested_summary.final_output
            if output_candidate is None:
                output_candidate = display_payload
            parsed, text_output = _structured_output_as_json(
                output_candidate if output_candidate is not None else ""
            )
            generated_urls_raw = nested_context.get("generated_image_urls")
            sanitized_image_urls = (
                [url for url in generated_urls_raw if isinstance(url, str)]
                if isinstance(generated_urls_raw, list)
                else []
            )
            output_text = append_generated_image_links(
                text_output, sanitized_image_urls
            )

            nested_context.setdefault("output", output_candidate)
            nested_context.setdefault("output_parsed", parsed)
            nested_context.setdefault("output_structured", parsed)
            nested_context["output_text"] = output_text
            if sanitized_image_urls:
                nested_context["generated_image_urls"] = sanitized_image_urls

            workflow_key = normalized_nested_slug or nested_workflow_id
            workflow_identifier = (
                f"workflow:{workflow_key}"
                if workflow_key is not None
                else current_node.slug
            )
            nested_context.setdefault("agent_key", workflow_identifier)
            last_step_context = nested_context

            state["last_agent_key"] = workflow_identifier
            state["last_agent_output"] = last_step_context.get("output")
            state["last_agent_output_text"] = last_step_context.get("output_text")
            structured_candidate = last_step_context.get("output_structured")
            if hasattr(structured_candidate, "model_dump"):
                try:
                    structured_candidate = structured_candidate.model_dump(
                        by_alias=True
                    )
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

            if output_text.strip():
                should_append_output_text = True
                if conversation_history:
                    last_entry = conversation_history[-1]
                    if (
                        isinstance(last_entry, Mapping)
                        and last_entry.get("role") == "assistant"
                    ):
                        contents = last_entry.get("content")
                        if isinstance(contents, Sequence):
                            for content_item in contents:
                                if not isinstance(content_item, Mapping):
                                    continue
                                text_value = content_item.get("text")
                                if (
                                    isinstance(text_value, str)
                                    and text_value.strip() == output_text.strip()
                                ):
                                    should_append_output_text = False
                                    break
                if should_append_output_text:
                    conversation_history.append(
                        {
                            "role": "assistant",
                            "content": [
                                {"type": "output_text", "text": output_text.strip()},
                            ],
                        }
                    )

            workflow_payload: dict[str, Any] = {
                "id": nested_workflow_id,
                "slug": nested_workflow_slug_raw,
                "version_id": getattr(nested_definition, "id", None),
                "version": getattr(nested_definition, "version", None),
            }
            if nested_summary.end_state is not None:
                workflow_payload["end_state"] = {
                    "slug": nested_summary.end_state.slug,
                    "status_type": nested_summary.end_state.status_type,
                    "status_reason": nested_summary.end_state.status_reason,
                    "message": nested_summary.end_state.message,
                }

            last_step_context.setdefault("workflow", workflow_payload)

            await record_step(
                current_node.slug,
                title,
                {
                    "workflow": workflow_payload,
                    "output": last_step_context.get("output"),
                },
            )

            await ingest_workflow_step(
                config=(current_node.parameters or {}).get("vector_store_ingestion"),
                step_slug=_branch_prefixed_slug(current_node.slug),
                step_title=title,
                step_context=last_step_context,
                state=state,
                default_input_context=last_step_context,
                session_factory=SessionLocal,
            )

            if widget_config is not None:
                rendered_widget = await _stream_response_widget(
                    widget_config,
                    step_slug=_branch_prefixed_slug(current_node.slug),
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

            if nested_summary.end_state is not None:
                final_end_state = nested_summary.end_state
                if nested_summary.end_state.status_type == "waiting":
                    final_node_slug = current_node.slug
                    break

            transition = _next_edge(current_slug)
            if transition is None:
                break
            current_slug = transition.target_step.slug
            continue

        if current_node.kind not in AGENT_NODE_KINDS:
            raise WorkflowExecutionError(
                "configuration",
                "Configuration du workflow invalide",
                RuntimeError(f"Type de nœud non géré : {current_node.kind}"),
                list(steps),
            )

        agent_key = current_node.agent_key or current_node.slug
        position = agent_positions.get(current_slug, total_runtime_steps)
        base_step_identifier = f"{agent_key}_{position}"
        step_identifier = _branch_prefixed_slug(base_step_identifier)
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
                "step_slug": _branch_prefixed_slug(current_node.slug),
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
            await _emit_stream_event(ThreadItemAddedEvent(item=links_message))
            await _emit_stream_event(ThreadItemDoneEvent(item=links_message))

        await ingest_workflow_step(
            config=(current_node.parameters or {}).get("vector_store_ingestion"),
            step_slug=_branch_prefixed_slug(current_node.slug),
            step_title=title,
            step_context=last_step_context,
            state=state,
            default_input_context=last_step_context,
            session_factory=SessionLocal,
        )

        if widget_config is not None:
            rendered_widget = await _stream_response_widget(
                widget_config,
                step_slug=_branch_prefixed_slug(current_node.slug),
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
        continue

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

    if final_output is None and isinstance(last_step_context, Mapping):
        candidate_output = last_step_context.get("output")
        if candidate_output is not None:
            final_output = candidate_output

    conversation_snapshot = _clone_conversation_history_snapshot(conversation_history)
    if conversation_snapshot:
        state["conversation_history"] = conversation_snapshot
    else:
        state.pop("conversation_history", None)

    return WorkflowRunSummary(
        steps=steps,
        final_output=final_output,
        final_node_slug=final_node_slug,
        end_state=final_end_state,
        last_context=copy.deepcopy(last_step_context)
        if last_step_context is not None
        else None,
        state=copy.deepcopy(state),
    )
