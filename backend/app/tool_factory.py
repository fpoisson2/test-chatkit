"""Fabrique centralisant la construction des outils Agents."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Mapping, Sequence
from typing import Any

from agents import FunctionTool, WebSearchTool, function_tool

try:  # pragma: no cover - dépend des versions du SDK Agents
    from agents.tool import ImageGeneration as _AgentImageGenerationConfig
    from agents.tool import ImageGenerationTool as _AgentImageGenerationTool
except ImportError:  # pragma: no cover - compatibilité rétro
    _AgentImageGenerationConfig = None  # type: ignore[assignment]
    _AgentImageGenerationTool = None  # type: ignore[assignment]

try:  # pragma: no cover - certaines versions du client OpenAI n'exposent pas encore ImageGeneration
    from openai.types.responses.tool import ImageGeneration
except ImportError:  # pragma: no cover - compatibilité rétro
    ImageGeneration = None  # type: ignore[assignment]

try:  # pragma: no cover - nouveaux SDK : le paramètre est dans tool_param
    from openai.types.responses.tool_param import ImageGeneration as ImageGenerationParam
except ImportError:  # pragma: no cover - compatibilité avec les anciennes versions
    ImageGenerationParam = None  # type: ignore[assignment]

from pydantic import BaseModel, Field

from .database import SessionLocal
from .vector_store import JsonVectorStoreService, SearchResult
from .weather import fetch_weather
from .widgets import WidgetLibraryService, WidgetValidationError

logger = logging.getLogger("chatkit.server")

ImageGenerationTool = _AgentImageGenerationTool

_SUPPORTED_IMAGE_OUTPUT_FORMATS = frozenset({"png", "jpeg", "webp"})

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


def sanitize_web_search_user_location(payload: Any) -> dict[str, str] | None:
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


def build_web_search_tool(payload: Any) -> WebSearchTool | None:
    """Construit un outil de recherche web à partir des paramètres sérialisés."""

    if isinstance(payload, WebSearchTool):
        return payload

    config: dict[str, Any] = {}
    if isinstance(payload, dict):
        search_context_size = payload.get("search_context_size")
        if isinstance(search_context_size, str) and search_context_size.strip():
            config["search_context_size"] = search_context_size.strip()

        user_location = sanitize_web_search_user_location(payload.get("user_location"))
        if user_location:
            config["user_location"] = user_location

    try:
        return WebSearchTool(**config)
    except Exception:  # pragma: no cover - dépend des versions du SDK
        logger.warning(
            "Impossible d'instancier WebSearchTool avec la configuration %s", config
        )
        return None


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


def build_image_generation_tool(payload: Any) -> Any | None:
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


def build_file_search_tool(payload: Any) -> FunctionTool | None:
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


def build_weather_tool(payload: Any) -> FunctionTool | None:
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


def build_widget_validation_tool(payload: Any) -> FunctionTool | None:
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


__all__ = [
    "ImageGeneration",
    "ImageGenerationTool",
    "WidgetValidationResult",
    "build_file_search_tool",
    "build_image_generation_tool",
    "build_weather_tool",
    "build_web_search_tool",
    "build_widget_validation_tool",
    "sanitize_web_search_user_location",
    "validate_widget_definition",
]

