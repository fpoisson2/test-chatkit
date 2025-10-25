from __future__ import annotations

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

from backend.app.models import AppSettings  # noqa: E402
from backend.app.telephony.registration import (  # noqa: E402
    _DEFAULT_SIP_PORT,
    SIPRegistrationConfig,
    SIPRegistrationManager,
)


def test_apply_config_from_settings_infers_contact_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    applied: list[SIPRegistrationConfig | None] = []
    loop = asyncio.new_event_loop()
    try:
        manager = SIPRegistrationManager(
            loop=loop,
            settings=SimpleNamespace(
                sip_bind_host=None,
                sip_bind_port=None,
                sip_username=None,
                sip_password=None,
            ),
        )

        def fake_apply_config(config: SIPRegistrationConfig | None) -> None:
            applied.append(config)

        monkeypatch.setattr(manager, "apply_config", fake_apply_config)
        monkeypatch.setattr(manager, "_infer_contact_host", lambda uri: "192.0.2.10")

        stored = AppSettings(thread_title_prompt="Prompt")
        stored.sip_trunk_uri = "sip:alice@example.com"
        stored.sip_trunk_username = "alice"
        stored.sip_trunk_password = "secret"

        session = MagicMock()
        loop.run_until_complete(manager.apply_config_from_settings(session, stored))
    finally:
        loop.close()

    assert applied, "apply_config should be invoked"
    config = applied[0]
    assert isinstance(config, SIPRegistrationConfig)
    assert config.contact_host == "192.0.2.10"
    assert config.contact_port == _DEFAULT_SIP_PORT
    assert config.transport is None


def test_apply_config_from_settings_disables_without_contact(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    applied: list[SIPRegistrationConfig | None] = []
    loop = asyncio.new_event_loop()
    try:
        manager = SIPRegistrationManager(
            loop=loop,
            settings=SimpleNamespace(
                sip_bind_host=None,
                sip_bind_port=None,
                sip_username=None,
                sip_password=None,
            ),
        )

        def fake_apply_config(config: SIPRegistrationConfig | None) -> None:
            applied.append(config)

        monkeypatch.setattr(manager, "apply_config", fake_apply_config)
        monkeypatch.setattr(manager, "_infer_contact_host", lambda uri: None)

        stored = AppSettings(thread_title_prompt="Prompt")
        stored.sip_trunk_uri = "sip:alice@example.com"
        stored.sip_trunk_username = "alice"
        stored.sip_trunk_password = "secret"

        session = MagicMock()
        loop.run_until_complete(manager.apply_config_from_settings(session, stored))
    finally:
        loop.close()

    assert applied == [None]


def test_apply_config_from_settings_uses_stored_contact_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    applied: list[SIPRegistrationConfig | None] = []
    loop = asyncio.new_event_loop()
    try:
        manager = SIPRegistrationManager(
            loop=loop,
            settings=SimpleNamespace(
                sip_bind_host=None,
                sip_bind_port=None,
                sip_username=None,
                sip_password=None,
                sip_contact_transport=None,
            ),
        )

        def fake_apply_config(config: SIPRegistrationConfig | None) -> None:
            applied.append(config)

        monkeypatch.setattr(manager, "apply_config", fake_apply_config)

        stored = AppSettings(thread_title_prompt="Prompt")
        stored.sip_trunk_uri = "sip:alice@example.com"
        stored.sip_trunk_username = "alice"
        stored.sip_trunk_password = "secret"
        stored.sip_contact_host = "198.51.100.5"
        stored.sip_contact_port = 5070
        stored.sip_contact_transport = "udp"

        session = MagicMock()
        loop.run_until_complete(manager.apply_config_from_settings(session, stored))
    finally:
        loop.close()

    assert applied, "apply_config should be invoked"
    config = applied[0]
    assert isinstance(config, SIPRegistrationConfig)
    assert config.contact_host == "198.51.100.5"
    assert config.contact_port == 5070
    assert config.transport == "udp"


def test_apply_config_from_settings_accepts_host_only_trunk_uri(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    applied: list[SIPRegistrationConfig | None] = []
    loop = asyncio.new_event_loop()
    try:
        manager = SIPRegistrationManager(
            loop=loop,
            settings=SimpleNamespace(
                sip_bind_host=None,
                sip_bind_port=None,
                sip_username=None,
                sip_password=None,
            ),
        )

        def fake_apply_config(config: SIPRegistrationConfig | None) -> None:
            applied.append(config)

        monkeypatch.setattr(manager, "apply_config", fake_apply_config)

        stored = AppSettings(thread_title_prompt="Prompt")
        stored.sip_trunk_uri = "montreal5.voip.ms"
        stored.sip_trunk_username = "alice"
        stored.sip_trunk_password = "secret"
        stored.sip_contact_host = "198.51.100.5"
        stored.sip_contact_port = 5070

        session = MagicMock()
        loop.run_until_complete(manager.apply_config_from_settings(session, stored))
    finally:
        loop.close()

    assert applied, "apply_config should be invoked"
    config = applied[0]
    assert isinstance(config, SIPRegistrationConfig)
    assert config.uri == "sip:alice@montreal5.voip.ms"
    assert config.contact_host == "198.51.100.5"
    assert config.contact_port == 5070


def test_normalize_trunk_uri_enforces_scheme_and_username() -> None:
    normalized = SIPRegistrationManager._normalize_trunk_uri(
        "example.com:5070;transport=udp",
        "alice",
    )
    assert normalized == "sip:alice@example.com:5070;transport=udp"


@pytest.mark.parametrize(
    "raw_uri, expected_host, expected_port",
    [
        ("sip:alice@example.com", "example.com", _DEFAULT_SIP_PORT),
        ("example.com", "example.com", _DEFAULT_SIP_PORT),
        ("sip:example.com:5070;transport=udp", "example.com", 5070),
        ("<sip:bob@[2001:db8::1]:5080>", "2001:db8::1", 5080),
    ],
)
def test_parse_registrar_endpoint_handles_various_inputs(
    raw_uri: str, expected_host: str, expected_port: int
) -> None:
    host, port = SIPRegistrationManager._parse_registrar_endpoint(raw_uri)
    assert host == expected_host
    assert port == expected_port
