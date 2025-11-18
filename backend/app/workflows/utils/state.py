"""State serialization helpers for workflows."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


def _json_safe_copy(value: Any) -> Any:
    """Create a JSON-safe deep copy of mappings, sequences, and primitives."""

    if isinstance(value, Mapping):
        return {str(key): _json_safe_copy(item) for key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        return [_json_safe_copy(entry) for entry in value]
    if isinstance(value, str | int | float | bool) or value is None:
        return value
    return str(value)
