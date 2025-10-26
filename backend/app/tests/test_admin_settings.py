from __future__ import annotations

import json
import os
import sys
import types
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///./test-admin-settings.db")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")

from backend.app import admin_settings  # noqa: E402
from backend.app.config import ModelProviderConfig  # noqa: E402
from backend.app.models import AppSettings, Base  # noqa: E402


@pytest.fixture
def session_factory(monkeypatch: pytest.MonkeyPatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionFactory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(admin_settings, "SessionLocal", SessionFactory)

    yield SessionFactory

    engine.dispose()


@pytest.fixture
def default_prompt(monkeypatch: pytest.MonkeyPatch) -> str:
    defaults = types.SimpleNamespace(
        thread_title_prompt="Prompt par défaut",
        model_provider="openai",
        model_api_base="https://api.openai.com",
        is_model_api_key_managed=False,
        model_api_key_hint=None,
        model_providers=(
            ModelProviderConfig(
                provider="openai",
                api_base="https://api.openai.com",
                api_key="sk-test",
                is_default=True,
            ),
        ),
    )
    monkeypatch.setattr(admin_settings, "get_settings", lambda: defaults)
    return defaults.thread_title_prompt


def test_resolve_thread_title_prompt_uses_default(
    session_factory: sessionmaker[Session], default_prompt: str
) -> None:
    with session_factory() as session:
        prompt = admin_settings.resolve_thread_title_prompt(session=session)
    assert prompt == default_prompt


def test_update_admin_settings_creates_override(
    session_factory: sessionmaker[Session], default_prompt: str
) -> None:
    with session_factory() as session:
        result = admin_settings.update_admin_settings(
            session, thread_title_prompt=" Nouveau prompt personnalisé "
        )
        assert result.prompt_changed is True
        assert result.sip_changed is False
        stored = result.settings
        assert stored is not None
        assert stored.thread_title_prompt == "Nouveau prompt personnalisé"

    with session_factory() as session:
        prompt = admin_settings.resolve_thread_title_prompt(session=session)
    assert prompt == "Nouveau prompt personnalisé"


def test_update_admin_settings_reset_to_default(
    session_factory: sessionmaker[Session], default_prompt: str
) -> None:
    with session_factory() as session:
        admin_settings.update_admin_settings(session, thread_title_prompt="Custom")

    with session_factory() as session:
        admin_settings.update_admin_settings(session, thread_title_prompt=None)

    with session_factory() as session:
        override = session.scalar(select(AppSettings).limit(1))
        assert override is None
        prompt = admin_settings.resolve_thread_title_prompt(session=session)

    assert prompt == default_prompt


def test_serialize_admin_settings_marks_custom_value(
    session_factory: sessionmaker[Session], default_prompt: str
) -> None:
    with session_factory() as session:
        result = admin_settings.update_admin_settings(
            session, thread_title_prompt="Prompt ajusté"
        )
        override = result.settings

    payload = admin_settings.serialize_admin_settings(override)
    assert payload["thread_title_prompt"] == "Prompt ajusté"
    assert payload["is_custom_thread_title_prompt"] is True
    assert payload["model_provider"] == "openai"
    assert payload["model_api_base"] == "https://api.openai.com"
    assert payload["is_model_provider_overridden"] is False
    assert payload["is_model_api_base_overridden"] is False
    assert payload["is_model_api_key_managed"] is False
    assert payload["model_api_key_hint"] is None
    assert payload["model_providers"] == []
    assert payload["sip_trunk_uri"] is None
    assert payload["sip_trunk_username"] is None
    assert payload["sip_trunk_password"] is None
    assert payload["sip_contact_host"] is None
    assert payload["sip_contact_port"] is None
    assert payload["sip_contact_transport"] is None

    with session_factory() as session:
        admin_settings.update_admin_settings(session, thread_title_prompt="  ")

    payload = admin_settings.serialize_admin_settings(
        None, default_prompt=default_prompt
    )
    assert payload["thread_title_prompt"] == default_prompt
    assert payload["is_custom_thread_title_prompt"] is False
    assert payload["model_provider"] == "openai"
    assert payload["model_api_base"] == "https://api.openai.com"
    assert payload["is_model_provider_overridden"] is False
    assert payload["is_model_api_base_overridden"] is False
    assert payload["is_model_api_key_managed"] is False
    assert payload["model_api_key_hint"] is None
    assert payload["model_providers"] == []
    assert payload["sip_trunk_uri"] is None
    assert payload["sip_trunk_username"] is None
    assert payload["sip_trunk_password"] is None
    assert payload["sip_contact_host"] is None
    assert payload["sip_contact_port"] is None
    assert payload["sip_contact_transport"] is None


def test_update_admin_settings_handles_sip_trunk(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        result = admin_settings.update_admin_settings(
            session,
            sip_trunk_uri=" sip:example.org ",
            sip_trunk_username="  user ",
            sip_trunk_password="  secret ",
        )

    assert result.sip_changed is True
    stored = result.settings
    assert stored is not None
    assert stored.sip_trunk_uri == "sip:example.org"
    assert stored.sip_trunk_username == "user"
    assert stored.sip_trunk_password == "secret"

    with session_factory() as session:
        override = admin_settings.get_thread_title_prompt_override(session)
        assert override is not None
        assert override.sip_trunk_uri == "sip:example.org"

    with session_factory() as session:
        result = admin_settings.update_admin_settings(
            session,
            sip_trunk_uri=None,
            sip_trunk_username=None,
            sip_trunk_password=None,
        )
        assert result.sip_changed is True

    with session_factory() as session:
        override = admin_settings.get_thread_title_prompt_override(session)
        assert override is None


def test_update_admin_settings_handles_contact_endpoint(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        result = admin_settings.update_admin_settings(
            session,
            sip_contact_host=" 198.51.100.10 ",
            sip_contact_port=" 5070 ",
            sip_contact_transport=" UDP ",
        )

    assert result.sip_changed is True
    stored = result.settings
    assert stored is not None
    assert stored.sip_contact_host == "198.51.100.10"
    assert stored.sip_contact_port == 5070
    assert stored.sip_contact_transport == "udp"

    with session_factory() as session:
        override = admin_settings.get_thread_title_prompt_override(session)
        assert override is not None
        assert override.sip_contact_host == "198.51.100.10"
        assert override.sip_contact_port == 5070
        assert override.sip_contact_transport == "udp"

    with session_factory() as session:
        result = admin_settings.update_admin_settings(
            session,
            sip_contact_host=None,
            sip_contact_port=None,
            sip_contact_transport=None,
        )
        assert result.sip_changed is True

    with session_factory() as session:
        override = admin_settings.get_thread_title_prompt_override(session)
        assert override is None


def test_update_admin_settings_handles_model_provider(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        result = admin_settings.update_admin_settings(
            session,
            model_provider="litellm",
            model_api_base="http://localhost:4000/",
            model_api_key=" proxy-secret ",
        )

    assert result.model_settings_changed is True
    assert result.provider_changed is True
    stored = result.settings
    assert stored is not None
    assert stored.model_provider == "litellm"
    assert stored.model_api_base == "http://localhost:4000"
    assert stored.model_api_key_encrypted is not None
    assert stored.model_api_key_encrypted != "proxy-secret"
    assert stored.model_api_key_hint is not None
    assert stored.model_api_key_hint.endswith("cret")

    decrypted = admin_settings._decrypt_secret(stored.model_api_key_encrypted)
    assert decrypted == "proxy-secret"

    overrides = admin_settings._compute_model_overrides(stored)
    assert overrides["model_provider"] == "litellm"
    assert overrides["model_api_base"] == "http://localhost:4000"
    assert overrides["model_api_key"] == "proxy-secret"
    provider_configs = overrides["model_providers"]
    assert len(provider_configs) == 1
    assert provider_configs[0].provider == "litellm"
    assert provider_configs[0].api_base == "http://localhost:4000"
    assert provider_configs[0].api_key == "proxy-secret"


def test_update_admin_settings_clears_model_overrides(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        admin_settings.update_admin_settings(
            session,
            model_provider="litellm",
            model_api_base="http://localhost:4000",
            model_api_key="secret",
        )

    with session_factory() as session:
        result = admin_settings.update_admin_settings(
            session,
            model_provider=None,
            model_api_base=None,
            model_api_key=None,
        )

    assert result.model_settings_changed is True
    assert result.provider_changed is True
    assert result.settings is None


def test_update_admin_settings_manages_multiple_model_providers(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        result = admin_settings.update_admin_settings(
            session,
            model_providers=[
                {
                    "provider": "litellm",
                    "api_base": "http://localhost:4000",
                    "api_key": "proxy-secret",
                    "is_default": True,
                },
                {
                    "provider": "gemini",
                    "api_base": "https://generativelanguage.googleapis.com",
                    "api_key": "gemini-secret",
                    "is_default": False,
                },
            ],
        )

    assert result.model_settings_changed is True
    assert result.provider_changed is True
    stored = result.settings
    assert stored is not None
    assert stored.model_provider == "litellm"
    assert stored.model_api_base == "http://localhost:4000"
    assert stored.model_provider_configs is not None
    saved_payload = json.loads(stored.model_provider_configs)
    assert len(saved_payload) == 2
    default_entry = next(entry for entry in saved_payload if entry["is_default"])
    assert default_entry["provider"] == "litellm"
    other_entry = next(entry for entry in saved_payload if not entry["is_default"])
    assert other_entry["provider"] == "gemini"

    overrides = admin_settings._compute_model_overrides(stored)
    assert overrides["model_provider"] == "litellm"
    configs = overrides["model_providers"]
    assert len(configs) == 2
    assert any(cfg.provider == "gemini" and cfg.api_key == "gemini-secret" for cfg in configs)
    assert any(cfg.provider == "litellm" and cfg.api_key == "proxy-secret" for cfg in configs)

    serialized = admin_settings.serialize_admin_settings(stored)
    assert len(serialized["model_providers"]) == 2
    first_id = serialized["model_providers"][0]["id"]
    second_id = serialized["model_providers"][1]["id"]

    with session_factory() as session:
        result = admin_settings.update_admin_settings(
            session,
            model_providers=[
                {
                    "id": first_id,
                    "provider": "litellm",
                    "api_base": "http://localhost:4001",
                    "delete_api_key": True,
                    "is_default": False,
                },
                {
                    "id": second_id,
                    "provider": "gemini",
                    "api_base": "https://generativelanguage.googleapis.com",
                    "is_default": True,
                },
            ],
        )

    assert result.model_settings_changed is True
    assert result.provider_changed is True
    updated = result.settings
    assert updated is not None
    assert updated.model_provider == "gemini"
    assert updated.model_api_base == "https://generativelanguage.googleapis.com"
    assert updated.model_api_key_encrypted is not None
    assert (
        admin_settings._decrypt_secret(updated.model_api_key_encrypted)
        == "gemini-secret"
    )
    assert updated.model_api_key_hint is not None
    assert updated.model_api_key_hint.endswith("cret")
    assert updated.model_provider_configs is not None
    payload = json.loads(updated.model_provider_configs)
    assert len(payload) == 2
    gemini_entry = next(entry for entry in payload if entry["provider"] == "gemini")
    assert gemini_entry["is_default"] is True
    assert gemini_entry["api_key_encrypted"] is not None
    litellm_entry = next(entry for entry in payload if entry["provider"] == "litellm")
    assert litellm_entry["api_key_encrypted"] is None

    overrides = admin_settings._compute_model_overrides(updated)
    assert overrides["model_provider"] == "gemini"
    configs = overrides["model_providers"]
    assert any(cfg.provider == "gemini" and cfg.is_default for cfg in configs)
    assert any(cfg.provider == "litellm" and cfg.api_key is None for cfg in configs)

    serialized = admin_settings.serialize_admin_settings(updated)
    assert any(entry["is_default"] for entry in serialized["model_providers"])
    assert any(
        entry["provider"] == "litellm" and entry["has_api_key"] is False
        for entry in serialized["model_providers"]
    )
