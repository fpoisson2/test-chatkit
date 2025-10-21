from __future__ import annotations

import asyncio
import copy
import inspect
import json
import keyword
import logging
import math
import re
import uuid
import weakref
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
    FunctionTool,
    ModelSettings,
    RunConfig,
    RunContextWrapper,
    Runner,
    TResponseInputItem,
    WebSearchTool,
    function_tool,
)
from openai.types.responses import ResponseInputTextParam

try:  # pragma: no cover - dépend des versions du SDK Agents
    from agents.tool import ImageGeneration as _AgentImageGenerationConfig
    from agents.tool import ImageGenerationTool as _AgentImageGenerationTool
except ImportError:  # pragma: no cover - compatibilité rétro
    _AgentImageGenerationConfig = None  # type: ignore[assignment]
    _AgentImageGenerationTool = None  # type: ignore[assignment]

ImageGenerationTool = _AgentImageGenerationTool
from openai.types.shared.reasoning import Reasoning

try:  # pragma: no cover - certaines versions du client OpenAI n'exposent pas encore ImageGeneration
    from openai.types.responses.tool import ImageGeneration
except ImportError:  # pragma: no cover - compatibilité rétro
    ImageGeneration = None  # type: ignore[assignment]

try:  # pragma: no cover - nouveaux SDK : le paramètre est dans tool_param
    from openai.types.responses.tool_param import ImageGeneration as ImageGenerationParam
except ImportError:  # pragma: no cover - compatibilité avec les anciennes versions
    ImageGenerationParam = None  # type: ignore[assignment]
from pydantic import BaseModel, Field, create_model

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
from .token_sanitizer import sanitize_model_like
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
from backend.app.chatkit_server.actions import (
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
from backend.app.chatkit_server.context import (
    AutoStartConfiguration,
    ChatKitRequestContext,
    _WAIT_STATE_METADATA_KEY,
    _clone_conversation_history_snapshot,
    _collect_user_text,
    _get_wait_state_metadata,
    _normalize_user_text,
    _resolve_user_input_text,
    _set_wait_state_metadata,
)
from backend.app.chatkit_server.workflow_runner import (
    _STREAM_DONE,
    _WorkflowStreamResult,
    _log_background_exceptions,
)
from .vector_store import JsonVectorStoreService, SearchResult
from .weather import fetch_weather
from .widgets import WidgetLibraryService, WidgetValidationError

logger = logging.getLogger("chatkit.server")

AGENT_IMAGE_VECTOR_STORE_SLUG = "chatkit-agent-images"

_WAIT_STATE_METADATA_KEY = "workflow_wait_for_user_input"




@dataclass(frozen=True)


@dataclass





# ---------------------------------------------------------------------------
# Définition du workflow local exécuté par DemoChatKitServer
# ---------------------------------------------------------------------------


class TriageSchema(BaseModel):
    has_all_details: bool
    details_manquants: str


class RDacteurSchemaIntroPlaceCours(BaseModel):
    texte: str


class RDacteurSchemaObjectifTerminal(BaseModel):
    texte: str


class RDacteurSchemaStructureIntro(BaseModel):
    texte: str


class RDacteurSchemaActivitesTheoriques(BaseModel):
    texte: str


class RDacteurSchemaActivitesPratiques(BaseModel):
    texte: str


class RDacteurSchemaActivitesPrevuesItem(BaseModel):
    phase: str
    description: str


class RDacteurSchemaEvaluationSommative(BaseModel):
    texte: str


class RDacteurSchemaNatureEvaluationsSommatives(BaseModel):
    texte: str


class RDacteurSchemaEvaluationLangue(BaseModel):
    texte: str


class RDacteurSchemaEvaluationFormative(BaseModel):
    texte: str


class RDacteurSchemaCompetencesDeveloppeesItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaCompetencesCertifieesItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaCoursCorequisItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaObjetsCiblesItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaCoursReliesItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaCoursPrealablesItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaSavoirsFaireCapaciteItem(BaseModel):
    savoir_faire: str
    cible_100: str
    seuil_60: str


class RDacteurSchemaCapaciteItem(BaseModel):
    capacite: str
    pond_min: float
    pond_max: float
    savoirs_necessaires_capacite: list[str]
    savoirs_faire_capacite: list[RDacteurSchemaSavoirsFaireCapaciteItem]
    moyens_evaluation_capacite: list[str]


class RDacteurSchema(BaseModel):
    intro_place_cours: RDacteurSchemaIntroPlaceCours
    objectif_terminal: RDacteurSchemaObjectifTerminal
    structure_intro: RDacteurSchemaStructureIntro
    activites_theoriques: RDacteurSchemaActivitesTheoriques
    activites_pratiques: RDacteurSchemaActivitesPratiques
    activites_prevues: list[RDacteurSchemaActivitesPrevuesItem]
    evaluation_sommative: RDacteurSchemaEvaluationSommative
    nature_evaluations_sommatives: RDacteurSchemaNatureEvaluationsSommatives
    evaluation_langue: RDacteurSchemaEvaluationLangue
    evaluation_formative: RDacteurSchemaEvaluationFormative
    competences_developpees: list[RDacteurSchemaCompetencesDeveloppeesItem]
    competences_certifiees: list[RDacteurSchemaCompetencesCertifieesItem]
    cours_corequis: list[RDacteurSchemaCoursCorequisItem]
    objets_cibles: list[RDacteurSchemaObjetsCiblesItem]
    cours_relies: list[RDacteurSchemaCoursReliesItem]
    cours_prealables: list[RDacteurSchemaCoursPrealablesItem]
    savoir_etre: list[str]
    capacite: list[RDacteurSchemaCapaciteItem]


class Triage2Schema(BaseModel):
    has_all_details: bool
    details_manquants: str


def _model_settings(**kwargs: Any) -> ModelSettings:
    return sanitize_model_like(ModelSettings(**kwargs))


def _coerce_model_settings(value: Any) -> Any:
    if isinstance(value, dict):
        logger.debug("Nettoyage model_settings dict: %s", value)
        result = _model_settings(**value)
        logger.debug("Résultat après nettoyage: %s", getattr(result, "model_dump", lambda **_: result)() if hasattr(result, "model_dump") else result)
        return result
    logger.debug("Nettoyage model_settings objet: %s", value)
    result = sanitize_model_like(value)
    logger.debug("Résultat après nettoyage: %s", getattr(result, "model_dump", lambda **_: result)() if hasattr(result, "model_dump") else result)
    return result


def _sanitize_web_search_user_location(payload: Any) -> dict[str, str] | None:
    """Nettoie un dictionnaire de localisation envoyé depuis l'UI."""

    if not isinstance(payload, dict):
        return None

    sanitized: dict[str, str] = {}
    for key, value in payload.items():
        if not isinstance(key, str):
            continue
        if not isinstance(value, str):
            continue
        trimmed = value.strip()
        if trimmed:
            sanitized[key] = trimmed

    return sanitized or None


def _build_web_search_tool(payload: Any) -> WebSearchTool | None:
    """Construit un outil de recherche web à partir des paramètres sérialisés."""

    if isinstance(payload, WebSearchTool):
        return payload

    config: dict[str, Any] = {}
    if isinstance(payload, dict):
        search_context_size = payload.get("search_context_size")
        if isinstance(search_context_size, str) and search_context_size.strip():
            config["search_context_size"] = search_context_size.strip()

        user_location = _sanitize_web_search_user_location(payload.get("user_location"))
        if user_location:
            config["user_location"] = user_location

    try:
        return WebSearchTool(**config)
    except Exception:  # pragma: no cover - dépend des versions du SDK
        logger.warning(
            "Impossible d'instancier WebSearchTool avec la configuration %s", config
        )
        return None


_SUPPORTED_IMAGE_OUTPUT_FORMATS = frozenset({"png", "jpeg", "webp"})


def _normalize_image_generation_field(key: str, value: Any) -> Any:
    """Nettoie et normalise les attributs spécifiques à la génération d'image."""

    if key == "output_format":
        if isinstance(value, str):
            normalized = value.strip().lower()
            if not normalized or normalized == "auto":
                return "png"
            if normalized in _SUPPORTED_IMAGE_OUTPUT_FORMATS:
                return normalized
            logger.warning(
                "Format de sortie %r non supporté, repli sur 'png'", value
            )
            return "png"
        return None
    return value


def _build_image_generation_tool(payload: Any) -> Any | None:
    """Construit un outil de génération d'image pour l'Agents SDK."""

    config_type: type[Any] | None = _AgentImageGenerationConfig or ImageGeneration
    if config_type is None:
        return None

    if isinstance(payload, _AgentImageGenerationTool):
        return payload

    if _AgentImageGenerationTool is None and isinstance(payload, config_type):
        return payload

    config: Any = payload
    if isinstance(payload, dict):
        candidate = payload.get("image_generation")
        if isinstance(candidate, dict):
            config = candidate

    if not isinstance(config, dict):
        return None

    field_names: set[str] = set()
    if hasattr(config_type, "model_fields"):
        field_names = set(config_type.model_fields)  # type: ignore[attr-defined]
    elif hasattr(config_type, "__fields__"):
        field_names = set(config_type.__fields__)  # type: ignore[attr-defined]
    elif hasattr(config_type, "__annotations__"):
        field_names = set(config_type.__annotations__)

    if not field_names:
        field_names = {
            "type",
            "model",
            "size",
            "quality",
            "background",
            "output_format",
            "input_fidelity",
            "input_image_mask",
            "moderation",
            "output_compression",
            "partial_images",
        }

    config_kwargs: dict[str, Any] = {"type": "image_generation"}
    for key in field_names:
        if key == "type":
            continue
        value = config.get(key)
        if value is not None:
            normalized = _normalize_image_generation_field(key, value)
            if normalized is not None:
                config_kwargs[key] = normalized

    def _construct_config() -> Any | None:
        try:
            return config_type(**config_kwargs)
        except Exception:  # pragma: no cover - dépend du modèle OpenAI installé
            logger.warning(
                "Impossible de construire ImageGeneration avec la configuration %s",
                config,
            )

            construct = getattr(config_type, "model_construct", None)
            if callable(construct):  # pragma: no branch - dépend de Pydantic v2
                try:
                    return construct(**config_kwargs)  # type: ignore[misc]
                except Exception:  # pragma: no cover - garde-fou
                    return None

            construct = getattr(config_type, "construct", None)
            if callable(construct):  # pragma: no branch - compat Pydantic v1
                try:
                    return construct(**config_kwargs)  # type: ignore[misc]
                except Exception:  # pragma: no cover - garde-fou
                    return None

            if ImageGenerationParam is not None and config_type is ImageGeneration:
                try:
                    return ImageGenerationParam(**config_kwargs)
                except Exception:  # pragma: no cover - dépend du SDK
                    return None

            return None

    tool_config = _construct_config()
    if tool_config is None:
        return None

    if _AgentImageGenerationTool is not None:
        try:
            return _AgentImageGenerationTool(tool_config=tool_config)
        except Exception:  # pragma: no cover - dépend des versions du SDK
            logger.debug(
                "Impossible d'envelopper le tool ImageGeneration, retour du modèle brut."
            )

    for attribute, default in (("type", "image_generation"), ("name", "image_generation")):
        current = getattr(tool_config, attribute, None)
        if isinstance(current, str) and current.strip():
            continue
        try:
            setattr(tool_config, attribute, default)
            continue
        except Exception:  # pragma: no cover - dépend de la classe retournée
            pass
        try:
            object.__setattr__(tool_config, attribute, default)
        except Exception:  # pragma: no cover - dernier recours
            logger.debug(
                "Impossible d'imposer l'attribut %s sur %r", attribute, tool_config
            )

    return tool_config


def _extract_vector_store_ids(config: dict[str, Any]) -> list[str]:
    """Récupère la liste des identifiants de vector store à partir du payload."""

    result: list[str] = []

    raw_ids = config.get("vector_store_ids")
    if isinstance(raw_ids, (list, tuple, set)):
        for entry in raw_ids:
            if isinstance(entry, str) and entry.strip():
                normalized = entry.strip()
                if normalized not in result:
                    result.append(normalized)

    candidate = config.get("vector_store_id")
    if isinstance(candidate, str) and candidate.strip():
        normalized = candidate.strip()
        if normalized not in result:
            result.append(normalized)

    slug = config.get("vector_store_slug")
    if isinstance(slug, str) and slug.strip():
        normalized = slug.strip()
        if normalized not in result:
            result.append(normalized)

    store = config.get("store")
    if isinstance(store, dict):
        nested_slug = store.get("slug")
        if isinstance(nested_slug, str) and nested_slug.strip():
            normalized = nested_slug.strip()
            if normalized not in result:
                result.append(normalized)

    return result


def _coerce_max_num_results(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.isdigit():
            return int(stripped)
    return None


def _coerce_include_search_results(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if not normalized:
            return False
        return normalized in {"full", "true", "1", "yes", "y"}
    return False


def _coerce_ranking_options(value: Any) -> dict[str, Any] | None:
    """Nettoie les options de ranking attendues par l'outil de recherche locale."""

    if value is None:
        return None

    if isinstance(value, dict):
        data: dict[str, Any] = {}
        ranker = value.get("ranker")
        if isinstance(ranker, str) and ranker.strip():
            data["ranker"] = ranker.strip()

        threshold = value.get("score_threshold")
        if isinstance(threshold, (int, float)):
            data["score_threshold"] = float(threshold)
        elif isinstance(threshold, str):
            try:
                data["score_threshold"] = float(threshold.strip())
            except ValueError:
                pass

        return data or None

    return None


def _format_vector_store_results(
    matches: list[tuple[str, list[SearchResult]]],
    *,
    include_text: bool,
) -> list[dict[str, Any]]:
    formatted: list[dict[str, Any]] = []
    for slug, entries in matches:
        formatted_matches: list[dict[str, Any]] = []
        for entry in entries:
            item: dict[str, Any] = {
                "doc_id": entry.doc_id,
                "chunk_index": entry.chunk_index,
                "score": entry.score,
                "dense_score": entry.dense_score,
                "bm25_score": entry.bm25_score,
                "metadata": entry.metadata,
                "document_metadata": entry.document_metadata,
            }
            if include_text:
                item["text"] = entry.text
            formatted_matches.append(item)

        formatted.append(
            {
                "vector_store_slug": slug,
                "matches": formatted_matches,
            }
        )

    return formatted


def _build_file_search_tool(payload: Any) -> FunctionTool | None:
    """Construit un FunctionTool effectuant une recherche sur nos magasins locaux."""

    if isinstance(payload, FunctionTool):
        return payload

    config: dict[str, Any] = payload if isinstance(payload, dict) else {}
    vector_store_ids = _extract_vector_store_ids(config)
    if not vector_store_ids:
        return None

    max_num_results = _coerce_max_num_results(config.get("max_num_results"))
    include_search_results = _coerce_include_search_results(
        config.get("return_documents")
    )
    ranking_options = _coerce_ranking_options(config.get("ranking_options"))
    default_top_k = max_num_results if max_num_results else 5

    async def _search_vector_stores(
        query: str,
        top_k: int | None = None,
    ) -> dict[str, Any]:
        """Recherche des extraits pertinents dans les magasins configurés."""

        normalized_query = query.strip() if isinstance(query, str) else ""
        if not normalized_query:
            return {
                "query": "",
                "vector_stores": [],
                "errors": ["La requête de recherche est vide."],
            }

        limit: int = default_top_k
        if isinstance(top_k, int) and top_k > 0:
            limit = top_k

        def _search_sync() -> tuple[
            list[tuple[str, list[SearchResult]]], list[dict[str, Any]]
        ]:
            matches: list[tuple[str, list[SearchResult]]] = []
            errors: list[dict[str, Any]] = []
            with SessionLocal() as session:
                service = JsonVectorStoreService(session)
                for slug in vector_store_ids:
                    try:
                        results = service.search(
                            slug,
                            normalized_query,
                            top_k=limit,
                        )
                    except LookupError:
                        errors.append(
                            {
                                "vector_store_slug": slug,
                                "message": "Magasin introuvable.",
                            }
                        )
                        continue
                    except Exception as exc:  # pragma: no cover - dépend du runtime
                        logger.exception(
                            "Erreur lors de la recherche dans le magasin %s", slug,
                            exc_info=exc,
                        )
                        errors.append(
                            {
                                "vector_store_slug": slug,
                                "message": "Recherche impossible : erreur interne.",
                            }
                        )
                        continue

                    matches.append((slug, list(results)))

            return matches, errors

        store_matches, store_errors = await asyncio.to_thread(_search_sync)

        response: dict[str, Any] = {
            "query": normalized_query,
            "vector_stores": _format_vector_store_results(
                store_matches,
                include_text=include_search_results,
            ),
        }
        if ranking_options:
            response["ranking_options"] = ranking_options
        if store_errors:
            response["errors"] = store_errors

        return response

    tool_name = "file_search"
    if len(vector_store_ids) == 1:
        tool_name = f"file_search_{vector_store_ids[0].replace('-', '_')}"

    search_tool = function_tool(name_override=tool_name)(_search_vector_stores)
    if include_search_results:
        search_tool.description = (
            "Recherche dans les documents locaux et renvoie le texte des extraits pertinents."
        )
    else:
        search_tool.description = (
            "Recherche dans les documents locaux et renvoie les métadonnées des extraits pertinents."
        )

    return search_tool


_WEATHER_FUNCTION_TOOL_ALIASES = {"fetch_weather", "get_weather"}
_WEATHER_FUNCTION_TOOL_DEFAULT_DESCRIPTION = (
    "Récupère les conditions météorologiques actuelles via le service Python interne."
)

_WIDGET_VALIDATION_TOOL_ALIASES = {
    "validate_widget",
    "validate_widget_definition",
    "widget_validation",
}
_WIDGET_VALIDATION_TOOL_DEFAULT_DESCRIPTION = (
    "Valide une définition de widget ChatKit et renvoie la version normalisée ainsi que les erreurs éventuelles."
)


class WidgetValidationResult(BaseModel):
    """Représente le résultat structuré de la validation d'un widget."""

    valid: bool = Field(description="Indique si la définition est valide")
    normalized_definition: dict[str, Any] | None = Field(
        default=None,
        description="Version normalisée du widget lorsque la validation réussit.",
    )
    errors: list[str] = Field(
        default_factory=list,
        description="Liste des messages d'erreur retournés par la validation.",
    )


def validate_widget_definition(
    definition: Mapping[str, Any] | str,
) -> WidgetValidationResult:
    """Valide une définition de widget et retourne un rapport structuré."""

    parsed_definition: Any = definition

    if isinstance(definition, Mapping):
        parsed_definition = dict(definition)
    elif isinstance(definition, str):
        candidate = definition.strip()
        if not candidate:
            return WidgetValidationResult(
                valid=False,
                errors=["La définition de widget fournie est vide."],
            )
        try:
            parsed_definition = json.loads(candidate)
        except json.JSONDecodeError as exc:
            location = f" (ligne {exc.lineno}, colonne {exc.colno})" if exc.lineno else ""
            return WidgetValidationResult(
                valid=False,
                errors=[f"JSON invalide : {exc.msg}{location}"],
            )
        except Exception as exc:  # pragma: no cover - garde-fou
            logger.exception(
                "Erreur lors du décodage JSON de la définition de widget",
                exc_info=exc,
            )
            return WidgetValidationResult(
                valid=False,
                errors=[f"JSON invalide : {exc}"],
            )
    else:
        return WidgetValidationResult(
            valid=False,
            errors=[
                "La définition de widget doit être un objet JSON ou une chaîne JSON.",
            ],
        )

    if not isinstance(parsed_definition, Mapping):
        return WidgetValidationResult(
            valid=False,
            errors=["La définition de widget doit être un objet JSON."],
        )

    try:
        normalized = WidgetLibraryService._normalize_definition(parsed_definition)
    except WidgetValidationError as exc:
        raw_errors = exc.errors
        if isinstance(raw_errors, str):
            messages = [raw_errors]
        elif raw_errors:
            messages = [str(entry) for entry in raw_errors]
        else:
            messages = [str(exc)]
        return WidgetValidationResult(valid=False, errors=messages)
    except Exception as exc:  # pragma: no cover - garde-fou
        logger.exception(
            "Erreur inattendue lors de la validation de widget",
            exc_info=exc,
        )
        return WidgetValidationResult(
            valid=False,
            errors=[f"Erreur interne lors de la validation : {exc}"],
        )

    return WidgetValidationResult(
        valid=True,
        normalized_definition=normalized,
        errors=[],
    )


def _build_weather_function_tool(payload: Any) -> FunctionTool | None:
    """Construit un FunctionTool pointant vers la fonction Python fetch_weather."""

    if isinstance(payload, FunctionTool):
        return payload

    name_override = "fetch_weather"
    description = _WEATHER_FUNCTION_TOOL_DEFAULT_DESCRIPTION

    if isinstance(payload, dict):
        raw_name = payload.get("name") or payload.get("id") or payload.get("function_name")
        if isinstance(raw_name, str) and raw_name.strip():
            candidate = raw_name.strip()
            if candidate.lower() in _WEATHER_FUNCTION_TOOL_ALIASES:
                name_override = candidate
            else:
                return None
        raw_description = payload.get("description")
        if isinstance(raw_description, str) and raw_description.strip():
            description = raw_description.strip()
    elif isinstance(payload, str) and payload.strip():
        candidate = payload.strip()
        if candidate.lower() in _WEATHER_FUNCTION_TOOL_ALIASES:
            name_override = candidate
        else:
            return None

    tool = function_tool(name_override=name_override)(fetch_weather)
    tool.description = description
    return tool


def _build_widget_validation_function_tool(payload: Any) -> FunctionTool | None:
    """Construit un FunctionTool pointant vers validate_widget_definition."""

    if isinstance(payload, FunctionTool):
        return payload

    name_override = "validate_widget"
    description = _WIDGET_VALIDATION_TOOL_DEFAULT_DESCRIPTION

    if isinstance(payload, dict):
        raw_name = payload.get("name") or payload.get("id") or payload.get("function_name")
        if isinstance(raw_name, str) and raw_name.strip():
            candidate = raw_name.strip()
            if candidate.lower() in _WIDGET_VALIDATION_TOOL_ALIASES:
                name_override = candidate
            else:
                return None
        raw_description = payload.get("description")
        if isinstance(raw_description, str) and raw_description.strip():
            description = raw_description.strip()
    elif isinstance(payload, str) and payload.strip():
        candidate = payload.strip()
        if candidate.lower() in _WIDGET_VALIDATION_TOOL_ALIASES:
            name_override = candidate
        else:
            return None

    tool = function_tool(name_override=name_override, strict_mode=False)(
        validate_widget_definition
    )
    tool.description = description
    return tool


def _clone_tools(value: Sequence[Any] | None) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return list(value)
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return list(value)
    # Si la valeur n'est pas séquentielle (ex. un objet unique), on la
    # encapsule tout de même dans une liste pour respecter le contrat du SDK.
    return [value]


_JSON_TYPE_MAPPING: dict[str, Any] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
}


def _sanitize_model_name(name: str | None) -> str:
    candidate = (name or "workflow_output").strip()
    sanitized = re.sub(r"[^0-9a-zA-Z_]", "_", candidate) or "workflow_output"
    if sanitized[0].isdigit():
        sanitized = f"model_{sanitized}"
    return sanitized




def _create_response_format_from_pydantic(model: type[BaseModel]) -> dict[str, Any]:
    """
    Crée un response_format compatible OpenAI depuis un modèle Pydantic.

    Args:
        model: Le modèle Pydantic à convertir

    Returns:
        Un dictionnaire response_format avec type='json_schema'
    """
    # Générer le schéma JSON depuis le modèle Pydantic
    if hasattr(model, "model_json_schema"):
        # Pydantic v2
        schema = model.model_json_schema()
    elif hasattr(model, "schema"):
        # Pydantic v1
        schema = model.schema()
    else:
        raise ValueError(f"Cannot generate JSON schema from model {model}")

    # Nettoyer le schéma pour le mode strict (supprimer additionalProperties)
    schema = _remove_additional_properties_from_schema(schema)

    # Extraire le nom du modèle
    model_name = getattr(model, "__name__", "Response")
    sanitized_name = _sanitize_model_name(model_name)

    # Construire le response_format
    response_format = {
        "type": "json_schema",
        "json_schema": {
            "name": sanitized_name,
            "schema": schema,
            "strict": True,
        }
    }

    try:
        logger.debug(
            "response_format demandé (modèle=%s): %s",
            sanitized_name,
            json.dumps(response_format, ensure_ascii=False),
        )
    except Exception:  # pragma: no cover - sérialisation best effort
        logger.debug(
            "response_format demandé (modèle=%s) - impossible de sérialiser pour les logs",
            sanitized_name,
        )

    return response_format


def _lookup_known_output_type(name: str) -> type[BaseModel] | None:
    obj = globals().get(name)
    if isinstance(obj, type) and issubclass(obj, BaseModel):
        return obj
    return None


class _JsonSchemaOutputBuilder:
    """Convertit un schéma JSON simple en type Python compatible Pydantic."""

    def __init__(self) -> None:
        self._models: dict[str, type[BaseModel]] = {}

    def build_type(self, schema: Any, *, name: str) -> Any | None:
        if not isinstance(schema, dict):
            return None
        py_type, _nullable = self._resolve(schema, _sanitize_model_name(name))
        return py_type

    def _resolve(self, schema: dict[str, Any], name: str) -> tuple[Any, bool]:
        nullable = False
        schema_type = schema.get("type")

        for combination_key in ("anyOf", "oneOf"):
            options = schema.get(combination_key)
            if not isinstance(options, list) or not options:
                continue

            option_types: list[Any] = []
            option_nullable = False

            for index, option_schema in enumerate(options, start=1):
                if not isinstance(option_schema, dict):
                    return Any, True

                resolved_type, resolved_nullable = self._resolve(
                    option_schema,
                    f"{name}_{combination_key}_{index}",
                )

                if resolved_type is None or resolved_type is Any:
                    return Any, True

                option_types.append(resolved_type)
                if resolved_nullable:
                    option_nullable = True

            if not option_types:
                return Any, True

            unique_types: list[Any] = []
            for candidate in option_types:
                if not any(existing == candidate for existing in unique_types):
                    unique_types.append(candidate)

            if len(unique_types) == 1:
                return unique_types[0], nullable or option_nullable

            union_type: Any = unique_types[0]
            for candidate in unique_types[1:]:
                try:
                    union_type = union_type | candidate  # type: ignore[operator]
                except TypeError:
                    union_type = Union.__getitem__(tuple(unique_types))
                    break

            return union_type, nullable or option_nullable

        if isinstance(schema_type, list):
            normalized = [value for value in schema_type if isinstance(value, str)]
            if "null" in normalized:
                nullable = True
                normalized = [value for value in normalized if value != "null"]
            if len(normalized) == 1:
                schema_type = normalized[0]
            elif not normalized:
                schema_type = None
            else:
                return Any, nullable
        elif isinstance(schema_type, str):
            if schema_type == "null":
                return type(None), True
        else:
            schema_type = None

        if schema.get("nullable") is True:
            nullable = True

        if "enum" in schema and isinstance(schema["enum"], list) and schema["enum"]:
            enum_values = tuple(schema["enum"])
            try:
                literal_type = Literal.__getitem__(enum_values)
            except TypeError:
                return Any, nullable
            return literal_type, nullable

        if "const" in schema:
            try:
                literal_type = Literal.__getitem__((schema["const"],))
            except TypeError:
                return Any, nullable
            return literal_type, nullable

        if schema_type == "array":
            items_schema = schema.get("items")
            items_type, _ = self._resolve(items_schema if isinstance(items_schema, dict) else {}, f"{name}Item")
            if items_type is None:
                items_type = Any
            return list[items_type], nullable

        if schema_type == "object" or "properties" in schema or "additionalProperties" in schema:
            return self._build_object(schema, name), nullable

        if isinstance(schema_type, str):
            primitive = _JSON_TYPE_MAPPING.get(schema_type)
            if primitive is not None:
                return primitive, nullable

        return Any, nullable

    def _build_object(self, schema: dict[str, Any], name: str) -> Any:
        sanitized = _sanitize_model_name(name)
        cached = self._models.get(sanitized)
        if cached is not None:
            return cached

        properties = schema.get("properties")
        if not isinstance(properties, dict):
            additional = schema.get("additionalProperties")
            if isinstance(additional, dict):
                value_type, _ = self._resolve(additional, f"{sanitized}Value")
                value_type = value_type if value_type is not None else Any
                return dict[str, value_type]
            if additional:
                return dict[str, Any]
            model = create_model(sanitized, __module__=__name__, __base__=_StrictSchemaBase)
            _patch_model_json_schema(model)
            self._models[sanitized] = model
            return model

        if not properties:
            model = create_model(sanitized, __module__=__name__, __base__=_StrictSchemaBase)
            _patch_model_json_schema(model)
            self._models[sanitized] = model
            return model

        sanitized_fields: dict[str, str] = {}
        used_names: set[str] = set()
        for index, prop in enumerate(properties, start=1):
            if not isinstance(prop, str):
                return dict[str, Any]
            if prop.isidentifier() and not keyword.iskeyword(prop) and prop not in used_names:
                sanitized_fields[prop] = prop
                used_names.add(prop)
                continue

            field_name = _sanitize_widget_field_name(prop, fallback=f"field_{index}")
            if keyword.iskeyword(field_name):
                field_name = f"{field_name}_"
            if field_name in used_names:
                suffix = 1
                base_name = field_name
                while f"{base_name}_{suffix}" in used_names:
                    suffix += 1
                field_name = f"{base_name}_{suffix}"
            used_names.add(field_name)
            sanitized_fields[prop] = field_name

        required_raw = schema.get("required")
        required: set[str] = set()
        if isinstance(required_raw, list):
            for item in required_raw:
                if isinstance(item, str):
                    required.add(item)

        field_definitions: dict[str, tuple[Any, Any]] = {}
        for prop_name, prop_schema in properties.items():
            nested_schema = prop_schema if isinstance(prop_schema, dict) else {}
            prop_type, prop_nullable = self._resolve(
                nested_schema,
                f"{sanitized}_{prop_name}",
            )
            if prop_type is None:
                prop_type = Any
            field_type = prop_type
            is_required = prop_name in required
            if prop_nullable:
                field_type = field_type | None if field_type is not Any else Any
            field_name = sanitized_fields.get(prop_name)
            if field_name is None:
                return dict[str, Any]

            def _build_field(default: Any) -> Any:
                try:
                    return Field(
                        default,
                        alias=prop_name,
                        serialization_alias=prop_name,
                    )
                except TypeError:  # pragma: no cover - compatibilité Pydantic v1
                    field = Field(default, alias=prop_name)
                    if hasattr(field, "serialization_alias"):
                        try:
                            setattr(field, "serialization_alias", prop_name)
                        except Exception:
                            pass
                    return field

            if not is_required:
                if not prop_nullable:
                    field_type = field_type | None if field_type is not Any else Any
                field_definitions[field_name] = (
                    field_type,
                    _build_field(default=None),
                )
            else:
                field_definitions[field_name] = (
                    field_type,
                    _build_field(default=Ellipsis),
                )

        model = create_model(
            sanitized,
            __module__=__name__,
            __base__=_StrictSchemaBase,
            **field_definitions,
        )
        _patch_model_json_schema(model)
        self._models[sanitized] = model
        return model


def _build_output_type_from_response_format(response_format: Any, *, fallback: Any | None) -> Any | None:
    if not isinstance(response_format, dict):
        logger.warning(
            "Format de réponse agent invalide (type inattendu) : %s. Utilisation du type existant.",
            response_format,
        )
        return fallback

    fmt_type = response_format.get("type")
    if fmt_type != "json_schema":
        logger.warning(
            "Format de réponse %s non pris en charge, utilisation du type existant.",
            fmt_type,
        )
        return fallback

    schema_payload: Any | None = None
    schema_name_raw: str | None = None

    json_schema = response_format.get("json_schema")
    if isinstance(json_schema, Mapping):
        schema_name_raw = json_schema.get("name") if isinstance(json_schema.get("name"), str) else None
        schema_payload = json_schema.get("schema") if isinstance(json_schema.get("schema"), Mapping) else json_schema.get("schema")
    elif json_schema is not None:
        logger.warning(
            "Format JSON Schema invalide (clé 'json_schema' inattendue) pour la configuration agent : %s. Utilisation du type existant.",
            response_format,
        )
        return fallback

    if schema_name_raw is None:
        alt_name = response_format.get("name")
        if isinstance(alt_name, str) and alt_name.strip():
            schema_name_raw = alt_name

    original_name = schema_name_raw if isinstance(schema_name_raw, str) and schema_name_raw.strip() else None
    schema_name = _sanitize_model_name(original_name)

    if schema_payload is None:
        schema_payload = response_format.get("schema")

    if not isinstance(schema_payload, Mapping):
        logger.warning(
            "Format JSON Schema sans contenu pour %s, utilisation du type existant.",
            schema_name,
        )
        return fallback
    schema_payload = dict(schema_payload)

    known = None
    if original_name:
        known = _lookup_known_output_type(original_name)
    if known is None:
        known = _lookup_known_output_type(schema_name)
    if known is not None:
        return known

    builder = _JsonSchemaOutputBuilder()
    built = builder.build_type(schema_payload, name=schema_name)
    if built is None:
        logger.warning(
            "Impossible de construire un output_type depuis le schéma %s, utilisation du type existant.",
            schema_name,
        )
        return fallback

    return built


def _coerce_agent_tools(
    value: Any, fallback: Sequence[Any] | None = None
) -> Sequence[Any] | None:
    """Convertit les outils sérialisés en instances compatibles avec le SDK Agents."""

    if value is None:
        return _clone_tools(fallback)

    if not isinstance(value, list):
        return value

    coerced: list[Any] = []
    for entry in value:
        if isinstance(entry, WebSearchTool):
            coerced.append(entry)
            continue

        if isinstance(entry, dict):
            tool_type = entry.get("type") or entry.get("tool") or entry.get("name")
            normalized_type = tool_type.strip().lower() if isinstance(tool_type, str) else ""

            if normalized_type == "web_search":
                tool = _build_web_search_tool(entry.get("web_search"))
                if tool is not None:
                    coerced.append(tool)
                continue

            if normalized_type == "file_search":
                tool = _build_file_search_tool(entry.get("file_search"))
                if tool is not None:
                    coerced.append(tool)
                continue

            if normalized_type == "image_generation":
                tool = _build_image_generation_tool(entry)
                if tool is not None:
                    coerced.append(tool)
                continue

            if normalized_type == "function":
                function_payload = entry.get("function")
                tool = _build_weather_function_tool(function_payload)
                if tool is None:
                    tool = _build_widget_validation_function_tool(function_payload)
                if tool is not None:
                    coerced.append(tool)
                continue

    if coerced:
        return coerced

    if value:
        logger.warning(
            "Outils agent non reconnus (%s), utilisation de la configuration par défaut.",
            value,
        )
        return _clone_tools(fallback)

    return []


def _build_response_format_from_widget(
    response_widget: dict[str, Any]
) -> dict[str, Any] | None:
    """
    Construit un response_format à partir d'une configuration response_widget.

    Args:
        response_widget: Configuration du widget (avec 'source', 'slug', etc.)

    Returns:
        Un dictionnaire response_format compatible ou None si impossible
    """
    logger.info(
        "_build_response_format_from_widget appelée avec: %s",
        response_widget
    )

    if not isinstance(response_widget, dict):
        return None

    source = response_widget.get("source")
    if source != "library":
        # Pour l'instant, on ne gère que les widgets de bibliothèque
        logger.debug(
            "response_widget avec source '%s' non géré, seule 'library' est supportée",
            source,
        )
        return None

    slug = response_widget.get("slug")
    if not isinstance(slug, str) or not slug.strip():
        logger.warning(
            "response_widget de type 'library' sans slug valide : %s",
            response_widget,
        )
        return None

    # Importer le service de widgets
    try:
        from .widgets.service import WidgetLibraryService
    except ImportError:
        logger.warning(
            "Impossible d'importer WidgetLibraryService pour traiter response_widget"
        )
        return None

    # Récupérer le widget depuis la bibliothèque
    try:
        # Créer une session pour accéder à la base de données
        session = SessionLocal()
        try:
            widget_service = WidgetLibraryService(session)
            widget_entry = widget_service.get_widget(slug)
        finally:
            session.close()

        if widget_entry is None:
            logger.warning(
                "Widget '%s' introuvable dans la bibliothèque",
                slug,
            )
            return None

        # Extraire les variables du widget depuis response_widget
        widget_variables = response_widget.get("variables", {})

        logger.debug(
            "Variables extraites du widget '%s': %s (type: %s)",
            slug,
            widget_variables,
            type(widget_variables).__name__
        )

        # Créer un schéma JSON basé sur les variables du widget
        # Le schéma doit représenter un objet avec les propriétés correspondant aux variables
        properties = {}
        required = []

        # Pour chaque variable du widget (ex: "image.alt", "image.src")
        # On crée une propriété dans le schéma
        # IMPORTANT: Utiliser les noms de champs sanitisés (sans points) pour OpenAI strict mode
        # Le modèle Pydantic gère la conversion via les aliases
        for var_path in widget_variables.keys():
            # Normaliser le chemin (remplacer les points par des underscores pour le schéma)
            # car OpenAI strict mode peut avoir des problèmes avec les points dans les clés
            safe_key = _sanitize_widget_field_name(var_path, fallback=var_path.replace(".", "_"))

            properties[safe_key] = {
                "type": "string",
                "description": f"Valeur pour {var_path}"
            }
            required.append(safe_key)

        logger.debug(
            "Propriétés générées pour le widget '%s': %s",
            slug,
            list(properties.keys())
        )

        # Si aucune variable n'est définie, créer un schéma pour le widget complet
        if not properties:
            # Utiliser la définition du widget elle-même comme schéma
            # Le LLM devra générer un JSON conforme à la structure du widget
            try:
                from chatkit.widgets import WidgetRoot
            except ImportError:
                logger.warning(
                    "Impossible d'importer WidgetRoot pour générer le schéma du widget"
                )
                return None

            # Générer le schéma JSON à partir du modèle Pydantic
            try:
                # Pydantic v2
                if hasattr(WidgetRoot, "model_json_schema"):
                    schema = WidgetRoot.model_json_schema()
                # Pydantic v1
                elif hasattr(WidgetRoot, "schema"):
                    schema = WidgetRoot.schema()
                else:
                    logger.warning(
                        "Impossible de générer le schéma JSON pour WidgetRoot"
                    )
                    return None

                # Nettoyer le schéma pour le mode strict
                schema = _remove_additional_properties_from_schema(schema)
            except Exception as exc:
                logger.exception(
                    "Erreur lors de la génération du schéma JSON pour le widget '%s'",
                    slug,
                    exc_info=exc,
                )
                return None
        else:
            # Créer un schéma personnalisé basé sur les variables
            # Note: on ne met pas additionalProperties en mode strict
            schema = {
                "type": "object",
                "properties": properties,
                "required": required,
            }

        # Construire le response_format
        widget_name = widget_entry.title or slug
        response_format: dict[str, Any] = {
            "type": "json_schema",
            "name": f"widget_{slug.replace('-', '_')}",
            "schema": schema,
            "strict": True,
        }
        description = widget_entry.description or f"Widget {widget_name}"
        if description:
            response_format["description"] = description

        logger.info(
            "response_format généré depuis le widget de bibliothèque '%s' (variables: %s)",
            slug,
            list(widget_variables.keys()) if widget_variables else "aucune",
        )
        try:
            logger.debug(
                "response_format demandé pour le widget '%s': %s",
                slug,
                json.dumps(response_format, ensure_ascii=False),
            )
        except Exception:  # pragma: no cover - sérialisation best effort
            logger.debug(
                "response_format demandé pour le widget '%s' - impossible de sérialiser pour les logs",
                slug,
            )
        return response_format

    except Exception as exc:
        logger.exception(
            "Erreur lors de la récupération du widget '%s' depuis la bibliothèque",
            slug,
            exc_info=exc,
        )
        return None


def _build_agent_kwargs(
    base_kwargs: dict[str, Any], overrides: dict[str, Any] | None
) -> dict[str, Any]:
    merged = {**base_kwargs}
    if overrides:
        for key, value in overrides.items():
            merged[key] = value

    # Traiter response_widget et le convertir en response_format si nécessaire
    response_widget = merged.pop("response_widget", None)
    sync_output_type = True

    if response_widget is not None and "response_format" not in merged:
        # Tenter de générer un response_format depuis le widget
        generated_format = _build_response_format_from_widget(response_widget)
        if generated_format is not None:
            merged["response_format"] = generated_format
            merged.pop("output_type", None)
            sync_output_type = False
    if "model_settings" in merged:
        merged["model_settings"] = _coerce_model_settings(merged["model_settings"])
    if "tools" in merged:
        merged["tools"] = _coerce_agent_tools(
            merged["tools"], base_kwargs.get("tools") if base_kwargs else None
        )
    if "response_format" in merged:
        response_format = merged.pop("response_format")
        if sync_output_type:
            output_type = merged.get("output_type")
            resolved = _build_output_type_from_response_format(
                response_format,
                fallback=output_type,
            )
            if resolved is not None:
                merged["output_type"] = resolved
            elif "output_type" not in base_kwargs and "output_type" in merged:
                # Aucun type exploitable fourni, on retire la clé pour éviter les incohérences.
                merged.pop("output_type", None)
        else:
            merged.pop("output_type", None)
        merged["_response_format_override"] = response_format
    return merged


_AGENT_RESPONSE_FORMATS: "weakref.WeakKeyDictionary[Agent, dict[str, Any]]" = weakref.WeakKeyDictionary()


def _instantiate_agent(kwargs: dict[str, Any]) -> Agent:
    response_format = kwargs.pop("_response_format_override", None)
    agent = Agent(**kwargs)
    if response_format is not None:
        try:
            setattr(agent, "response_format", response_format)
        except Exception:
            logger.debug(
                "Impossible d'attacher response_format directement à l'agent %s",
                getattr(agent, "name", "<inconnu>"),
            )
        try:
            setattr(agent, "_chatkit_response_format", response_format)
        except Exception:
            logger.debug(
                "Impossible de stocker _chatkit_response_format pour l'agent %s",
                getattr(agent, "name", "<inconnu>"),
            )
        try:
            _AGENT_RESPONSE_FORMATS[agent] = response_format
        except Exception:
            logger.debug(
                "Impossible de mémoriser le response_format pour l'agent %s",
                getattr(agent, "name", "<inconnu>"),
            )
    return agent


web_search_preview = WebSearchTool(
    search_context_size="medium",
    user_location={
        "city": "Québec",
        "country": "CA",
        "region": "QC",
        "type": "approximate",
    },
)


def _build_triage_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "Triage",
        "instructions": (
            """Ton rôle : Vérifier si toutes les informations nécessaires sont présentes pour générer un plan-cadre.
Si oui → has_all_details: true
Sinon → has_all_details: false + lister uniquement les éléments manquants

Ne génère pas encore le plan-cadre.

Informations attendues
Le plan-cadre pourra être généré seulement si les champs suivants sont fournis :
code_cours:
nom_cours:
programme:
fil_conducteur:
session:
cours_prealables: []       # Codes + titres
cours_requis: []           # (optionnel)
cours_reliés: []           # (optionnel)
heures_theorie:
heures_lab:
heures_maison:
competences_developpees: []   # Codes + titres
competences_atteintes: []     # Codes + titres
competence_nom:               # Pour la section Description des compétences développées
cours_developpant_une_meme_competence: [] # Pour les activités pratiques
Une idée générale de ce qui devrait se retrouver dans le cours."""
        ),
        "model": "gpt-5",
        "output_type": TriageSchema,
        "model_settings": _model_settings(
            store=True,
            reasoning=Reasoning(
                effort="minimal",
                summary="auto",
            ),
        ),
    }
    return _instantiate_agent(_build_agent_kwargs(base_kwargs, overrides))


def _build_thread_title_agent() -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "TitreFil",
        "model": "gpt-5-nano",
        "instructions": (
            """Propose un titre court et descriptif en français pour un nouveau fil de discussion.
Utilise au maximum 6 mots.
N'inclus ni guillemets ni ponctuation finale.
Si le message ne contient pas d'information, réponds «Nouvelle conversation»."""
        ),
        "model_settings": _model_settings(
            store=False,
            reasoning=Reasoning(
                effort="minimal",
            ),
        ),
    }
    return _instantiate_agent(_build_agent_kwargs(base_kwargs, None))


R_DACTEUR_INSTRUCTIONS = (
    """Tu es un assistant pédagogique qui génère, en français, des contenus de plan-cadre selon le ton institutionnel : clairs, concis, rigoureux, rédigés au vouvoiement. Tu ne t’appuies que sur les informations fournies dans le prompt utilisateur, sans inventer de contenu. Si une information manque et qu’aucune directive de repli n’est donnée, omets l’élément manquant.

**CONTRAINTE SPÉCIALE – SAVOIR ET SAVOIR-FAIRE PAR CAPACITÉ**
Pour chaque capacité identifiée dans le cours, tu dois générer explicitement :
- La liste des savoirs nécessaires à la maîtrise de cette capacité (minimum 10 par capacité)
- La liste des savoir-faire associés à cette même capacité (minimum 10 par capacité, chacun avec niveau cible et seuil)

Ton rôle est de récupérer les informations manquantes pour rédiger le plan-cadre.
Demande à l'utilisateur les informations manquantes.

SECTIONS ET RÈGLES DE GÉNÉRATION

## Intro et place du cours
Génère une description détaillée pour le cours «{{code_cours}} – {{nom_cours}}» qui s’inscrit dans le fil conducteur «{{fil_conducteur}}» du programme de {{programme}} et se donne en session {{session}} de la grille de cours.

La description devra comporter :

Une introduction qui situe le cours dans son contexte (code, nom, fil conducteur, programme et session).

Une explication sur l’importance des connaissances préalables pour réussir ce cours.

Pour chaque cours préalable listé dans {{cours_prealables}}, détaillez les connaissances et compétences essentielles acquises et expliquez en quoi ces acquis sont indispensables pour aborder les notions spécifiques du cours actuel.

Le texte final devra adopter un style clair et pédagogique, similaire à l’exemple suivant, mais adapté au contenu du présent cours :

"Le cours «243-4Q4 – Communication radio» s’inscrit dans le fil conducteur «Sans-fil et fibre optique» du programme de Technologie du génie électrique : Réseaux et télécommunications et se donne en session 4. Afin de bien réussir ce cours, il est essentiel de maîtriser les connaissances préalables acquises dans «nom du cours», particulièrement [connaissances et compétences]. Ces acquis permettront aux personnes étudiantes de saisir plus aisément les notions [ de ... ]abordées dans le présent cours."

---

## Objectif terminal
Écrire un objectif terminal pour le cours {{nom_cours}} qui devrait commencer par: "Au terme de ce cours, les personnes étudiantes seront capables de" et qui termine par un objectif terminal qui correspond aux compétences à développer ou atteinte({{competences_developpees}}{{competences_atteintes}}). Celui-ci devrait clair, mais ne comprendre que 2 ou 3 actes. Le e nom du cours donne de bonnes explications sur les technologies utilisés dans le cours, à intégrer dans l'objectif terminal.

---

## Introduction Structure du Cours
Le cours «{{nom_cours}}» prévoit {{heures_theorie}} heures de théorie, {{heures_lab}} heures d’application en travaux pratiques ou en laboratoire et {{heures_maison}} heures de travail personnel sur une base hebdomadaire.

---

## Activités Théoriques
Écrire un texte sous cette forme adapté à la nature du cours ({{nom_cours}}), celui-ci devrait être similaire en longueur et en style:

"Les séances théoriques du cours visent à préparer les personnes étudiantes en vue de la mise en pratique de leurs connaissances au laboratoire. Ces séances seront axées sur plusieurs aspects, notamment les éléments constitutifs des systèmes électroniques analogiques utilisés en télécommunications. Les personnes étudiantes auront l'opportunité d'approfondir leur compréhension par le biais de discussions interactives, des exercices et des analyses de cas liés à l’installation et au fonctionnement des systèmes électroniques analogiques. "

---

## Activités Pratiques
Écrire un texte sous cette forme adapté à la nature du cours {{nom_cours}}, celui-ci devrait être similaire en longueur et en style.  Le premier chiffre après 243 indique la session sur 6 et le nom du cours donne de bonnes explications sur le matériel ou la technologie utilisé dans le cours

Voici les cours reliés:
{{cours_developpant_une_meme_competence}}

Voici un exemple provenant d'un autre cours de mes attentes:
"La structure des activités pratiques sur les 15 semaines du cours se déroulera de manière progressive et devrait se dérouler en 4 phases. La première phrase devrait s’inspirer du quotidien des personnes étudiantes qui, généralement, ont simplement utilisé des systèmes électroniques. Son objectif serait donc de favoriser la compréhension des composants essentiels des systèmes électroniques analogiques. Cela devrait conduire à une compréhension d’un système d’alimentation basé sur des panneaux solaires photovoltaïques, offrant ainsi une introduction pertinente aux systèmes d’alimentation en courant continu, utilisés dans les télécommunications. La seconde phase devrait mener l’a personne à comprendre la nature des signaux alternatifs dans le cadre de systèmes d’alimentation en courant alternatif et sur des signaux audios. La troisième phase viserait une exploration des systèmes de communication radio. Finalement, la dernière phase viserait à réaliser un projet final combinant les apprentissages réalisés, en partenariat avec les cours 243-1N5-LI - Systèmes numériques et 243-1P4-LI – Travaux d’atelier."

---

## Activités Prévues
Décrire les différentes phases de manière succincte en utilisant cette forme. Ne pas oublier que la session dure 15 semaines.

**Phase X - titre de la phase (Semaines Y à 4Z)**
  - Description de la phase

---

## Évaluation Sommative des Apprentissages
Pour la réussite du cours, la personne étudiante doit obtenir la note de 60% lorsque l'on fait la somme pondérée des capacités.

La note attribuée à une capacité ne sera pas nécessairement la moyenne cumulative des résultats des évaluations pour cette capacité, mais bien le reflet des observations constatées en cours de session, par la personne enseignante et le jugement global de cette dernière.

---

## Nature des Évaluations Sommatives
Inclure un texte similaire à celui-ci:

L’évaluation sommative devrait surtout être réalisée à partir de travaux pratiques effectués en laboratoire, alignés avec le savoir-faire évalué. Les travaux pratiques pourraient prendre la forme de...

Pour certains savoirs, il est possible que de courts examens théoriques soient le moyen à privilégier, par exemple pour les savoirs suivants:
...

---

## Évaluation de la Langue
Utiliser ce modèle:

Dans un souci de valorisation de la langue, l’évaluation de l’expression et de la communication en français se fera de façon constante par l’enseignant(e) sur une base formative, à l’oral ou à l’écrit. Son évaluation se fera sur une base sommative pour les savoir-faire reliés à la documentation. Les critères d’évaluation se trouvent au plan général d’évaluation sommative présenté à la page suivante. Les dispositions pour la valorisation de l’expression et de la communication en français sont encadrées par les modalités particulières d’application de l’article 6.6 de la PIEA (Politique institutionnelle d’évaluation des apprentissages) et sont précisées dans le plan de cours.

---

## Évaluation formative des apprentissages
Sur une base régulière, la personne enseignante proposera des évaluations formatives à réaliser en classe, en équipe ou individuellement. Elle pourrait offrir des mises en situation authentiques de même que des travaux pratiques et des simulations. Des lectures dirigées pourraient également être proposées. L’évaluation formative est continue et intégrée aux activités d’apprentissage et d’enseignement et poursuit les fins suivantes :

...
Définir le concept de superposition d’ondes.
Expliquer la différence entre interférence constructive et destructive.
Décrire les causes possibles de réflexion dans un système de transmission.
Comprendre l’effet de la longueur électrique sur les ondes stationnaires.
… (jusqu’à au moins 10)
Comment adapter à ce cours
Identifier les notions clés propres au présent cours (ex. décrire les types de risques financiers, expliquer les mécanismes d’authentification en sécurité informatique, etc.).
Veiller à ce que la liste couvre l’essentiel de la base théorique nécessaire pour développer les savoir-faire ultérieurement.
Rester cohérent avec la complexité de la capacité. Pas de verbes trop avancés si on vise la simple compréhension.

---

## Savoirs faire d'une capacité
Objectif général
Définir ce que les apprenants doivent être capables de faire (actions concrètes) pour démontrer qu’ils atteignent la capacité. Chaque savoir-faire est accompagné de deux niveaux de performance : cible (100 %) et seuil de réussite (60 %).

Instructions détaillées
Lister au moins 10 savoir-faire.
Chaque savoir-faire doit commencer par un verbe à l’infinitif (ex. Mesurer, Calculer, Configurer, Vérifier, etc.).
Il doit représenter une action observable et évaluable.
Pour chaque savoir-faire, préciser :
Cible (niveau optimal, 100 %) : Formulée à l’infinitif, décrivant la maîtrise complète ou la performance idéale.
Seuil de réussite (niveau minimal, 60 %) : Aussi formulée à l’infinitif, décrivant la version minimale acceptable du même savoir-faire.
Éviter :
Les notions de quantité ou répétition (ex. « faire X fois »).
Les noms d’outils ou de technologies précises.
Exemple d’attendu
Savoir-faire : Analyser l’effet des réflexions sur une ligne de transmission

Cible (100 %) : Analyser avec précision les variations de signal en identifiant clairement l’origine des désadaptations.
Seuil (60 %) : Analyser les variations de manière suffisante pour repérer les principales anomalies et causes de désadaptation.
Savoir-faire : Mesurer l’impédance caractéristique d’un support

Cible (100 %) : Mesurer avec exactitude l’impédance en appliquant la bonne méthode et en interprétant correctement les résultats.
Seuil (60 %) : Mesurer l’impédance de base et reconnaître les écarts majeurs par rapport à la valeur attendue.
(jusqu’à avoir 10 savoir-faire minimum)

Comment adapter au présent cours
Transformer les actions en fonction du domaine (ex. Configurer un serveur Web, Concevoir une base de données, Effectuer une analyse de rentabilité, etc.).
Ajuster le langage et la précision selon le niveau visé (Bloom). Par exemple, Appliquer ou Mettre en œuvre pour un niveau intermédiaire, Concevoir ou Évaluer pour un niveau avancé.
Adapter les niveaux cible et seuil pour refléter les attendus concrets dans la pratique de votre discipline.

---

## Moyen d'évaluation d'une capacité
Trouve 3 ou 4 moyens d'évaluations adaptés pour cette capacité.

# Remarques

- Respecter la logique explicite : lier savoirs, savoir-faire et évaluation à chaque capacité (ne pas globaliser).
- S’assurer que chaque tableau “capacités” contient systématiquement la triple structure : savoirs, savoir-faire, moyens d’évaluation.
- Reproduire fidèlement la langue et le degré de précision montré dans les exemples.
- Pour toutes les listes longues (ex : savoirs, savoir-faire), fournir la longueur requise (même si exemples ci-dessous sont abrégés).
- Pour les exemples, utiliser des placeholders réalistes : (ex : “Décrire les principes de base du [concept central du cours]”).

---

**Résumé importante** :
Pour chaque capacité, générez immédiatement après son texte et sa pondération :
- La liste complète de ses savoirs nécessaires ;
- La liste complète de ses savoir-faire associés (avec cible et seuil) ;
- Les moyens d’évaluation pertinents pour cette capacité.

Générez les autres sections exactement comme décrit, sans ajout ni omission spontanée.
"""
)


def _build_r_dacteur_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "Rédacteur",
        "instructions": R_DACTEUR_INSTRUCTIONS,
        "model": "gpt-4.1-mini",
        "output_type": RDacteurSchema,
        "model_settings": _model_settings(
            temperature=1,
            top_p=1,
            store=True,
        ),
    }
    return _instantiate_agent(_build_agent_kwargs(base_kwargs, overrides))


class GetDataFromWebContext:
    def __init__(self, state_infos_manquantes: str) -> None:
        self.state_infos_manquantes = state_infos_manquantes


def get_data_from_web_instructions(
    run_context: RunContextWrapper[GetDataFromWebContext],
    _agent: Agent[GetDataFromWebContext],
) -> str:
    state_infos_manquantes = run_context.context.state_infos_manquantes
    return f"""Ton rôle est de récupérer les informations manquantes pour rédiger le plan-cadre.
Va chercher sur le web pour les informations manquantes.

Voici les informations manquantes:
 {state_infos_manquantes}

code_cours:
nom_cours:
programme:
fil_conducteur:
session:
cours_prealables: []       # Codes + titres
cours_requis: []           # (optionnel)
cours_reliés: []           # (optionnel)
heures_theorie:
heures_lab:
heures_maison:
competences_developpees: []   # Codes + titres
competences_atteintes: []     # Codes + titres
competence_nom:               # Pour la section Description des compétences développées
cours_developpant_une_meme_competence: [] # Pour les activités pratiques
Une idée générale de ce qui devrait se retrouver dans le cours"""


def _build_get_data_from_web_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "Get data from web",
        "instructions": get_data_from_web_instructions,
        "model": "gpt-5-mini",
        "tools": [web_search_preview],
        "model_settings": _model_settings(
            store=True,
            reasoning=Reasoning(
                effort="medium",
                summary="auto",
            ),
        ),
    }
    return _instantiate_agent(_build_agent_kwargs(base_kwargs, overrides))


class Triage2Context:
    def __init__(self, input_output_text: str) -> None:
        self.input_output_text = input_output_text


def triage_2_instructions(
    run_context: RunContextWrapper[Triage2Context],
    _agent: Agent[Triage2Context],
) -> str:
    input_output_text = run_context.context.input_output_text
    return f"""Ton rôle : Vérifier si toutes les informations nécessaires sont présentes pour générer un plan-cadre.
Si oui → has_all_details: true
Sinon → has_all_details: false + lister uniquement les éléments manquants

Ne génère pas encore le plan-cadre.

Informations attendues
Le plan-cadre pourra être généré seulement si les champs suivants sont fournis :
code_cours:
nom_cours:
programme:
fil_conducteur:
session:
cours_prealables: []       # Codes + titres cours_requis: []           # (optionnel)
cours_reliés: []           # (optionnel)
heures_theorie:
heures_lab:
heures_maison:
competences_developpees: []   # Codes + titres
competences_atteintes: []     # Codes + titres
competence_nom:               # Pour la section Description des compétences développées cours_developpant_une_meme_competence: [] # Pour les activités pratiques
Une idée générale de ce qui devrait se retrouver dans le cours.

Voici les informations connues {input_output_text}"""


def _build_triage_2_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "Triage 2",
        "instructions": triage_2_instructions,
        "model": "gpt-5",
        "output_type": Triage2Schema,
        "model_settings": _model_settings(
            store=True,
            reasoning=Reasoning(
                effort="minimal",
                summary="auto",
            ),
        ),
    }
    return _instantiate_agent(_build_agent_kwargs(base_kwargs, overrides))


class GetDataFromUserContext:
    def __init__(self, state_infos_manquantes: str) -> None:
        self.state_infos_manquantes = state_infos_manquantes


def get_data_from_user_instructions(
    run_context: RunContextWrapper[GetDataFromUserContext],
    _agent: Agent[GetDataFromUserContext],
) -> str:
    state_infos_manquantes = run_context.context.state_infos_manquantes
    return f"""Ton rôle est de récupérer les informations manquantes pour rédiger le plan-cadre.

Arrête-toi et demande à l'utilisateur les informations manquantes.
infos manquantes:
 {state_infos_manquantes}
"""


def _build_get_data_from_user_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "Get data from user",
        "instructions": get_data_from_user_instructions,
        "model": "gpt-5-nano",
        "model_settings": _model_settings(
            store=True,
            reasoning=Reasoning(
                effort="medium",
                summary="auto",
            ),
        ),
    }
    return _instantiate_agent(_build_agent_kwargs(base_kwargs, overrides))


_CUSTOM_AGENT_FALLBACK_NAME = "Agent personnalisé"


def _build_custom_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {"name": _CUSTOM_AGENT_FALLBACK_NAME}
    merged = _build_agent_kwargs(base_kwargs, overrides or {})
    name = merged.get("name")
    if not isinstance(name, str) or not name.strip():
        merged["name"] = _CUSTOM_AGENT_FALLBACK_NAME
    return _instantiate_agent(merged)


_AGENT_BUILDERS: dict[str, Callable[[dict[str, Any] | None], Agent]] = {
    "triage": _build_triage_agent,
    "r_dacteur": _build_r_dacteur_agent,
    "get_data_from_web": _build_get_data_from_web_agent,
    "triage_2": _build_triage_2_agent,
    "get_data_from_user": _build_get_data_from_user_agent,
}


_STEP_TITLES: dict[str, str] = {
    "triage": "Analyse des informations fournies",
    "r_dacteur": "Rédaction du plan-cadre",
    "get_data_from_web": "Collecte d'exemples externes",
    "triage_2": "Validation après collecte",
    "get_data_from_user": "Demande d'informations supplémentaires",
}


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
    end_state: "WorkflowEndState | None" = None


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

    if isinstance(payload, (dict, list)):
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

        if isinstance(parsed, (dict, list)):
            try:
                return json.dumps(parsed, ensure_ascii=False, indent=2)
            except TypeError:
                return str(parsed)
        return str(parsed)

    return str(payload)


def _resolve_watch_payload(
    context: Any, steps: Sequence["WorkflowStepSummary"]
) -> Any:
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
    on_widget_step: Callable[
        [WorkflowStep, _ResponseWidgetConfig], Awaitable[Mapping[str, Any] | None]
    ]
    | None = None,
    workflow_service: WorkflowService | None = None,
    thread_item_converter: ThreadItemConverter | None = None,
    thread_items_history: list[ThreadItem] | None = None,
) -> WorkflowRunSummary:
    workflow_payload = workflow_input.model_dump()
    steps: list[WorkflowStepSummary] = []
    auto_started = bool(workflow_payload.get("auto_start_was_triggered"))
    initial_user_text = _normalize_user_text(workflow_payload["input_as_text"])
    workflow_payload["input_as_text"] = initial_user_text
    current_input_item_id = workflow_payload.get("source_item_id")
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
    # IMPORTANT: Exclure le message utilisateur actuel (source_item_id) pour éviter la duplication
    if thread_items_history and thread_item_converter:
        try:
            # Filtrer le message utilisateur actuel de l'historique
            filtered_history = [
                item for item in thread_items_history
                if item.id != current_input_item_id
            ]
            if filtered_history:
                converted_history = await thread_item_converter.to_agent_input(filtered_history)
                if converted_history:
                    conversation_history.extend(converted_history)
        except Exception as exc:
            logger.warning(
                "Impossible de convertir l'historique des thread items, poursuite sans historique",
                exc_info=exc,
            )

    # Ajouter le message utilisateur actuel
    restored_state: dict[str, Any] | None = None
    if pending_wait_state:
        stored_state = pending_wait_state.get("state")
        if isinstance(stored_state, Mapping):
            restored_state = copy.deepcopy(dict(stored_state))

    if initial_user_text.strip():
        conversation_history.append(
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": initial_user_text,
                    }
                ],
            }
        )
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
        assistant_message_payload = resolve_start_auto_start_assistant_message(definition)

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
        stored_input_id = waiting_input_id if isinstance(waiting_input_id, str) else None
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
        logger.debug("Paramètres bruts du step %s: %s", step.slug, json.dumps(step.parameters, ensure_ascii=False) if step.parameters else "{}")

        widget_config = _register_widget_config(step)

        agent_key = (step.agent_key or "").strip()
        builder = _AGENT_BUILDERS.get(agent_key)
        overrides_raw = step.parameters or {}
        overrides = dict(overrides_raw)

        logger.info(
            "Construction de l'agent pour l'étape %s. widget_config: %s, output_model: %s",
            step.slug,
            widget_config is not None,
            widget_config.output_model if widget_config else None
        )

        if widget_config is not None and widget_config.output_model is not None:
            # Retirer les anciens paramètres de widget pour éviter les conflits
            overrides.pop("response_format", None)
            overrides.pop("response_widget", None)
            overrides.pop("widget", None)

            # NE PAS définir output_type car cela cause des problèmes de double-wrapping
            # avec AgentOutputSchema dans le SDK. À la place, utiliser seulement response_format.

            # Créer le response_format pour que l'API OpenAI utilise json_schema
            try:
                overrides["response_format"] = _create_response_format_from_pydantic(
                    widget_config.output_model
                )
                logger.info(
                    "response_format généré depuis le modèle widget pour l'étape %s",
                    step.slug
                )
            except Exception as exc:
                logger.warning(
                    "Impossible de générer response_format depuis le modèle widget : %s",
                    exc,
                )

        if builder is None:
            if agent_key:
                raise WorkflowExecutionError(
                    "configuration",
                    "Configuration du workflow invalide",
                    RuntimeError(f"Agent inconnu : {agent_key}"),
                    [],
                )
            agent_instances[step.slug] = _build_custom_agent(overrides)
        else:
            agent_instances[step.slug] = builder(overrides)

    if agent_steps_ordered and all(
        (step.agent_key == "r_dacteur") for step in agent_steps_ordered
    ):
        state["should_finalize"] = True

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
            status_reason = _sanitize_end_value(status_raw.get("reason")) or status_reason

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
        if isinstance(value, (int, float)) and not isinstance(value, bool):
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
        if isinstance(raw_delay, (int, float)) and not isinstance(raw_delay, bool):
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

    async def _stream_assistant_message(
        text: str, *, delay_seconds: float
    ) -> None:
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
                return RunConfig(trace_metadata=metadata, response_format=response_format)
        except TypeError:
            logger.debug("RunConfig ne supporte pas response_format, utilisation de la configuration par défaut")
        return RunConfig(trace_metadata=metadata)

    async def record_step(step_key: str, title: str, payload: Any) -> None:
        formatted_output = _format_step_output(payload)
        print(
            f"[Workflow] Payload envoyé pour l'étape {step_key} ({title}) :\n{formatted_output}"
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
        if isinstance(output, (dict, list)):
            return output, json.dumps(output, ensure_ascii=False)
        return output, str(output)

    def _resolve_from_container(value: Any, path: str) -> Any:
        """Récupère une valeur imbriquée en gérant les alias Pydantic."""

        def _as_mapping(candidate: Any) -> dict[str, Any] | None:
            if isinstance(candidate, dict):
                return candidate
            if hasattr(candidate, "model_dump"):
                try:
                    dumped = candidate.model_dump(by_alias=True)
                except TypeError:
                    dumped = candidate.model_dump()
                if isinstance(dumped, dict):
                    return dumped
            if hasattr(candidate, "dict"):
                try:
                    dumped = candidate.dict(by_alias=True)
                except TypeError:
                    dumped = candidate.dict()
                if isinstance(dumped, dict):
                    return dumped
            return None

        def _resolve(current: Any, parts: list[str]) -> Any:
            if not parts:
                return current

            if isinstance(current, (list, tuple)):
                head, *tail = parts
                try:
                    index = int(head)
                except ValueError:
                    return None
                if 0 <= index < len(current):
                    return _resolve(current[index], tail)
                return None

            mapping = _as_mapping(current)
            if mapping is not None:
                head, *tail = parts
                if head in mapping:
                    return _resolve(mapping[head], tail)
                if tail:
                    for join_index in range(len(parts), 1, -1):
                        candidate_key = ".".join(parts[:join_index])
                        if candidate_key in mapping:
                            return _resolve(
                                mapping[candidate_key],
                                parts[join_index:],
                            )
                return None

            head, *tail = parts
            if hasattr(current, head):
                return _resolve(getattr(current, head), tail)

            return None

        parts = [segment for segment in path.split(".") if segment]
        return _resolve(value, parts)

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
                    f"Impossible d'écrire dans state.{part} : valeur existante incompatible."
                )
            cursor = next_value
        cursor[path_parts[-1]] = value

    def _evaluate_state_expression(
        expression: Any, *, input_context: dict[str, Any] | None = None
    ) -> Any:
        if expression is None:
            return None
        if isinstance(expression, (bool, int, float, dict, list)):
            return expression
        if isinstance(expression, str):
            expr = expression.strip()
            if not expr:
                return None
            if expr == "state":
                return state
            if expr == "input":
                context = last_step_context if input_context is None else input_context
                if context is None:
                    raise RuntimeError(
                        "Aucun résultat précédent disponible pour l'expression 'input'."
                    )
                return context
            if expr.startswith("state."):
                return _resolve_from_container(state, expr[len("state.") :])
            if expr.startswith("input."):
                context = last_step_context if input_context is None else input_context
                if context is None:
                    raise RuntimeError(
                        "Aucun résultat précédent disponible pour les expressions basées sur 'input'."
                    )
                return _resolve_from_container(context, expr[len("input.") :])
            try:
                return json.loads(expr)
            except json.JSONDecodeError:
                return expr
        return expression

    _MUSTACHE_PATTERN = re.compile(r"\{\{\s*(.+?)\s*\}\}")
    _MUSTACHE_FULL_PATTERN = re.compile(r"^\s*\{\{\s*(.+?)\s*\}\}\s*$")

    def _render_template_string(
        template: str, *, input_context: dict[str, Any] | None = None
    ) -> Any:
        full_match = _MUSTACHE_FULL_PATTERN.match(template)
        if full_match:
            expression = full_match.group(1).strip()
            try:
                return _evaluate_state_expression(expression, input_context=input_context)
            except Exception:
                logger.debug(
                    "Impossible d'évaluer l'expression de template '%s'.",
                    expression,
                    exc_info=True,
                )
                return None

        def _replacement(match: re.Match[str]) -> str:
            expression = match.group(1).strip()
            try:
                value = _evaluate_state_expression(expression, input_context=input_context)
            except Exception:
                logger.debug(
                    "Impossible d'évaluer l'expression de template '%s'.",
                    expression,
                    exc_info=True,
                )
                return ""
            if value is None:
                return ""
            if isinstance(value, (dict, list)):
                try:
                    return json.dumps(value, ensure_ascii=False)
                except TypeError:
                    return str(value)
            return str(value)

        return _MUSTACHE_PATTERN.sub(_replacement, template)

    def _resolve_transform_value(
        value: Any, *, input_context: dict[str, Any] | None = None
    ) -> Any:
        if isinstance(value, dict):
            return {
                key: _resolve_transform_value(entry, input_context=input_context)
                for key, entry in value.items()
            }
        if isinstance(value, list):
            return [
                _resolve_transform_value(entry, input_context=input_context)
                for entry in value
            ]
        if isinstance(value, str):
            if "{{" in value and "}}" in value:
                return _render_template_string(value, input_context=input_context)
            trimmed = value.strip()
            if trimmed in {"state", "input"} or trimmed.startswith(("state.", "input.")):
                try:
                    return _evaluate_state_expression(trimmed, input_context=input_context)
                except Exception:
                    logger.debug(
                        "Impossible d'évaluer l'expression '%s' dans le bloc transform.",
                        trimmed,
                        exc_info=True,
                    )
                    return value
            return value
        return value

    def _apply_state_node(step: WorkflowStep) -> None:
        params = step.parameters or {}
        operations = params.get("state")
        if operations is None:
            return
        if not isinstance(operations, list):
            raise ValueError(
                "Le paramètre 'state' doit être une liste d'opérations."
            )
        for entry in operations:
            if not isinstance(entry, dict):
                raise ValueError(
                    "Chaque opération de mise à jour d'état doit être un objet."
                )
            target_raw = entry.get("target")
            target = str(target_raw).strip() if target_raw is not None else ""
            if not target:
                raise ValueError(
                    "Chaque opération doit préciser une cible 'target'."
                )
            value = _evaluate_state_expression(entry.get("expression"))
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
        if isinstance(value, (dict, list)):
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

        if preferred_key in {"src", "url", "href"} or component_type in {"image", "link"}:
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
            mapping: dict[str, str | list[str]]
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
                    if isinstance(normalized, (dict, list)):
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

    async def _ingest_vector_store_document(
        slug: str,
        doc_id: str,
        document: dict[str, Any],
        metadata: dict[str, Any],
    ) -> None:
        def _ingest_sync() -> None:
            with SessionLocal() as session:
                service = JsonVectorStoreService(session)
                try:
                    service.ingest(
                        slug,
                        doc_id,
                        document,
                        document_metadata=metadata,
                    )
                    session.commit()
                except Exception:
                    session.rollback()
                    raise

        try:
            await asyncio.to_thread(_ingest_sync)
        except LookupError:
            logger.warning(
                "Vector store %s introuvable : impossible d'enregistrer le document %s",
                slug,
                doc_id,
            )
        except Exception as exc:  # pragma: no cover - dépend du runtime
            logger.exception(
                "Erreur lors de l'ingestion du document %s dans %s",
                doc_id,
                slug,
                exc_info=exc,
            )

    async def _apply_vector_store_ingestion(
        *,
        config: dict[str, Any] | None,
        step_slug: str,
        step_title: str,
        step_context: dict[str, Any] | None,
    ) -> None:
        if not isinstance(config, dict):
            return

        slug_raw = config.get("vector_store_slug")
        slug = str(slug_raw).strip() if isinstance(slug_raw, str) else ""
        if not slug:
            logger.debug(
                "Configuration vector_store_ingestion ignorée pour %s : slug absent.",
                step_slug,
            )
            return

        if not isinstance(step_context, dict):
            logger.warning(
                "Impossible d'ingérer le document JSON pour %s : aucun contexte disponible.",
                step_slug,
            )
            return

        def _to_mapping(candidate: Any, *, purpose: str) -> dict[str, Any] | None:
            if hasattr(candidate, "model_dump"):
                try:
                    return candidate.model_dump(by_alias=True)
                except TypeError:
                    return candidate.model_dump()
            if hasattr(candidate, "dict"):
                try:
                    return candidate.dict(by_alias=True)
                except TypeError:
                    return candidate.dict()
            if isinstance(candidate, str):
                trimmed = candidate.strip()
                if not trimmed:
                    return None
                # Log pour déboguer le JSON parsing
                logger.debug(
                    "Tentative de parsing JSON pour %s (taille: %d, début: %s...)",
                    step_slug,
                    len(trimmed),
                    trimmed[:100],
                )
                try:
                    decoded = json.loads(trimmed)
                except json.JSONDecodeError as e:
                    if purpose == "document":
                        logger.warning(
                            "Le document produit par %s n'est pas un JSON valide pour l'ingestion. Erreur: %s",
                            step_slug,
                            str(e),
                        )
                    else:
                        logger.warning(
                            "Les métadonnées calculées pour %s ne sont pas un JSON valide. Erreur: %s",
                            step_slug,
                            str(e),
                        )
                    return None
                if isinstance(decoded, dict):
                    return decoded
                if purpose == "document":
                    logger.warning(
                        "Le document généré par %s doit être un objet JSON pour être indexé (type %s).",
                        step_slug,
                        type(decoded).__name__,
                    )
                else:
                    logger.warning(
                        "Les métadonnées calculées pour %s doivent être un objet JSON (type %s).",
                        step_slug,
                        type(decoded).__name__,
                    )
                return None
            if isinstance(candidate, dict):
                return candidate
            return None

        doc_id_expression_raw = config.get("doc_id_expression") or config.get("doc_id")
        doc_id_expression = (
            doc_id_expression_raw.strip()
            if isinstance(doc_id_expression_raw, str)
            else ""
        )
        doc_id_value: Any = None
        if doc_id_expression:
            try:
                doc_id_value = _evaluate_state_expression(
                    doc_id_expression, input_context=step_context
                )
            except Exception as exc:  # pragma: no cover - dépend des expressions fournies
                logger.exception(
                    "Impossible d'évaluer l'expression d'identifiant '%s' pour %s",
                    doc_id_expression,
                    step_slug,
                    exc_info=exc,
                )

        doc_id = str(doc_id_value).strip() if doc_id_value is not None else ""
        if not doc_id:
            parsed_context = step_context.get("output_structured")
            if not isinstance(parsed_context, dict):
                parsed_context = step_context.get("output_parsed")
            if isinstance(parsed_context, dict):
                for key in ("doc_id", "id", "slug", "reference", "uid"):
                    candidate = parsed_context.get(key)
                    if candidate is None:
                        continue
                    candidate_str = str(candidate).strip()
                    if candidate_str:
                        doc_id = candidate_str
                        break
            if not doc_id:
                generated = uuid.uuid4().hex
                doc_id = f"{step_slug}-{generated}" if step_slug else generated
                logger.info(
                    "Identifiant de document généré automatiquement pour %s : %s",
                    step_slug,
                    doc_id,
                )

        document_expression_raw = (
            config.get("document_expression") or config.get("document")
        )
        document_expression = (
            document_expression_raw.strip()
            if isinstance(document_expression_raw, str)
            else ""
        )
        document_value: Any = None
        if document_expression:
            try:
                document_value = _evaluate_state_expression(
                    document_expression, input_context=step_context
                )
                logger.debug(
                    "Expression de document '%s' évaluée pour %s: type=%s, valeur=%s",
                    document_expression,
                    step_slug,
                    type(document_value).__name__,
                    str(document_value)[:200] if document_value else "None",
                )
            except Exception as exc:  # pragma: no cover - dépend des expressions fournies
                logger.exception(
                    "Impossible d'évaluer l'expression de document '%s' pour %s",
                    document_expression,
                    step_slug,
                    exc_info=exc,
                )

        if document_value is None:
            for candidate_key in ("output_structured", "output_parsed", "output", "output_text"):
                candidate_value = step_context.get(candidate_key)
                mapping = _to_mapping(candidate_value, purpose="document")
                if mapping is not None:
                    document_value = mapping
                    break

        document_mapping = _to_mapping(document_value, purpose="document")
        if document_mapping is None:
            logger.warning(
                "Le document généré par %s doit être un objet JSON pour être indexé (type %s).",
                step_slug,
                type(document_value).__name__ if document_value is not None else "None",
            )
            return

        metadata: dict[str, Any] = {
            "workflow_step": step_slug,
            "workflow_step_title": step_title,
        }

        metadata_expression_raw = config.get("metadata_expression")
        metadata_expression = (
            metadata_expression_raw.strip()
            if isinstance(metadata_expression_raw, str)
            else ""
        )

        if metadata_expression:
            try:
                metadata_value = _evaluate_state_expression(
                    metadata_expression, input_context=step_context
                )
            except Exception as exc:  # pragma: no cover - dépend des expressions fournies
                logger.exception(
                    "Impossible d'évaluer l'expression de métadonnées '%s' pour %s",
                    metadata_expression,
                    step_slug,
                    exc_info=exc,
                )
            else:
                metadata_mapping = _to_mapping(metadata_value, purpose="metadata")
                if metadata_mapping is not None:
                    metadata.update(metadata_mapping)
                elif metadata_value is not None:
                    logger.warning(
                        "Les métadonnées calculées pour %s doivent être un objet JSON.",
                        step_slug,
                    )

        logger.info(
            "Ingestion du résultat JSON de %s dans le vector store %s (doc_id=%s)",
            step_slug,
            slug,
            doc_id,
        )
        await _ingest_vector_store_document(slug, doc_id, document_mapping, metadata)

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
        step_identifier_for_doc = context.get("step_key") or context.get("step_slug") or "step"
        normalized_step_identifier = _sanitize_identifier(str(step_identifier_for_doc), "step")
        raw_doc_id = f"{normalized_thread}-{key[0]}-{key[1]}-{normalized_step_identifier}"
        doc_id = _sanitize_identifier(raw_doc_id, f"{normalized_thread}-{uuid.uuid4().hex[:8]}")
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
            from .security import create_agent_image_token  # lazy import pour éviter les dépendances globales

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
        await _ingest_vector_store_document(
            AGENT_IMAGE_VECTOR_STORE_SLUG,
            doc_id,
            payload,
            metadata,
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
            raw_value = _evaluate_state_expression(
                expression, input_context=input_context
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

        return matched

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
                definition_candidate = _evaluate_state_expression(
                    expression, input_context=step_context
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
                except json.JSONDecodeError as exc:  # pragma: no cover - dépend du contenu
                    logger.warning(
                        "Le JSON renvoyé par %s est invalide pour l'étape %s : %s",
                        expression,
                        step_slug,
                        exc,
                    )
                    return None
            if not isinstance(definition, (dict, list)):
                logger.warning(
                    "L'expression %s doit renvoyer un objet JSON utilisable pour le widget de l'étape %s",
                    expression,
                    step_slug,
                )
                return None
            if not bindings:
                bindings = _collect_widget_bindings(definition)
        else:
            if not config.slug:
                logger.warning(
                    "Slug de widget manquant pour l'étape %s", step_slug
                )
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
                "Le widget %s est invalide après interpolation", widget_label, exc_info=exc
            )
            return None

        if _sdk_stream_widget is None:
            logger.warning(
                "Le SDK Agents installé ne supporte pas stream_widget : impossible de diffuser %s",
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
            except Exception as exc:  # pragma: no cover - dépend du stockage sous-jacent
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
        metadata_for_images["step_slug"] = metadata_for_images.get("step_slug") or step_key
        metadata_for_images["step_title"] = metadata_for_images.get("step_title") or title
        if not metadata_for_images.get("agent_key"):
            metadata_for_images["agent_key"] = getattr(agent, "name", None)
        if not metadata_for_images.get("agent_label"):
            metadata_for_images["agent_label"] = (
                getattr(agent, "name", None) or getattr(agent, "model", None)
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
                self._settings.backend_public_base_url
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
            if not isinstance(update, (WorkflowTaskAdded, WorkflowTaskUpdated)):
                return
            task = getattr(update, "task", None)
            if not isinstance(task, ImageTask):
                return
            registration = _register_image_generation_task(
                task, metadata=metadata_for_images
            )
            if registration is None:
                logger.debug(
                    "Impossible de suivre la génération d'image pour %s : identifiant absent.",
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
                response_format_override = _AGENT_RESPONSE_FORMATS.get(agent)
            except TypeError:
                logger.debug(
                    "Agent %s non hachable, impossible de récupérer le response_format mémorisé.",
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
                if (
                    on_stream_event is not None
                    and _should_forward_agent_event(
                        event, suppress=suppress_stream_events
                    )
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
            return _STEP_TITLES.get(agent_key, agent_key)
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
        if isinstance(value, (int, float)):
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

    def _next_edge(source_slug: str, branch: str | None = None) -> WorkflowTransition | None:
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
                        f"Transition manquante pour la branche {branch_label} du nœud {current_slug}"
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
            elif isinstance(expressions_payload, (dict, list)):
                transform_source = copy.deepcopy(expressions_payload)
            else:
                raise WorkflowExecutionError(
                    current_node.slug,
                    title or current_node.slug,
                    ValueError("Le paramètre 'expressions' doit être un objet ou une liste."),
                    list(steps),
                )

            try:
                transform_output = _resolve_transform_value(
                    transform_source,
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
                _get_wait_state_metadata(thread)
                if thread is not None
                else None
            )
            waiting_slug = (
                pending_wait_state.get("slug") if pending_wait_state else None
            )
            waiting_input_id = (
                pending_wait_state.get("input_item_id")
                if pending_wait_state
                else None
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
                        status_reason="Aucune transition disponible après le bloc d'attente.",
                        message="Aucune transition disponible après le bloc d'attente.",
                    )
                    break
                current_slug = next_slug
                continue

            title = _node_title(current_node)
            raw_message = _resolve_wait_for_user_input_message(current_node)
            sanitized_message = _normalize_user_text(raw_message)
            display_payload = sanitized_message or "En attente d'une réponse utilisateur."
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
            await _apply_vector_store_ingestion(
                config=current_node.parameters or {},
                step_slug=current_node.slug,
                step_title=title,
                step_context=last_step_context,
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
                if (
                    on_widget_step is not None
                    and _should_wait_for_widget_action(current_node.kind, widget_config)
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
                    step_payload["widget_expression"] = widget_config.definition_expression
                if (
                    widget_config.source == "variable"
                    and rendered_widget is not None
                ):
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

        if (
            agent_key in {"get_data_from_web", "triage_2", "get_data_from_user"}
            and state["has_all_details"]
        ):
            transition = _next_edge(current_slug)
            if transition is None:
                if _fallback_to_start("agent", current_node.slug):
                    continue
                break
            current_slug = transition.target_step.slug
            continue

        if agent_key == "r_dacteur":
            should_run = state["should_finalize"] or position == total_runtime_steps
            if not should_run:
                transition = _next_edge(current_slug)
                if transition is None:
                    if _fallback_to_start("agent", current_node.slug):
                        continue
                    break
                current_slug = transition.target_step.slug
                continue

        run_context: Any | None = None
        if agent_key == "get_data_from_web":
            run_context = GetDataFromWebContext(state["infos_manquantes"])
        elif agent_key == "triage_2":
            run_context = Triage2Context(input_output_text=state["infos_manquantes"])
        elif agent_key == "get_data_from_user":
            run_context = GetDataFromUserContext(state_infos_manquantes=state["infos_manquantes"])
        elif last_step_context is not None:
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
                if isinstance(structured_payload, (dict, list)):
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
                    json.dumps(conversation_history[-1], ensure_ascii=False, default=str),
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

        if agent_key == "triage":
            parsed, text = _structured_output_as_json(result_stream.final_output)
            state["has_all_details"] = bool(parsed.get("has_all_details")) if isinstance(parsed, dict) else False
            state["infos_manquantes"] = text
            state["should_finalize"] = state["has_all_details"]
            await record_step(
                step_identifier,
                title,
                merge_generated_image_urls_into_payload(parsed, image_urls),
            )
            last_step_context = {
                "agent_key": agent_key,
                "output": result_stream.final_output,
                "output_parsed": parsed,
                "output_structured": parsed,
                "output_text": append_generated_image_links(text, image_urls),
            }
        elif agent_key == "get_data_from_web":
            text = result_stream.final_output_as(str)
            display_text = append_generated_image_links(text, image_urls)
            state["infos_manquantes"] = text
            await record_step(step_identifier, title, display_text)
            last_step_context = {
                "agent_key": agent_key,
                "output": text,
                "output_text": display_text,
            }
        elif agent_key == "triage_2":
            parsed, text = _structured_output_as_json(result_stream.final_output)
            state["has_all_details"] = bool(parsed.get("has_all_details")) if isinstance(parsed, dict) else False
            state["infos_manquantes"] = text
            state["should_finalize"] = state["has_all_details"]
            await record_step(
                step_identifier,
                title,
                merge_generated_image_urls_into_payload(parsed, image_urls),
            )
            last_step_context = {
                "agent_key": agent_key,
                "output": result_stream.final_output,
                "output_parsed": parsed,
                "output_structured": parsed,
                "output_text": append_generated_image_links(text, image_urls),
            }
        elif agent_key == "get_data_from_user":
            text = result_stream.final_output_as(str)
            display_text = append_generated_image_links(text, image_urls)
            state["infos_manquantes"] = text
            state["should_finalize"] = True
            await record_step(step_identifier, title, display_text)
            last_step_context = {
                "agent_key": agent_key,
                "output": text,
                "output_text": display_text,
            }
        elif agent_key == "r_dacteur":
            parsed, text = _structured_output_as_json(result_stream.final_output)
            display_text = append_generated_image_links(text, image_urls)
            final_output = {
                "output_text": display_text,
                "output_parsed": parsed,
                "output_structured": parsed,
            }
            await record_step(step_identifier, title, final_output["output_text"])
            last_step_context = {
                "agent_key": agent_key,
                "output": result_stream.final_output,
                "output_parsed": parsed,
                "output_structured": parsed,
                "output_text": display_text,
            }
        else:
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

        # Mémoriser la dernière sortie d'agent dans l'état global pour les transitions suivantes.
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
            structured_candidate, (dict, list, str)
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

        await _apply_vector_store_ingestion(
            config=(current_node.parameters or {}).get("vector_store_ingestion"),
            step_slug=current_node.slug,
            step_title=title,
            step_context=last_step_context,
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

            if (
                on_widget_step is not None
                and _should_wait_for_widget_action(current_node.kind, widget_config)
            ):
                result = await on_widget_step(current_node, widget_config)
                if result is not None:
                    augmented_context["action"] = dict(result)

            last_step_context = augmented_context

        transition = _next_edge(current_slug)
        if agent_key == "r_dacteur":
            # Après la rédaction finale, on rejoint la fin si disponible
            transition = transition or _next_edge(current_slug, "true")
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
from backend.app.chatkit_server.server import (
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
