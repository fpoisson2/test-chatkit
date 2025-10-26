from __future__ import annotations

import base64
import datetime
import hashlib
import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any
from urllib.parse import urlparse

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import (
    ADMIN_MODEL_API_KEY_ENV,
    DEFAULT_THREAD_TITLE_PROMPT,
    get_settings,
    set_runtime_settings_overrides,
)
from .database import SessionLocal
from .models import AppSettings

logger = logging.getLogger(__name__)

@dataclass(slots=True)
class AdminSettingsUpdateResult:
    settings: AppSettings | None
    sip_changed: bool
    prompt_changed: bool
    model_settings_changed: bool
    provider_changed: bool

_UNSET = object()


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


@lru_cache(maxsize=1)
def _get_cipher() -> Fernet:
    secret = os.environ.get("APP_SETTINGS_SECRET_KEY") or os.environ.get(
        "AUTH_SECRET_KEY"
    )
    if not secret:
        raise RuntimeError(
            "APP_SETTINGS_SECRET_KEY (ou AUTH_SECRET_KEY) doit être défini pour "
            "chiffrer les clés API."
        )
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def _encrypt_secret(value: str) -> str:
    return _get_cipher().encrypt(value.encode("utf-8")).decode("utf-8")


def _decrypt_secret(value: str | None) -> str | None:
    if not value:
        return None
    try:
        decrypted = _get_cipher().decrypt(value.encode("utf-8"))
    except InvalidToken:
        logger.warning(
            "Clé API modèle illisible : le secret a probablement été modifié."
        )
        return None
    return decrypted.decode("utf-8")


def _mask_secret(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        return ""
    if len(trimmed) <= 4:
        return "•" * len(trimmed)
    return "•" * (len(trimmed) - 4) + trimmed[-4:]


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


def _normalize_model_provider(value: str | None) -> str | None:
    if value is None:
        return None
    candidate = value.strip().lower()
    return candidate or None


def _sanitize_model_api_base(
    value: str | None, *, strict: bool = False
) -> str | None:
    if value is None:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    try:
        parsed = urlparse(candidate)
    except ValueError as exc:
        if strict:
            raise ValueError("URL de base du fournisseur invalide") from exc
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        if strict:
            raise ValueError(
                "L'URL de base du fournisseur doit commencer par http(s)://"
                " et contenir un hôte."
            )
        return None
    return candidate.rstrip("/")


def _has_model_overrides(settings: AppSettings | None) -> bool:
    if not settings:
        return False
    if _normalize_model_provider(settings.model_provider):
        return True
    if _sanitize_model_api_base(settings.model_api_base, strict=False):
        return True
    if settings.model_api_key_encrypted:
        return True
    return False


def _compute_model_overrides(settings: AppSettings | None) -> dict[str, Any]:
    overrides: dict[str, Any] = {}
    if not settings:
        return overrides
    provider = _normalize_model_provider(settings.model_provider)
    if provider:
        overrides["model_provider"] = provider
    base = _sanitize_model_api_base(settings.model_api_base, strict=False)
    if base:
        overrides["model_api_base"] = base
    decrypted = _decrypt_secret(settings.model_api_key_encrypted)
    if decrypted:
        overrides["model_api_key"] = decrypted
        overrides["model_api_key_env"] = ADMIN_MODEL_API_KEY_ENV
        overrides["openai_api_key"] = decrypted
    return overrides


def apply_runtime_model_overrides(settings: AppSettings | None) -> Any:
    overrides = _compute_model_overrides(settings)
    set_runtime_settings_overrides(overrides or None)
    return get_settings()


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
    model_provider: str | None | object = _UNSET,
    model_api_base: str | None | object = _UNSET,
    model_api_key: str | None | object = _UNSET,
) -> AdminSettingsUpdateResult:
    default_prompt = _default_thread_title_prompt()
    stored_settings = get_thread_title_prompt_override(session)
    previous_prompt = _resolved_prompt(stored_settings, default_prompt)
    previous_sip_values = _resolved_sip_values(stored_settings)
    previous_overrides = _compute_model_overrides(stored_settings)

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

    if model_provider is not _UNSET:
        if model_provider is None:
            settings.model_provider = None
        else:
            normalized_provider = _normalize_model_provider(str(model_provider))
            if not normalized_provider:
                raise ValueError(
                    "Le fournisseur de modèles doit contenir au moins un caractère."
                )
            settings.model_provider = normalized_provider
        changed = True

    if model_api_base is not _UNSET:
        if model_api_base is None:
            settings.model_api_base = None
        else:
            normalized_base = _sanitize_model_api_base(
                str(model_api_base), strict=True
            )
            settings.model_api_base = normalized_base
        changed = True

    if model_api_key is not _UNSET:
        if model_api_key is None:
            settings.model_api_key_encrypted = None
            settings.model_api_key_hint = None
        else:
            candidate_key = str(model_api_key)
            stripped_key = candidate_key.strip()
            if not stripped_key:
                raise ValueError("La clé API ne peut pas être vide.")
            settings.model_api_key_encrypted = _encrypt_secret(stripped_key)
            settings.model_api_key_hint = _mask_secret(stripped_key)
        changed = True

    if not changed:
        return AdminSettingsUpdateResult(
            settings=None if created else settings,
            sip_changed=False,
            prompt_changed=False,
            model_settings_changed=False,
            provider_changed=False,
        )

    normalized_prompt = settings.thread_title_prompt.strip()
    if not normalized_prompt:
        normalized_prompt = default_prompt
        settings.thread_title_prompt = normalized_prompt

    has_custom_prompt = normalized_prompt != default_prompt
    resolved_sip_values = _resolved_sip_values(settings)
    has_sip_values = any(value is not None for value in resolved_sip_values)
    new_overrides = _compute_model_overrides(settings)
    has_model_values = bool(new_overrides)

    if not has_custom_prompt and not has_sip_values and not has_model_values:
        new_prompt = default_prompt
        new_sip_values = (None, None, None, None, None, None)
        if not created:
            session.delete(settings)
            session.commit()
        return AdminSettingsUpdateResult(
            settings=None,
            sip_changed=previous_sip_values != new_sip_values,
            prompt_changed=previous_prompt != new_prompt,
            model_settings_changed=previous_overrides != new_overrides,
            provider_changed=(
                previous_overrides.get("model_provider")
                != new_overrides.get("model_provider")
            ),
        )

    settings.updated_at = _now()
    session.add(settings)
    session.commit()
    session.refresh(settings)
    new_prompt = _resolved_prompt(settings, default_prompt)
    new_sip_values = resolved_sip_values
    final_overrides = _compute_model_overrides(settings)
    return AdminSettingsUpdateResult(
        settings=settings,
        sip_changed=previous_sip_values != new_sip_values,
        prompt_changed=previous_prompt != new_prompt,
        model_settings_changed=previous_overrides != final_overrides,
        provider_changed=(
            previous_overrides.get("model_provider")
            != final_overrides.get("model_provider")
        ),
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
    runtime_settings = get_settings()
    provider_overridden = bool(
        settings and _normalize_model_provider(settings.model_provider)
    )
    base_overridden = bool(
        settings and _sanitize_model_api_base(settings.model_api_base, strict=False)
    )
    api_key_managed = bool(settings and settings.model_api_key_encrypted)

    return {
        "thread_title_prompt": resolved_prompt,
        "default_thread_title_prompt": resolved_default,
        "is_custom_thread_title_prompt": is_custom,
        "model_provider": runtime_settings.model_provider,
        "model_api_base": runtime_settings.model_api_base,
        "is_model_provider_overridden": provider_overridden,
        "is_model_api_base_overridden": base_overridden,
        "is_model_api_key_managed": api_key_managed,
        "model_api_key_hint": (
            settings.model_api_key_hint if api_key_managed and settings else None
        ),
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
