from __future__ import annotations

import asyncio
import copy
import inspect
import json
import logging
import math
import re
import uuid
from pathlib import Path
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import (
    Any,
    AsyncIterator,
    Awaitable,
    Callable,
    Coroutine,
    Iterator,
    Literal,
    Union,
)

from agents import (
    Agent,
    AgentOutputSchema,
    RunConfig,
    Runner,
    TResponseInputItem,
)
from pydantic import BaseModel

from chatkit.actions import Action
from chatkit.agents import AgentContext, simple_to_agent_input, stream_agent_response, ThreadItemConverter

try:  # pragma: no cover - dépend de la version du SDK Agents installée
    from chatkit.agents import stream_widget as _sdk_stream_widget
except ImportError:  # pragma: no cover - compatibilité avec les anciennes versions
    _sdk_stream_widget = None  # type: ignore[assignment]
from chatkit.server import ChatKitServer
from chatkit.store import NotFoundError
from chatkit.types import (
    ActiveStatus,
    AssistantMessageContent,
    AssistantMessageContentPartTextDelta,
    AssistantMessageItem,
    ClosedStatus,
    EndOfTurnItem,
    ErrorCode,
    ErrorEvent,
    GeneratedImage,
    ImageTask,
    InferenceOptions,
    LockedStatus,
    ProgressUpdateEvent,
    TaskItem,
    ThreadItem,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    ThreadItemRemovedEvent,
    ThreadItemUpdated,
    ThreadMetadata,
    ThreadStreamEvent,
    WidgetItem,
    WidgetRootUpdated,
    WorkflowItem,
    WorkflowTaskAdded,
    WorkflowTaskUpdated,
    UserMessageInput,
    UserMessageItem,
    UserMessageTextContent,
)

from .config import Settings, get_settings
from .chatkit_store import PostgresChatKitStore
from .database import SessionLocal
from .models import WorkflowStep, WorkflowTransition
from .workflows import (
    WorkflowService,
    resolve_start_auto_start,
    resolve_start_auto_start_message,
    resolve_start_auto_start_assistant_message,
)
from .image_utils import (
    append_generated_image_links,
    build_agent_image_absolute_url,
    format_generated_image_links,
    merge_generated_image_urls_into_payload,
    save_agent_image_file,
)
from .chatkit_server.actions import (
    _UNSET,
    _apply_widget_variable_values,
    _candidate_widget_keys,
    _clone_widget_definition,
    _collect_widget_bindings,
    _ensure_widget_output_model,
    _extract_copy_text_update,
    _extract_template_variables,
    _extract_widget_bindings_from_payload,
    _extract_widget_slug,
    _extract_widget_values,
    _json_safe_copy,
    _load_widget_definition,
    _parse_response_widget_config,
    _resolve_widget_action_payload,
    _sanitize_widget_field_name,
    _build_widget_output_model,
    _sync_button_text_fields,
    _update_widget_node_value,
    _coerce_bool,
    _remove_additional_properties_from_schema,
    _StrictSchemaBase,
    _patch_model_json_schema,
)
__path__ = [str((Path(__file__).resolve().parent / "chatkit").resolve())]

from .chatkit.agent_registry import (
    AGENT_BUILDERS,
    AGENT_RESPONSE_FORMATS,
    STEP_TITLES,
    GetDataFromUserContext,
    GetDataFromWebContext,
    Triage2Context,
    _build_custom_agent,
    _create_response_format_from_pydantic,
)
from .chatkit_server.context import (
    AutoStartConfiguration,
    ChatKitRequestContext,
    _clone_conversation_history_snapshot,
    _collect_user_text,
    _get_wait_state_metadata,
    _normalize_user_text,
    _resolve_user_input_text,
    _set_wait_state_metadata,
)
from .chatkit_server.workflow_runner import (
    _STREAM_DONE,
    _WorkflowStreamResult,
    _log_background_exceptions,
)
from .vector_store.ingestion import (
    evaluate_state_expression,
    ingest_document,
    ingest_workflow_step,
    resolve_transform_value,
)
from .weather import fetch_weather
from .widgets import WidgetLibraryService, WidgetValidationError

logger = logging.getLogger("chatkit.server")




# ---------------------------------------------------------------------------
# Définition du workflow local exécuté par DemoChatKitServer
# ---------------------------------------------------------------------------

from .workflows.executor import (
    AGENT_IMAGE_VECTOR_STORE_SLUG,
    WorkflowExecutionError,
    WorkflowInput,
    WorkflowRunSummary,
    WorkflowStepStreamUpdate,
    WorkflowStepSummary,
    _WAIT_STATE_METADATA_KEY,
    _resolve_watch_payload,
    run_workflow,
)

from .chatkit_server.server import (
    DemoChatKitServer,
    ImageAwareThreadItemConverter,
)
_server: DemoChatKitServer | None = None


def get_chatkit_server() -> DemoChatKitServer:
    """Retourne l'instance unique du serveur ChatKit."""
    global _server
    if _server is None:
        _server = DemoChatKitServer(get_settings())
    return _server
