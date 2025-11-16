from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from sqlalchemy.orm import Session

from .service import JsonVectorStoreService

logger = logging.getLogger("chatkit.server")

_MUSTACHE_PATTERN = re.compile(r"\{\{\s*(.+?)\s*\}\}")
_MUSTACHE_FULL_PATTERN = re.compile(r"^\s*\{\{\s*(.+?)\s*\}\}\s*$")


def resolve_from_container(value: Any, path: str) -> Any:
    """Récupère une valeur imbriquée en gérant les alias Pydantic."""

    def _as_mapping(candidate: Any) -> dict[str, Any] | None:
        if isinstance(candidate, dict):
            return candidate
        if hasattr(candidate, "model_dump"):
            try:
                dumped = candidate.model_dump(by_alias=True)  # type: ignore[call-arg]
            except TypeError:
                dumped = candidate.model_dump()
            if isinstance(dumped, dict):
                return dumped
        if hasattr(candidate, "dict"):
            try:
                dumped = candidate.dict(by_alias=True)  # type: ignore[call-arg]
            except TypeError:
                dumped = candidate.dict()
            if isinstance(dumped, dict):
                return dumped
        return None

    def _resolve(current: Any, parts: list[str]) -> Any:
        if not parts:
            return current

        if isinstance(current, list | tuple):
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


def evaluate_state_expression(
    expression: Any,
    *,
    state: Mapping[str, Any],
    default_input_context: Mapping[str, Any] | None = None,
    input_context: Mapping[str, Any] | None = None,
) -> Any:
    if expression is None:
        return None
    if isinstance(expression, bool | int | float | dict | list):
        return expression
    if isinstance(expression, str):
        expr = expression.strip()
        if not expr:
            return None
        if expr == "state":
            return state
        context = input_context if input_context is not None else default_input_context
        if expr == "input":
            if context is None:
                raise RuntimeError(
                    "Aucun résultat précédent disponible pour l'expression 'input'."
                )
            return context
        if expr.startswith("state."):
            state_path = expr[len("state.") :]
            if re.fullmatch(r"[A-Za-z0-9_.]+", state_path):
                return resolve_from_container(state, state_path)
        if expr.startswith("input."):
            input_path = expr[len("input.") :]
            if re.fullmatch(r"[A-Za-z0-9_.]+", input_path):
                if context is None:
                    raise RuntimeError(
                        "Aucun résultat précédent disponible pour les expressions "
                        "basées sur 'input'."
                    )
                return resolve_from_container(context, input_path)
        try:
            return json.loads(expr)
        except json.JSONDecodeError:
            eval_context: dict[str, Any] = {"state": state}
            if context is not None:
                eval_context["input"] = context

            try:
                return eval(expr, {"__builtins__": {}}, eval_context)
            except Exception:
                return expr
    return expression


def _render_template_string(
    template: str,
    *,
    state: Mapping[str, Any],
    default_input_context: Mapping[str, Any] | None = None,
    input_context: Mapping[str, Any] | None = None,
) -> Any:
    full_match = _MUSTACHE_FULL_PATTERN.match(template)
    if full_match:
        expression = full_match.group(1).strip()
        try:
            return evaluate_state_expression(
                expression,
                state=state,
                default_input_context=default_input_context,
                input_context=input_context,
            )
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
            value = evaluate_state_expression(
                expression,
                state=state,
                default_input_context=default_input_context,
                input_context=input_context,
            )
        except Exception:
            logger.debug(
                "Impossible d'évaluer l'expression de template '%s'.",
                expression,
                exc_info=True,
            )
            return ""
        if value is None:
            return ""
        if isinstance(value, dict | list):
            try:
                return json.dumps(value, ensure_ascii=False)
            except TypeError:
                return str(value)
        return str(value)

    return _MUSTACHE_PATTERN.sub(_replacement, template)


def resolve_transform_value(
    value: Any,
    *,
    state: Mapping[str, Any],
    default_input_context: Mapping[str, Any] | None = None,
    input_context: Mapping[str, Any] | None = None,
) -> Any:
    if isinstance(value, dict):
        return {
            key: resolve_transform_value(
                entry,
                state=state,
                default_input_context=default_input_context,
                input_context=input_context,
            )
            for key, entry in value.items()
        }
    if isinstance(value, list):
        return [
            resolve_transform_value(
                entry,
                state=state,
                default_input_context=default_input_context,
                input_context=input_context,
            )
            for entry in value
        ]
    if isinstance(value, str):
        if "{{" in value and "}}" in value:
            return _render_template_string(
                value,
                state=state,
                default_input_context=default_input_context,
                input_context=input_context,
            )
        trimmed = value.strip()
        if trimmed in {"state", "input"} or trimmed.startswith(("state.", "input.")):
            try:
                return evaluate_state_expression(
                    trimmed,
                    state=state,
                    default_input_context=default_input_context,
                    input_context=input_context,
                )
            except Exception:
                logger.debug(
                    "Impossible d'évaluer l'expression '%s' dans le bloc transform.",
                    trimmed,
                    exc_info=True,
                )
                return value
        return value
    return value


def _to_mapping(
    candidate: Any,
    *,
    step_slug: str,
    purpose: str,
) -> dict[str, Any] | None:
    if hasattr(candidate, "model_dump"):
        try:
            return candidate.model_dump(by_alias=True)  # type: ignore[call-arg]
        except TypeError:
            return candidate.model_dump()
    if hasattr(candidate, "dict"):
        try:
            return candidate.dict(by_alias=True)  # type: ignore[call-arg]
        except TypeError:
            return candidate.dict()
    if isinstance(candidate, str):
        trimmed = candidate.strip()
        if not trimmed:
            return None
        logger.debug(
            "Tentative de parsing JSON pour %s (taille: %d, début: %s...)",
            step_slug,
            len(trimmed),
            trimmed[:100],
        )
        try:
            decoded = json.loads(trimmed)
        except json.JSONDecodeError as exc:
            if purpose == "document":
                logger.warning(
                    "Le document produit par %s n'est pas un JSON valide pour "
                    "l'ingestion. Erreur: %s",
                    step_slug,
                    str(exc),
                )
            else:
                logger.warning(
                    "Les métadonnées calculées pour %s ne sont pas un JSON "
                    "valide. Erreur: %s",
                    step_slug,
                    str(exc),
                )
            return None
        if isinstance(decoded, dict):
            return decoded
        if purpose == "document":
            logger.warning(
                "Le document généré par %s doit être un objet JSON pour "
                "être indexé (type %s).",
                step_slug,
                type(decoded).__name__,
            )
        else:
            logger.warning(
                "Les métadonnées calculées pour %s doivent être un objet "
                "JSON (type %s).",
                step_slug,
                type(decoded).__name__,
            )
        return None
    if isinstance(candidate, Mapping):
        return dict(candidate)
    return None


def _normalize_workflow_blueprint(
    value: Any,
    *,
    step_slug: str,
) -> dict[str, Any] | None:
    if value is None:
        return None

    if hasattr(value, "model_dump"):
        try:
            value = value.model_dump(by_alias=True)  # type: ignore[call-arg]
        except TypeError:
            value = value.model_dump()
    elif hasattr(value, "dict"):
        try:
            value = value.dict(by_alias=True)  # type: ignore[call-arg]
        except TypeError:
            value = value.dict()

    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed:
            return None
        try:
            decoded = json.loads(trimmed)
        except json.JSONDecodeError as exc:
            logger.warning(
                "Le blueprint calculé pour %s doit être un JSON valide (erreur: %s)",
                step_slug,
                str(exc),
            )
            return None
        value = decoded

    if not isinstance(value, Mapping):
        logger.warning(
            "Le blueprint de workflow calculé pour %s doit être un objet JSON.",
            step_slug,
        )
        return None

    mapping = dict(value)

    slug_raw = mapping.get("slug")
    slug = str(slug_raw).strip() if isinstance(slug_raw, str) else ""
    if not slug:
        logger.warning(
            "Le blueprint de workflow calculé pour %s doit contenir un slug non vide.",
            step_slug,
        )
        return None

    display_name_raw = mapping.get("display_name")
    display_name = (
        str(display_name_raw).strip()
        if isinstance(display_name_raw, str)
        else ""
    )
    if not display_name:
        logger.warning(
            "Le blueprint de workflow calculé pour %s doit contenir un nom à afficher.",
            step_slug,
        )
        return None

    graph_raw = mapping.get("graph")
    if hasattr(graph_raw, "model_dump"):
        try:
            graph_raw = graph_raw.model_dump(by_alias=True)  # type: ignore[call-arg]
        except TypeError:
            graph_raw = graph_raw.model_dump()
    elif hasattr(graph_raw, "dict"):
        try:
            graph_raw = graph_raw.dict(by_alias=True)  # type: ignore[call-arg]
        except TypeError:
            graph_raw = graph_raw.dict()

    if not isinstance(graph_raw, Mapping):
        logger.warning(
            "Le blueprint calculé pour %s doit contenir un objet 'graph'.",
            step_slug,
        )
        return None

    graph = dict(graph_raw)
    nodes_value = graph.get("nodes")
    edges_value = graph.get("edges")

    if not isinstance(nodes_value, Sequence) or isinstance(nodes_value, str | bytes):
        logger.warning(
            "Le graphe du blueprint calculé pour %s doit définir une liste 'nodes'.",
            step_slug,
        )
        return None

    if not isinstance(edges_value, Sequence) or isinstance(edges_value, str | bytes):
        logger.warning(
            "Le graphe du blueprint calculé pour %s doit définir une liste 'edges'.",
            step_slug,
        )
        return None

    graph["nodes"] = list(nodes_value)
    graph["edges"] = list(edges_value)

    description_raw = mapping.get("description")
    description: str | None = None
    if isinstance(description_raw, str):
        description = description_raw.strip() or None
    elif description_raw is not None:
        description = str(description_raw).strip() or None

    normalized: dict[str, Any] = {
        "slug": slug,
        "display_name": display_name,
        "graph": graph,
        "mark_active": bool(mapping.get("mark_active")),
    }
    if description:
        normalized["description"] = description

    return normalized


def _ingest_vector_store_document(
    slug: str,
    doc_id: str,
    document: dict[str, Any],
    metadata: dict[str, Any],
    *,
    session_factory: Callable[[], Session],
) -> None:
    with session_factory() as session:
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


async def ingest_document(
    slug: str,
    doc_id: str,
    document: dict[str, Any],
    metadata: dict[str, Any],
    *,
    session_factory: Callable[[], Session],
) -> None:
    try:
        await asyncio.to_thread(
            _ingest_vector_store_document,
            slug,
            doc_id,
            document,
            metadata,
            session_factory=session_factory,
        )
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


async def ingest_workflow_step(
    *,
    config: Mapping[str, Any] | None,
    step_slug: str,
    step_title: str,
    step_context: Mapping[str, Any] | None,
    state: Mapping[str, Any],
    default_input_context: Mapping[str, Any] | None,
    session_factory: Callable[[], Session],
) -> None:
    if not isinstance(config, Mapping):
        return

    slug_raw = config.get("vector_store_slug")
    slug = str(slug_raw).strip() if isinstance(slug_raw, str) else ""
    if not slug:
        logger.debug(
            "Configuration vector_store_ingestion ignorée pour %s : slug absent.",
            step_slug,
        )
        return

    if not isinstance(step_context, Mapping):
        logger.warning(
            "Impossible d'ingérer le document JSON pour %s : aucun contexte "
            "disponible.",
            step_slug,
        )
        return

    doc_id_expression_raw = config.get("doc_id_expression") or config.get("doc_id")
    doc_id_expression = (
        doc_id_expression_raw.strip() if isinstance(doc_id_expression_raw, str) else ""
    )
    doc_id_value: Any = None
    if doc_id_expression:
        try:
            doc_id_value = evaluate_state_expression(
                doc_id_expression,
                state=state,
                default_input_context=default_input_context,
                input_context=step_context,
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
        if not isinstance(parsed_context, Mapping):
            parsed_context = step_context.get("output_parsed")
        if isinstance(parsed_context, Mapping):
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

    document_expression_raw = config.get("document_expression") or config.get(
        "document"
    )
    document_expression = (
        document_expression_raw.strip()
        if isinstance(document_expression_raw, str)
        else ""
    )
    document_value: Any = None
    if document_expression:
        try:
            document_value = evaluate_state_expression(
                document_expression,
                state=state,
                default_input_context=default_input_context,
                input_context=step_context,
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
        for candidate_key in (
            "output_structured",
            "output_parsed",
            "output",
            "output_text",
        ):
            candidate_value = step_context.get(candidate_key)
            mapping = _to_mapping(
                candidate_value,
                step_slug=step_slug,
                purpose="document",
            )
            if mapping is not None:
                document_value = mapping
                break

    document_mapping = _to_mapping(
        document_value,
        step_slug=step_slug,
        purpose="document",
    )
    if document_mapping is None:
        logger.warning(
            "Le document généré par %s doit être un objet JSON pour être indexé "
            "(type %s).",
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

    workflow_blueprint_expression_raw = config.get("workflow_blueprint_expression")
    workflow_blueprint_expression = (
        workflow_blueprint_expression_raw.strip()
        if isinstance(workflow_blueprint_expression_raw, str)
        else ""
    )

    workflow_blueprint: dict[str, Any] | None = None
    if workflow_blueprint_expression:
        try:
            workflow_blueprint_value = evaluate_state_expression(
                workflow_blueprint_expression,
                state=state,
                default_input_context=default_input_context,
                input_context=step_context,
            )
        except Exception as exc:  # pragma: no cover - dépend des expressions fournies
            logger.exception(
                "Impossible d'évaluer l'expression de blueprint '%s' pour %s",
                workflow_blueprint_expression,
                step_slug,
                exc_info=exc,
            )
        else:
            workflow_blueprint = _normalize_workflow_blueprint(
                workflow_blueprint_value,
                step_slug=step_slug,
            )
    elif "workflow_blueprint" in config:
        workflow_blueprint = _normalize_workflow_blueprint(
            config.get("workflow_blueprint"),
            step_slug=step_slug,
        )

    if metadata_expression:
        try:
            metadata_value = evaluate_state_expression(
                metadata_expression,
                state=state,
                default_input_context=default_input_context,
                input_context=step_context,
            )
        except Exception as exc:  # pragma: no cover - dépend des expressions fournies
            logger.exception(
                "Impossible d'évaluer l'expression de métadonnées '%s' pour %s",
                metadata_expression,
                step_slug,
                exc_info=exc,
            )
        else:
            metadata_mapping = _to_mapping(
                metadata_value,
                step_slug=step_slug,
                purpose="metadata",
            )
            if metadata_mapping is not None:
                metadata.update(metadata_mapping)
            elif metadata_value is not None:
                logger.warning(
                    "Les métadonnées calculées pour %s doivent être un objet JSON.",
                    step_slug,
                )

    if workflow_blueprint is not None:
        metadata["workflow_blueprint"] = workflow_blueprint

    logger.info(
        "Ingestion du résultat JSON de %s dans le vector store %s (doc_id=%s)",
        step_slug,
        slug,
        doc_id,
    )
    await ingest_document(
        slug,
        doc_id,
        document_mapping,
        metadata,
        session_factory=session_factory,
    )


__all__ = [
    "evaluate_state_expression",
    "ingest_document",
    "ingest_workflow_step",
    "resolve_from_container",
    "resolve_transform_value",
]
