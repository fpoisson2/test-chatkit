from __future__ import annotations

import asyncio
import itertools
import os
import sys
import types
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

import backend.app.startup as startup_module  # noqa: E402
import backend.app.telephony.sip_server as sip_module  # noqa: E402
from backend.app.telephony.sip_server import (  # noqa: E402
    SipCallRequestHandler,
    SipCallSession,
    resolve_workflow_for_phone_number,
)
from backend.app.telephony.voice_bridge import VoiceBridgeStats  # noqa: E402
from backend.app.workflows import resolve_start_telephony_config  # noqa: E402


@dataclass
class _Step:
    slug: str
    kind: str
    position: int
    is_enabled: bool
    parameters: dict[str, Any]


_definition_id_counter = itertools.count(1)


@dataclass
class _Definition:
    slug: str
    telephony_config: dict[str, Any]
    workflow_id: int = field(default_factory=lambda: next(_definition_id_counter))

    def __post_init__(self) -> None:
        start_step = _Step(
            slug="start",
            kind="start",
            position=0,
            is_enabled=True,
            parameters={"telephony": self.telephony_config},
        )
        self.steps = [start_step]
        self.workflow = SimpleNamespace(slug=self.slug, id=self.workflow_id)


class _FakeWorkflowService:
    def __init__(self, definitions: dict[str, _Definition], current: str) -> None:
        self._definitions = definitions
        self._definitions_by_id = {
            definition.workflow_id: definition for definition in definitions.values()
        }
        self._current = current

    def get_current(self, session: Any | None = None) -> _Definition:
        return self._definitions[self._current]

    def get_definition_by_slug(
        self, slug: str, session: Any | None = None
    ) -> _Definition:
        return self._definitions[slug]

    def get_definition_by_workflow_id(
        self, workflow_id: int, session: Any | None = None
    ) -> _Definition:
        return self._definitions_by_id[workflow_id]

    def list_workflows(self, session: Any | None = None) -> list[Any]:
        return [definition.workflow for definition in self._definitions.values()]


class _DummyVoiceSettings:
    def __init__(self) -> None:
        self.model = "base-model"
        self.instructions = "Base instructions"
        self.voice = "base-voice"
        self.prompt_variables = {"existing": "1"}


def test_resolve_start_telephony_config_detects_flag() -> None:
    definition = _Definition(
        slug="base",
        telephony_config={"sip_entrypoint": True},
    )

    config = resolve_start_telephony_config(definition)
    assert config is not None
    assert config.sip_entrypoint is True


def test_resolve_start_telephony_config_returns_none_without_flag() -> None:
    definition = _Definition(slug="base", telephony_config={})
    assert resolve_start_telephony_config(definition) is None


def test_extract_remote_media_target_prefers_audio_section() -> None:
    payload = (
        "v=0\r\n"
        "o=- 123 1 IN IP4 198.51.100.5\r\n"
        "s=-\r\n"
        "c=IN IP4 198.51.100.9\r\n"
        "t=0 0\r\n"
        "m=audio 49170 RTP/AVP 0 8\r\n"
        "c=IN IP4 198.51.100.5\r\n"
        "a=rtpmap:0 PCMU/8000\r\n"
    )

    host, port = startup_module._extract_remote_media_target(payload)

    assert host == "198.51.100.5"
    assert port == 49170


def test_extract_remote_media_target_handles_missing_values() -> None:
    payload = "v=0\r\n" "s=-\r\n" "m=video 0 RTP/AVP 31\r\n"

    host, port = startup_module._extract_remote_media_target(payload)

    assert host is None
    assert port is None


def test_extract_remote_media_target_handles_mapping_payload() -> None:
    payload = {
        "body": (
            b"v=0\r\n"
            b"o=- 321 1 IN IP4 203.0.113.10\r\n"
            b"s=-\r\n"
            b"c=IN IP4 203.0.113.77\r\n"
            b"t=0 0\r\n"
            b"m=audio 60000 RTP/AVP 0\r\n"
        )
    }

    host, port = startup_module._extract_remote_media_target(payload)

    assert host == "203.0.113.77"
    assert port == 60000


def test_extract_remote_media_target_handles_object_payload() -> None:
    body = (
        b"v=0\r\n"
        b"o=- 999 1 IN IP4 198.51.100.20\r\n"
        b"s=-\r\n"
        b"c=IN IP4 198.51.100.30\r\n"
        b"t=0 0\r\n"
        b"m=audio 49152 RTP/AVP 0\r\n"
    )

    class _Payload:
        def __init__(self, data: bytes) -> None:
            self.body = data

        def decode(self, encoding: str = "utf-8") -> str:
            return self.body.decode(encoding)

    payload = _Payload(body)

    host, port = startup_module._extract_remote_media_target(payload)

    assert host == "198.51.100.30"
    assert port == 49152


def _make_settings(**overrides: Any) -> Any:
    defaults = {
        "chatkit_realtime_model": "fallback-model",
        "chatkit_realtime_instructions": "Fallback instructions",
        "chatkit_realtime_voice": "fallback-voice",
        "telephony_default_workflow_slug": None,
        "telephony_default_workflow_id": None,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_resolve_workflow_for_phone_number_uses_current_entrypoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeWorkflowService(
        definitions={
            "base": _Definition(
                slug="base",
                telephony_config={"sip_entrypoint": True},
            ),
            "alt": _Definition(slug="alt", telephony_config={}),
        },
        current="base",
    )

    monkeypatch.setattr(
        "backend.app.telephony.sip_server.get_or_create_voice_settings",
        lambda session: _DummyVoiceSettings(),
    )

    context = resolve_workflow_for_phone_number(
        service,
        phone_number="+331234",
        session=object(),
        settings=_make_settings(),
    )

    assert context.workflow_definition is service.get_definition_by_slug("base")
    assert context.is_sip_entrypoint is True
    assert context.voice_model == "base-model"


def test_resolve_workflow_for_phone_number_prefers_flagged_workflow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeWorkflowService(
        definitions={
            "base": _Definition(slug="base", telephony_config={}),
            "voice": _Definition(
                slug="voice",
                telephony_config={"sip_entrypoint": True},
            ),
        },
        current="base",
    )

    monkeypatch.setattr(
        "backend.app.telephony.sip_server.get_or_create_voice_settings",
        lambda session: _DummyVoiceSettings(),
    )

    context = resolve_workflow_for_phone_number(
        service,
        phone_number="100",
        session=object(),
        settings=_make_settings(),
    )

    assert context.workflow_definition is service.get_definition_by_slug("voice")
    assert context.is_sip_entrypoint is True


def test_resolve_workflow_for_phone_number_uses_settings_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeWorkflowService(
        definitions={
            "base": _Definition(slug="base", telephony_config={}),
            "voice": _Definition(
                slug="voice",
                telephony_config={"sip_entrypoint": True},
            ),
        },
        current="base",
    )

    monkeypatch.setattr(
        "backend.app.telephony.sip_server.get_or_create_voice_settings",
        lambda session: _DummyVoiceSettings(),
    )

    settings = _make_settings(telephony_default_workflow_slug="voice")
    context = resolve_workflow_for_phone_number(
        service,
        phone_number="999",
        session=object(),
        settings=settings,
    )

    assert context.workflow_definition is service.get_definition_by_slug("voice")
    assert context.is_sip_entrypoint is True


def test_resolve_workflow_for_phone_number_returns_defaults_when_missing_flag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeWorkflowService(
        definitions={
            "base": _Definition(slug="base", telephony_config={}),
        },
        current="base",
    )

    monkeypatch.setattr(
        "backend.app.telephony.sip_server.get_or_create_voice_settings",
        lambda session: _DummyVoiceSettings(),
    )

    context = resolve_workflow_for_phone_number(
        service,
        phone_number="+331234",
        session=object(),
        settings=_make_settings(),
    )

    assert context.workflow_definition is service.get_definition_by_slug("base")
    assert context.is_sip_entrypoint is False
    assert context.voice_model == "base-model"
    assert context.voice_voice == "base-voice"
def test_ack_starts_rtp_session_once() -> None:
    started: list[str] = []

    async def _on_start(session: SipCallSession) -> None:
        started.append(session.call_id)

    handler = SipCallRequestHandler(start_rtp_callback=_on_start)

    async def _run() -> None:
        invite = SimpleNamespace(method="INVITE", headers={"Call-ID": "abc123"})
        await handler.handle_request(invite)

        ack = SimpleNamespace(method="ACK", headers={"Call-ID": "abc123"})
        await handler.handle_request(ack)

        assert started == ["abc123"]
        session = handler.get_session("abc123")
        assert session is not None
        assert session.state == "established"
        assert session.rtp_started_at is not None

        # Replaying the ACK should be ignored silently.
        await handler.handle_request(ack)
        assert started == ["abc123"], "ACK should not restart RTP"

    asyncio.run(_run())


@pytest.mark.anyio
@pytest.mark.parametrize("anyio_backend", ["asyncio"])
async def test_prepare_voice_workflow_returns_voice_event(
    monkeypatch: pytest.MonkeyPatch, anyio_backend: str
) -> None:
    del anyio_backend
    voice_event = {
        "type": "realtime.event",
        "step": {"slug": "voice", "title": "Voice"},
        "event": {
            "type": "history",
            "session_id": "session-123",
            "client_secret": {"value": "secret-abc"},
            "tool_permissions": {"response": True},
            "session": {
                "model": "gpt-voice",
                "voice": "ember",
                "instructions": "Répondez brièvement.",
                "realtime": {"start_mode": "manual", "stop_mode": "manual"},
                "tools": [{"type": "web_search"}],
                "handoffs": [{"type": "superviseur"}],
                "prompt_variables": {"locale": "fr"},
                "model_provider_id": "prov-1",
                "model_provider_slug": "openai",
            },
        },
    }

    voice_context = {
        "model": "gpt-voice",
        "voice": "ember",
        "instructions": "Répondez brièvement.",
        "realtime": {"start_mode": "manual", "stop_mode": "manual"},
        "tools": [{"type": "web_search"}],
        "handoffs": [{"type": "superviseur"}],
        "prompt_variables": {"locale": "fr"},
        "model_provider_id": "prov-1",
        "model_provider_slug": "openai",
    }

    wait_state = {
        "slug": "voice",
        "input_item_id": "input-1",
        "type": "voice",
        "voice_event": voice_event,
        "state": {"last_voice_session": voice_context},
    }

    calls: list[Any] = []

    async def _fake_run_workflow(*args: Any, agent_context: Any, **_: Any) -> Any:
        calls.append(args)
        if len(calls) == 1:
            assert stub_store.saved, "Le thread doit être enregistré avant l'exécution"
            sip_module._set_wait_state_metadata(agent_context.thread, wait_state)
        else:
            stored = sip_module._get_wait_state_metadata(agent_context.thread)
            assert stored is not None
            assert stored.get("voice_transcripts") == [
                {"role": "user", "text": "Salut"}
            ]
        return SimpleNamespace()

    class _StubStore:
        def __init__(self) -> None:
            self.saved: list[Any] = []

        def generate_thread_id(self, _: Any) -> str:
            return "thread-voice"

        async def save_thread(self, thread: Any, context: Any) -> None:
            self.saved.append((thread, context))

    stub_store = _StubStore()

    class _StubServer:
        def __init__(self) -> None:
            self.store = stub_store

    monkeypatch.setattr(sip_module, "get_chatkit_server", lambda: _StubServer())
    monkeypatch.setattr(sip_module, "run_workflow", _fake_run_workflow)

    call_context = sip_module.TelephonyCallContext(
        workflow_definition=SimpleNamespace(workflow=SimpleNamespace(slug="demo")),
        normalized_number="+331234",
        original_number="+331234",
        is_sip_entrypoint=False,
        voice_model="gpt-voice",
        voice_instructions="Répondez brièvement.",
        voice_voice="ember",
        voice_prompt_variables={"locale": "fr"},
        voice_provider_id="prov-1",
        voice_provider_slug="openai",
    )

    result = await sip_module.prepare_voice_workflow(
        call_context,
        call_id="call-voice",
        settings=SimpleNamespace(backend_public_base_url="https://backend.invalid"),
    )

    assert result is not None
    assert result.voice_event == voice_event

    assert calls, "run_workflow doit être invoqué"
    bootstrap_input = calls[0][0]
    assert isinstance(bootstrap_input, sip_module.WorkflowInput)
    assert "Appel téléphonique entrant" in bootstrap_input.input_as_text
    assert "call-voice" in bootstrap_input.input_as_text
    assert "locale=fr" in bootstrap_input.input_as_text
    assert bootstrap_input.source_item_id == "sip:call-voice"

    metadata = dict(result.metadata)
    assert metadata["thread_id"] == "thread-voice"
    assert metadata["voice_context"]["tools"] == [{"type": "web_search"}]
    assert metadata["voice_context"]["handoffs"] == [{"type": "superviseur"}]
    assert metadata["tool_permissions"] == {"response": True}

    await result.resume_callback([{"role": "user", "text": "Salut"}])
    assert len(calls) == 2
    assert stub_store.saved, "Le thread doit être enregistré"
    first_thread, first_context = stub_store.saved[0]
    assert first_thread.id == "thread-voice"
    assert first_context.user_id == "sip:call-voice"


@pytest.mark.anyio
@pytest.mark.parametrize("anyio_backend", ["asyncio"])
async def test_register_session_stores_voice_metadata(
    monkeypatch: pytest.MonkeyPatch, anyio_backend: str
) -> None:
    del anyio_backend

    async def _fake_prepare_voice_workflow(
        *_: Any, **__: Any
    ) -> sip_module.TelephonyVoiceWorkflowResult:
        async def _resume(_: Any) -> None:
            return None

        voice_event = {
            "type": "realtime.event",
            "event": {
                "type": "history",
                "session_id": "session-xyz",
                "client_secret": {"value": "secret"},
                "tool_permissions": {"response": True},
                "session": {
                    "model": "gpt-voice",
                    "voice": "alloy",
                    "instructions": "Soyez bref.",
                    "realtime": {"start_mode": "auto", "stop_mode": "manual"},
                    "tools": [{"type": "web_search"}],
                    "handoffs": [{"type": "agent"}],
                    "prompt_variables": {"locale": "fr"},
                    "model_provider_id": "prov",
                    "model_provider_slug": "openai",
                },
            },
        }

        metadata = {
            "thread_id": "thread-xyz",
            "voice_context": {
                "model": "gpt-voice",
                "voice": "alloy",
                "instructions": "Soyez bref.",
                "realtime": {"start_mode": "auto", "stop_mode": "manual"},
                "tools": [{"type": "web_search"}],
                "handoffs": [{"type": "agent"}],
                "prompt_variables": {"locale": "fr"},
                "model_provider_id": "prov",
                "model_provider_slug": "openai",
            },
            "tool_permissions": {"response": True},
            "wait_state": {"slug": "voice"},
            "realtime_session_id": "session-xyz",
            "voice_step_slug": "voice",
        }

        return sip_module.TelephonyVoiceWorkflowResult(
            voice_event=voice_event,
            metadata=metadata,
            resume_callback=_resume,
        )

    def _fake_resolve_workflow(*_: Any, **__: Any) -> sip_module.TelephonyCallContext:
        return sip_module.TelephonyCallContext(
            workflow_definition=SimpleNamespace(workflow=SimpleNamespace(slug="demo")),
            normalized_number="+331234",
            original_number="+331234",
            is_sip_entrypoint=False,
            voice_model="gpt-fallback",
            voice_instructions="Fallback",
            voice_voice="verse",
            voice_prompt_variables={"fallback": "1"},
            voice_provider_id="prov",
            voice_provider_slug="openai",
        )

    class _DummySession:
        def __enter__(self) -> Any:
            return SimpleNamespace()

        def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
            return False

    monkeypatch.setattr(
        startup_module, "prepare_voice_workflow", _fake_prepare_voice_workflow
    )
    monkeypatch.setattr(
        startup_module, "resolve_workflow_for_phone_number", _fake_resolve_workflow
    )
    monkeypatch.setattr(startup_module, "SessionLocal", lambda: _DummySession())
    monkeypatch.setattr(startup_module, "WorkflowService", lambda: SimpleNamespace())
    monkeypatch.setattr(
        startup_module,
        "settings",
        SimpleNamespace(backend_public_base_url="https://backend.invalid"),
    )

    manager = SimpleNamespace(active_config=None, contact_host=None)
    on_invite = startup_module._build_invite_handler(manager)
    closure = {
        name: cell.cell_contents
        for name, cell in zip(
            on_invite.__code__.co_freevars,
            on_invite.__closure__ or (),
            strict=False,
        )
    }
    sip_handler = closure["sip_handler"]
    register_callback = sip_handler._invite_callback

    class _Request:
        def __init__(self) -> None:
            self.headers = {"To": "sip:+331234@example.com"}

    session = SipCallSession(call_id="call-xyz", request=_Request())
    await register_callback(session, session.request)

    metadata = session.metadata.get("telephony") or {}
    assert metadata["voice_event"]["event"]["session"]["tools"] == [
        {"type": "web_search"}
    ]
    assert metadata["voice_event"]["event"]["tool_permissions"] == {"response": True}
    assert metadata["voice_realtime"] == {"start_mode": "auto", "stop_mode": "manual"}
    assert metadata["voice_tools"] == [{"type": "web_search"}]
    assert metadata["voice_handoffs"] == [{"type": "agent"}]
    assert metadata["voice_prompt_variables"] == {"locale": "fr"}
    assert metadata["voice_model"] == "gpt-voice"
    assert metadata["voice_session_active"] is False
    assert callable(metadata.get("resume_workflow_callable"))


@pytest.mark.anyio
@pytest.mark.parametrize("anyio_backend", ["asyncio"])
async def test_start_rtp_uses_voice_event_configuration(
    monkeypatch: pytest.MonkeyPatch, anyio_backend: str
) -> None:
    del anyio_backend

    recorded: dict[str, Any] = {}

    class _SecretHandle:
        def as_text(self) -> str:
            return "secret-token"

        def expires_at_isoformat(self) -> str:
            return "2099-01-01T00:00:00Z"

    def _parse_secret(payload: Mapping[str, Any]) -> _SecretHandle:
        recorded["parsed_payload"] = payload
        return _SecretHandle()

    class _FakeBridge:
        def __init__(self, *, hooks: Any, **_: Any) -> None:
            recorded["hooks"] = hooks

        async def run(self, **kwargs: Any) -> VoiceBridgeStats:
            recorded["run_kwargs"] = kwargs
            return VoiceBridgeStats(
                duration_seconds=0.0,
                inbound_audio_bytes=0,
                outbound_audio_bytes=0,
            )

    monkeypatch.setattr(startup_module, "TelephonyVoiceBridge", _FakeBridge)

    class _SecretParserStub:
        def parse(self, payload: Mapping[str, Any]) -> _SecretHandle:
            return _parse_secret(payload)

    monkeypatch.setattr(
        startup_module,
        "SessionSecretParser",
        lambda: _SecretParserStub(),
    )

    manager = SimpleNamespace(active_config=None, contact_host=None)
    on_invite = startup_module._build_invite_handler(manager)
    closure = {
        name: cell.cell_contents
        for name, cell in zip(
            on_invite.__code__.co_freevars,
            on_invite.__closure__ or (),
            strict=False,
        )
    }
    sip_handler = closure["sip_handler"]
    start_rtp = sip_handler._start_rtp_callback

    async def _send_audio(_: bytes) -> None:
        return None

    def _rtp_factory() -> Any:
        async def _generator() -> Any:
            if False:  # pragma: no cover - génération vide
                yield None
            return

        return _generator()

    session_config = {
        "model": "gpt-realtime-mini",
        "voice": "alloy",
        "instructions": "Parlez peu.",
        "realtime": {
            "start_mode": "auto",
            "turn_detection": {"type": "server_vad", "threshold": 0.33},
        },
        "tools": [{"type": "mcp"}],
        "handoffs": [{"type": "agent"}],
    }
    voice_event = {
        "event": {
            "type": "history",
            "session_id": "sess-123",
            "client_secret": {"value": "secret-token"},
            "tool_permissions": {"response": True},
            "session": session_config,
        }
    }

    session = SipCallSession(call_id="call-voice", request=SimpleNamespace())
    session.metadata["telephony"] = {
        "rtp_stream_factory": _rtp_factory,
        "send_audio": _send_audio,
        "voice_event": voice_event,
    }

    await start_rtp(session)

    run_kwargs = recorded["run_kwargs"]
    session_payload = run_kwargs["session_config"]
    assert session_payload["voice"] == "alloy"
    assert session_payload["realtime"]["start_mode"] == "auto"
    assert session_payload["realtime"]["turn_detection"] == {
        "type": "server_vad",
        "threshold": 0.33,
    }
    assert session_payload["tools"] == [{"type": "mcp"}]
    assert run_kwargs["tool_permissions"] == {"response": True}

    metadata = session.metadata["telephony"]
    assert metadata["client_secret"] == "secret-token"
    assert metadata["voice_session_config"]["instructions"] == "Parlez peu."


@pytest.mark.anyio
@pytest.mark.parametrize("anyio_backend", ["asyncio"])
async def test_invite_configures_rtp_remote_target(
    monkeypatch: pytest.MonkeyPatch, anyio_backend: str
) -> None:
    del anyio_backend

    recorded: dict[str, Any] = {}

    class _FakeRtpServer:
        def __init__(self, config: Any) -> None:
            recorded["config"] = config

        async def start(self) -> int:
            return 40000

        async def stop(self) -> None:
            recorded["stopped"] = True

    async def _noop_reply(*_: Any, **__: Any) -> None:
        return None

    monkeypatch.setattr(startup_module, "RtpServer", _FakeRtpServer)
    monkeypatch.setattr(startup_module, "send_sip_reply", _noop_reply)

    manager = SimpleNamespace(active_config=None, contact_host="192.0.2.10")
    on_invite = startup_module._build_invite_handler(manager)
    closure = {
        name: cell.cell_contents
        for name, cell in zip(
            on_invite.__code__.co_freevars,
            on_invite.__closure__ or (),
            strict=False,
        )
    }
    sip_handler = closure["sip_handler"]

    async def _fake_handle_invite(
        self: Any, request: Any, dialog: Any | None = None
    ) -> None:
        raise RuntimeError("stop")

    monkeypatch.setattr(
        sip_handler,
        "handle_invite",
        types.MethodType(_fake_handle_invite, sip_handler),
        raising=False,
    )

    payload = (
        b"v=0\r\n"
        b"o=- 123 1 IN IP4 198.51.100.5\r\n"
        b"s=-\r\n"
        b"c=IN IP4 198.51.100.9\r\n"
        b"t=0 0\r\n"
        b"m=audio 49170 RTP/AVP 0 8\r\n"
        b"a=rtpmap:0 PCMU/8000\r\n"
    )

    request = SimpleNamespace(
        method="INVITE",
        payload=payload,
        headers={
            "Call-ID": "call-remote",
            "From": "\"Caller\" <sip:100@example.com>",
            "To": "sip:102@example.com",
        },
    )

    dialog = SimpleNamespace()

    with pytest.raises(RuntimeError):
        await on_invite(dialog, request)

    config = recorded["config"]
    assert config.remote_host == "198.51.100.9"
    assert config.remote_port == 49170


def test_ack_without_session_is_ignored(caplog: pytest.LogCaptureFixture) -> None:
    handler = SipCallRequestHandler()

    async def _run() -> None:
        ack = SimpleNamespace(method="ACK", headers={"Call-ID": "missing"})

        with caplog.at_level("WARNING"):
            await handler.handle_request(ack)

        assert "sans session correspondante" in " ".join(caplog.messages)

    asyncio.run(_run())


def test_bye_terminates_session_and_calls_callback() -> None:
    terminated: list[str] = []

    async def _on_terminate(session: SipCallSession, _dialog: Any | None) -> None:
        terminated.append(session.call_id)

    handler = SipCallRequestHandler(terminate_callback=_on_terminate)

    async def _run() -> None:
        invite = SimpleNamespace(method="INVITE", headers={"Call-ID": "bye-test"})
        await handler.handle_request(invite)

        bye = SimpleNamespace(method="BYE", headers={"Call-ID": "bye-test"})
        await handler.handle_request(bye)

        assert terminated == ["bye-test"]
        assert handler.get_session("bye-test") is None

    asyncio.run(_run())
