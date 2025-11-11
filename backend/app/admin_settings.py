from __future__ import annotations

import datetime
import json
import logging
import math
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import (
    ADMIN_MODEL_API_KEY_ENV,
    DEFAULT_THREAD_TITLE_MODEL,
    DEFAULT_THREAD_TITLE_PROMPT,
    ModelProviderConfig,
    ensure_lti_key_material,
    get_settings,
    set_runtime_settings_overrides,
)
from .database import SessionLocal
from .models import AppSettings, WorkflowAppearance
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
    api_base: str | None
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
    api_base: str | None
    api_key: str | None

_UNSET = object()


DEFAULT_APPEARANCE_COLOR_SCHEME = "system"
DEFAULT_APPEARANCE_ACCENT_COLOR = "#2563eb"
DEFAULT_APPEARANCE_USE_CUSTOM_SURFACE = False
DEFAULT_APPEARANCE_SURFACE_HUE = 222.0
DEFAULT_APPEARANCE_SURFACE_TINT = 92.0
DEFAULT_APPEARANCE_SURFACE_SHADE = 16.0
DEFAULT_APPEARANCE_BODY_FONT = (
    '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, '
    '"Helvetica Neue", sans-serif'
)
DEFAULT_APPEARANCE_HEADING_FONT = DEFAULT_APPEARANCE_BODY_FONT
DEFAULT_APPEARANCE_GREETING = ""
DEFAULT_APPEARANCE_PROMPT = ""
DEFAULT_APPEARANCE_PLACEHOLDER = "Posez votre question..."
DEFAULT_APPEARANCE_DISCLAIMER = ""
_ALLOWED_COLOR_SCHEMES = {"system", "light", "dark"}


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


def _sanitize_color_scheme(value: str | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(
            "Le mode de couleur doit être system, light ou dark."
        )
    candidate = value.strip().lower()
    if candidate not in _ALLOWED_COLOR_SCHEMES:
        raise ValueError(
            "Le mode de couleur doit être system, light ou dark."
        )
    return None if candidate == DEFAULT_APPEARANCE_COLOR_SCHEME else candidate


def _resolve_color_scheme(settings: AppSettings | None) -> str:
    raw_value = getattr(settings, "appearance_color_scheme", None)
    if isinstance(raw_value, str):
        candidate = raw_value.strip().lower()
        if candidate in _ALLOWED_COLOR_SCHEMES:
            return candidate
    return DEFAULT_APPEARANCE_COLOR_SCHEME


_HEX_COLOR_PATTERN = re.compile(r"#([0-9a-fA-F]{6})")


def _sanitize_accent_color(value: str | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(
            "La couleur d'accent doit être au format hexadécimal (#RRGGBB)."
        )
    candidate = value.strip()
    if not candidate:
        return None
    if not candidate.startswith("#"):
        candidate = f"#{candidate}"
    if not _HEX_COLOR_PATTERN.fullmatch(candidate):
        raise ValueError(
            "La couleur d'accent doit être au format hexadécimal (#RRGGBB)."
        )
    normalized = candidate.lower()
    return None if normalized == DEFAULT_APPEARANCE_ACCENT_COLOR else normalized


def _resolve_accent_color(settings: AppSettings | None) -> str:
    raw_value = getattr(settings, "appearance_accent_color", None)
    if isinstance(raw_value, str):
        candidate = raw_value.strip()
        if candidate and candidate.startswith("#"):
            normalized = candidate.lower()
            if _HEX_COLOR_PATTERN.fullmatch(normalized):
                return normalized
    return DEFAULT_APPEARANCE_ACCENT_COLOR


def _sanitize_surface_value(
    name: str,
    value: int | float | str | None,
    *,
    minimum: float,
    maximum: float,
) -> float | None:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        raise ValueError(
            f"La valeur {name} doit être numérique."
        ) from None
    if not math.isfinite(numeric) or numeric < minimum or numeric > maximum:
        raise ValueError(
            f"La valeur {name} doit être comprise entre {minimum} et {maximum}."
        )
    return float(numeric)


def _resolve_surface_value(
    value: int | float | str | None,
    default: float,
    *,
    minimum: float,
    maximum: float,
) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(numeric):
        return default
    return float(min(max(numeric, minimum), maximum))


def _sanitize_font(value: str | None, default: str) -> str | None:
    if value is None:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    return None if candidate == default else candidate


def _resolve_font(value: str | None, default: str) -> str:
    if isinstance(value, str):
        candidate = value.strip()
        if candidate:
            return candidate
    return default


def _resolve_placeholder(value: str | None) -> str:
    if isinstance(value, str):
        candidate = value.strip()
        if candidate:
            return candidate
    return DEFAULT_APPEARANCE_PLACEHOLDER


def _resolve_optional_text(value: str | None) -> str:
    if isinstance(value, str):
        candidate = value.strip()
        if candidate:
            return candidate
    return ""


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
        # Provider is required, but base_url is optional for LiteLLM with auto-routing
        if not provider:
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
        return ()

    records = _load_stored_model_providers(settings)
    configs: list[ModelProviderConfig] = []

    # Ajouter les providers de la DB
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

    # Ajouter aussi les providers de l'env de base pour ne pas les perdre
    # Cela permet de garder OpenAI (ou autre provider .env) même si on configure
    # d'autres providers (comme Groq) dans l'admin DB
    try:
        # Récupérer les settings de base AVANT overrides.
        # get_settings() retourne encore les anciens overrides
        # pendant que nous calculons les nouveaux.
        base_settings = get_settings()
        if base_settings and base_settings.model_providers:
            # Identifier les slugs déjà présents dans la DB
            db_provider_slugs = {r.provider for r in records} if records else set()

            # Ajouter les providers de l'env absents de la DB
            for env_provider in base_settings.model_providers:
                # La DB reste prioritaire : ignorer les slugs déjà présents
                if env_provider.provider not in db_provider_slugs:
                    configs.append(env_provider)
    except Exception:  # pragma: no cover - fallback best effort
        pass

    # Si aucun provider DB et aucun provider env, essayer de créer un depuis AppSettings
    if not configs:
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


_APPEARANCE_ATTRIBUTE_NAMES = (
    "appearance_color_scheme",
    "appearance_accent_color",
    "appearance_use_custom_surface",
    "appearance_surface_hue",
    "appearance_surface_tint",
    "appearance_surface_shade",
    "appearance_heading_font",
    "appearance_body_font",
    "appearance_start_greeting",
    "appearance_start_prompt",
    "appearance_input_placeholder",
    "appearance_disclaimer",
)


def _combine_appearance_sources(
    base: AppSettings | None, workflow_override: WorkflowAppearance | None
) -> AppSettings | WorkflowAppearance | SimpleNamespace | None:
    if workflow_override is None:
        return base

    combined = SimpleNamespace()
    for attribute in _APPEARANCE_ATTRIBUTE_NAMES:
        if hasattr(workflow_override, attribute):
            override_value = getattr(workflow_override, attribute)
            if override_value is not None:
                setattr(combined, attribute, override_value)
                continue
        if base is not None and hasattr(base, attribute):
            setattr(combined, attribute, getattr(base, attribute))
        else:
            setattr(combined, attribute, None)
    return combined


def _resolve_appearance_settings(
    settings: AppSettings | None,
    workflow_override: WorkflowAppearance | None = None,
) -> dict[str, Any]:
    source = _combine_appearance_sources(settings, workflow_override)
    return {
        "color_scheme": _resolve_color_scheme(source),
        "accent_color": _resolve_accent_color(source),
        "use_custom_surface_colors": bool(
            getattr(source, "appearance_use_custom_surface", False)
        ),
        "surface_hue": _resolve_surface_value(
            getattr(source, "appearance_surface_hue", None),
            DEFAULT_APPEARANCE_SURFACE_HUE,
            minimum=0.0,
            maximum=360.0,
        ),
        "surface_tint": _resolve_surface_value(
            getattr(source, "appearance_surface_tint", None),
            DEFAULT_APPEARANCE_SURFACE_TINT,
            minimum=0.0,
            maximum=100.0,
        ),
        "surface_shade": _resolve_surface_value(
            getattr(source, "appearance_surface_shade", None),
            DEFAULT_APPEARANCE_SURFACE_SHADE,
            minimum=0.0,
            maximum=100.0,
        ),
        "heading_font": _resolve_font(
            getattr(source, "appearance_heading_font", None),
            DEFAULT_APPEARANCE_HEADING_FONT,
        ),
        "body_font": _resolve_font(
            getattr(source, "appearance_body_font", None),
            DEFAULT_APPEARANCE_BODY_FONT,
        ),
        "start_screen_greeting": _resolve_optional_text(
            getattr(source, "appearance_start_greeting", None)
        ),
        "start_screen_prompt": _resolve_optional_text(
            getattr(source, "appearance_start_prompt", None)
        ),
        "start_screen_placeholder": _resolve_placeholder(
            getattr(source, "appearance_input_placeholder", None)
        ),
        "start_screen_disclaimer": _resolve_optional_text(
            getattr(source, "appearance_disclaimer", None)
        ),
    }


def _has_custom_appearance(settings: AppSettings | None) -> bool:
    if not settings:
        return False
    resolved = _resolve_appearance_settings(settings)
    if resolved["color_scheme"] != DEFAULT_APPEARANCE_COLOR_SCHEME:
        return True
    if resolved["accent_color"].lower() != DEFAULT_APPEARANCE_ACCENT_COLOR:
        return True
    if resolved["use_custom_surface_colors"] and (
        resolved["surface_hue"] != DEFAULT_APPEARANCE_SURFACE_HUE
        or resolved["surface_tint"] != DEFAULT_APPEARANCE_SURFACE_TINT
        or resolved["surface_shade"] != DEFAULT_APPEARANCE_SURFACE_SHADE
    ):
        return True
    if resolved["heading_font"] != DEFAULT_APPEARANCE_HEADING_FONT:
        return True
    if resolved["body_font"] != DEFAULT_APPEARANCE_BODY_FONT:
        return True
    if resolved["start_screen_greeting"] != DEFAULT_APPEARANCE_GREETING:
        return True
    if resolved["start_screen_prompt"] != DEFAULT_APPEARANCE_PROMPT:
        return True
    if resolved["start_screen_placeholder"] != DEFAULT_APPEARANCE_PLACEHOLDER:
        return True
    if resolved["start_screen_disclaimer"] != DEFAULT_APPEARANCE_DISCLAIMER:
        return True
    return False


def apply_runtime_model_overrides(settings: AppSettings | None) -> Any:
    overrides = _compute_model_overrides(settings) or {}
    lti_overrides = _compute_lti_overrides(settings)
    if lti_overrides:
        overrides.update(lti_overrides)
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


def _resolved_lti_tool_values(
    settings: AppSettings | None,
) -> tuple[str | None, str | None, str | None, str | None, str | None]:
    if not settings:
        return (None, None, None, None, None)
    private_key = _decrypt_secret(settings.lti_tool_private_key_encrypted)
    return (
        _normalize_optional_string(settings.lti_tool_client_id),
        _normalize_optional_string(settings.lti_tool_key_set_url),
        _normalize_optional_string(settings.lti_tool_audience),
        _normalize_optional_string(settings.lti_tool_key_id),
        private_key.strip() if private_key else None,
    )


def _compute_lti_overrides(settings: AppSettings | None) -> dict[str, Any] | None:
    client_id, key_set_url, audience, key_id, private_key = _resolved_lti_tool_values(
        settings
    )
    overrides: dict[str, Any] = {}
    if client_id:
        overrides["lti_tool_client_id"] = client_id
    if key_set_url:
        overrides["lti_tool_key_set_url"] = key_set_url
    if audience:
        overrides["lti_tool_audience"] = audience
    if key_id:
        overrides["lti_tool_key_id"] = key_id
    if private_key:
        overrides["lti_tool_private_key"] = private_key
    return overrides or None


def apply_appearance_update(
    target: Any,
    *,
    color_scheme: str | None | object = _UNSET,
    accent_color: str | None | object = _UNSET,
    use_custom_surface_colors: bool | None | object = _UNSET,
    surface_hue: float | int | str | None | object = _UNSET,
    surface_tint: float | int | str | None | object = _UNSET,
    surface_shade: float | int | str | None | object = _UNSET,
    heading_font: str | None | object = _UNSET,
    body_font: str | None | object = _UNSET,
    start_screen_greeting: str | None | object = _UNSET,
    start_screen_prompt: str | None | object = _UNSET,
    start_screen_placeholder: str | None | object = _UNSET,
    start_screen_disclaimer: str | None | object = _UNSET,
) -> bool:
    changed = False

    if color_scheme is not _UNSET:
        if color_scheme is not None and not isinstance(color_scheme, str):
            raise ValueError(
                "Le mode de couleur doit être une chaîne de caractères."
            )
        target.appearance_color_scheme = _sanitize_color_scheme(color_scheme)
        changed = True

    if accent_color is not _UNSET:
        if accent_color is not None and not isinstance(accent_color, str):
            raise ValueError(
                "La couleur d'accent doit être une chaîne au format #RRGGBB."
            )
        target.appearance_accent_color = _sanitize_accent_color(accent_color)
        changed = True

    if use_custom_surface_colors is not _UNSET:
        target.appearance_use_custom_surface = bool(use_custom_surface_colors)
        changed = True

    if surface_hue is not _UNSET:
        target.appearance_surface_hue = _sanitize_surface_value(
            "surface_hue",
            surface_hue,
            minimum=0.0,
            maximum=360.0,
        )
        changed = True

    if surface_tint is not _UNSET:
        target.appearance_surface_tint = _sanitize_surface_value(
            "surface_tint",
            surface_tint,
            minimum=0.0,
            maximum=100.0,
        )
        changed = True

    if surface_shade is not _UNSET:
        target.appearance_surface_shade = _sanitize_surface_value(
            "surface_shade",
            surface_shade,
            minimum=0.0,
            maximum=100.0,
        )
        changed = True

    if heading_font is not _UNSET:
        if heading_font is not None and not isinstance(heading_font, str):
            raise ValueError("La police des titres doit être une chaîne.")
        target.appearance_heading_font = _sanitize_font(
            heading_font, DEFAULT_APPEARANCE_HEADING_FONT
        )
        changed = True

    if body_font is not _UNSET:
        if body_font is not None and not isinstance(body_font, str):
            raise ValueError("La police principale doit être une chaîne.")
        target.appearance_body_font = _sanitize_font(
            body_font, DEFAULT_APPEARANCE_BODY_FONT
        )
        changed = True

    if start_screen_greeting is not _UNSET:
        if (
            start_screen_greeting is not None
            and not isinstance(start_screen_greeting, str)
        ):
            raise ValueError("Le message de bienvenue doit être une chaîne.")
        target.appearance_start_greeting = _normalize_optional_string(
            start_screen_greeting
        )
        changed = True

    if start_screen_prompt is not _UNSET:
        if (
            start_screen_prompt is not None
            and not isinstance(start_screen_prompt, str)
        ):
            raise ValueError("La phrase d'accroche doit être une chaîne.")
        target.appearance_start_prompt = _normalize_optional_string(
            start_screen_prompt
        )
        changed = True

    if start_screen_placeholder is not _UNSET:
        if (
            start_screen_placeholder is not None
            and not isinstance(start_screen_placeholder, str)
        ):
            raise ValueError("Le placeholder doit être une chaîne.")
        target.appearance_input_placeholder = _normalize_optional_string(
            start_screen_placeholder
        )
        changed = True

    if start_screen_disclaimer is not _UNSET:
        if (
            start_screen_disclaimer is not None
            and not isinstance(start_screen_disclaimer, str)
        ):
            raise ValueError("L'avertissement doit être une chaîne.")
        target.appearance_disclaimer = _normalize_optional_string(
            start_screen_disclaimer
        )
        changed = True

    return changed


def update_appearance_settings(
    session: Session,
    *,
    color_scheme: str | None | object = _UNSET,
    accent_color: str | None | object = _UNSET,
    use_custom_surface_colors: bool | None | object = _UNSET,
    surface_hue: float | int | str | None | object = _UNSET,
    surface_tint: float | int | str | None | object = _UNSET,
    surface_shade: float | int | str | None | object = _UNSET,
    heading_font: str | None | object = _UNSET,
    body_font: str | None | object = _UNSET,
    start_screen_greeting: str | None | object = _UNSET,
    start_screen_prompt: str | None | object = _UNSET,
    start_screen_placeholder: str | None | object = _UNSET,
    start_screen_disclaimer: str | None | object = _UNSET,
) -> AppSettings:
    stored_settings = get_thread_title_prompt_override(session)
    settings = stored_settings
    if settings is None:
        settings = AppSettings(
            thread_title_prompt=_default_thread_title_prompt(),
            thread_title_model=_default_thread_title_model(),
        )

    changed = apply_appearance_update(
        settings,
        color_scheme=color_scheme,
        accent_color=accent_color,
        use_custom_surface_colors=use_custom_surface_colors,
        surface_hue=surface_hue,
        surface_tint=surface_tint,
        surface_shade=surface_shade,
        heading_font=heading_font,
        body_font=body_font,
        start_screen_greeting=start_screen_greeting,
        start_screen_prompt=start_screen_prompt,
        start_screen_placeholder=start_screen_placeholder,
        start_screen_disclaimer=start_screen_disclaimer,
    )

    if not changed:
        return settings

    settings.updated_at = _now()
    session.add(settings)
    session.commit()
    session.refresh(settings)
    return settings


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
    has_appearance_values = _has_custom_appearance(settings)

    if (
        not has_custom_prompt
        and not has_custom_model
        and not has_sip_values
        and not has_model_values
        and not has_appearance_values
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


def _load_workflow_appearance_override(
    session: Session, reference: int | str | None
) -> WorkflowAppearance | None:
    if reference is None:
        return None

    workflow_id: int | None = None
    slug_candidate: str | None = None

    if isinstance(reference, int):
        workflow_id = reference
        slug_candidate = str(reference)
    else:
        trimmed = str(reference).strip()
        if not trimmed:
            return None
        try:
            workflow_id = int(trimmed)
            slug_candidate = trimmed
        except ValueError:
            slug_candidate = trimmed

    if workflow_id is not None:
        override = session.scalar(
            select(WorkflowAppearance).where(
                WorkflowAppearance.workflow_id == workflow_id
            )
        )
        if override is not None:
            return override

    if slug_candidate:
        normalized_slug = slug_candidate.strip().lower()
        if not normalized_slug:
            return None
        return session.scalar(
            select(WorkflowAppearance).where(
                WorkflowAppearance.hosted_workflow_slug == normalized_slug
            )
        )

    return None


def resolve_appearance_settings(
    session: Session | None = None,
    workflow_reference: int | str | None = None,
) -> dict[str, Any]:
    try:
        if session is not None:
            override = get_thread_title_prompt_override(session)
            workflow_override = _load_workflow_appearance_override(
                session, workflow_reference
            )
            return serialize_appearance_settings(override, workflow_override)
        with SessionLocal() as owned_session:
            override = get_thread_title_prompt_override(owned_session)
            workflow_override = _load_workflow_appearance_override(
                owned_session, workflow_reference
            )
            return serialize_appearance_settings(override, workflow_override)
    except Exception:  # pragma: no cover - fallback
        return serialize_appearance_settings(None, None)


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


def serialize_lti_tool_settings(settings: AppSettings | None) -> dict[str, Any]:
    runtime_settings = get_settings()
    (
        stored_client_id,
        stored_key_set_url,
        stored_audience,
        stored_key_id,
        stored_private_key,
    ) = _resolved_lti_tool_values(settings)

    resolved_client_id = stored_client_id or runtime_settings.lti_tool_client_id
    resolved_key_set_url = stored_key_set_url or runtime_settings.lti_tool_key_set_url
    resolved_audience = stored_audience or runtime_settings.lti_tool_audience
    resolved_key_id = stored_key_id or runtime_settings.lti_tool_key_id
    resolved_private_key = stored_private_key or runtime_settings.lti_tool_private_key

    private_key_hint = None
    if resolved_private_key:
        private_key_hint = _mask_secret(resolved_private_key.strip())

    (
        private_key_path,
        public_key_path,
        generated_public_key,
    ) = _ensure_managed_lti_key_files(runtime_settings)

    public_key_pem = generated_public_key
    public_key_last_updated_at: datetime.datetime | None = None

    if public_key_path:
        key_path = Path(public_key_path).expanduser()
        try:
            if public_key_pem is None:
                public_key_pem = key_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            logger.warning("Clé publique LTI introuvable : %s", key_path)
        except OSError as exc:  # pragma: no cover - accès fichier improbable
            logger.warning(
                "Lecture de la clé publique LTI impossible (%s) : %s",
                key_path,
                exc,
            )
        else:
            try:
                stat_result = key_path.stat()
            except OSError as exc:  # pragma: no cover - accès fichier improbable
                logger.debug(
                    (
                        "Impossible de récupérer la date de modification de la clé "
                        "publique LTI (%s): %s"
                    ),
                    key_path,
                    exc,
                )
            else:
                public_key_last_updated_at = datetime.datetime.fromtimestamp(
                    stat_result.st_mtime,
                    datetime.UTC,
                )

    return {
        "client_id": resolved_client_id,
        "key_set_url": resolved_key_set_url,
        "audience": resolved_audience,
        "key_id": resolved_key_id,
        "has_private_key": bool(resolved_private_key),
        "private_key_hint": private_key_hint,
        "is_client_id_overridden": bool(stored_client_id),
        "is_key_set_url_overridden": bool(stored_key_set_url),
        "is_audience_overridden": bool(stored_audience),
        "is_key_id_overridden": bool(stored_key_id),
        "is_private_key_overridden": bool(stored_private_key),
        "created_at": settings.created_at if settings else None,
        "updated_at": settings.updated_at if settings else None,
        "private_key_path": private_key_path,
        "public_key_path": public_key_path,
        "public_key_pem": public_key_pem,
        "public_key_last_updated_at": public_key_last_updated_at,
    }


def _ensure_managed_lti_key_files(
    settings: Any,
) -> tuple[str | None, str | None, str | None]:
    private_path_str = getattr(settings, "lti_tool_private_key_path", None)
    public_path_str = getattr(settings, "lti_tool_public_key_path", None)

    if not private_path_str or not public_path_str:
        return private_path_str, public_path_str, None

    private_path = Path(private_path_str).expanduser()
    public_path = Path(public_path_str).expanduser()

    try:
        private_path.parent.mkdir(parents=True, exist_ok=True)
        public_path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:  # pragma: no cover - accès disque improbable
        logger.warning(
            "Impossible de préparer le dossier des clés LTI (%s, %s) : %s",
            private_path,
            public_path,
            exc,
        )
        return str(private_path), str(public_path), None

    private_key = getattr(settings, "lti_tool_private_key", None)

    private_pem, public_pem = ensure_lti_key_material(
        private_path,
        public_path,
        private_key,
    )

    if private_pem is None:
        return str(private_path), str(public_path), None

    return str(private_path), str(public_path), public_pem


def update_lti_tool_settings(
    session: Session,
    *,
    client_id: str | None | object = _UNSET,
    key_set_url: str | None | object = _UNSET,
    audience: str | None | object = _UNSET,
    key_id: str | None | object = _UNSET,
    private_key: str | None | object = _UNSET,
) -> AppSettings:
    default_prompt = _default_thread_title_prompt()
    default_model = _default_thread_title_model()
    settings = get_thread_title_prompt_override(session)
    if settings is None:
        settings = AppSettings(
            thread_title_prompt=default_prompt,
            thread_title_model=default_model,
        )

    changed = False

    if client_id is not _UNSET:
        if client_id is not None and not isinstance(client_id, str):
            raise ValueError("L'identifiant client doit être une chaîne.")
        settings.lti_tool_client_id = _normalize_optional_string(client_id)
        changed = True

    if key_set_url is not _UNSET:
        if key_set_url is not None and not isinstance(key_set_url, str):
            raise ValueError("L'URL du JWKS doit être une chaîne.")
        candidate = _normalize_optional_string(key_set_url)
        if candidate:
            parsed = urlparse(candidate)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError(
                    "L'URL du JWKS doit commencer par http(s):// et contenir un hôte."
                )
        settings.lti_tool_key_set_url = candidate
        changed = True

    if audience is not _UNSET:
        if audience is not None and not isinstance(audience, str):
            raise ValueError("L'audience doit être une chaîne.")
        settings.lti_tool_audience = _normalize_optional_string(audience)
        changed = True

    if key_id is not _UNSET:
        if key_id is not None and not isinstance(key_id, str):
            raise ValueError("Le kid doit être une chaîne.")
        settings.lti_tool_key_id = _normalize_optional_string(key_id)
        changed = True

    if private_key is not _UNSET:
        if private_key is None:
            settings.lti_tool_private_key_encrypted = None
        elif not isinstance(private_key, str):
            raise ValueError("La clé privée doit être une chaîne.")
        else:
            stripped = private_key.strip()
            if stripped:
                ensure_secret_key_available()
                settings.lti_tool_private_key_encrypted = _encrypt_secret(stripped)
            else:
                settings.lti_tool_private_key_encrypted = None
        changed = True

    if changed:
        settings.updated_at = _now()
        session.add(settings)
        session.commit()
        session.refresh(settings)

    return settings


def serialize_appearance_settings(
    settings: AppSettings | None,
    workflow_override: WorkflowAppearance | None = None,
) -> dict[str, Any]:
    resolved = _resolve_appearance_settings(settings, workflow_override)
    created_at = None
    updated_at = None
    if workflow_override is not None:
        created_at = workflow_override.created_at
        updated_at = workflow_override.updated_at
    elif settings is not None:
        created_at = settings.created_at
        updated_at = settings.updated_at
    resolved["created_at"] = created_at
    resolved["updated_at"] = updated_at
    return resolved
