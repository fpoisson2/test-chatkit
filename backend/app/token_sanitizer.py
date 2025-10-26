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
    # L'API attend la verbosité dans l'objet « text », pas sous « reasoning ».
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


def strip_unsupported_reasoning_fields(
    value: Any, *, allow_summary: bool = True
) -> tuple[Any, bool]:
    """Supprime récursivement les champs de raisonnement non pris en charge."""

    if isinstance(value, dict):
        sanitized: dict[Any, Any] = {}
        removed_any = False
        pending_text_verbosity: str | None = None

        for key, item in value.items():
            if key == "reasoning" and isinstance(item, dict):
                sanitized_reasoning: dict[Any, Any] = {}
                removed_reasoning = False
                for field, field_value in item.items():
                    if field == "summary" and not allow_summary:
                        removed_reasoning = True
                        continue
                    if field in UNSUPPORTED_REASONING_FIELDS:
                        removed_reasoning = True
                        if (
                            field == "verbosity"
                            and isinstance(field_value, str)
                            and field_value.strip()
                        ):
                            pending_text_verbosity = field_value.strip()
                        continue
                    sanitized_value, removed_nested = (
                        strip_unsupported_reasoning_fields(
                            field_value,
                            allow_summary=allow_summary,
                        )
                    )
                    sanitized_reasoning[field] = sanitized_value
                    removed_reasoning = removed_reasoning or removed_nested

                if sanitized_reasoning:
                    sanitized[key] = sanitized_reasoning
                removed_any = removed_any or removed_reasoning
            else:
                sanitized_item, removed_item = strip_unsupported_reasoning_fields(
                    item, allow_summary=allow_summary
                )
                sanitized[key] = sanitized_item
                removed_any = removed_any or removed_item

        if pending_text_verbosity:
            current_text = sanitized.get("text")
            if isinstance(current_text, dict):
                current_verbosity = current_text.get("verbosity")
                if (
                    not isinstance(current_verbosity, str)
                    or not current_verbosity.strip()
                ):
                    current_text["verbosity"] = pending_text_verbosity
            else:
                sanitized["text"] = {"verbosity": pending_text_verbosity}

        return sanitized, removed_any or pending_text_verbosity is not None

    if isinstance(value, list):
        sanitized_list: list[Any] = []
        removed_any = False
        for element in value:
            sanitized_element, removed = strip_unsupported_reasoning_fields(
                element, allow_summary=allow_summary
            )
            sanitized_list.append(sanitized_element)
            removed_any = removed_any or removed
        return sanitized_list, removed_any

    return value, False


def sanitize_value(
    value: Any, *, allow_reasoning_summary: bool = True
) -> tuple[Any, bool]:
    """Retourne une valeur nettoyée et un indicateur de suppression."""

    sanitized, removed_tokens = strip_max_token_fields(value)
    sanitized_reasoning, removed_reasoning = strip_unsupported_reasoning_fields(
        sanitized, allow_summary=allow_reasoning_summary
    )
    return sanitized_reasoning, removed_tokens or removed_reasoning


def sanitize_model_like(
    settings: T, *, allow_reasoning_summary: bool = True
) -> T:
    """Nettoie les champs *max tokens* d'un objet de configuration."""

    if settings is None:
        return settings

    model_dump = getattr(settings, "model_dump", None)
    to_json_dict = getattr(settings, "to_json_dict", None)
    if not callable(model_dump):
        if callable(to_json_dict):
            data = to_json_dict()
            sanitized_data, removed = sanitize_value(
                data, allow_reasoning_summary=allow_reasoning_summary
            )
            if not removed:
                return settings
            try:
                return cast(T, settings.__class__(**sanitized_data))
            except TypeError:  # pragma: no cover - fallback ultime
                return settings
        for field in MAX_TOKEN_FIELD_NAMES:
            if hasattr(settings, field):
                try:
                    delattr(settings, field)
                except AttributeError:  # pragma: no cover - objets non mutables
                    setattr(settings, field, None)
        if not allow_reasoning_summary:
            reasoning = getattr(settings, "reasoning", None)
            if hasattr(reasoning, "summary"):
                try:
                    reasoning.summary = None
                except Exception:  # pragma: no cover - objets immuables
                    try:
                        object.__setattr__(reasoning, "summary", None)
                    except Exception:
                        pass
        return settings

    data = model_dump(mode="python", exclude_none=False, round_trip=True)
    sanitized_data, removed = sanitize_value(
        data, allow_reasoning_summary=allow_reasoning_summary
    )
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
