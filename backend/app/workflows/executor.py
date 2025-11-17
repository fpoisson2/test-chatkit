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
    AGENT_RESPONSE_FORMATS,
    STEP_TITLES,
    AgentProviderBinding,
)
from ..chatkit_server.actions import (
    _json_safe_copy,
    _ResponseWidgetConfig,
    _should_wait_for_widget_action,
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
from ..models import WorkflowDefinition, WorkflowStep, WorkflowTransition
from ..vector_store.ingestion import (
    evaluate_state_expression,
    ingest_document,
    ingest_workflow_step,
    resolve_transform_value,
)
from .runtime import (
    _coerce_bool,
    _resolve_voice_agent_configuration,
    _stream_response_widget,
    build_edges_by_source,
    ingest_vector_store_step,
    initialize_runtime_context,
    prepare_agents,
    process_agent_step,
)
from .service import (
    WorkflowService,
)
from .template_utils import render_agent_instructions

logger = logging.getLogger("chatkit.server")

AGENT_NODE_KINDS = frozenset({"agent", "voice_agent"})
AGENT_IMAGE_VECTOR_STORE_SLUG = "chatkit-agent-images"


def _sanitize_previous_response_id(value: Any) -> str | None:
    """Return a valid previous_response_id or ``None`` when invalid."""

    if isinstance(value, str):
        candidate = value.strip()
        if candidate.startswith("resp"):
            return candidate
    return None


def _normalize_conversation_history_for_provider(
    items: Sequence[TResponseInputItem],
    provider_slug: str | None,
) -> Sequence[TResponseInputItem]:
    """Adapt conversation history to the provider capabilities when needed.

    Some providers still rely on the legacy Chat Completions format and reject
    Responses-specific content blocks such as `input_text` and `output_text`.
    When we detect such providers we collapse textual content blocks into the
    plain-string representation accepted by the Chat Completions API.
    """

    if not provider_slug or not isinstance(provider_slug, str):
        return items

    normalized_slug = provider_slug.strip().lower()
    requires_normalization = normalized_slug in {"groq"} or normalized_slug.startswith(
        "litellm"
    )

    changed = False
    normalized: list[TResponseInputItem] = []
    text_content_types = {"input_text", "output_text", "text"}

    for item in items:
        if not isinstance(item, Mapping):
            normalized.append(item)
            continue

        copied_item = copy.deepcopy(item)
        item_changed = False

        if requires_normalization:
            response_id = copied_item.get("id")
            if response_id is not None and (
                not isinstance(response_id, str) or not response_id.startswith("msg")
            ):
                copied_item.pop("id", None)
                item_changed = True

            item_type = copied_item.get("type")

            # Items already using the full Responses schema (with a string type)
            # are assumed to be compatible with the Chat Completions converter.
            if not isinstance(item_type, str):
                content = copied_item.get("content")

                if isinstance(content, list):
                    text_parts: list[str] = []

                    for part in content:
                        if (
                            isinstance(part, Mapping)
                            and isinstance(part.get("type"), str)
                            and part["type"] in text_content_types
                            and isinstance(part.get("text"), str)
                        ):
                            text_parts.append(part["text"])

                    if text_parts:
                        copied_item["content"] = "\n\n".join(text_parts)
                        item_changed = True

        if item_changed:
            normalized.append(copied_item)
            changed = True
        else:
            normalized.append(item)

    return items if not changed else normalized


def _deduplicate_conversation_history_items(
    items: Sequence[TResponseInputItem],
) -> Sequence[TResponseInputItem]:
    """Remove duplicated response items sharing the same identifier.

    When the Responses API detects two entries referencing the same resource
    identifier (for example ``rs_*`` attachments), it rejects the entire
    payload. This helper keeps the first occurrence and skips subsequent ones
    while preserving the original order.
    """

    if not items:
        return items

    seen_ids: set[str] = set()
    deduplicated: list[TResponseInputItem] = []
    changed = False

    for item in items:
        candidate: Any | None
        if isinstance(item, Mapping):
            candidate = item.get("id")  # type: ignore[assignment]
        else:
            candidate = getattr(item, "id", None)

        item_id = candidate if isinstance(candidate, str) else None

        if item_id is not None:
            if item_id in seen_ids:
                changed = True
                continue
            seen_ids.add(item_id)

        deduplicated.append(item)

    return items if not changed else deduplicated


def _filter_conversation_history_for_previous_response(
    items: Sequence[TResponseInputItem],
) -> Sequence[TResponseInputItem]:
    """Keep only user/system items when a previous response is referenced.

    The Responses API automatically restores the prior context from
    ``previous_response_id``. Sending assistant outputs or tool calls again can
    lead to mismatched references (for instance image generation calls requiring
    their associated reasoning block). This helper strips everything except
    user/system authored items so only fresh input is forwarded.
    """

    if not items:
        return items

    filtered: list[TResponseInputItem] = []
    changed = False

    for item in items:
        if isinstance(item, Mapping):
            role_candidate = item.get("role")
        else:
            role_candidate = getattr(item, "role", None)

        role = role_candidate if isinstance(role_candidate, str) else None

        if role in {"user", "system"}:
            filtered.append(item)
        else:
            changed = True

    return items if not changed else filtered

# ---------------------------------------------------------------------------
# Définition du workflow local exécuté par DemoChatKitServer
# ---------------------------------------------------------------------------


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
    ags_variable_id: str | None = None
    ags_score_value: float | None = None
    ags_score_maximum: float | None = None


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
    thread = getattr(agent_context, "thread", None)
    resume_from_wait_slug: str | None = None

    initialization = await initialize_runtime_context(
        workflow_input,
        agent_context=agent_context,
        workflow_service=workflow_service,
        workflow_definition=workflow_definition,
        workflow_slug=workflow_slug,
        thread_item_converter=thread_item_converter,
        thread_items_history=thread_items_history,
        current_user_message=current_user_message,
        workflow_call_stack=workflow_call_stack,
        runtime_snapshot=runtime_snapshot,
    )

    service = initialization.service
    workflow_payload = initialization.workflow_payload
    steps = initialization.steps
    conversation_history = initialization.conversation_history
    state = initialization.state
    last_step_context = initialization.last_step_context
    pending_wait_state = initialization.pending_wait_state
    workflow_call_stack = initialization.workflow_call_stack
    current_input_item_id = initialization.current_input_item_id
    definition = initialization.definition
    runtime_snapshot = initialization.runtime_snapshot
    initial_user_text = initialization.initial_user_text
    voice_overrides = initialization.voice_overrides
    voice_session_manager = initialization.voice_session_manager

    final_output: dict[str, Any] | None = None

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

    current_workflow_id = getattr(definition, "workflow_id", None)

    def _belongs_to_current_workflow(step: WorkflowStep) -> bool:
        if current_workflow_id is None:
            return True

        step_workflow_id = getattr(step, "workflow_id", None)
        if (
            isinstance(step_workflow_id, int)
            and step_workflow_id != current_workflow_id
        ):
            return False

        step_definition_id = getattr(step, "definition_id", None)
        definition_id = getattr(definition, "id", None)
        if (
            isinstance(step_definition_id, int)
            and isinstance(definition_id, int)
            and step_definition_id != definition_id
        ):
            return False

        return True

    if pending_wait_state:
        waiting_slug = pending_wait_state.get("slug")
        waiting_input_id = pending_wait_state.get("input_item_id")
        stored_input_id = (
            waiting_input_id if isinstance(waiting_input_id, str) else None
        )
        current_input_id = (
            current_input_item_id if isinstance(current_input_item_id, str) else None
        )
        if isinstance(waiting_slug, str) and waiting_slug in nodes_by_slug:
            resume_candidate: str | None = waiting_slug
            if (
                stored_input_id
                and current_input_id
                and stored_input_id == current_input_id
            ):
                resume_candidate = None

            if resume_candidate is not None:
                resume_from_wait_slug = resume_candidate
            elif (
                isinstance(pending_wait_state.get("voice_transcripts"), list)
                and pending_wait_state.get("voice_transcripts")
            ):
                resume_from_wait_slug = waiting_slug

    transitions = [
        transition
        for transition in definition.transitions
        if transition.source_step.slug in nodes_by_slug
        and transition.target_step.slug in nodes_by_slug
        and _belongs_to_current_workflow(transition.source_step)
        and _belongs_to_current_workflow(transition.target_step)
    ]

    start_step = next(
        (
            step
            for step in nodes_by_slug.values()
            if step.kind == "start" and _belongs_to_current_workflow(step)
        ),
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

    agent_setup = prepare_agents(
        definition=definition,
        service=service,
        agent_steps_ordered=agent_steps_ordered,
        nodes_by_slug=nodes_by_slug,
    )

    agent_instances = agent_setup.agent_instances
    agent_provider_bindings = agent_setup.agent_provider_bindings
    nested_workflow_configs = agent_setup.nested_workflow_configs
    widget_configs_by_step = agent_setup.widget_configs_by_step
    _load_nested_workflow_definition = agent_setup.load_nested_definition

    edges_by_source = build_edges_by_source(transitions)

    def _get_nodes_inside_while(while_node: WorkflowStep) -> set[str]:
        """
        Detect which nodes are visually inside a while block based on their positions.
        Returns a set of node slugs that are inside the while block.
        """
        if not _belongs_to_current_workflow(while_node):
            logger.debug(
                "Bloc while %s ignoré car il appartient à un autre workflow (%s)",
                while_node.slug,
                getattr(while_node, "workflow_id", None),
            )
            return set()

        while_metadata = while_node.ui_metadata or {}
        while_pos = while_metadata.get("position", {})

        # Check if while has position data
        if not while_pos or "x" not in while_pos or "y" not in while_pos:
            logger.warning(
                "Bloc while %s n'a pas de position définie dans metadata. "
                "Les blocs ne pourront pas être détectés automatiquement. "
                "Assurez-vous que le workflow a été sauvegardé avec les positions.",
                while_node.slug
            )
            return set()

        while_x = while_pos.get("x", 0)
        while_y = while_pos.get("y", 0)

        # Get while dimensions from size metadata or style
        size_metadata = while_metadata.get("size", {})
        while_width = size_metadata.get("width", 400)
        while_height = size_metadata.get("height", 300)

        inside_nodes = set()

        for node in nodes_by_slug.values():
            if not _belongs_to_current_workflow(node):
                continue

            if node.slug == while_node.slug or node.kind == "while":
                continue

            node_metadata = node.ui_metadata or {}
            node_pos = node_metadata.get("position", {})

            # Skip nodes without position
            if not node_pos or "x" not in node_pos or "y" not in node_pos:
                continue

            node_x = node_pos.get("x", 0)
            node_y = node_pos.get("y", 0)

            # Check if node is inside the while rectangle
            if (while_x <= node_x <= while_x + while_width and
                while_y <= node_y <= while_y + while_height):
                inside_nodes.add(node.slug)
                logger.debug(
                    "Bloc %s détecté à l'intérieur du while %s (pos: %d,%d)",
                    node.slug, while_node.slug, node_x, node_y
                )

        if inside_nodes:
            logger.info(
                "While %s contient %d bloc(s): %s",
                while_node.slug, len(inside_nodes), ", ".join(inside_nodes)
            )
        else:
            logger.warning(
                "While %s ne contient aucun bloc détecté. "
                "Vérifiez que les blocs ont des positions définies et "
                "sont visuellement dans le while.",
                while_node.slug
            )

        return inside_nodes

    def _find_parent_while(node_slug: str) -> str | None:
        """
        Find the while block that contains a given node, if any.

        Returns the slug of the parent while block, or None if the node is not inside
        any while.
        """
        for while_node in nodes_by_slug.values():
            if while_node.kind != "while" or not _belongs_to_current_workflow(
                while_node
            ):
                continue

            inside_nodes = _get_nodes_inside_while(while_node)
            if node_slug in inside_nodes:
                return while_node.slug

        return None

    def _should_intercept_transition_for_while(
        source_slug: str, transition: WorkflowTransition | None
    ) -> tuple[bool, str | None]:
        """
        Check if a transition should be intercepted because it exits a while loop.
        Returns (should_intercept, parent_while_slug).

        If the source node is inside a while block and the transition target is
        outside, we should intercept it and return to the while instead (to
        re-evaluate the condition).
        """
        if transition is None:
            return (False, None)

        # Check if source is inside a while block
        parent_while_slug = _find_parent_while(source_slug)
        if parent_while_slug is None:
            return (False, None)

        # Check if target is also inside the same while block
        target_slug = transition.target_step.slug
        target_parent_while = _find_parent_while(target_slug)

        # If target is in the same while, don't intercept
        if target_parent_while == parent_while_slug:
            return (False, None)

        # Target is outside the while (or in a different while)
        # Intercept this transition and return to the parent while
        return (True, parent_while_slug)

    def _handle_transition_with_while_support(
        node_kind: str, node_slug: str, transition: WorkflowTransition | None
    ) -> tuple[WorkflowTransition | None, bool]:
        """
        Handle transition with while loop support.
        Returns (transition_to_use, should_continue).

        If the node is inside a while and the transition exits the while,
        redirects to the parent while instead.
        """
        nonlocal current_slug

        # Check if we should intercept this transition
        should_intercept, parent_while_slug = _should_intercept_transition_for_while(
            node_slug, transition
        )

        if should_intercept and parent_while_slug is not None:
            # Intercept: return to while instead of following the transition
            logger.debug(
                "Bloc %s %s dans une boucle while %s avec transition sortante, "
                "retour au while pour réévaluation",
                node_kind,
                node_slug,
                parent_while_slug,
            )
            current_slug = parent_while_slug
            return (None, True)

        # No interception needed
        if transition is not None:
            return (transition, False)

        # No transition exists
        parent_while_slug = _find_parent_while(node_slug)
        if parent_while_slug is not None:
            # Node is inside a while block, return to the while to re-evaluate condition
            logger.debug(
                "Bloc %s %s dans une boucle while %s, retour au while pour "
                "réévaluation",
                node_kind,
                node_slug,
                parent_while_slug,
            )
            current_slug = parent_while_slug
            return (None, True)

        # Try fallback to start as before
        if _fallback_to_start(node_kind, node_slug):
            return (None, True)

        return (None, False)

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

        def _coerce_score_value(value: Any) -> float | None:
            if value is None:
                return None
            if isinstance(value, bool):
                return 1.0 if value else 0.0
            if isinstance(value, (int, float)):
                try:
                    numeric = float(value)
                except (TypeError, ValueError):
                    return None
                if math.isnan(numeric) or math.isinf(numeric):
                    return None
                return numeric
            if isinstance(value, str):
                candidate = value.strip()
                if not candidate:
                    return None
                normalized = candidate
                if "," in candidate and "." not in candidate:
                    normalized = candidate.replace(",", ".")
                try:
                    numeric = float(normalized)
                except ValueError:
                    return None
                if math.isnan(numeric) or math.isinf(numeric):
                    return None
                return numeric
            return None

        ags_variable_id: str | None = None
        ags_score_value: float | None = None
        ags_maximum: float | None = None

        ags_raw = params.get("ags")
        ags_config = ags_raw if isinstance(ags_raw, Mapping) else None
        if ags_config:
            raw_identifier = ags_config.get("score_variable_id")
            if not isinstance(raw_identifier, str):
                raw_identifier = ags_config.get("variable_id")
            ags_variable_id = (
                _sanitize_end_value(raw_identifier)
                if isinstance(raw_identifier, str)
                else None
            )

            def _evaluate(expression_key: str) -> Any:
                expression = ags_config.get(expression_key)
                try:
                    return evaluate_state_expression(
                        expression,
                        state=state,
                        default_input_context=last_step_context,
                    )
                except Exception as exc:  # pragma: no cover - robustesse
                    logger.warning(
                        "Impossible de résoudre l'expression AGS %s sur le bloc %s",
                        expression_key,
                        step.slug,
                        exc_info=exc,
                    )
                    return None

            value_candidate = _evaluate("value")
            if value_candidate is None and "score" in ags_config:
                value_candidate = _evaluate("score")
            if value_candidate is None and "score_value" in ags_config:
                value_candidate = _evaluate("score_value")
            ags_score_value = _coerce_score_value(value_candidate)

            maximum_candidate = _evaluate("maximum")
            if maximum_candidate is None and "max_score" in ags_config:
                maximum_candidate = _evaluate("max_score")
            ags_maximum = _coerce_score_value(maximum_candidate)

        return WorkflowEndState(
            slug=step.slug,
            status_type=status_type,
            status_reason=status_reason,
            message=message,
            ags_variable_id=ags_variable_id,
            ags_score_value=ags_score_value,
            ags_score_maximum=ags_maximum,
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
        if provider_binding is not None and provider_binding.provider is not None:
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
        for index, part in enumerate(path_parts):
            is_last = index == len(path_parts) - 1

            if is_last:
                cursor[part] = value
                break

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
        log_agent_key = (
            metadata_for_images.get("agent_key")
            or metadata_for_images.get("agent_label")
            or step_key
        )
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

        raw_instructions = getattr(agent, "instructions", None)
        overridden_instructions: Any = None
        instructions_overridden = False
        if isinstance(raw_instructions, str):
            rendered_instructions = render_agent_instructions(
                raw_instructions,
                state=state,
                last_step_context=last_step_context,
                run_context=run_context if isinstance(run_context, Mapping) else None,
            )
            if (
                rendered_instructions is not None
                and rendered_instructions != raw_instructions
            ):
                overridden_instructions = raw_instructions
                try:
                    agent.instructions = rendered_instructions
                    instructions_overridden = True
                except Exception:
                    logger.debug(
                        "Impossible de surcharger les instructions de l'agent %s",
                        getattr(agent, "name", "<inconnu>"),
                        exc_info=True,
                    )

        provider_binding = agent_provider_bindings.get(current_slug)

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
            getattr(provider_binding, "provider_slug", None)
            if provider_binding
            else None,
        )
        conversation_history_input = _deduplicate_conversation_history_items(
            conversation_history_input
        )

        sanitized_previous_response_id = _sanitize_previous_response_id(
            getattr(agent_context, "previous_response_id", None)
        )
        if sanitized_previous_response_id != getattr(
            agent_context, "previous_response_id", None
        ):
            try:
                agent_context.previous_response_id = sanitized_previous_response_id
            except Exception:  # pragma: no cover - attribute assignment best effort
                logger.debug(
                    "Impossible de normaliser previous_response_id pour l'agent %s",
                    getattr(agent, "name", "<inconnu>"),
                    exc_info=True,
                )

        # When using previous_response_id, the API automatically includes all context
        # from the previous response. We should only send new user messages,
        # not assistant messages or reasoning items from history (which would conflict).
        if sanitized_previous_response_id:
            filtered_input = _filter_conversation_history_for_previous_response(
                conversation_history_input
            )
            logger.debug(
                "Utilisation de previous_response_id=%s, filtrage de %d items de "
                "l'historique (assistant/tool outputs)",
                sanitized_previous_response_id,
                len(conversation_history_input) - len(filtered_input),
            )
            conversation_history_input = filtered_input

        # Check if we're in a while loop iteration (with previous_response_id or wait state resume)
        # If so, don't send the initial user message again as it's already in the context
        in_while_loop_iteration = False
        if "state" in state and isinstance(state["state"], dict):
            logger.debug(
                "Vérification du state pour détection de boucle while: %s",
                {k: v for k, v in state["state"].items() if "__while_" in str(k)}
            )
            for key, value in state["state"].items():
                if (
                    isinstance(key, str)
                    and key.startswith("__while_")
                    and key.endswith("_counter")
                    and isinstance(value, int)
                    and value >= 1
                ):
                    in_while_loop_iteration = True
                    logger.debug(
                        "Boucle while détectée: %s = %d (>= 1)",
                        key,
                        value
                    )
                    break

        if in_while_loop_iteration and (sanitized_previous_response_id or pending_wait_state):
            # We're in a subsequent iteration of a while loop
            # The initial user message is already in the context via previous_response_id or wait state history
            # So we should not send it again
            logger.debug(
                "Boucle while (itération >= 1) détectée avec previous_response_id=%s ou wait_state=%s, "
                "suppression du message user initial de l'entrée",
                sanitized_previous_response_id,
                bool(pending_wait_state),
            )
            conversation_history_input = []

        try:
            result = Runner.run_streamed(
                agent,
                input=[*conversation_history_input],
                run_config=_workflow_run_config(
                    response_format_override, provider_binding=provider_binding
                ),
                context=runner_context,
                previous_response_id=sanitized_previous_response_id,
            )
            try:
                async for event in stream_agent_response(agent_context, result):
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
            if last_response_id is not None:
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
                        log_agent_key,
                        json.dumps(
                            [item.to_input_item() for item in result.new_items],
                            ensure_ascii=False,
                            default=str,
                        ),
                    )
                except TypeError:
                    logger.debug(
                        "Éléments ajoutés par l'agent %s non sérialisables en JSON",
                        log_agent_key,
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

            if instructions_overridden:
                try:
                    agent.instructions = overridden_instructions
                except Exception:
                    logger.debug(
                        "Impossible de restaurer les instructions de l'agent %s",
                        getattr(agent, "name", "<inconnu>"),
                        exc_info=True,
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

    def _next_edge_with_while_support(
        source_slug: str, branch: str | None = None
    ) -> WorkflowTransition | None:
        """
        Get the next edge, with automatic while loop support.

        If the source node is inside a while block and has no explicit transition,
        automatically return to the parent while block to re-evaluate the loop
        condition.
        """
        # First, try to get a normal transition
        transition = _next_edge(source_slug, branch)

        # If a transition exists, use it
        if transition is not None:
            return transition

        # If no transition exists, check if this node is inside a while block
        parent_while_slug = _find_parent_while(source_slug)
        if parent_while_slug is not None:
            # Create a virtual transition back to the parent while
            # We'll search for an existing edge to the while, or indicate we
            # should jump back
            parent_while = nodes_by_slug.get(parent_while_slug)
            if parent_while is not None:
                # Look for an existing edge back to the while
                for edge in edges_by_source.get(source_slug, []):
                    if edge.target_step.slug == parent_while_slug:
                        return edge

                # No explicit edge back to while, but we'll handle this by setting
                # current_slug to the parent while directly (handled in the caller)
                # For now, return None and let the caller check _find_parent_while

        return None

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
        nonlocal current_slug, final_end_state, thread, conversation_history, \
            state, current_input_item_id
        # When a node has no outgoing transition and agent_steps_ordered exists,
        # we create a wait state to get new user input before restarting
        if not agent_steps_ordered:
            return False

        logger.debug(
            "Absence de transition après le bloc %s %s, attente d'input utilisateur",
            node_kind,
            node_slug,
        )

        # Create a wait state that will resume at START on next user input
        wait_state_payload: dict[str, Any] = {
            "slug": node_slug,
            "input_item_id": current_input_item_id,
            "next_step_slug": start_step.slug,
        }

        # Filter out old user messages from conversation history since we're restarting
        # Only keep assistant responses and system messages to maintain context
        filtered_history = [
            item for item in conversation_history
            if not (isinstance(item, dict) and item.get("role") == "user")
        ]

        conversation_snapshot = _clone_conversation_history_snapshot(
            filtered_history
        )
        if conversation_snapshot:
            wait_state_payload["conversation_history"] = conversation_snapshot
            logger.debug(
                "Nettoyage de %d message(s) user avant redémarrage (conservé %d items)",
                len(conversation_history) - len(filtered_history),
                len(filtered_history)
            )
        if state:
            # Clean up while loop counters since we're restarting at the beginning
            # This prevents the old counters from incorrectly filtering the new user message
            cleaned_state = _json_safe_copy(state)
            if isinstance(cleaned_state, dict) and "state" in cleaned_state:
                nested_state = cleaned_state.get("state")
                if isinstance(nested_state, dict):
                    keys_to_remove = [
                        k for k in nested_state.keys()
                        if isinstance(k, str) and k.startswith("__while_")
                    ]
                    for key in keys_to_remove:
                        nested_state.pop(key, None)
                    if keys_to_remove:
                        logger.debug(
                            "Nettoyage de %d compteur(s) de while avant redémarrage: %s",
                            len(keys_to_remove),
                            keys_to_remove
                        )
            wait_state_payload["state"] = cleaned_state

        if thread is not None:
            _set_wait_state_metadata(thread, wait_state_payload)

        # Set final_end_state to waiting
        final_end_state = WorkflowEndState(
            slug=node_slug,
            status_type="waiting",
            status_reason="En attente d'une nouvelle question.",
            message="En attente d'une nouvelle question.",
        )

        # Return False to break out of the loop (don't continue)
        return False

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

            resolved_message = (
                final_end_state.message
                or final_end_state.status_reason
                or "Workflow terminé"
            )

            end_payload: dict[str, Any] = {"message": resolved_message}
            if final_end_state.status_reason:
                end_payload["status_reason"] = final_end_state.status_reason
            if final_end_state.status_type:
                end_payload["status_type"] = final_end_state.status_type

            ags_payload: dict[str, Any] | None = None
            if final_end_state.ags_variable_id:
                ags_payload = {"variable_id": final_end_state.ags_variable_id}
                if final_end_state.ags_score_value is not None:
                    ags_payload["score"] = final_end_state.ags_score_value
                if final_end_state.ags_score_maximum is not None:
                    ags_payload["maximum"] = final_end_state.ags_score_maximum
                if ags_payload:
                    end_payload["ags"] = ags_payload

            await record_step(
                current_node.slug,
                _node_title(current_node),
                end_payload,
            )

            end_state_payload: dict[str, Any] = {
                "slug": final_end_state.slug,
                "status_type": final_end_state.status_type,
                "status_reason": final_end_state.status_reason,
                "message": final_end_state.message,
            }
            if ags_payload:
                end_state_payload["ags"] = ags_payload

            last_step_context = {
                "output": end_payload,
                "output_structured": end_payload,
                "output_parsed": end_payload,
                "output_text": resolved_message,
                "assistant_message": resolved_message,
                "end_state": end_state_payload,
            }

            final_output = end_payload
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

        if current_node.kind == "while":
            params = current_node.parameters or {}
            condition_expr = str(params.get("condition", "")).strip()
            max_iterations = int(params.get("max_iterations", 100))
            max_iterations = max(max_iterations - 1, 0)
            iteration_var = str(params.get("iteration_var", "")).strip()

            def _find_while_exit_transition(
                while_node: WorkflowStep = current_node,
                while_slug: str = current_slug,
            ) -> WorkflowTransition | None:
                inside_nodes = _get_nodes_inside_while(while_node)
                transition = None

                # Look for any transition from nodes inside to nodes outside
                for inside_slug in inside_nodes:
                    for edge in edges_by_source.get(inside_slug, []):
                        if edge.target_step.slug not in inside_nodes:
                            transition = edge
                            break
                    if transition:
                        break

                if transition is None:
                    # No exit found, look for any outgoing transition
                    transition = _next_edge(while_slug, "exit")
                    if transition is None:
                        transition = _next_edge(while_slug)

                return transition

            # Initialize or get iteration counter from state
            loop_counter_key = f"__while_{current_slug}_counter"
            loop_entry_key = f"__while_{current_slug}_entry"
            logger.debug(
                "While %s: avant init, 'state' in state=%s, state.keys()=%s",
                current_slug,
                "state" in state,
                list(state.keys())
            )
            # state["state"] should always exist now (initialized in state_manager.py)
            if "state" not in state:
                logger.error(
                    "While %s: clé 'state' absente de state - ERREUR INATTENDUE!",
                    current_slug
                )
                state["state"] = {}

            iteration_count = state["state"].get(loop_counter_key, 0)
            transition: WorkflowTransition | None = None

            # Evaluate the while condition
            try:
                if not condition_expr:
                    # No condition means always true (but limited by max_iterations)
                    condition_result = True
                else:
                    # Create a safe context for eval
                    eval_context = {
                        "state": state.get("state", {}),
                        "globals": state.get("globals", {}),
                    }
                    condition_result = bool(
                        eval(condition_expr, {"__builtins__": {}}, eval_context)
                    )
            except Exception as exc:
                raise_step_error(current_node.slug, _node_title(current_node), exc)

            if not condition_result:
                # Condition is false, exit the loop
                state["state"].pop(loop_counter_key, None)  # Clean up counter
                state["state"].pop(loop_entry_key, None)  # Clean up entry point

                transition = _find_while_exit_transition()
            else:
                # Condition is true, continue loop after counting the iteration
                iteration_count = iteration_count + 1

                # Check max iterations safety limit after incrementing
                if iteration_count > max_iterations:
                    state["state"].pop(loop_counter_key, None)  # Clean up counter
                    state["state"].pop(loop_entry_key, None)  # Clean up entry point

                    transition = _find_while_exit_transition()
                else:
                    state["state"][loop_counter_key] = iteration_count
                    logger.debug(
                        "While %s: compteur incrémenté et sauvegardé, iteration_count=%d, state[loop_counter_key]=%s",
                        current_slug,
                        iteration_count,
                        state["state"].get(loop_counter_key)
                    )
                    logger.debug(
                        "While %s: APRÈS sauvegarde compteur, id(state)=%s, 'state' in state=%s, state.keys()=%s",
                        current_slug,
                        id(state),
                        "state" in state,
                        list(state.keys())
                    )

                    # Update iteration variable if specified (1-based: 1, 2, 3, ...,)
                    if iteration_var:
                        state["state"][iteration_var] = iteration_count

                    # Find the entry point to the while loop
                    # This is the first block inside the while that we should execute
                    entry_slug = state["state"].get(loop_entry_key)

                    if entry_slug is None:
                        # First time entering the loop, find the entry point
                        inside_nodes = _get_nodes_inside_while(current_node)

                        # Look for a transition from outside into the while
                        for node_slug in nodes_by_slug:
                            node = nodes_by_slug[node_slug]
                            if not _belongs_to_current_workflow(node):
                                continue
                            if node_slug in inside_nodes or node_slug == current_slug:
                                continue
                            for edge in edges_by_source.get(node_slug, []):
                                if edge.target_step.slug in inside_nodes:
                                    entry_slug = edge.target_step.slug
                                    state["state"][loop_entry_key] = entry_slug
                                    break
                            if entry_slug:
                                break

                        # If still no entry point, take the first node by position
                        if entry_slug is None and inside_nodes:
                            # Sort by Y position (top to bottom)
                            sorted_nodes = sorted(
                                [nodes_by_slug[slug] for slug in inside_nodes],
                                key=lambda n: (n.ui_metadata or {})
                                .get("position", {})
                                .get("y", 0),
                            )
                            if sorted_nodes:
                                entry_slug = sorted_nodes[0].slug
                                state["state"][loop_entry_key] = entry_slug

                    if entry_slug is not None:
                        current_slug = entry_slug
                        continue

                    # No entry point found, try normal transitions
                    transition = _next_edge(current_slug, "loop")
                    if transition is None:
                        transition = _next_edge(current_slug)

            if transition is None:
                # Check if start block is inside the while loop
                inside_nodes = _get_nodes_inside_while(current_node)
                if start_step.slug in inside_nodes:
                    # Start is inside the while, we can fallback to it
                    if _fallback_to_start("while", current_node.slug):
                        continue
                else:
                    # Start is NOT inside the while, reset counter and don't fallback
                    state["state"].pop(loop_counter_key, None)
                    state["state"].pop(loop_entry_key, None)
                break
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "state":
            try:
                _apply_state_node(current_node)
            except Exception as exc:  # pragma: no cover - validation runtime
                raise_step_error(current_node.slug, _node_title(current_node), exc)

            transition = _next_edge(current_slug)
            transition, should_continue = _handle_transition_with_while_support(
                "state", current_node.slug, transition
            )
            if should_continue:
                continue
            if transition is None:
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
            transition, should_continue = _handle_transition_with_while_support(
                "watch", current_node.slug, transition
            )
            if should_continue:
                continue
            if transition is None:
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
            transition, should_continue = _handle_transition_with_while_support(
                "transform", current_node.slug, transition
            )
            if should_continue:
                continue
            if transition is None:
                break
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "wait_for_user_input":
            transition = _next_edge(current_slug)
            transition, should_continue_early = _handle_transition_with_while_support(
                "wait_for_user_input", current_node.slug, transition
            )

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
                if should_continue_early:
                    # We intercepted the transition for while loop, continue to while
                    continue

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

            if voice_wait_state is not None:
                resume_result = await voice_session_manager.resume_from_wait_state(
                    current_step_slug=current_node.slug,
                    title=title,
                    voice_context=voice_context,
                    voice_wait_state=voice_wait_state,
                    conversation_history=conversation_history,
                    state=state,
                    agent_context=agent_context,
                    record_step=record_step,
                    emit_stream_event=_emit_stream_event,
                    ingest_step=ingest_workflow_step,
                    vector_config=(current_node.parameters or {}).get(
                        "vector_store_ingestion"
                    ),
                    step_slug_for_ingestion=_branch_prefixed_slug(current_node.slug),
                    session_factory=SessionLocal,
                    thread=thread,
                    wait_reason="En attente des transcriptions vocales.",
                    agent_key=current_node.agent_key or current_node.slug,
                )
                if resume_result.processed:
                    last_step_context = resume_result.last_step_context
                    pending_wait_state = None
                    transition = _next_edge(current_slug)
                    if transition is None:
                        break
                    current_slug = transition.target_step.slug
                    continue
                if resume_result.wait_reason:
                    final_end_state = WorkflowEndState(
                        slug=current_node.slug,
                        status_type="waiting",
                        status_reason=resume_result.wait_reason,
                        message=resume_result.wait_reason,
                    )
                    break

            request_context = getattr(agent_context, "request_context", None)
            user_id = None
            if request_context is not None:
                user_id = getattr(request_context, "user_id", None)
            if not isinstance(user_id, str) or not user_id.strip():
                thread_meta = getattr(agent_context, "thread", None)
                fallback_id = getattr(thread_meta, "id", None)
                user_id = str(fallback_id or "voice-user")

            transition = _next_edge(current_slug)
            next_step_slug = (
                transition.target_step.slug if transition is not None else None
            )

            try:
                start_result = await voice_session_manager.start_voice_session(
                    current_step_slug=current_node.slug,
                    title=title,
                    voice_context=voice_context,
                    event_context=event_context,
                    agent_context=agent_context,
                    user_id=user_id,
                    conversation_history=conversation_history,
                    state=state,
                    thread=thread,
                    current_input_item_id=current_input_item_id,
                    next_step_slug=next_step_slug,
                    record_step=record_step,
                    emit_stream_event=_emit_stream_event,
                )
            except Exception as exc:
                raise_step_error(current_node.slug, title or current_node.slug, exc)

            last_step_context = start_result.last_step_context

            final_end_state = WorkflowEndState(
                slug=current_node.slug,
                status_type="waiting",
                status_reason="Session vocale en cours",
                message="Session vocale en cours",
            )
            break

        if current_node.kind == "outbound_call":
            from ..models import SipAccount
            from ..telephony.outbound_call_manager import get_outbound_call_manager

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

            # Créer une session de base de données pour ce bloc
            database_session = SessionLocal()

            try:
                # Vérifier que le workflow vocal existe et récupérer sa version active
                from ..models import Workflow, WorkflowDefinition

                # Le voice_workflow_id peut être soit un workflow.id,
                # soit un workflow_definition.id.
                # On essaie d'abord comme workflow.id (cas le plus probable
                # depuis le frontend).
                workflow = database_session.query(Workflow).filter_by(
                    id=voice_workflow_id
                ).first()

                if workflow and workflow.active_version_id:
                    # On a trouvé un workflow parent, utiliser sa version active
                    voice_workflow_definition_id = workflow.active_version_id
                elif workflow:
                    # Workflow existe mais pas de version active, chercher
                    # une version active
                    active_def = database_session.query(WorkflowDefinition).filter_by(
                        workflow_id=workflow.id,
                        is_active=True
                    ).first()
                    if not active_def:
                        raise WorkflowExecutionError(
                            current_node.slug,
                            title,
                            Exception(
                                f"Le workflow '{workflow.display_name}' "
                                f"(ID: {voice_workflow_id}) n'a pas de version "
                                "active. Veuillez activer une version."
                            ),
                            list(steps),
                        )
                    voice_workflow_definition_id = active_def.id
                else:
                    # Peut-être que c'est directement un workflow_definition.id
                    voice_workflow_def = (
                        database_session.query(WorkflowDefinition)
                        .filter_by(id=voice_workflow_id)
                        .first()
                    )
                    if not voice_workflow_def:
                        raise WorkflowExecutionError(
                            current_node.slug,
                            title,
                            Exception(
                                "Le workflow avec l'ID "
                                f"{voice_workflow_id} n'existe pas. "
                                "Veuillez créer ou sélectionner un "
                                "workflow valide."
                            ),
                            list(steps),
                        )
                    voice_workflow_definition_id = voice_workflow_def.id

                # Utiliser voice_workflow_definition_id pour l'appel sortant.
                # On accepte n'importe quel type de workflow tant qu'il existe.
                # La validation du contenu (présence d'un bloc vocal) sera
                # faite à l'exécution.

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
                        current_node.slug,
                        title,
                        Exception("Session de base de données non disponible"),
                        list(steps),
                    )

                call_session = await outbound_manager.initiate_call(
                    db=database_session,
                    to_number=to_number,
                    from_number=from_number,
                    workflow_id=voice_workflow_definition_id,
                    sip_account_id=sip_account_id,
                    metadata=metadata,
                )

                # Émettre un événement d'appel sortant (similaire à
                # realtime.event pour voice_agent)
                if on_stream_event is not None and agent_context.thread is not None:
                    try:
                        outbound_call_event = {
                            "type": "outbound_call.event",
                            "step": {"slug": current_node.slug, "title": title},
                            "event": {
                                "type": "call_started",
                                "call_id": call_session.call_id,
                                "to_number": to_number,
                                "from_number": from_number,
                            },
                        }

                        task_item = TaskItem(
                            id=agent_context.generate_id("task"),
                            thread_id=agent_context.thread.id,
                            created_at=datetime.now(),
                            task=CustomTask(
                                title=f"📞 Appel en cours vers {to_number}...",
                                content=json.dumps(
                                    outbound_call_event,
                                    ensure_ascii=False,
                                ),
                            ),
                        )
                        await _emit_stream_event(ThreadItemAddedEvent(item=task_item))
                        await _emit_stream_event(ThreadItemDoneEvent(item=task_item))

                        logger.info(
                            "Événement d'appel sortant émis pour call_id=%s",
                            call_session.call_id,
                        )
                    except Exception as e:
                        logger.error(
                            (
                                "Erreur lors de l'émission de l'événement "
                                "d'appel sortant : %s"
                            ),
                            e,
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
                        # Les transcriptions sont déjà ajoutées en temps réel
                        # via on_transcript_hook. On récupère juste les
                        # métadonnées pour le contexte.
                        transcripts = call_result.get("transcripts", [])
                        audio_recordings = call_result.get("audio_recordings", {})

                        # Ajouter un message avec les liens audio à la fin de
                        # l'appel
                        if (
                            audio_recordings
                            and thread is not None
                            and on_stream_event is not None
                        ):
                            try:
                                call_id = call_result["call_id"]
                                audio_links = []
                                if audio_recordings.get("inbound"):
                                    audio_links.append(
                                        "🎤 [Audio entrant]"
                                        f"(/api/outbound/call/{call_id}/audio/inbound)"
                                    )
                                if audio_recordings.get("outbound"):
                                    audio_links.append(
                                        "🔊 [Audio sortant]"
                                        f"(/api/outbound/call/{call_id}/audio/outbound)"
                                    )
                                if audio_recordings.get("mixed"):
                                    audio_links.append(
                                        "🎧 [Audio mixé]"
                                        f"(/api/outbound/call/{call_id}/audio/mixed)"
                                    )

                                if audio_links:
                                    # Émettre un événement de fin d'appel
                                    try:
                                        outbound_call_end_event = {
                                            "type": "outbound_call.event",
                                            "step": {
                                                "slug": current_node.slug,
                                                "title": title,
                                            },
                                            "event": {
                                                "type": "call_ended",
                                                "call_id": call_id,
                                                "status": call_result.get("status"),
                                                "duration_seconds": call_result.get(
                                                    "duration_seconds"
                                                ),
                                            },
                                        }

                                        audio_links_text = "\n".join(audio_links)
                                        task_item = TaskItem(
                                            id=agent_context.generate_id("task"),
                                            thread_id=thread.id,
                                            created_at=datetime.now(),
                                            task=CustomTask(
                                                title=(
                                                    "**Enregistrements audio de "
                                                    "l'appel :**"
                                                ),
                                                content=(
                                                    json.dumps(
                                                        outbound_call_end_event,
                                                        ensure_ascii=False,
                                                    )
                                                    + "\n\n"
                                                    + audio_links_text
                                                ),
                                            ),
                                        )
                                        await _emit_stream_event(
                                            ThreadItemAddedEvent(item=task_item)
                                        )
                                        await _emit_stream_event(
                                            ThreadItemDoneEvent(item=task_item)
                                        )

                                        logger.info(
                                            (
                                                "Événement de fin d'appel émis "
                                                "pour call_id=%s"
                                            ),
                                            call_id,
                                        )
                                    except Exception as e:
                                        logger.error(
                                            (
                                                "Erreur lors de l'émission de "
                                                "l'événement de fin d'appel : %s"
                                            ),
                                            e,
                                        )

                                    logger.info(
                                        (
                                            "Liens audio ajoutés au thread %s "
                                            "pour l'appel %s"
                                        ),
                                        thread.id,
                                        call_session.call_id,
                                    )
                            except Exception as e:
                                logger.error(
                                    (
                                        "Erreur lors de l'ajout des liens "
                                        "audio au thread : %s"
                                    ),
                                    e,
                                )

                        last_step_context = {
                            "outbound_call": {
                                "call_id": call_result["call_id"],
                                "call_status": call_result["status"],
                                "answered": call_result["status"] == "completed",
                                "duration_seconds": call_result.get("duration_seconds"),
                                "to_number": to_number,
                                "transcripts": transcripts,
                                "audio_recordings": audio_recordings,
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
                # Fermer la session de base de données
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
            await ingest_vector_store_step(
                current_node.parameters or {},
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
                    state=state,
                    last_step_context=last_step_context,
                    agent_context=agent_context,
                    emit_stream_event=_emit_stream_event,
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

            await ingest_vector_store_step(
                (current_node.parameters or {}).get("vector_store_ingestion"),
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
                    state=state,
                    last_step_context=last_step_context,
                    agent_context=agent_context,
                    emit_stream_event=_emit_stream_event,
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
            transition, should_continue = _handle_transition_with_while_support(
                current_node.kind, current_node.slug, transition
            )
            if should_continue:
                continue
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

        logger.debug(
            "AVANT process_agent_step pour %s: id(state)=%s, 'state' in state=%s, state.keys()=%s",
            current_slug,
            id(state),
            "state" in state,
            list(state.keys())
        )

        agent_step_execution = await process_agent_step(
            current_node=current_node,
            current_slug=current_slug,
            agent_instances=agent_instances,
            agent_positions=agent_positions,
            total_runtime_steps=total_runtime_steps,
            widget_configs_by_step=widget_configs_by_step,
            conversation_history=conversation_history,
            last_step_context=last_step_context,
            state=state,
            agent_context=agent_context,
            run_agent_step=run_agent_step,
            consume_generated_image_urls=_consume_generated_image_urls,
            structured_output_as_json=_structured_output_as_json,
            record_step=record_step,
            merge_generated_image_urls_into_payload=merge_generated_image_urls_into_payload,
            append_generated_image_links=append_generated_image_links,
            format_generated_image_links=format_generated_image_links,
            ingest_vector_store_step=ingest_vector_store_step,
            stream_widget=_stream_response_widget,
            should_wait_for_widget_action=_should_wait_for_widget_action,
            on_widget_step=on_widget_step,
            emit_stream_event=_emit_stream_event,
            on_stream_event=on_stream_event,
            branch_prefixed_slug=_branch_prefixed_slug,
            node_title=_node_title,
            next_edge=_next_edge,
            session_factory=SessionLocal,
        )

        logger.debug(
            "APRÈS process_agent_step pour %s: id(state)=%s, 'state' in state=%s, state.keys()=%s",
            current_slug,
            id(state),
            "state" in state,
            list(state.keys())
        )

        last_step_context = agent_step_execution.last_step_context
        transition = agent_step_execution.transition
        transition, should_continue = _handle_transition_with_while_support(
            current_node.kind, current_node.slug, transition
        )
        if should_continue:
            continue
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
