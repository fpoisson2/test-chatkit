"""Utility helpers for locating the frontend i18n resources."""
from __future__ import annotations

import logging
import os
from collections.abc import Iterable
from pathlib import Path

logger = logging.getLogger(__name__)


def _candidate_i18n_paths() -> Iterable[Path]:
    """Yield potential locations for the frontend i18n directory."""
    repo_root = Path(__file__).resolve().parents[2]

    env_path = os.environ.get("FRONTEND_I18N_PATH")
    if env_path:
        candidate = Path(env_path).expanduser()
        if not candidate.is_absolute():
            candidate = repo_root / candidate
        yield candidate

    yield repo_root / "frontend" / "src" / "i18n"
    yield Path("/frontend/src/i18n")


def resolve_frontend_i18n_path() -> tuple[Path, bool]:
    """Return the most suitable i18n path and whether it exists.

    The search order is:
    1. ``FRONTEND_I18N_PATH`` environment variable (relative paths are
       interpreted from the repository root).
    2. ``frontend/src/i18n`` inside the repository.
    3. ``/frontend/src/i18n`` (path used in Docker deployments).

    Returns a tuple containing the chosen path and a boolean flag indicating
    if the directory exists.
    """

    candidates = list(_candidate_i18n_paths())
    for candidate in candidates:
        if candidate.exists():
            logger.debug("Resolved frontend i18n directory at %s", candidate)
            return candidate, True

    if candidates:
        logger.debug(
            "None of the frontend i18n directories exist. Using first candidate: %s",
            candidates[0],
        )
        return candidates[0], False

    # This should never happen, but keep a safe fallback.
    fallback = Path(__file__).resolve().parents[2] / "frontend" / "src" / "i18n"
    logger.debug("Fallback frontend i18n directory: %s", fallback)
    return fallback, False
