from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass
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
    TelephonyRouteSelectionError,
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


@dataclass
class _Definition:
    slug: str
    telephony_config: dict[str, Any]

    def __post_init__(self) -> None:
        start_step = _Step(
            slug="start",
            kind="start",
            position=0,
            is_enabled=True,
            parameters={"telephony": self.telephony_config},
        )
        self.steps = [start_step]
        self.workflow = SimpleNamespace(slug=self.slug)


class _FakeWorkflowService:
    def __init__(self, definitions: dict[str, _Definition], current: str) -> None:
        self._definitions = definitions
        self._current = current

    def get_current(self, session: Any | None = None) -> _Definition:
        return self._definitions[self._current]

    def get_definition_by_slug(
        self, slug: str, session: Any | None = None
    ) -> _Definition:
        return self._definitions[slug]


class _DummyVoiceSettings:
    def __init__(self) -> None:
        self.model = "base-model"
        self.instructions = "Base instructions"
        self.voice = "base-voice"
        self.prompt_variables = {"existing": "1"}


def test_resolve_start_telephony_config_parses_routes() -> None:
    definition = _Definition(
        slug="base",
        telephony_config={
            "routes": [
                {
                    "label": "Support",
                    "phone_numbers": [" +33 1 23 45 67 89 ", "001122"],
                    "workflow": {"slug": "support"},
                    "overrides": {
                        "model": "gpt-voice",
                        "voice": "alloy",
                        "instructions": "Soyez aimable",
                        "prompt_variables": {"locale": "fr", "trim": " value "},
                    },
                },
                {
                    "prefixes": ["+331"],
                    "workflow_slug": "sales",
                },
            ],
            "default": {
                "workflow": {"slug": "base"},
                "overrides": {"voice": "verse"},
            },
        },
    )

    config = resolve_start_telephony_config(definition)
    assert config is not None
    assert len(config.routes) == 2
    assert config.default_route is not None

    first_route = config.routes[0]
    assert first_route.workflow_slug == "support"
    assert first_route.phone_numbers == ("+33123456789", "001122")
    assert first_route.overrides.model == "gpt-voice"
    assert first_route.overrides.voice == "alloy"
    assert first_route.overrides.instructions == "Soyez aimable"
    assert first_route.overrides.prompt_variables == {"locale": "fr", "trim": " value "}

    second_route = config.routes[1]
    assert second_route.prefixes == ("+331",)


def test_resolve_workflow_for_phone_number_applies_overrides(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeWorkflowService(
        definitions={
            "base": _Definition(
                slug="base",
                telephony_config={
                    "routes": [
                        {
                            "phone_numbers": ["+331234"],
                            "workflow": {"slug": "base"},
                            "overrides": {
                                "model": "gpt-special",
                                "voice": "ember",
                                "instructions": "Répondez rapidement",
                                "prompt_variables": {"channel": "sip"},
                            },
                        }
                    ],
                    "default": {
                        "workflow": {"slug": "base"},
                    },
                },
            )
        },
        current="base",
    )

    dummy_session = object()
    monkeypatch.setattr(
        "backend.app.telephony.sip_server.get_or_create_voice_settings",
        lambda session: _DummyVoiceSettings(),
    )

    context = resolve_workflow_for_phone_number(
        service,
        phone_number="+33 1234",
        session=dummy_session,
    )

    assert context.route is not None
    assert context.voice_model == "gpt-special"
    assert context.voice_instructions == "Répondez rapidement"
    assert context.voice_voice == "ember"
    assert context.voice_prompt_variables == {"existing": "1", "channel": "sip"}


def test_resolve_workflow_for_phone_number_logs_and_falls_back_to_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeWorkflowService(
        definitions={
            "base": _Definition(slug="base", telephony_config={}),
        },
        current="base",
    )

    dummy_session = object()
    monkeypatch.setattr(
        "backend.app.telephony.sip_server.get_or_create_voice_settings",
        lambda session: _DummyVoiceSettings(),
    )

    context = resolve_workflow_for_phone_number(
        service,
        phone_number="+331234",
        session=dummy_session,
    )

    assert context.route is None
    assert context.voice_model == "base-model"
    assert context.voice_voice == "base-voice"


def test_resolve_workflow_for_phone_number_raises_when_no_route(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeWorkflowService(
        definitions={
            "base": _Definition(
                slug="base",
                telephony_config={
                    "routes": [
                        {
                            "phone_numbers": ["+999"],
                            "workflow": {"slug": "base"},
                        }
                    ]
                },
            )
        },
        current="base",
    )

    monkeypatch.setattr(
        "backend.app.telephony.sip_server.get_or_create_voice_settings",
        lambda session: _DummyVoiceSettings(),
    )

    with pytest.raises(TelephonyRouteSelectionError):
        resolve_workflow_for_phone_number(
            service,
            phone_number="+331234",
            session=object(),
        )


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
        route=None,
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
            route=None,
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
