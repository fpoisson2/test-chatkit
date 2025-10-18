"""Outils de nettoyage pour retirer les champs liés aux limites de jetons."""

from __future__ import annotations

from typing import Any, TypeVar, cast

T = TypeVar("T")

MAX_TOKEN_FIELD_NAMES = {
    "max_tokens",
    "maxTokens",
    "maxOutputTokens",
    "max_completion_tokens",
    "maxCompletionTokens",
    "max_input_tokens",
    "maxInputTokens",
}

UNSUPPORTED_REASONING_FIELDS = {
    # L'API ne reconnaît pas encore le réglage de verbosité du raisonnement.
    "verbosity",
}


def strip_max_token_fields(value: Any) -> tuple[Any, bool]:
    """Supprime récursivement les champs liés aux limites de jetons."""

    if isinstance(value, dict):
        sanitized: dict[Any, Any] = {}
        removed_any = False
        for key, item in value.items():
            if key in MAX_TOKEN_FIELD_NAMES:
                removed_any = True
                continue
            sanitized_item, removed = strip_max_token_fields(item)
            sanitized[key] = sanitized_item
            removed_any = removed_any or removed
        return sanitized, removed_any

    if isinstance(value, list):
        sanitized_list: list[Any] = []
        removed_any = False
        for element in value:
            sanitized_element, removed = strip_max_token_fields(element)
            sanitized_list.append(sanitized_element)
            removed_any = removed_any or removed
        return sanitized_list, removed_any

    return value, False


def strip_unsupported_reasoning_fields(value: Any) -> tuple[Any, bool]:
    """Supprime récursivement les champs de raisonnement non pris en charge."""

    if isinstance(value, dict):
        sanitized: dict[Any, Any] = {}
        removed_any = False
        for key, item in value.items():
            if key == "reasoning" and isinstance(item, dict):
                sanitized_reasoning: dict[Any, Any] = {}
                removed_reasoning = False
                for field, field_value in item.items():
                    if field in UNSUPPORTED_REASONING_FIELDS:
                        removed_reasoning = True
                        continue
                    sanitized_value, removed_nested = strip_unsupported_reasoning_fields(
                        field_value
                    )
                    sanitized_reasoning[field] = sanitized_value
                    removed_reasoning = removed_reasoning or removed_nested
                sanitized[key] = sanitized_reasoning
                removed_any = removed_any or removed_reasoning
            else:
                sanitized_item, removed_item = strip_unsupported_reasoning_fields(item)
                sanitized[key] = sanitized_item
                removed_any = removed_any or removed_item
        return sanitized, removed_any

    if isinstance(value, list):
        sanitized_list: list[Any] = []
        removed_any = False
        for element in value:
            sanitized_element, removed = strip_unsupported_reasoning_fields(element)
            sanitized_list.append(sanitized_element)
            removed_any = removed_any or removed
        return sanitized_list, removed_any

    return value, False


def sanitize_value(value: Any) -> tuple[Any, bool]:
    """Retourne une valeur nettoyée et un indicateur de suppression."""

    sanitized, removed_tokens = strip_max_token_fields(value)
    sanitized_reasoning, removed_reasoning = strip_unsupported_reasoning_fields(sanitized)
    return sanitized_reasoning, removed_tokens or removed_reasoning


def sanitize_model_like(settings: T) -> T:
    """Nettoie les champs *max tokens* d'un objet de configuration."""

    if settings is None:
        return settings

    model_dump = getattr(settings, "model_dump", None)
    if not callable(model_dump):
        for field in MAX_TOKEN_FIELD_NAMES:
            if hasattr(settings, field):
                try:
                    delattr(settings, field)
                except AttributeError:  # pragma: no cover - objets non mutables
                    setattr(settings, field, None)
        return settings

    data = model_dump(mode="python", exclude_none=False, round_trip=True)
    sanitized_data, removed = strip_max_token_fields(data)
    if not removed:
        return settings

    validator = getattr(settings.__class__, "model_validate", None)
    if callable(validator):
        return cast(T, validator(sanitized_data))

    try:
        return cast(T, settings.__class__(**sanitized_data))
    except TypeError:  # pragma: no cover - fallback ultime
        clone = getattr(settings, "model_copy", None)
        if callable(clone):
            return cast(T, clone(update={}, deep=True))
        return settings

