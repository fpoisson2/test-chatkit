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

os.environ.setdefault("DATABASE_URL", "sqlite:///./test-telephony-trunk.db")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")

from backend.app import telephony_trunk_settings  # noqa: E402
from backend.app.models import Base, TelephonyTrunkSettings  # noqa: E402


@pytest.fixture
def session_factory(monkeypatch: pytest.MonkeyPatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionFactory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(
        telephony_trunk_settings,
        "SessionLocal",
        SessionFactory,
        raising=False,
    )

    yield SessionFactory

    engine.dispose()


@pytest.fixture
def default_trunk(monkeypatch: pytest.MonkeyPatch) -> types.SimpleNamespace:
    defaults = types.SimpleNamespace(
        sip_bind_host="0.0.0.0",
        sip_bind_port=5060,
        sip_username="voip",
        sip_password="secret",
    )
    monkeypatch.setattr(telephony_trunk_settings, "get_settings", lambda: defaults)
    return defaults


def test_get_or_create_trunk_settings_uses_defaults(
    session_factory: sessionmaker[Session], default_trunk: types.SimpleNamespace
) -> None:
    with session_factory() as session:
        settings = telephony_trunk_settings.get_or_create_trunk_settings(session)

    assert settings.sip_bind_host == default_trunk.sip_bind_host
    assert settings.sip_bind_port == default_trunk.sip_bind_port
    assert settings.sip_username == default_trunk.sip_username
    assert settings.sip_password == default_trunk.sip_password


def test_update_trunk_settings_persists_changes(
    session_factory: sessionmaker[Session], default_trunk: types.SimpleNamespace
) -> None:
    with session_factory() as session:
        telephony_trunk_settings.get_or_create_trunk_settings(session)

    with session_factory() as session:
        updated = telephony_trunk_settings.update_trunk_settings(
            session,
            sip_bind_host=" 192.168.1.10 ",
            sip_bind_port=5070,
            sip_username=" trunk ",
            sip_password="  top-secret  ",
        )

    assert updated.sip_bind_host == "192.168.1.10"
    assert updated.sip_bind_port == 5070
    assert updated.sip_username == "trunk"
    assert updated.sip_password == "top-secret"

    with session_factory() as session:
        stored = session.scalar(select(TelephonyTrunkSettings).limit(1))

    assert stored is not None
    assert stored.sip_bind_host == "192.168.1.10"
    assert stored.sip_bind_port == 5070
    assert stored.sip_username == "trunk"
    assert stored.sip_password == "top-secret"


def test_update_trunk_settings_clears_with_none(
    session_factory: sessionmaker[Session], default_trunk: types.SimpleNamespace
) -> None:
    with session_factory() as session:
        telephony_trunk_settings.get_or_create_trunk_settings(session)

    with session_factory() as session:
        updated = telephony_trunk_settings.update_trunk_settings(
            session,
            sip_bind_host=None,
            sip_bind_port=None,
            sip_username="   ",
            sip_password=None,
        )

    assert updated.sip_bind_host is None
    assert updated.sip_bind_port is None
    assert updated.sip_username is None
    assert updated.sip_password is None
