from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Any

from pydantic import BaseModel

from chatkit.agents import AgentContext
from chatkit.types import ThreadStreamEvent

from ..chatkit_server.actions import (
    _apply_widget_variable_values,
    _collect_widget_bindings,
    _load_widget_definition,
    _ResponseWidgetConfig,
    _WidgetBinding,
)
from ..vector_store.ingestion import evaluate_state_expression
from ..widgets import WidgetLibraryService

try:  # pragma: no cover - dépend de la version du SDK Agents installée
    from chatkit.agents import stream_widget as _sdk_stream_widget
except ImportError:  # pragma: no cover - compatibilité avec les anciennes versions
    _sdk_stream_widget = None  # type: ignore[assignment]

logger = logging.getLogger("chatkit.server")


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
            elif isinstance(step, int):
                path_parts.append(str(step))
        if not path_parts:
            continue
        candidate_key = ".".join(path_parts)
        if candidate_key in collected:
            candidate = collected[candidate_key]
        else:
            candidate = None
            for key, value in collected.items():
                if not key.startswith(candidate_key + "."):
                    continue
                suffix = key[len(candidate_key) + 1 :]
                if not suffix:
                    continue
                candidate_key = key
                candidate = value
                break
        if candidate is None:
            continue
        consumed_keys.add(candidate_key)
        if isinstance(candidate, list):
            enriched[identifier] = _coerce_widget_binding_sequence_value(
                candidate, binding
            )
        else:
            enriched[identifier] = candidate

    for key in consumed_keys:
        enriched.pop(key, None)

    return _normalize_sequence_fields(enriched)


def _evaluate_widget_variable_expression(
    expression: str,
    *,
    state: Mapping[str, Any],
    last_step_context: Mapping[str, Any] | None,
    input_context: Mapping[str, Any] | None,
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
    step_context: Mapping[str, Any] | None,
    state: Mapping[str, Any],
    last_step_context: Mapping[str, Any] | None,
    agent_context: AgentContext[Any],
    emit_stream_event: Callable[[ThreadStreamEvent], Awaitable[None]] | None,
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
            expression,
            state=state,
            last_step_context=last_step_context,
            input_context=step_context,
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
        return None

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
            if emit_stream_event is not None:
                await emit_stream_event(event)
    except Exception as exc:  # pragma: no cover - dépend du SDK Agents
        logger.exception(
            "Impossible de diffuser le widget %s pour %s",
            widget_label,
            step_title,
            exc_info=exc,
        )
        return None

    return widget
