"""Conversation-related helper utilities for workflows."""

from __future__ import annotations

import copy
from collections.abc import Mapping, Sequence
from typing import Any


def _clone_conversation_history_snapshot(payload: Any) -> list[dict[str, Any]]:
    """Return a sanitized, deep-copied conversation history snapshot."""

    if isinstance(payload, str | bytes | bytearray):
        return []
    if not isinstance(payload, Sequence):
        return []

    cloned: list[dict[str, Any]] = []
    for entry in payload:
        if isinstance(entry, Mapping):
            cloned.append(copy.deepcopy(dict(entry)))
    return cloned
