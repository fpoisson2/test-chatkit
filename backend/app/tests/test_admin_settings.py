from __future__ import annotations

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
    defaults = types.SimpleNamespace(thread_title_prompt="Prompt par défaut")
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
        stored = admin_settings.update_admin_settings(
            session, thread_title_prompt=" Nouveau prompt personnalisé "
        )
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
        override = admin_settings.update_admin_settings(
            session, thread_title_prompt="Prompt ajusté"
        )

    payload = admin_settings.serialize_admin_settings(override)
    assert payload["thread_title_prompt"] == "Prompt ajusté"
    assert payload["is_custom_thread_title_prompt"] is True
    assert payload["sip_trunk_uri"] is None
    assert payload["sip_trunk_username"] is None
    assert payload["sip_trunk_password"] is None

    with session_factory() as session:
        admin_settings.update_admin_settings(session, thread_title_prompt="  ")

    payload = admin_settings.serialize_admin_settings(
        None, default_prompt=default_prompt
    )
    assert payload["thread_title_prompt"] == default_prompt
    assert payload["is_custom_thread_title_prompt"] is False
    assert payload["sip_trunk_uri"] is None
    assert payload["sip_trunk_username"] is None
    assert payload["sip_trunk_password"] is None


def test_update_admin_settings_handles_sip_trunk(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        stored = admin_settings.update_admin_settings(
            session,
            sip_trunk_uri=" sip:example.org ",
            sip_trunk_username="  user ",
            sip_trunk_password="  secret ",
        )

    assert stored is not None
    assert stored.sip_trunk_uri == "sip:example.org"
    assert stored.sip_trunk_username == "user"
    assert stored.sip_trunk_password == "secret"

    with session_factory() as session:
        override = admin_settings.get_thread_title_prompt_override(session)
        assert override is not None
        assert override.sip_trunk_uri == "sip:example.org"

    with session_factory() as session:
        admin_settings.update_admin_settings(
            session,
            sip_trunk_uri=None,
            sip_trunk_username=None,
            sip_trunk_password=None,
        )

    with session_factory() as session:
        override = admin_settings.get_thread_title_prompt_override(session)
        assert override is None
