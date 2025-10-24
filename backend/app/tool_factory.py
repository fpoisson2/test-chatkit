"""Fabrique centralisant la construction des outils Agents."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Mapping
from dataclasses import field
from typing import TYPE_CHECKING, Any

from agents import FunctionTool, RunContextWrapper, WebSearchTool, function_tool

try:  # pragma: no cover - dépend des versions du SDK Agents
    from agents.tool import ImageGeneration as _AgentImageGenerationConfig
    from agents.tool import ImageGenerationTool as _AgentImageGenerationTool
except ImportError:  # pragma: no cover - compatibilité rétro
    _AgentImageGenerationConfig = None  # type: ignore[assignment]
    _AgentImageGenerationTool = None  # type: ignore[assignment]

try:  # pragma: no cover - clients OpenAI sans ImageGeneration
    from openai.types.responses.tool import ImageGeneration
except ImportError:  # pragma: no cover - compatibilité rétro
    ImageGeneration = None  # type: ignore[assignment]

try:  # pragma: no cover - nouveaux SDK : le paramètre est dans tool_param
    from openai.types.responses.tool_param import (
        ImageGeneration as ImageGenerationParam,
    )
except ImportError:  # pragma: no cover - compatibilité avec les anciennes versions
    ImageGenerationParam = None  # type: ignore[assignment]

from pydantic import BaseModel, Field
from pydantic.dataclasses import dataclass as pydantic_dataclass

from chatkit.agents import AgentContext
from chatkit.types import CustomSummary, ThoughtTask, Workflow

from .database import SessionLocal
from .vector_store import JsonVectorStoreService, SearchResult
from .weather import fetch_weather
from .widgets import WidgetLibraryService, WidgetValidationError
from .workflows import WorkflowService, WorkflowValidationError

if TYPE_CHECKING:
    from .workflows.executor import (
        WorkflowRunSummary,
        WorkflowStepStreamUpdate,
        WorkflowStepSummary,
    )

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
    "Valide une définition de widget ChatKit et renvoie la version "
    "normalisée ainsi que les erreurs éventuelles."
)

_WORKFLOW_VALIDATION_TOOL_ALIASES = {
    "validate_workflow_graph",
    "workflow_validation",
    "validate_workflow",
}
_WORKFLOW_VALIDATION_TOOL_DEFAULT_DESCRIPTION = (
    "Valide la configuration d'un graphe de workflow ChatKit et "
    "renvoie la version normalisée ainsi que les erreurs éventuelles."
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
            logger.warning("Format de sortie %r non supporté, repli sur 'png'", value)
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
                "Impossible d'envelopper le tool ImageGeneration, retour du "
                "modèle brut."
            )

    for attribute, default in (
        ("type", "image_generation"),
        ("name", "image_generation"),
    ):
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
    if isinstance(raw_ids, list | tuple | set):
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
        if isinstance(threshold, int | float):
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

        def _search_sync() -> (
            tuple[list[tuple[str, list[SearchResult]]], list[dict[str, Any]]]
        ):
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
                            "Erreur lors de la recherche dans le magasin %s",
                            slug,
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
            "Recherche dans les documents locaux et renvoie le texte des extraits "
            "pertinents."
        )
    else:
        search_tool.description = (
            "Recherche dans les documents locaux et renvoie les métadonnées des "
            "extraits pertinents."
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


@pydantic_dataclass
class WorkflowValidationResult:
    """Représente le résultat structuré de la validation d'un workflow."""

    valid: bool
    normalized_graph: dict[str, Any] | None = None
    errors: list[str] = field(default_factory=list)


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
            location = (
                f" (ligne {exc.lineno}, colonne {exc.colno})" if exc.lineno else ""
            )
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
        raw_name = (
            payload.get("name") or payload.get("id") or payload.get("function_name")
        )
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


def validate_workflow_graph(
    graph: Mapping[str, Any] | str,
) -> WorkflowValidationResult:
    """Valide un graphe de workflow et retourne un rapport structuré."""

    parsed_graph: Any = graph

    if isinstance(graph, Mapping):
        parsed_graph = dict(graph)
    elif isinstance(graph, str):
        candidate = graph.strip()
        if not candidate:
            return WorkflowValidationResult(
                valid=False,
                errors=["Le graphe de workflow fourni est vide."],
            )
        try:
            parsed_graph = json.loads(candidate)
        except json.JSONDecodeError as exc:
            location = (
                f" (ligne {exc.lineno}, colonne {exc.colno})" if exc.lineno else ""
            )
            return WorkflowValidationResult(
                valid=False,
                errors=[f"JSON invalide : {exc.msg}{location}"],
            )
        except Exception as exc:  # pragma: no cover - garde-fou
            logger.exception(
                "Erreur inattendue lors du décodage du graphe de workflow", exc_info=exc
            )
            return WorkflowValidationResult(
                valid=False,
                errors=[
                    "Une erreur inattendue est survenue lors de la lecture du JSON."
                ],
            )
    else:
        return WorkflowValidationResult(
            valid=False,
            errors=[
                "Le graphe de workflow doit être fourni sous forme de chaîne JSON "
                "ou d'objet JSON.",
            ],
        )

    if not isinstance(parsed_graph, Mapping):
        return WorkflowValidationResult(
            valid=False,
            errors=["Le graphe de workflow doit être un objet JSON."],
        )

    try:
        service = WorkflowService()
        normalized_graph = service.validate_graph_payload(dict(parsed_graph))
    except WorkflowValidationError as exc:
        return WorkflowValidationResult(valid=False, errors=[exc.message])
    except Exception as exc:  # pragma: no cover - garde-fou
        logger.exception(
            "Erreur inattendue lors de la validation du workflow", exc_info=exc
        )
        return WorkflowValidationResult(
            valid=False,
            errors=[
                "Une erreur inattendue est survenue lors de la validation du workflow.",
            ],
        )

    return WorkflowValidationResult(valid=True, normalized_graph=normalized_graph)


def build_workflow_validation_tool(payload: Any) -> FunctionTool | None:
    """Construit un FunctionTool pointant vers validate_workflow_graph."""

    name_override = "validate_workflow_graph"
    description = _WORKFLOW_VALIDATION_TOOL_DEFAULT_DESCRIPTION

    if isinstance(payload, FunctionTool):
        tool_name = getattr(payload, "name", None)
        if isinstance(tool_name, str) and tool_name.strip():
            name_override = tool_name.strip()
        tool_description = getattr(payload, "description", None)
        if isinstance(tool_description, str) and tool_description.strip():
            description = tool_description.strip()
        return payload

    if isinstance(payload, dict):
        raw_name = payload.get("name") or payload.get("id")
        if isinstance(raw_name, str) and raw_name.strip():
            candidate = raw_name.strip()
            if candidate.lower() in _WORKFLOW_VALIDATION_TOOL_ALIASES:
                name_override = candidate
            else:
                return None

        raw_description = payload.get("description")
        if isinstance(raw_description, str) and raw_description.strip():
            description = raw_description.strip()
    elif isinstance(payload, str) and payload.strip():
        candidate = payload.strip()
        if candidate.lower() in _WORKFLOW_VALIDATION_TOOL_ALIASES:
            name_override = candidate
        else:
            return None

    tool = function_tool(name_override=name_override, strict_mode=False)(
        validate_workflow_graph
    )
    tool.description = description
    return tool


def build_workflow_tool(payload: Any) -> FunctionTool | None:
    """Construit un outil permettant de lancer un workflow ChatKit.

    Le payload accepte notamment :

    - ``slug`` (*str*) : identifiant du workflow à exécuter.
    - ``initial_message`` (*str*, optionnel) : message utilisateur transmis par défaut
      si l'appel du tool n'en fournit pas.
    - ``title`` (*str*, optionnel) : titre affiché dans l'UI lors de l'exécution.
    - ``identifier`` (*str*, optionnel) : identifiant affiché avec le titre dans l'UI.
    - ``name`` / ``description`` (*str*, optionnels) : métadonnées de l'outil exposées
      au modèle.
    """

    if isinstance(payload, FunctionTool):
        return payload

    config: Mapping[str, Any]
    if isinstance(payload, Mapping):
        config = payload
    else:
        config = {}

    slug: str | None = None
    if isinstance(payload, str):
        slug = payload.strip()
    if not slug:
        raw_slug = config.get("slug") or config.get("workflow_slug")
        if isinstance(raw_slug, str) and raw_slug.strip():
            slug = raw_slug.strip()

    if not slug:
        logger.warning("Impossible de construire l'outil workflow : slug manquant.")
        return None

    default_message = config.get("initial_message") or config.get("message")
    if isinstance(default_message, str):
        default_message = default_message
    elif default_message is None:
        default_message = ""
    else:
        default_message = str(default_message)

    raw_name = config.get("name")
    if isinstance(raw_name, str) and raw_name.strip():
        tool_name = raw_name.strip()
    else:
        sanitized_slug = "".join(
            ch if ch.isalnum() else "_" for ch in slug.lower()
        ).strip("_")
        tool_name = f"run_{sanitized_slug or 'workflow'}"

    raw_description = config.get("description")
    if isinstance(raw_description, str) and raw_description.strip():
        description = raw_description.strip()
    else:
        description = f"Exécute le workflow '{slug}' configuré côté serveur."

    raw_title = config.get("title") or config.get("workflow_title")
    workflow_title = raw_title.strip() if isinstance(raw_title, str) else None
    if workflow_title:
        workflow_title = workflow_title.strip()

    raw_identifier = (
        config.get("identifier")
        or config.get("workflow_identifier")
        or config.get("workflow_id")
        or config.get("id")
    )
    workflow_identifier = (
        raw_identifier.strip() if isinstance(raw_identifier, str) else None
    )

    show_ui = True
    if "show_ui" in config:
        raw_show_ui = config.get("show_ui")
        if isinstance(raw_show_ui, str):
            normalized_flag = raw_show_ui.strip().lower()
            show_ui = normalized_flag not in {"", "false", "0", "no", "off"}
        else:
            show_ui = bool(raw_show_ui)

    workflow_service = WorkflowService()

    def _summary_title() -> str | None:
        title = workflow_title.strip() if isinstance(workflow_title, str) else None
        identifier = (
            workflow_identifier.strip()
            if isinstance(workflow_identifier, str)
            else None
        )
        if title and identifier:
            return f"{title} · {identifier}"
        if identifier:
            return identifier
        if title:
            return title
        return slug

    def _serialize_final_output(payload: Any) -> str | None:
        if payload is None:
            return None
        if isinstance(payload, str):
            normalized = payload.strip()
            return normalized or payload
        try:
            return json.dumps(payload, ensure_ascii=False, indent=2)
        except TypeError:
            try:
                return str(payload)
            except Exception:  # pragma: no cover - garde-fou
                return None

    def _summary_to_text(summary: WorkflowRunSummary) -> str:
        sections: list[str] = []
        for index, step in enumerate(summary.steps, start=1):
            title = step.title or f"Étape {index}"
            if isinstance(step.output, str):
                content = step.output.strip()
            else:
                content = step.output
            if not content:
                content = "(aucune sortie)"
            sections.append(f"Étape {index} – {title}\n{content}")

        final_output = _serialize_final_output(summary.final_output)
        if final_output:
            sections.append(f"Sortie finale :\n{final_output}")

        end_state = summary.end_state
        if end_state is not None:
            status_bits: list[str] = []
            if end_state.status_type:
                status_bits.append(end_state.status_type)
            reason = end_state.status_reason or end_state.message
            if reason:
                status_bits.append(reason)
            status_label = " – ".join(status_bits) if status_bits else "terminé"
            sections.append(f"État final ({end_state.slug}) : {status_label}")
        elif summary.final_node_slug:
            sections.append(
                f"Nœud de fin atteint : {summary.final_node_slug}"
            )

        if not sections:
            return "Le workflow s'est terminé sans étape exécutée."
        return "\n\n".join(sections)

    @function_tool(
        name_override=tool_name,
        description_override=description,
        strict_mode=False,
    )
    async def _run_configured_workflow(
        ctx: RunContextWrapper[AgentContext],
        initial_message: str | None = None,
    ) -> str:
        agent_context = ctx.context
        message = initial_message if initial_message is not None else default_message
        if not isinstance(message, str):
            try:
                message = str(message)
            except Exception:  # pragma: no cover - garde-fou
                message = ""

        from .workflows.executor import WorkflowInput, run_workflow

        workflow_input = WorkflowInput(input_as_text=message)

        workflow_started = agent_context.workflow_item is not None
        task_indices: dict[str, int] = {}
        task_texts: dict[str, str] = {}

        async def _ensure_workflow_started() -> None:
            nonlocal workflow_started
            if not show_ui:
                return
            if workflow_started and agent_context.workflow_item is not None:
                return
            if agent_context.workflow_item is not None:
                workflow_started = True
                return
            summary_title = _summary_title()
            summary_payload = (
                CustomSummary(title=summary_title)
                if summary_title is not None
                else None
            )
            workflow_model = Workflow(
                type="reasoning",
                tasks=[],
                summary=summary_payload,
                expanded=True,
            )
            try:
                await agent_context.start_workflow(workflow_model)
            except Exception as exc:  # pragma: no cover - robustesse best effort
                logger.debug(
                    "Impossible de démarrer le workflow côté UI (%s)",
                    slug,
                    exc_info=exc,
                )
            else:
                workflow_started = True

        async def _upsert_task(
            key: str,
            *,
            title: str,
            content: str,
            status: str,
        ) -> None:
            if not show_ui:
                return
            await _ensure_workflow_started()
            if agent_context.workflow_item is None:
                return

            existing_index = task_indices.get(key)
            task_payload = ThoughtTask(
                title=title,
                content=content,
                status_indicator=status,
            )
            try:
                if existing_index is None:
                    await agent_context.add_workflow_task(task_payload)
                    workflow_item = agent_context.workflow_item
                    if workflow_item is not None:
                        index = len(workflow_item.workflow.tasks) - 1
                        task_indices[key] = index
                else:
                    await agent_context.update_workflow_task(
                        task_payload, existing_index
                    )
            except Exception as exc:  # pragma: no cover - progression best effort
                logger.debug(
                    "Impossible de synchroniser la tâche %s du workflow",
                    key,
                    exc_info=exc,
                )

        async def _handle_step_stream(update: WorkflowStepStreamUpdate) -> None:
            if not show_ui:
                return
            title = update.title or f"Étape {update.index}"
            current = task_texts.get(update.key, "")
            if update.delta:
                current += update.delta
            elif update.text:
                current = update.text
            task_texts[update.key] = current
            display_text = current if current.strip() else "En cours..."
            await _upsert_task(
                update.key,
                title=title,
                content=display_text,
                status="loading",
            )

        async def _handle_step_completion(
            summary: WorkflowStepSummary, index: int
        ) -> None:
            if not show_ui:
                return
            title = summary.title or f"Étape {index}"
            if isinstance(summary.output, str):
                text = summary.output.strip()
            else:
                text = summary.output
            if not text:
                text = "(aucune sortie)"
            task_texts[summary.key] = text
            await _upsert_task(
                summary.key,
                title=title,
                content=text,
                status="complete",
            )

        workflow_completed = False
        try:
            summary = await run_workflow(
                workflow_input,
                agent_context=agent_context,
                on_step=_handle_step_completion,
                on_step_stream=_handle_step_stream if show_ui else None,
                on_stream_event=agent_context.stream,
                workflow_service=workflow_service,
                workflow_slug=slug,
            )
            result_text = _summary_to_text(summary)
            if show_ui and agent_context.workflow_item is not None:
                final_title = _summary_title()
                if summary.steps and not final_title:
                    final_title = summary.steps[-1].title or slug
                summary_payload = (
                    CustomSummary(title=final_title)
                    if final_title is not None
                    else None
                )
                try:
                    await agent_context.end_workflow(
                        summary=summary_payload,
                        expanded=True,
                    )
                except Exception as exc:  # pragma: no cover - best effort
                    logger.debug(
                        "Impossible de terminer le workflow côté UI (%s)",
                        slug,
                        exc_info=exc,
                    )
                else:
                    workflow_completed = True
            return result_text
        finally:
            if (
                show_ui
                and not workflow_completed
                and agent_context.workflow_item is not None
            ):
                try:
                    await agent_context.end_workflow(expanded=True)
                except Exception as exc:  # pragma: no cover - best effort
                    logger.debug(
                        "Impossible de finaliser le workflow côté UI (%s)",
                        slug,
                        exc_info=exc,
                    )

    return _run_configured_workflow


def build_widget_validation_tool(payload: Any) -> FunctionTool | None:
    """Construit un FunctionTool pointant vers validate_widget_definition."""

    if isinstance(payload, FunctionTool):
        return payload

    name_override = "validate_widget"
    description = _WIDGET_VALIDATION_TOOL_DEFAULT_DESCRIPTION

    if isinstance(payload, dict):
        raw_name = (
            payload.get("name") or payload.get("id") or payload.get("function_name")
        )
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
    "WorkflowValidationResult",
    "build_file_search_tool",
    "build_image_generation_tool",
    "build_weather_tool",
    "build_workflow_tool",
    "build_workflow_validation_tool",
    "build_web_search_tool",
    "build_widget_validation_tool",
    "sanitize_web_search_user_location",
    "validate_workflow_graph",
    "validate_widget_definition",
]
