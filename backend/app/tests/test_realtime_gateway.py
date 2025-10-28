import asyncio
import base64
import json
import os
import sys
from types import SimpleNamespace

import pytest

os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("DATABASE_URL", "sqlite:///./chatkit-tests.db")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from agents.tool import FunctionTool  # noqa: E402
from backend.app.realtime_gateway import (  # noqa: E402
    GatewayConnection,
    GatewayUser,
    RealtimeSessionGateway,
    _RealtimeSessionState,
)
from backend.app.realtime_runner import VoiceSessionHandle  # noqa: E402


class _StubState:
    def __init__(
        self,
        handle: VoiceSessionHandle,
        *,
        thread_id: str | None = None,
    ) -> None:
        self.handle = handle
        self.owner_user_id = handle.metadata.get("user_id") or ""
        self.thread_id = thread_id
        self.history: list[dict[str, object]] = []
        self.listeners: set[GatewayConnection] = set()
        self.session_payload_value = {"model": handle.metadata.get("model")}
        self.transcripts_value = [
            {"id": "t1", "role": "assistant", "text": "Bonjour"}
        ]
        self.sent_audio: list[tuple[bytes, bool]] = []
        self.interrupted = False
        self.shutdown_called = False

    async def add_listener(self, connection: GatewayConnection) -> None:
        self.listeners.add(connection)

    async def remove_listener(self, connection: GatewayConnection) -> None:
        self.listeners.discard(connection)

    async def ensure_session_started(self) -> None:
        return

    async def send_audio(self, pcm: bytes, *, commit: bool) -> None:
        self.sent_audio.append((pcm, commit))

    async def interrupt(self) -> None:
        self.interrupted = True

    async def shutdown(self) -> None:
        self.shutdown_called = True

    def should_log_input_audio(self, *, commit: bool) -> bool:
        return False

    def session_payload(self) -> dict[str, object]:
        return dict(self.session_payload_value)

    def transcripts(self) -> list[dict[str, object]]:
        return list(self.transcripts_value)


class _StubWebSocket:
    def __init__(self, collector: list[dict[str, object]]):
        self._collector = collector

    async def send_text(self, message: str) -> None:
        self._collector.append(json.loads(message))


def _make_handle(
    session_id: str = "session-1",
    *,
    user_id: str = "user-1",
) -> VoiceSessionHandle:
    agent = SimpleNamespace(instructions="Salut")
    runner = SimpleNamespace()
    return VoiceSessionHandle(
        session_id=session_id,
        payload={},
        agent=agent,
        runner=runner,
        client_secret="secret",
        metadata={"user_id": user_id, "model": "gpt-realtime"},
    )


def test_state_ensure_session_started_uses_sdk_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _run() -> None:
        captured_configs: list[dict[str, object]] = []

        class _StubSession:
            async def __aenter__(self):  # type: ignore[no-untyped-def]
                return self

            async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
                return False

            def __aiter__(self):  # type: ignore[no-untyped-def]
                return self

            async def __anext__(self):  # type: ignore[no-untyped-def]
                raise StopAsyncIteration

        class _StubRunner:
            async def run(self, *, model_config: dict[str, object]):  # type: ignore[no-untyped-def]
                captured_configs.append(model_config)
                return _StubSession()

        async def _invoke_tool(context, arguments):  # type: ignore[no-untyped-def]
            return "ok"

        function_tool = FunctionTool(
            name="calc",
            description="Calculator",
            params_json_schema={"type": "object", "properties": {}},
            on_invoke_tool=_invoke_tool,
        )

        handle = VoiceSessionHandle(
            session_id="session-sdk",
            payload={},
            agent=SimpleNamespace(instructions=None),
            runner=_StubRunner(),
            client_secret="secret",
            metadata={
                "user_id": "user-1",
                "model": "gpt-realtime",
                "sdk_tools": [function_tool],
                "tools": [{"type": "function", "name": "calc"}],
            },
        )

        state = _RealtimeSessionState(handle, gateway=SimpleNamespace())

        async def _noop(self):  # type: ignore[no-untyped-def]
            return None

        monkeypatch.setattr(_RealtimeSessionState, "_pump_events", _noop)

        await state.ensure_session_started()

        assert captured_configs, "runner.run should be called"
        model_config = captured_configs[0]
        settings = model_config.get("initial_model_settings")
        assert isinstance(settings, dict)
        assert settings.get("tools") == [function_tool]

    asyncio.run(_run())


def test_register_connection_pushes_existing_sessions() -> None:
    async def _run() -> None:
        gateway = RealtimeSessionGateway()
        handle = _make_handle()
        state = _StubState(handle)
        gateway._sessions[handle.session_id] = state  # type: ignore[attr-defined]

        messages: list[dict[str, object]] = []
        connection = GatewayConnection(
            websocket=_StubWebSocket(messages),
            user=GatewayUser(id="user-1", email="user@example.com"),
            authorization="Bearer token",
        )

        await gateway.register_connection(connection)

        assert state.listeners == {connection}
        assert messages, "aucun message reçu"
        payload = messages[0]
        assert payload["type"] == "session_created"
        assert payload["session_id"] == handle.session_id

    asyncio.run(_run())


def test_handle_message_routes_audio_to_state() -> None:
    async def _run() -> None:
        gateway = RealtimeSessionGateway()
        handle = _make_handle()
        state = _StubState(handle)
        gateway._sessions[handle.session_id] = state  # type: ignore[attr-defined]

        messages: list[dict[str, object]] = []
        connection = GatewayConnection(
            websocket=_StubWebSocket(messages),
            user=GatewayUser(id="user-1", email=None),
            authorization="Bearer token",
        )

        payload = {
            "type": "input_audio",
            "session_id": handle.session_id,
            "data": base64.b64encode(b"pcm").decode("ascii"),
        }

        await gateway.handle_message(connection, payload)

        assert state.sent_audio == [(b"pcm", False)]

    asyncio.run(_run())


def test_finalize_closes_session_and_broadcasts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _run() -> None:
        gateway = RealtimeSessionGateway()
        handle = _make_handle()
        state = _StubState(handle, thread_id="thread-1")
        gateway._sessions[handle.session_id] = state  # type: ignore[attr-defined]

        messages: list[dict[str, object]] = []
        connection = GatewayConnection(
            websocket=_StubWebSocket(messages),
            user=GatewayUser(id="user-1", email="user@example.com"),
            authorization="Bearer token",
        )

        await gateway.register_connection(connection)

        captured_finalize: dict[str, object] = {}

        async def _fake_finalize(**kwargs):  # type: ignore[no-untyped-def]
            captured_finalize.update(kwargs)

        async def _fake_close_voice_session(
            *, session_id: str | None = None, **_: object
        ) -> bool:
            captured_finalize["closed_session"] = session_id
            return True

        def _build_context(  # type: ignore[no-untyped-def]
            user,
            request=None,
            public_base_url=None,
            authorization=None,
        ):
            return SimpleNamespace(user=user)

        monkeypatch.setattr(
            "backend.app.realtime_gateway.build_chatkit_request_context",
            _build_context,
        )
        monkeypatch.setattr(
            "backend.app.realtime_gateway.get_settings",
            lambda: SimpleNamespace(backend_public_base_url="http://public.example"),
        )
        monkeypatch.setattr(
            "backend.app.realtime_gateway.finalize_voice_wait_state",
            _fake_finalize,
        )
        monkeypatch.setattr(
            "backend.app.realtime_runner.close_voice_session",
            _fake_close_voice_session,
        )

        await gateway.handle_message(
            connection,
            {"type": "finalize", "session_id": handle.session_id},
        )

        assert captured_finalize["thread_id"] == "thread-1"
        assert captured_finalize["transcripts"] == state.transcripts_value
        assert captured_finalize["closed_session"] == handle.session_id
        assert state.shutdown_called is True
        assert handle.session_id not in gateway._sessions  # type: ignore[attr-defined]

        assert any(msg.get("type") == "session_finalized" for msg in messages)

    asyncio.run(_run())


def test_handle_unknown_session_returns_error() -> None:
    async def _run() -> None:
        gateway = RealtimeSessionGateway()
        messages: list[dict[str, object]] = []
        connection = GatewayConnection(
            websocket=_StubWebSocket(messages),
            user=GatewayUser(id="user-1", email=None),
            authorization="Bearer token",
        )

        await gateway.handle_message(
            connection,
            {
                "type": "input_audio",
                "session_id": "missing",
                "data": base64.b64encode(b"pcm").decode("ascii"),
            },
        )

        assert messages
        assert messages[0]["type"] == "error"

    asyncio.run(_run())

