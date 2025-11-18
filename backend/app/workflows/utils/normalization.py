"""Text normalization helpers for workflows."""

from __future__ import annotations

from typing import Final

_ZERO_WIDTH_CHARACTERS: Final = frozenset({"\u200b", "\u200c", "\u200d", "\ufeff"})
"""Invisible characters stripped from user inputs."""


def _normalize_user_text(value: str | None) -> str:
    """Strip invisible characters and whitespace from user messages."""

    if not value:
        return ""

    sanitized = "".join(ch for ch in value if ch not in _ZERO_WIDTH_CHARACTERS)
    return sanitized.strip()
