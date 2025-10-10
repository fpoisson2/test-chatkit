"""Outils de nettoyage pour retirer les champs liés aux limites de jetons."""

from __future__ import annotations

from typing import Any, TypeVar, cast

T = TypeVar("T")

MAX_TOKEN_FIELD_NAMES = {
    "max_tokens",
    "maxTokens",
    "max_output_tokens",
    "maxOutputTokens",
    "max_completion_tokens",
    "maxCompletionTokens",
    "max_input_tokens",
    "maxInputTokens",
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


def sanitize_value(value: Any) -> tuple[Any, bool]:
    """Retourne une valeur nettoyée et un indicateur de suppression."""

    sanitized, removed = strip_max_token_fields(value)
    return sanitized, removed


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

