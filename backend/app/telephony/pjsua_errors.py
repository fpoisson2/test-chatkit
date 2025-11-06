"""Utilities for interpreting errors raised by :mod:`pjsua2`."""

from __future__ import annotations

from .pjsua_lib import PJSUA_AVAILABLE, pj


def _is_invalid_conference_disconnect_error(error: Exception) -> bool:
    """Return ``True`` when a PJ_EINVAL error can be safely ignored."""

    message = str(error) if error else ""
    if "EINVAL" in message or "70004" in message:
        return True

    if PJSUA_AVAILABLE and isinstance(error, pj.Error):  # type: ignore[has-type]
        status = getattr(error, "status", None)
        if status in {getattr(pj, "PJ_EINVAL", 70004), 70004}:
            return True

    return False


def _is_session_terminated_error(error: Exception) -> bool:
    """Return ``True`` when the error corresponds to ESESSIONTERMINATED."""

    message = str(error).lower() if error else ""

    if (
        "already terminated" in message
        or "esessionterminated" in message
        or "171140" in message
    ):
        return True

    if PJSUA_AVAILABLE and isinstance(error, pj.Error):  # type: ignore[has-type]
        status = getattr(error, "status", None)
        if status == 171140:
            return True

    return False


__all__ = [
    "_is_invalid_conference_disconnect_error",
    "_is_session_terminated_error",
]
