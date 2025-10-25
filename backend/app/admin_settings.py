from __future__ import annotations

import datetime
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import DEFAULT_THREAD_TITLE_PROMPT, get_settings
from .database import SessionLocal
from .models import AppSettings


@dataclass(slots=True)
class AdminSettingsUpdateResult:
    settings: AppSettings | None
    sip_changed: bool
    prompt_changed: bool

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


def _normalize_optional_string(value: str | None) -> str | None:
    if value is None:
        return None
    candidate = value.strip()
    return candidate or None


def _resolved_prompt(settings: AppSettings | None, default_prompt: str) -> str:
    if settings and settings.thread_title_prompt.strip():
        return settings.thread_title_prompt.strip()
    return default_prompt


def _normalize_optional_int(value: int | str | None) -> int | None:
    if value is None:
        return None
    try:
        port = int(value)
    except (TypeError, ValueError):
        return None
    if port <= 0 or port > 65535:
        return None
    return port


_VALID_TRANSPORTS = {"udp", "tcp", "tls"}


def _normalize_transport(value: str | None) -> str | None:
    if value is None:
        return None
    candidate = value.strip().lower()
    if not candidate:
        return None
    if candidate not in _VALID_TRANSPORTS:
        return None
    return candidate


def _resolved_sip_values(
    settings: AppSettings | None,
) -> tuple[
    str | None,
    str | None,
    str | None,
    str | None,
    int | None,
    str | None,
]:
    if not settings:
        return (None, None, None, None, None, None)
    return (
        _normalize_optional_string(settings.sip_trunk_uri),
        _normalize_optional_string(settings.sip_trunk_username),
        _normalize_optional_string(settings.sip_trunk_password),
        _normalize_optional_string(settings.sip_contact_host),
        _normalize_optional_int(settings.sip_contact_port),
        _normalize_transport(settings.sip_contact_transport),
    )


def update_admin_settings(
    session: Session,
    *,
    thread_title_prompt: str | None | object = _UNSET,
    sip_trunk_uri: str | None | object = _UNSET,
    sip_trunk_username: str | None | object = _UNSET,
    sip_trunk_password: str | None | object = _UNSET,
    sip_contact_host: str | None | object = _UNSET,
    sip_contact_port: int | str | None | object = _UNSET,
    sip_contact_transport: str | None | object = _UNSET,
) -> AdminSettingsUpdateResult:
    default_prompt = _default_thread_title_prompt()
    stored_settings = get_thread_title_prompt_override(session)
    previous_prompt = _resolved_prompt(stored_settings, default_prompt)
    previous_sip_values = _resolved_sip_values(stored_settings)

    settings = stored_settings
    created = False

    if settings is None:
        settings = AppSettings(thread_title_prompt=default_prompt)
        created = True

    changed = False

    if thread_title_prompt is not _UNSET:
        settings.thread_title_prompt = _normalize_prompt(
            thread_title_prompt, default_prompt
        )
        changed = True

    if sip_trunk_uri is not _UNSET:
        settings.sip_trunk_uri = _normalize_optional_string(sip_trunk_uri)
        changed = True

    if sip_trunk_username is not _UNSET:
        settings.sip_trunk_username = _normalize_optional_string(sip_trunk_username)
        changed = True

    if sip_trunk_password is not _UNSET:
        settings.sip_trunk_password = _normalize_optional_string(sip_trunk_password)
        changed = True

    if sip_contact_host is not _UNSET:
        settings.sip_contact_host = _normalize_optional_string(sip_contact_host)
        changed = True

    if sip_contact_port is not _UNSET:
        settings.sip_contact_port = _normalize_optional_int(sip_contact_port)
        changed = True

    if sip_contact_transport is not _UNSET:
        settings.sip_contact_transport = _normalize_transport(sip_contact_transport)
        changed = True

    if not changed:
        return AdminSettingsUpdateResult(
            settings=None if created else settings,
            sip_changed=False,
            prompt_changed=False,
        )

    normalized_prompt = settings.thread_title_prompt.strip()
    if not normalized_prompt:
        normalized_prompt = default_prompt
        settings.thread_title_prompt = normalized_prompt

    has_custom_prompt = normalized_prompt != default_prompt
    resolved_sip_values = _resolved_sip_values(settings)
    has_sip_values = any(value is not None for value in resolved_sip_values)

    if not has_custom_prompt and not has_sip_values:
        new_prompt = default_prompt
        new_sip_values = (None, None, None, None, None, None)
        if not created:
            session.delete(settings)
            session.commit()
        return AdminSettingsUpdateResult(
            settings=None,
            sip_changed=previous_sip_values != new_sip_values,
            prompt_changed=previous_prompt != new_prompt,
        )

    settings.updated_at = _now()
    session.add(settings)
    session.commit()
    session.refresh(settings)
    new_prompt = _resolved_prompt(settings, default_prompt)
    new_sip_values = resolved_sip_values
    return AdminSettingsUpdateResult(
        settings=settings,
        sip_changed=previous_sip_values != new_sip_values,
        prompt_changed=previous_prompt != new_prompt,
    )


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
        "sip_trunk_uri": _normalize_optional_string(
            settings.sip_trunk_uri if settings else None
        ),
        "sip_trunk_username": _normalize_optional_string(
            settings.sip_trunk_username if settings else None
        ),
        "sip_trunk_password": _normalize_optional_string(
            settings.sip_trunk_password if settings else None
        ),
        "sip_contact_host": _normalize_optional_string(
            settings.sip_contact_host if settings else None
        ),
        "sip_contact_port": _normalize_optional_int(
            settings.sip_contact_port if settings else None
        ),
        "sip_contact_transport": _normalize_transport(
            settings.sip_contact_transport if settings else None
        ),
        "created_at": settings.created_at if settings else None,
        "updated_at": settings.updated_at if settings else None,
    }
