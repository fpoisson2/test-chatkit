from __future__ import annotations

import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import DEFAULT_THREAD_TITLE_PROMPT, get_settings
from .database import SessionLocal
from .models import AppSettings

_UNSET = object()


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


def _default_thread_title_prompt() -> str:
    try:
        settings = get_settings()
        candidate = getattr(settings, "thread_title_prompt", None)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    except Exception:  # pragma: no cover - fallback best effort
        return DEFAULT_THREAD_TITLE_PROMPT
    return DEFAULT_THREAD_TITLE_PROMPT


def get_thread_title_prompt_override(session: Session) -> AppSettings | None:
    return session.scalar(select(AppSettings).limit(1))


def _normalize_prompt(value: str | None, default_prompt: str) -> str:
    if value is None:
        return default_prompt
    candidate = value.strip()
    return candidate or default_prompt


def update_admin_settings(
    session: Session,
    *,
    thread_title_prompt: str | None | object = _UNSET,
) -> AppSettings | None:
    default_prompt = _default_thread_title_prompt()
    settings = get_thread_title_prompt_override(session)

    if thread_title_prompt is not _UNSET:
        normalized = _normalize_prompt(thread_title_prompt, default_prompt)
        if normalized == default_prompt:
            if settings:
                session.delete(settings)
                session.commit()
            return None
        if settings is None:
            settings = AppSettings(thread_title_prompt=normalized)
        else:
            settings.thread_title_prompt = normalized
        settings.updated_at = _now()
        session.add(settings)
        session.commit()
        session.refresh(settings)
        return settings

    return settings


def resolve_thread_title_prompt(session: Session | None = None) -> str:
    default_prompt = _default_thread_title_prompt()
    try:
        if session is not None:
            override = get_thread_title_prompt_override(session)
            if override and override.thread_title_prompt.strip():
                return override.thread_title_prompt.strip()
            return default_prompt

        with SessionLocal() as owned_session:
            override = get_thread_title_prompt_override(owned_session)
            if override and override.thread_title_prompt.strip():
                return override.thread_title_prompt.strip()
    except Exception:  # pragma: no cover - graceful fallback
        return default_prompt

    return default_prompt


def serialize_admin_settings(
    settings: AppSettings | None,
    *,
    default_prompt: str | None = None,
) -> dict[str, Any]:
    resolved_default = default_prompt or _default_thread_title_prompt()
    resolved_prompt = resolved_default
    if settings and settings.thread_title_prompt.strip():
        resolved_prompt = settings.thread_title_prompt.strip()

    is_custom = bool(settings and resolved_prompt != resolved_default)

    return {
        "thread_title_prompt": resolved_prompt,
        "default_thread_title_prompt": resolved_default,
        "is_custom_thread_title_prompt": is_custom,
        "created_at": settings.created_at if settings else None,
        "updated_at": settings.updated_at if settings else None,
    }
