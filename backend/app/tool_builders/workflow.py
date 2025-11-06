"""Builders et utilitaires liés aux workflows ChatKit."""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from collections.abc import Mapping
from dataclasses import field
from typing import TYPE_CHECKING, Any

from agents import FunctionTool, RunContextWrapper, function_tool

from ..chatkit.agents import AgentContext
from ..chatkit.types import CustomSummary, ThoughtTask, Workflow
from ..workflows import WorkflowService, WorkflowValidationError

if TYPE_CHECKING:  # pragma: no cover - aide mypy
    from ..workflows.executor import (
        WorkflowInput,
        WorkflowRunSummary,
        WorkflowStepStreamUpdate,
        WorkflowStepSummary,
    )

from pydantic.dataclasses import dataclass as pydantic_dataclass

logger = logging.getLogger("chatkit.server")

__all__ = [
    "WorkflowValidationResult",
    "validate_workflow_graph",
    "build_workflow_validation_tool",
    "build_workflow_tool",
]

_WORKFLOW_TOOL_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")
_WORKFLOW_VALIDATION_TOOL_ALIASES = {
    "validate_workflow_graph",
    "workflow_validation",
    "validate_workflow",
}
_WORKFLOW_VALIDATION_TOOL_DEFAULT_DESCRIPTION = (
    "Valide la configuration d'un graphe de workflow ChatKit et renvoie la version "
    "normalisée ainsi que les erreurs éventuelles."
)


@pydantic_dataclass
class WorkflowValidationResult:
    """Représente le résultat structuré de la validation d'un workflow."""

    valid: bool
    normalized_graph: dict[str, Any] | None = None
    errors: list[str] = field(default_factory=list)


def _normalize_workflow_tool_name(candidate: Any) -> str | None:
    """Normalise un nom de tool workflow pour satisfaire le pattern OpenAI."""

    if not isinstance(candidate, str):
        return None

    trimmed = candidate.strip()
    if not trimmed:
        return None

    if _WORKFLOW_TOOL_NAME_PATTERN.fullmatch(trimmed):
        return trimmed

    normalized = unicodedata.normalize("NFKD", trimmed)
    without_marks = "".join(
        ch for ch in normalized if unicodedata.category(ch) != "Mn"
    )
    replaced = re.sub(r"[^0-9A-Za-z_-]+", "_", without_marks)
    collapsed = re.sub(r"_+", "_", replaced).strip("_")

    if collapsed and _WORKFLOW_TOOL_NAME_PATTERN.fullmatch(collapsed):
        return collapsed

    return None


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
                    "Une erreur inattendue est survenue lors de la lecture du JSON.",
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

    if isinstance(payload, Mapping):
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
    """Construit un outil permettant de lancer un workflow ChatKit."""

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

    name_candidates: list[Any] = [
        config.get("name"),
        config.get("identifier"),
        config.get("workflow_identifier"),
    ]

    workflow_id_candidate = config.get("workflow_id") or config.get("id")
    if isinstance(workflow_id_candidate, int) and workflow_id_candidate > 0:
        name_candidates.append(f"workflow_{workflow_id_candidate}")
    elif isinstance(workflow_id_candidate, str):
        trimmed_id = workflow_id_candidate.strip()
        if trimmed_id:
            name_candidates.append(trimmed_id)

    name_candidates.extend([slug, f"workflow_{slug}"])

    tool_name: str | None = None
    for candidate in name_candidates:
        normalized_name = _normalize_workflow_tool_name(candidate)
        if normalized_name:
            tool_name = normalized_name
            break

    if tool_name is None:
        sanitized_slug = re.sub(r"[^0-9A-Za-z_-]+", "_", slug.lower()).strip("_")
        fallback_name = f"run_{sanitized_slug or 'workflow'}"
        tool_name = (
            fallback_name
            if _WORKFLOW_TOOL_NAME_PATTERN.fullmatch(fallback_name)
            else "workflow_tool"
        )

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
        context_payload = getattr(ctx, "context", None)
        step_context: Mapping[str, Any] | None = None

        if isinstance(context_payload, AgentContext):
            agent_context = context_payload
        else:
            agent_context = getattr(context_payload, "agent_context", None)
            candidate_step_context = getattr(context_payload, "step_context", None)
            if isinstance(candidate_step_context, Mapping):
                step_context = candidate_step_context
            elif isinstance(context_payload, Mapping):
                step_context = context_payload

        if not isinstance(agent_context, AgentContext):
            fallback_context = getattr(ctx, "agent_context", None)
            if isinstance(fallback_context, AgentContext):
                agent_context = fallback_context

        if not isinstance(agent_context, AgentContext):
            raise RuntimeError(
                "Contexte agent indisponible pour l'exécution du workflow."
            )

        if step_context:
            try:
                logger.debug(
                    "Contexte précédent fourni à l'outil workflow %s : %s",
                    slug,
                    json.dumps(step_context, ensure_ascii=False, default=str),
                )
            except TypeError:
                logger.debug(
                    "Contexte précédent fourni à l'outil workflow %s non sérialisable",
                    slug,
                )

        message = initial_message if initial_message is not None else default_message
        if not isinstance(message, str):
            try:
                message = str(message)
            except Exception:  # pragma: no cover - garde-fou
                message = ""

        from ..workflows.executor import WorkflowInput, run_workflow

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
