from __future__ import annotations

import datetime
import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import (
    ADMIN_MODEL_API_KEY_ENV,
    DEFAULT_THREAD_TITLE_MODEL,
    DEFAULT_THREAD_TITLE_PROMPT,
    ModelProviderConfig,
    get_settings,
    set_runtime_settings_overrides,
)
from .database import SessionLocal
from .models import AppSettings
from .secret_utils import decrypt_secret as _decrypt_secret
from .secret_utils import encrypt_secret as _encrypt_secret
from .secret_utils import ensure_secret_key_available
from .secret_utils import mask_secret as _mask_secret

logger = logging.getLogger(__name__)

@dataclass(slots=True)
class AdminSettingsUpdateResult:
    settings: AppSettings | None
    sip_changed: bool
    prompt_changed: bool
    model_settings_changed: bool
    provider_changed: bool


@dataclass(slots=True)
class StoredModelProvider:
    id: str
    provider: str
    api_base: str
    api_key_encrypted: str | None
    api_key_hint: str | None
    is_default: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "provider": self.provider,
            "api_base": self.api_base,
            "api_key_encrypted": self.api_key_encrypted,
            "api_key_hint": self.api_key_hint,
            "is_default": self.is_default,
        }


@dataclass(frozen=True)
class ResolvedModelProviderCredentials:
    id: str
    provider: str
    api_base: str
    api_key: str | None

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


def _default_thread_title_model() -> str:
    try:
        settings = get_settings()
        candidate = getattr(settings, "thread_title_model", None)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    except Exception:  # pragma: no cover - fallback best effort
        return DEFAULT_THREAD_TITLE_MODEL
    return DEFAULT_THREAD_TITLE_MODEL


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


def _normalize_thread_title_model(value: str | None, default_model: str) -> str:
    if value is None:
        return default_model
    candidate = value.strip()
    return candidate or default_model


def _resolved_prompt(settings: AppSettings | None, default_prompt: str) -> str:
    if settings and settings.thread_title_prompt.strip():
        return settings.thread_title_prompt.strip()
    return default_prompt


def _resolved_thread_title_model(
    settings: AppSettings | None, default_model: str
) -> str:
    candidate = getattr(settings, "thread_title_model", None)
    if isinstance(candidate, str) and candidate.strip():
        return candidate.strip()
    return default_model


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


def _normalize_provider_id(value: Any) -> str:
    candidate = ""
    if isinstance(value, str):
        candidate = value.strip()
    if not candidate:
        candidate = uuid.uuid4().hex
    return candidate


def _normalize_optional_encrypted(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    return candidate or None


def _load_stored_model_providers(
    settings: AppSettings | None,
) -> list[StoredModelProvider]:
    if not settings or not settings.model_provider_configs:
        return []
    try:
        raw_payload = json.loads(settings.model_provider_configs)
    except (TypeError, json.JSONDecodeError):
        logger.warning(
            "Configuration des fournisseurs de modèles illisible : JSON invalide."
        )
        return []

    records: list[StoredModelProvider] = []
    for entry in raw_payload:
        if not isinstance(entry, dict):
            continue
        provider = _normalize_model_provider(entry.get("provider"))
        base = _sanitize_model_api_base(entry.get("api_base"), strict=False)
        if not provider or not base:
            continue
        record = StoredModelProvider(
            id=_normalize_provider_id(entry.get("id")),
            provider=provider,
            api_base=base,
            api_key_encrypted=_normalize_optional_encrypted(
                entry.get("api_key_encrypted")
            ),
            api_key_hint=_normalize_optional_encrypted(entry.get("api_key_hint")),
            is_default=bool(entry.get("is_default")),
        )
        records.append(record)
    return records


def _dump_stored_model_providers(records: list[StoredModelProvider]) -> str | None:
    if not records:
        return None
    payload = [record.to_dict() for record in records]
    return json.dumps(payload, ensure_ascii=False)


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
    if _load_stored_model_providers(settings):
        return True
    if _normalize_model_provider(settings.model_provider):
        return True
    if _sanitize_model_api_base(settings.model_api_base, strict=False):
        return True
    if settings.model_api_key_encrypted:
        return True
    return False


def _build_model_provider_configs(
    settings: AppSettings | None,
) -> tuple[ModelProviderConfig, ...]:
    if not settings:
        return tuple()

    records = _load_stored_model_providers(settings)
    configs: list[ModelProviderConfig] = []

    if records:
        for record in records:
            configs.append(
                ModelProviderConfig(
                    provider=record.provider,
                    api_base=record.api_base,
                    api_key=_decrypt_secret(record.api_key_encrypted),
                    is_default=record.is_default,
                    id=record.id,
                )
            )
        return tuple(configs)

    provider = _normalize_model_provider(settings.model_provider)
    base = _sanitize_model_api_base(settings.model_api_base, strict=False)
    if provider and base:
        configs.append(
            ModelProviderConfig(
                provider=provider,
                api_base=base,
                api_key=_decrypt_secret(settings.model_api_key_encrypted),
                is_default=True,
                id="__env__",
            )
        )
    return tuple(configs)


def resolve_model_provider_credentials(
    provider_id: str,
    *,
    session: Session | None = None,
) -> ResolvedModelProviderCredentials | None:
    normalized = provider_id.strip() if isinstance(provider_id, str) else ""
    if not normalized:
        return None

    owned_session = False
    db_session = session
    if db_session is None:
        db_session = SessionLocal()
        owned_session = True

    try:
        settings = get_thread_title_prompt_override(db_session)
        record: StoredModelProvider | None = None
        if settings is not None:
            for candidate in _load_stored_model_providers(settings):
                if candidate.id == normalized:
                    record = candidate
                    break
        if record is None:
            return None
        return ResolvedModelProviderCredentials(
            id=record.id,
            provider=record.provider,
            api_base=record.api_base,
            api_key=_decrypt_secret(record.api_key_encrypted),
        )
    finally:
        if owned_session and db_session is not None:
            db_session.close()


def _compute_model_overrides(settings: AppSettings | None) -> dict[str, Any]:
    overrides: dict[str, Any] = {}
    configs = _build_model_provider_configs(settings)
    if configs:
        overrides["model_providers"] = configs
        default_config = next((cfg for cfg in configs if cfg.is_default), configs[0])
        overrides["model_provider"] = default_config.provider
        overrides["model_api_base"] = default_config.api_base
        if default_config.api_key:
            overrides["model_api_key"] = default_config.api_key
            overrides["model_api_key_env"] = ADMIN_MODEL_API_KEY_ENV
            if default_config.provider == "openai":
                overrides["openai_api_key"] = default_config.api_key
        return overrides

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
        if provider == "openai":
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
    thread_title_model: str | None | object = _UNSET,
    sip_trunk_uri: str | None | object = _UNSET,
    sip_trunk_username: str | None | object = _UNSET,
    sip_trunk_password: str | None | object = _UNSET,
    sip_contact_host: str | None | object = _UNSET,
    sip_contact_port: int | str | None | object = _UNSET,
    sip_contact_transport: str | None | object = _UNSET,
    model_provider: str | None | object = _UNSET,
    model_api_base: str | None | object = _UNSET,
    model_api_key: str | None | object = _UNSET,
    model_providers: list[Any] | None | object = _UNSET,
) -> AdminSettingsUpdateResult:
    default_prompt = _default_thread_title_prompt()
    default_model = _default_thread_title_model()
    stored_settings = get_thread_title_prompt_override(session)
    previous_prompt = _resolved_prompt(stored_settings, default_prompt)
    previous_model = _resolved_thread_title_model(stored_settings, default_model)
    previous_sip_values = _resolved_sip_values(stored_settings)
    previous_overrides = _compute_model_overrides(stored_settings)

    settings = stored_settings
    created = False

    if settings is None:
        settings = AppSettings(
            thread_title_prompt=default_prompt,
            thread_title_model=default_model,
        )
        created = True

    changed = False

    if thread_title_prompt is not _UNSET:
        settings.thread_title_prompt = _normalize_prompt(
            thread_title_prompt, default_prompt
        )
        changed = True

    if thread_title_model is not _UNSET:
        settings.thread_title_model = _normalize_thread_title_model(
            thread_title_model, default_model
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

    existing_provider_records = _load_stored_model_providers(stored_settings)
    legacy_record: StoredModelProvider | None = None
    if not existing_provider_records and stored_settings is not None:
        legacy_provider = _normalize_model_provider(stored_settings.model_provider)
        legacy_base = _sanitize_model_api_base(
            stored_settings.model_api_base, strict=False
        )
        if legacy_provider and legacy_base:
            legacy_record = StoredModelProvider(
                id="__legacy__",
                provider=legacy_provider,
                api_base=legacy_base,
                api_key_encrypted=stored_settings.model_api_key_encrypted,
                api_key_hint=stored_settings.model_api_key_hint,
                is_default=True,
            )

    if model_api_key is not _UNSET:
        if model_api_key is None:
            settings.model_api_key_encrypted = None
            settings.model_api_key_hint = None
        else:
            candidate_key = str(model_api_key)
            stripped_key = candidate_key.strip()
            if not stripped_key:
                raise ValueError("La clé API ne peut pas être vide.")
            ensure_secret_key_available()
            settings.model_api_key_encrypted = _encrypt_secret(stripped_key)
            settings.model_api_key_hint = _mask_secret(stripped_key)
        changed = True

    if model_providers is not _UNSET:
        changed = True
        submitted = model_providers or []
        new_records: list[StoredModelProvider] = []
        existing_by_id = {record.id: record for record in existing_provider_records}
        if legacy_record is not None:
            existing_by_id[legacy_record.id] = legacy_record
        default_count = 0
        seen_ids: set[str] = set()

        for item in submitted:
            if hasattr(item, "model_dump"):
                entry = item.model_dump()
            elif isinstance(item, dict):
                entry = dict(item)
            else:
                raise ValueError("Format de configuration de fournisseur invalide.")

            provider_value = _normalize_model_provider(entry.get("provider"))
            if not provider_value:
                raise ValueError(
                    "Chaque fournisseur doit contenir au moins un caractère."
                )

            try:
                normalized_base = _sanitize_model_api_base(
                    entry.get("api_base"), strict=True
                )
            except ValueError as exc:
                raise ValueError(str(exc)) from exc

            entry_id = _normalize_provider_id(entry.get("id"))
            if entry_id in seen_ids:
                raise ValueError(
                    "Chaque configuration de fournisseur doit avoir un identifiant "
                    "unique."
                )
            seen_ids.add(entry_id)

            is_default = bool(entry.get("is_default"))
            if is_default:
                default_count += 1

            delete_flag = bool(entry.get("delete_api_key"))
            new_key = entry.get("api_key")
            if delete_flag and new_key not in (None, ""):
                raise ValueError(
                    "Impossible de fournir une clé API et de demander sa suppression."
                )

            encrypted = None
            hint = None
            existing_record = existing_by_id.get(entry_id)
            if existing_record is not None:
                encrypted = existing_record.api_key_encrypted
                hint = existing_record.api_key_hint

            if new_key is not None:
                candidate = str(new_key)
                stripped_candidate = candidate.strip()
                if not stripped_candidate:
                    raise ValueError("La clé API ne peut pas être vide.")
                ensure_secret_key_available()
                encrypted = _encrypt_secret(stripped_candidate)
                hint = _mask_secret(stripped_candidate)
            elif delete_flag:
                encrypted = None
                hint = None

            new_records.append(
                StoredModelProvider(
                    id=entry_id,
                    provider=provider_value,
                    api_base=normalized_base,
                    api_key_encrypted=encrypted,
                    api_key_hint=hint,
                    is_default=is_default,
                )
            )

        if new_records:
            if default_count == 0:
                raise ValueError(
                    "Un fournisseur par défaut doit être sélectionné lorsqu'au moins "
                    "une configuration est enregistrée."
                )
            if default_count > 1:
                raise ValueError("Un seul fournisseur peut être défini par défaut.")

        settings.model_provider_configs = _dump_stored_model_providers(new_records)

        if new_records:
            default_record = next(record for record in new_records if record.is_default)
            settings.model_provider = default_record.provider
            settings.model_api_base = default_record.api_base
            settings.model_api_key_encrypted = default_record.api_key_encrypted
            settings.model_api_key_hint = default_record.api_key_hint
        else:
            settings.model_provider = None
            settings.model_api_base = None
            settings.model_api_key_encrypted = None
            settings.model_api_key_hint = None

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

    normalized_model = settings.thread_title_model.strip()
    if not normalized_model:
        normalized_model = default_model
        settings.thread_title_model = normalized_model

    has_custom_prompt = normalized_prompt != default_prompt
    has_custom_model = normalized_model != default_model
    resolved_sip_values = _resolved_sip_values(settings)
    has_sip_values = any(value is not None for value in resolved_sip_values)
    new_overrides = _compute_model_overrides(settings)
    has_model_values = bool(new_overrides)

    if (
        not has_custom_prompt
        and not has_custom_model
        and not has_sip_values
        and not has_model_values
    ):
        new_prompt = default_prompt
        new_model = default_model
        new_sip_values = (None, None, None, None, None, None)
        if not created:
            session.delete(settings)
            session.commit()
        return AdminSettingsUpdateResult(
            settings=None,
            sip_changed=previous_sip_values != new_sip_values,
            prompt_changed=(
                previous_prompt != new_prompt or previous_model != new_model
            ),
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
    new_model = _resolved_thread_title_model(settings, default_model)
    new_sip_values = resolved_sip_values
    final_overrides = _compute_model_overrides(settings)
    return AdminSettingsUpdateResult(
        settings=settings,
        sip_changed=previous_sip_values != new_sip_values,
        prompt_changed=(
            previous_prompt != new_prompt or previous_model != new_model
        ),
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


def resolve_thread_title_model(session: Session | None = None) -> str:
    default_model = _default_thread_title_model()
    try:
        if session is not None:
            override = get_thread_title_prompt_override(session)
            if override and override.thread_title_model.strip():
                return override.thread_title_model.strip()
            return default_model

        with SessionLocal() as owned_session:
            override = get_thread_title_prompt_override(owned_session)
            if override and override.thread_title_model.strip():
                return override.thread_title_model.strip()
    except Exception:  # pragma: no cover - graceful fallback
        return default_model

    return default_model


def serialize_admin_settings(
    settings: AppSettings | None,
    *,
    default_prompt: str | None = None,
) -> dict[str, Any]:
    resolved_default_prompt = default_prompt or _default_thread_title_prompt()
    resolved_prompt = resolved_default_prompt
    if settings and settings.thread_title_prompt.strip():
        resolved_prompt = settings.thread_title_prompt.strip()

    resolved_default_model = _default_thread_title_model()
    resolved_model = _resolved_thread_title_model(settings, resolved_default_model)

    is_custom_prompt = bool(
        settings and resolved_prompt != resolved_default_prompt
    )
    is_custom_model = bool(settings and resolved_model != resolved_default_model)
    runtime_settings = get_settings()
    provider_overridden = bool(
        settings and _normalize_model_provider(settings.model_provider)
    )
    base_overridden = bool(
        settings and _sanitize_model_api_base(settings.model_api_base, strict=False)
    )
    api_key_managed = bool(settings and settings.model_api_key_encrypted)
    stored_records = _load_stored_model_providers(settings)
    serialized_records = [
        {
            "id": record.id,
            "provider": record.provider,
            "api_base": record.api_base,
            "api_key_hint": record.api_key_hint,
            "has_api_key": bool(record.api_key_encrypted),
            "is_default": record.is_default,
        }
        for record in stored_records
    ]

    return {
        "thread_title_prompt": resolved_prompt,
        "default_thread_title_prompt": resolved_default_prompt,
        "is_custom_thread_title_prompt": is_custom_prompt,
        "thread_title_model": resolved_model,
        "default_thread_title_model": resolved_default_model,
        "is_custom_thread_title_model": is_custom_model,
        "model_provider": runtime_settings.model_provider,
        "model_api_base": runtime_settings.model_api_base,
        "is_model_provider_overridden": provider_overridden,
        "is_model_api_base_overridden": base_overridden,
        "is_model_api_key_managed": api_key_managed,
        "model_api_key_hint": (
            settings.model_api_key_hint if api_key_managed and settings else None
        ),
        "model_providers": serialized_records,
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
