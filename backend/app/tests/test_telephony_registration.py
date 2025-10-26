from __future__ import annotations

import asyncio
import errno
import logging
import os
import socket
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

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
    _OPTIONS_ALLOW_HEADER,
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
    assert config.bind_host == "192.0.2.10"


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
    assert config.bind_host == "198.51.100.5"


def test_apply_config_from_settings_uses_runtime_contact_settings(
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
                sip_contact_host="203.0.113.10",
                sip_contact_port=5082,
                sip_contact_transport="TCP",
            ),
        )

        def fake_apply_config(config: SIPRegistrationConfig | None) -> None:
            applied.append(config)

        monkeypatch.setattr(manager, "apply_config", fake_apply_config)

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
    assert config.contact_host == "203.0.113.10"
    assert config.contact_port == 5082
    assert config.transport == "tcp"


def test_apply_config_from_settings_uses_runtime_trunk_uri(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    applied: list[SIPRegistrationConfig | None] = []
    loop = asyncio.new_event_loop()
    try:
        manager = SIPRegistrationManager(
            loop=loop,
            settings=SimpleNamespace(
                sip_bind_host="0.0.0.0",
                sip_bind_port=5060,
                sip_username="102",
                sip_password="secret",
                sip_trunk_uri="sip:102@192.168.1.155",
                sip_contact_host="192.168.1.116",
                sip_contact_port=5060,
                sip_contact_transport="udp",
            ),
            contact_host="192.168.1.116",
            contact_port=5060,
            contact_transport="udp",
            bind_host="0.0.0.0",
        )

        def fake_apply_config(config: SIPRegistrationConfig | None) -> None:
            applied.append(config)

        monkeypatch.setattr(manager, "apply_config", fake_apply_config)

        session = MagicMock()
        session.scalar.return_value = None

        loop.run_until_complete(manager.apply_config_from_settings(session, None))
    finally:
        loop.close()

    assert applied, "apply_config should be invoked"
    config = applied[0]
    assert isinstance(config, SIPRegistrationConfig)
    assert config.uri == "sip:102@192.168.1.155"
    assert config.username == "102"
    assert config.password == "secret"
    assert config.contact_host == "192.168.1.116"
    assert config.contact_port == 5060
    assert config.transport == "udp"


def test_apply_config_from_settings_builds_trunk_from_registrar(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    applied: list[SIPRegistrationConfig | None] = []
    loop = asyncio.new_event_loop()
    try:
        manager = SIPRegistrationManager(
            loop=loop,
            settings=SimpleNamespace(
                sip_bind_host="0.0.0.0",
                sip_bind_port=5060,
                sip_username="102",
                sip_password="secret",
                sip_registrar="192.168.1.155",
                sip_trunk_uri=None,
                sip_contact_host="192.168.1.116",
                sip_contact_port=5060,
                sip_contact_transport="udp",
            ),
            contact_host="192.168.1.116",
            contact_port=5060,
            contact_transport="udp",
            bind_host="0.0.0.0",
        )

        def fake_apply_config(config: SIPRegistrationConfig | None) -> None:
            applied.append(config)

        monkeypatch.setattr(manager, "apply_config", fake_apply_config)

        session = MagicMock()
        session.scalar.return_value = None

        loop.run_until_complete(manager.apply_config_from_settings(session, None))
    finally:
        loop.close()

    assert applied, "apply_config should be invoked"
    config = applied[0]
    assert isinstance(config, SIPRegistrationConfig)
    assert config.uri == "sip:102@192.168.1.155"
    assert config.username == "102"
    assert config.password == "secret"
    assert config.contact_host == "192.168.1.116"
    assert config.contact_port == 5060
    assert config.transport == "udp"


def test_apply_config_from_settings_autodetects_port_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    applied: list[SIPRegistrationConfig | None] = []
    loop = asyncio.new_event_loop()
    try:
        manager = SIPRegistrationManager(loop=loop)

        def fake_apply_config(config: SIPRegistrationConfig | None) -> None:
            applied.append(config)

        monkeypatch.setattr(manager, "apply_config", fake_apply_config)
        monkeypatch.setattr(
            manager,
            "_find_available_contact_port",
            MagicMock(return_value=5074),
        )

        stored = AppSettings(thread_title_prompt="Prompt")
        stored.sip_trunk_uri = "sip:alice@example.com"
        stored.sip_trunk_username = "alice"
        stored.sip_trunk_password = "secret"
        stored.sip_contact_host = "198.51.100.5"
        stored.sip_contact_port = 0

        session = MagicMock()
        loop.run_until_complete(manager.apply_config_from_settings(session, stored))
    finally:
        loop.close()

    assert applied, "apply_config should be invoked"
    config = applied[0]
    assert isinstance(config, SIPRegistrationConfig)
    assert config.contact_host == "198.51.100.5"
    assert config.contact_port == 5074


def test_apply_config_from_settings_disables_when_port_autodetect_fails(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    applied: list[SIPRegistrationConfig | None] = []
    loop = asyncio.new_event_loop()
    try:
        manager = SIPRegistrationManager(loop=loop)

        def fake_apply_config(config: SIPRegistrationConfig | None) -> None:
            applied.append(config)

        monkeypatch.setattr(manager, "apply_config", fake_apply_config)
        monkeypatch.setattr(
            manager,
            "_find_available_contact_port",
            MagicMock(return_value=None),
        )

        stored = AppSettings(thread_title_prompt="Prompt")
        stored.sip_trunk_uri = "sip:alice@example.com"
        stored.sip_trunk_username = "alice"
        stored.sip_trunk_password = "secret"
        stored.sip_contact_host = "198.51.100.5"
        stored.sip_contact_port = 0

        session = MagicMock()
        caplog.set_level(logging.WARNING)
        loop.run_until_complete(manager.apply_config_from_settings(session, stored))
    finally:
        loop.close()

    assert applied == [None]
    assert "détection automatique du port SIP impossible" in caplog.text


def test_find_available_contact_port_falls_back_on_unassigned_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import backend.app.telephony.registration as registration_module

    contact_host = "198.51.100.5"
    fake_addrinfo = [
        (socket.AF_INET, socket.SOCK_DGRAM, 0, "", (contact_host, 0)),
    ]

    monkeypatch.setattr(
        registration_module.socket,
        "getaddrinfo",
        MagicMock(return_value=fake_addrinfo),
    )

    bound_sockaddrs: list[tuple[object, ...]] = []

    class DummySocket:
        def __init__(self, family: int, socktype: int, proto: int) -> None:
            self.family = family
            self.socktype = socktype
            self.proto = proto
            self._bound: tuple[str, int] = ("0.0.0.0", 0)

        def bind(self, sockaddr: tuple[object, ...]) -> None:
            bound_sockaddrs.append(sockaddr)
            host = sockaddr[0] if len(sockaddr) >= 1 else ""
            if host == contact_host:
                raise OSError(errno.EADDRNOTAVAIL, "Cannot assign requested address")
            self._bound = ("0.0.0.0", 59876)

        def getsockname(self) -> tuple[str, int]:
            return self._bound

        def close(self) -> None:  # pragma: no cover - nothing to clean up
            pass

    monkeypatch.setattr(registration_module.socket, "socket", DummySocket)

    port = registration_module.SIPRegistrationManager._find_available_contact_port(
        contact_host
    )

    assert port == 59876
    assert bound_sockaddrs
    assert bound_sockaddrs[0][0] == contact_host
    assert any(
        isinstance(addr, tuple) and len(addr) >= 1 and addr[0] in {"0.0.0.0", "::"}
        for addr in bound_sockaddrs
    )


def test_ensure_dialog_username_populates_missing_user() -> None:
    dialog = SimpleNamespace(to_details={"uri": {"user": ""}})

    SIPRegistrationManager._ensure_dialog_username(dialog, "alice")

    assert dialog.to_details["uri"]["user"] == "alice"


def test_ensure_dialog_username_preserves_existing_user() -> None:
    dialog = SimpleNamespace(to_details={"uri": {"user": "carol"}})

    SIPRegistrationManager._ensure_dialog_username(dialog, "alice")

    assert dialog.to_details["uri"]["user"] == "carol"


def test_apply_config_from_settings_respects_bind_host_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    applied: list[SIPRegistrationConfig | None] = []
    loop = asyncio.new_event_loop()
    try:
        manager = SIPRegistrationManager(
            loop=loop,
            settings=SimpleNamespace(
                sip_bind_host="127.0.0.1",
                sip_bind_port=None,
                sip_username=None,
                sip_password=None,
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

        session = MagicMock()
        loop.run_until_complete(manager.apply_config_from_settings(session, stored))
    finally:
        loop.close()

    assert applied, "apply_config should be invoked"
    config = applied[0]
    assert isinstance(config, SIPRegistrationConfig)
    assert config.bind_host == "127.0.0.1"


def test_apply_config_from_settings_defaults_to_wildcard_for_public_ip(
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
        stored.sip_trunk_uri = "sip:alice@example.com"
        stored.sip_trunk_username = "alice"
        stored.sip_trunk_password = "secret"
        stored.sip_contact_host = "142.118.219.63"
        stored.sip_contact_port = 5070

        session = MagicMock()
        loop.run_until_complete(manager.apply_config_from_settings(session, stored))
    finally:
        loop.close()

    assert applied, "apply_config should be invoked"
    config = applied[0]
    assert isinstance(config, SIPRegistrationConfig)
    assert config.contact_host == "142.118.219.63"
    assert config.bind_host == "0.0.0.0"


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
    assert config.bind_host == "198.51.100.5"


def test_normalize_trunk_uri_enforces_scheme_and_username() -> None:
    normalized = SIPRegistrationManager._normalize_trunk_uri(
        "example.com:5070;transport=udp",
        "alice",
    )
    assert normalized == "sip:alice@example.com:5070;transport=udp"


def test_set_invite_handler_configures_router() -> None:
    loop = asyncio.new_event_loop()
    try:
        manager = SIPRegistrationManager(loop=loop)

        class _Router:
            def __init__(self) -> None:
                self.routes: dict[str, object] = {}

            def add_route(self, method: str, handler) -> None:  # type: ignore[no-untyped-def]
                self.routes[method] = handler

        dummy_app = SimpleNamespace(router=_Router())
        manager._app = dummy_app  # type: ignore[attr-defined]

        async def handler(dialog, request):  # type: ignore[no-untyped-def]
            return None

        manager.set_invite_handler(handler)
        assert dummy_app.router.routes["INVITE"] is handler
        assert "OPTIONS" in dummy_app.router.routes

        manager.set_invite_handler(None)
        assert "INVITE" not in dummy_app.router.routes
        assert "OPTIONS" in dummy_app.router.routes
    finally:
        loop.close()


def test_options_handler_replies_with_success() -> None:
    loop = asyncio.new_event_loop()
    try:
        manager = SIPRegistrationManager(loop=loop)
        manager._config = SIPRegistrationConfig(  # type: ignore[assignment]
            uri="sip:alice@example.com",
            username="alice",
            password="secret",
            contact_host="198.51.100.10",
            contact_port=5070,
        )
        manager._active_config = manager._config  # type: ignore[assignment]

        replies: list[tuple[int, dict[str, object]]] = []

        class DummyDialog:
            async def reply(  # type: ignore[no-untyped-def]
                self, status_code: int, **kwargs: object
            ) -> None:
                replies.append((status_code, kwargs))

        request = SimpleNamespace(headers={"Call-ID": "abc123"})

        loop.run_until_complete(
            manager._handle_incoming_options(DummyDialog(), request)  # type: ignore[arg-type]
        )
    finally:
        loop.run_until_complete(asyncio.sleep(0))
        loop.close()

    assert replies, "A SIP reply should be sent"
    status, params = replies[0]
    assert status == 200
    headers = params.get("headers")
    assert isinstance(headers, dict)
    assert headers.get("Allow") == _OPTIONS_ALLOW_HEADER
    assert headers.get("Contact") == "<sip:alice@198.51.100.10:5070>"
    assert params.get("reason") == "OK"


def test_register_once_uses_resolved_registrar_ip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loop = asyncio.new_event_loop()

    class FakeDialog:
        def register(self, *, expires: int) -> asyncio.Future[None]:
            fut: asyncio.Future[None] = loop.create_future()
            fut.set_result(None)
            return fut

        def close(self) -> None:
            pass

    start_kwargs: list[dict[str, object]] = []

    class FakeApplication:
        def __init__(self, *, loop: asyncio.AbstractEventLoop) -> None:
            self.loop = loop
            self.router = SimpleNamespace(
                routes={}, add_route=lambda *args, **kwargs: None
            )

        async def start_dialog(self, **kwargs: object) -> FakeDialog:
            start_kwargs.append(kwargs)
            return FakeDialog()

        async def finish(self) -> None:
            return None

    import backend.app.telephony.registration as registration_module

    fake_aiosip = SimpleNamespace(Application=FakeApplication)
    monkeypatch.setattr(registration_module, "aiosip", fake_aiosip)
    monkeypatch.setattr(
        registration_module,
        "_AIOSIP_IMPORT_ERROR",
        None,
        raising=False,
    )

    def fake_getaddrinfo(
        host: str, port: int, *, type: int
    ) -> list[tuple[object, ...]]:
        assert host == "montreal5.voip.ms"
        assert port == 5060
        return [
            (
                socket.AF_INET,
                socket.SOCK_DGRAM,
                0,
                "",
                ("208.100.60.23", port),
            )
        ]

    monkeypatch.setattr(registration_module.socket, "getaddrinfo", fake_getaddrinfo)

    try:
        manager = SIPRegistrationManager(loop=loop)
        config = SIPRegistrationConfig(
            uri="sip:218135_chatkit@montreal5.voip.ms",
            username="218135_chatkit",
            password="secret",
            contact_host="172.18.0.3",
            contact_port=5060,
        )

        loop.run_until_complete(manager._register_once(config))

        assert start_kwargs, "start_dialog should be invoked"
        remote_addr = start_kwargs[0]["remote_addr"]
        assert remote_addr == ("208.100.60.23", 5060)
    finally:
        loop.run_until_complete(manager._unregister())
        loop.close()


def test_register_once_uses_bind_host_for_local_addr(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loop = asyncio.new_event_loop()

    class FakeDialog:
        def register(self, *, expires: int) -> asyncio.Future[None]:
            fut: asyncio.Future[None] = loop.create_future()
            fut.set_result(None)
            return fut

        def close(self) -> None:
            pass

    start_kwargs: list[dict[str, object]] = []

    class FakeApplication:
        def __init__(self, *, loop: asyncio.AbstractEventLoop) -> None:
            self.loop = loop
            self.router = SimpleNamespace(
                routes={}, add_route=lambda *args, **kwargs: None
            )

        async def start_dialog(self, **kwargs: object) -> FakeDialog:
            start_kwargs.append(kwargs)
            return FakeDialog()

        async def finish(self) -> None:
            return None

    import backend.app.telephony.registration as registration_module

    fake_aiosip = SimpleNamespace(Application=FakeApplication)
    monkeypatch.setattr(registration_module, "aiosip", fake_aiosip)
    monkeypatch.setattr(
        registration_module,
        "_AIOSIP_IMPORT_ERROR",
        None,
        raising=False,
    )

    monkeypatch.setattr(
        registration_module.socket,
        "getaddrinfo",
        lambda host, port, *, type: [
            (
                socket.AF_INET,
                socket.SOCK_DGRAM,
                0,
                "",
                ("208.100.60.23", port),
            )
        ],
    )

    try:
        manager = SIPRegistrationManager(loop=loop)
        config = SIPRegistrationConfig(
            uri="sip:218135_chatkit@montreal5.voip.ms",
            username="218135_chatkit",
            password="secret",
            contact_host="198.51.100.5",
            contact_port=5060,
            bind_host="0.0.0.0",
        )

        loop.run_until_complete(manager._register_once(config))

        assert start_kwargs, "start_dialog should be invoked"
        local_addr = start_kwargs[0]["local_addr"]
        assert local_addr == ("0.0.0.0", 5060)
    finally:
        loop.run_until_complete(manager._unregister())
        loop.close()


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


def test_resolve_contact_endpoint_replaces_registrar_host(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    loop = asyncio.new_event_loop()
    try:
        manager = SIPRegistrationManager(loop=loop)
        monkeypatch.setattr(manager, "_infer_contact_host", lambda uri: "203.0.113.7")

        stored = AppSettings(thread_title_prompt="Prompt")
        stored.sip_trunk_uri = "sip:alice@montreal5.voip.ms"
        stored.sip_contact_host = "montreal5.voip.ms"
        stored.sip_contact_port = 5060

        caplog.set_level(logging.WARNING)
        host, port, transport = manager._resolve_contact_endpoint(
            stored,
            "sip:alice@montreal5.voip.ms",
        )
    finally:
        loop.close()

    assert host == "203.0.113.7"
    assert port == 5060
    assert transport is None
    assert "identique au registrar" in caplog.text


def test_register_once_reports_bind_error(monkeypatch: pytest.MonkeyPatch) -> None:
    loop = asyncio.new_event_loop()
    try:
        manager = SIPRegistrationManager(loop=loop)

        fake_app = SimpleNamespace(
            start_dialog=AsyncMock(
                side_effect=OSError(99, "Cannot assign requested address")
            )
        )
        fake_application = MagicMock(return_value=fake_app)
        monkeypatch.setattr(
            "backend.app.telephony.registration.aiosip",
            SimpleNamespace(Application=fake_application),
        )

        config = SIPRegistrationConfig(
            uri="sip:alice@example.com",
            username="alice",
            password="secret",
            contact_host="montreal5.voip.ms",
            contact_port=5060,
        )

        with pytest.raises(ValueError) as excinfo:
            loop.run_until_complete(manager._register_once(config))
    finally:
        loop.close()

    message = str(excinfo.value)
    assert "Impossible d'ouvrir une socket SIP locale" in message
    assert "montreal5.voip.ms:5060" in message


def test_register_once_retries_with_available_port(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    loop = asyncio.new_event_loop()
    try:
        manager = SIPRegistrationManager(loop=loop)

        dialog = SimpleNamespace(register=AsyncMock(return_value=None))
        start_dialog = AsyncMock(
            side_effect=[
                OSError(errno.EADDRINUSE, "Address already in use"),
                dialog,
            ]
        )
        fake_app = SimpleNamespace(start_dialog=start_dialog)
        fake_application = MagicMock(return_value=fake_app)
        monkeypatch.setattr(
            "backend.app.telephony.registration.aiosip",
            SimpleNamespace(Application=fake_application),
        )
        monkeypatch.setattr(
            manager,
            "_find_available_contact_port",
            MagicMock(return_value=5072),
        )

        config = SIPRegistrationConfig(
            uri="sip:alice@example.com",
            username="alice",
            password="secret",
            contact_host="127.0.0.1",
            contact_port=5060,
        )
        manager._config = config

        caplog.set_level(logging.WARNING)
        loop.run_until_complete(manager._register_once(config))
    finally:
        loop.close()

    assert start_dialog.await_count == 2
    assert manager._dialog is dialog
    assert manager._config.contact_port == 5072
    assert manager._active_config.contact_port == 5072
    assert "tentative avec le port" in caplog.text


def test_run_loop_retries_after_register_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loop = asyncio.new_event_loop()
    try:
        manager = SIPRegistrationManager(
            loop=loop,
            retry_interval=0.01,
            max_retry_interval=0.01,
        )

        config = SIPRegistrationConfig(
            uri="sip:alice@example.com",
            username="alice",
            password="secret",
            contact_host="127.0.0.1",
            contact_port=5060,
            expires=1,
        )
        manager.apply_config(config)

        register_once = AsyncMock(side_effect=[RuntimeError("boom"), None])
        monkeypatch.setattr(manager, "_register_once", register_once)

        loop.run_until_complete(manager.start())
        loop.run_until_complete(asyncio.sleep(0.05))
        loop.run_until_complete(manager.stop())
    finally:
        loop.close()

    assert register_once.await_count >= 2
