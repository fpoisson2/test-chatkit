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
    """Keep only the last user message when a previous response is referenced.

    The Responses API automatically restores the prior context from
    ``previous_response_id``. Sending assistant outputs or tool calls again can
    lead to mismatched references (for instance image generation calls requiring
    their associated reasoning block).

    Since previous_response_id already contains all the prior context, we only
    need to send the last user message (if any) as new input. Sending all user
    messages would duplicate the conversation history.
    """

    if not items:
        return items

    # Find the last user message
    last_user_message = None
    for item in reversed(items):
        if isinstance(item, Mapping):
            role_candidate = item.get("role")
        else:
            role_candidate = getattr(item, "role", None)

        role = role_candidate if isinstance(role_candidate, str) else None

        if role == "user":
            last_user_message = item
            break

    # Return only the last user message (or empty list if none found)
    return [last_user_message] if last_user_message is not None else []

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



# ---------------------------------------------------------------------------
# v1 implementation removed - using v2 as default
# ---------------------------------------------------------------------------
# The monolithic run_workflow_v1 function (3,272 lines) has been removed
# because the modular v2 implementation is now the default and production-ready.
# This file now only contains shared types, dataclasses, and helper functions
# used by both v2 and other parts of the codebase.
#
# For the current implementation, see: executor_v2.py
# For migration documentation, see: MIGRATION_GUIDE.md
# ---------------------------------------------------------------------------



# Import v2 implementation as the default run_workflow
from .executor_v2 import run_workflow_v2 as run_workflow  # noqa: E402, F401
