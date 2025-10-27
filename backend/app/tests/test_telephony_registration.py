# ruff: noqa: I001

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

from backend.app.telephony.registration import (  # noqa: E402
    SIPRegistrationConfig,
    SIPRegistrationManager,
    _DEFAULT_SIP_PORT,
)


class FakeTransportInfo:
    def __init__(self, port: int) -> None:
        self.id = 1
        self.local_port = port


class FakeTransport:
    def __init__(self, port: int) -> None:
        self.id = 1
        self._info = FakeTransportInfo(port)
        self.closed = False

    def info(self) -> FakeTransportInfo:
        return self._info

    def close(self) -> None:
        self.closed = True


class FakeAccountInfo:
    def __init__(self, status: int = 200) -> None:
        self.reg_status = status


class FakeAccount:
    def __init__(self) -> None:
        self.deleted = False
        self.registration_set = False

    def info(self) -> FakeAccountInfo:
        return FakeAccountInfo()

    def set_registration(self, state: bool) -> None:
        self.registration_set = not state

    def delete(self) -> None:
        self.deleted = True


class FakeLib:
    def __init__(self) -> None:
        self.transports: list[FakeTransport] = []
        self.accounts: list[FakeAccount] = []
        self.started = False

    def init(self, **_: object) -> None:
        pass

    def start(self) -> None:
        self.started = True

    def handle_events(self, timeout: float) -> None:  # pragma: no cover
        pass

    def create_transport(self, _type: object, cfg: object) -> FakeTransport:
        port = getattr(cfg, "port", 0) or 4000
        transport = FakeTransport(port)
        self.transports.append(transport)
        return transport

    def create_account(self, cfg: object, cb=None) -> FakeAccount:
        account = FakeAccount()
        self.accounts.append(account)
        return account

    def destroy(self) -> None:
        pass


class FakePJSUA:
    class Lib(FakeLib):
        pass

    class SipHeader:
        def __init__(self, name: str, value: str) -> None:
            self.name = name
            self.value = value

    class TransportType:
        UDP = object()

    class TransportConfig:
        def __init__(self) -> None:
            self.port = 0
            self.bound_addr = None

    class LogConfig:
        def __init__(self, **_: object) -> None:
            pass

    class AccountConfig:
        def __init__(self) -> None:
            self.id = ""
            self.reg_uri = ""
            self.contact = ""
            self.transport_id = None
            self.reg_timeout = 0
            self.auth_cred = []

    class AuthCred:
        def __init__(self, *, realm: str, username: str, data: str) -> None:
            self.realm = realm
            self.username = username
            self.data = data


@pytest.fixture(autouse=True)
def fake_pjsua(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakePJSUA()
    monkeypatch.setattr("backend.app.telephony.registration._PJSUA", fake)
    monkeypatch.setattr("backend.app.telephony.registration._PJSUA_IMPORT_ERROR", None)
    monkeypatch.setattr(
        "backend.app.telephony.registration._require_pjsua",
        lambda: fake,
    )
    monkeypatch.setattr("backend.app.telephony.registration._lib_instance", None)
    monkeypatch.setattr("backend.app.telephony.registration._lib_users", 0)
    monkeypatch.setattr("backend.app.telephony.registration._event_thread", None)
    import threading

    monkeypatch.setattr(
        "backend.app.telephony.registration._event_stop",
        threading.Event(),
    )


def test_apply_config_from_settings_builds_config(monkeypatch) -> None:
    loop = asyncio.new_event_loop()
    manager = SIPRegistrationManager(
        loop=loop,
        settings=SimpleNamespace(
            sip_trunk_uri=None,
            sip_username=None,
            sip_password=None,
            sip_contact_host=None,
            sip_contact_port=None,
        ),
        contact_host="198.51.100.4",
        contact_port=None,
    )

    applied: list[SIPRegistrationConfig | None] = []
    monkeypatch.setattr(manager, "apply_config", applied.append)

    stored = SimpleNamespace(
        sip_trunk_uri="sip:alice@example.org",
        sip_trunk_username="alice",
        sip_trunk_password="secret",
        sip_contact_port=None,
        sip_contact_transport=None,
    )

    loop.run_until_complete(manager.apply_config_from_settings(MagicMock(), stored))
    loop.close()

    assert applied
    config = applied[-1]
    assert isinstance(config, SIPRegistrationConfig)
    assert config.contact_host == "198.51.100.4"
    assert config.contact_port == _DEFAULT_SIP_PORT
    assert config.transport is None


def test_start_creates_account(monkeypatch) -> None:
    loop = asyncio.new_event_loop()
    manager = SIPRegistrationManager(loop=loop)
    config = SIPRegistrationConfig(
        uri="sip:alice@example.org",
        username="alice",
        password="secret",
        contact_host="203.0.113.1",
        contact_port=5062,
    )
    manager.apply_config(config)

    loop.run_until_complete(manager.start())
    loop.run_until_complete(asyncio.sleep(0))
    loop.run_until_complete(manager.stop())
    loop.close()

    assert manager._account is None


def test_normalize_trunk_uri() -> None:
    normalized = SIPRegistrationManager._normalize_trunk_uri("sip:example.org", "alice")
    assert normalized == "sip:alice@example.org"
