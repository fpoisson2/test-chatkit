from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Callable, Mapping, Sequence
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from agents.realtime.agent import RealtimeAgent
from agents.tool import FunctionTool

os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("DATABASE_URL", "sqlite:///./chatkit-tests.db")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

realtime_runner = import_module("backend.app.realtime_runner")
config_module = import_module("backend.app.config")
ModelProviderConfig = config_module.ModelProviderConfig


class _DummyResponse:
    def __init__(self, payload: dict[str, object], status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict[str, object]:
        return self._payload


class _DummyAsyncClient:
    def __init__(
        self,
        *,
        captured: dict[str, object],
        response_factory: ResponseFactory | None = None,
        **_: object,
    ) -> None:
        self._captured = captured
        self._response_factory = response_factory
        self._call_count = 0

    async def __aenter__(self) -> _DummyAsyncClient:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001
        return False

    async def post(self, url: str, json: object, headers: dict[str, str]):
        request_data = {"url": url, "json": json, "headers": headers}
        self._captured.setdefault("requests", []).append(request_data)
        self._call_count += 1
        if self._response_factory is not None:
            return self._response_factory(request_data, self._call_count)
        return _DummyResponse({"client_secret": {"value": "secret"}})


ResponseFactory = Callable[[dict[str, object], int], _DummyResponse]


class _FakeSettings:
    model_api_base = "https://api.groq.com/openai/v1"
    model_api_key = "groq-key"
    model_provider = "groq"
    model_providers = (
        ModelProviderConfig(
            provider="groq",
            api_base="https://api.groq.com/openai/v1",
            api_key="groq-key",
            is_default=True,
            id="groq-default",
        ),
    )
    openai_api_key = "openai-key"


def _reset_orchestrator(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        realtime_runner,
        "_ORCHESTRATOR",
        realtime_runner.RealtimeVoiceSessionOrchestrator(),
    )

    async def _noop_connect(configs: Sequence[Mapping[str, object]]) -> list[object]:
        return []

    async def _noop_cleanup(servers: Sequence[object]) -> None:
        return None

    monkeypatch.setattr(
        realtime_runner,
        "_connect_mcp_servers",
        _noop_connect,
    )
    monkeypatch.setattr(
        realtime_runner,
        "_cleanup_mcp_servers",
        _noop_cleanup,
    )


def test_connect_mcp_servers_wraps_http_status_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = httpx.Request("GET", "https://mcp.example.com/sse")
    response = httpx.Response(status_code=401, request=request)
    http_error = httpx.HTTPStatusError(
        "401 Unauthorized",
        request=request,
        response=response,
    )

    class _FailingServer:
        async def connect(self) -> None:  # noqa: D401 - simple stub
            raise http_error

    cleanup_calls: list[list[object]] = []

    monkeypatch.setattr(
        realtime_runner,
        "_create_mcp_server_from_config",
        lambda config: _FailingServer(),
    )

    async def _record_cleanup(servers: Sequence[object]) -> None:
        cleanup_calls.append(list(servers))

    monkeypatch.setattr(
        realtime_runner,
        "_cleanup_mcp_servers",
        _record_cleanup,
    )

    config = {"server_url": str(request.url), "server_label": "mcp"}

    with pytest.raises(realtime_runner.HTTPException) as excinfo:
        asyncio.run(realtime_runner._connect_mcp_servers([config]))

    assert excinfo.value.status_code == 502
    detail = excinfo.value.detail
    assert isinstance(detail, dict)
    assert detail.get("server_url") == str(request.url)
    assert detail.get("status_code") == 401
    assert cleanup_calls == [[]]


def test_connect_mcp_servers_wraps_generic_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _BoomingServer:
        async def connect(self) -> None:
            raise RuntimeError("boom")

    cleanup_calls: list[list[object]] = []

    monkeypatch.setattr(
        realtime_runner,
        "_create_mcp_server_from_config",
        lambda config: _BoomingServer(),
    )

    async def _record_cleanup(servers: Sequence[object]) -> None:
        cleanup_calls.append(list(servers))

    monkeypatch.setattr(
        realtime_runner,
        "_cleanup_mcp_servers",
        _record_cleanup,
    )

    config = {"server_url": "https://mcp.example.com"}

    with pytest.raises(realtime_runner.HTTPException) as excinfo:
        asyncio.run(realtime_runner._connect_mcp_servers([config]))

    assert excinfo.value.status_code == 502
    assert excinfo.value.detail == {"error": "MCP server connection failed"}
    assert cleanup_calls == [[]]


def test_open_voice_session_passes_metadata_to_gateway(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _reset_orchestrator(monkeypatch)

    async def _fake_request_client_secret(self, **kwargs: object) -> dict[str, object]:
        return {"client_secret": {"value": "secret"}}

    monkeypatch.setattr(
        realtime_runner.RealtimeVoiceSessionOrchestrator,
        "_request_client_secret",
        _fake_request_client_secret,
    )

    gateway_module = import_module("backend.app.realtime_gateway")

    class _StubGateway:
        def __init__(self) -> None:
            self.handles: list[realtime_runner.VoiceSessionHandle] = []

        async def register_session(
            self, handle: realtime_runner.VoiceSessionHandle
        ) -> None:
            self.handles.append(handle)

    stub_gateway = _StubGateway()

    monkeypatch.setattr(
        gateway_module,
        "get_realtime_gateway",
        lambda: stub_gateway,
    )

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-meta",
            model="gpt-realtime",
            instructions="Salut",
            metadata={
                "thread_id": "thr-test",
                "step_slug": "voice",
                "step_title": "Voice",
            },
        )
    )

    assert stub_gateway.handles, "register_session should be invoked"
    registered = stub_gateway.handles[0]
    assert registered.metadata.get("thread_id") == "thr-test"
    assert registered.metadata.get("step_slug") == "voice"
    assert handle.metadata.get("thread_id") == "thr-test"


def test_open_voice_session_prefers_openai_slug(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)
    monkeypatch.setattr(realtime_runner, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        realtime_runner,
        "resolve_model_provider_credentials",
        lambda provider_id: None,
    )
    monkeypatch.setattr(
        realtime_runner.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(captured=captured, **kwargs),
    )

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-1",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_slug="openai",
            voice="verse",
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    assert isinstance(handle.session_id, str) and handle.session_id
    requests = captured.get("requests")
    assert isinstance(requests, list)
    assert len(requests) == 1
    request = requests[0]
    assert request["url"] == "https://api.openai.com/v1/realtime/client_secrets"
    payload = request["json"]
    assert isinstance(payload, dict)
    assert "voice" not in payload
    session_payload = payload.get("session")
    assert isinstance(session_payload, dict)
    audio_payload = session_payload.get("audio")
    assert isinstance(audio_payload, dict)
    output_payload = audio_payload.get("output")
    assert isinstance(output_payload, dict)
    assert output_payload.get("voice") == "verse"
    headers = request["headers"]
    assert isinstance(headers, dict)
    assert headers.get("Authorization") == "Bearer openai-key"


def test_open_voice_session_uses_provider_id_when_slug_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)
    monkeypatch.setattr(realtime_runner, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        realtime_runner,
        "resolve_model_provider_credentials",
        lambda provider_id: None,
    )
    monkeypatch.setattr(
        realtime_runner.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(captured=captured, **kwargs),
    )

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-provider-id",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_id="OpenAI",
            voice="verse",
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    requests = captured.get("requests")
    assert isinstance(requests, list)
    assert len(requests) == 1
    request = requests[0]
    assert request["url"] == "https://api.openai.com/v1/realtime/client_secrets"
    headers = request["headers"]
    assert isinstance(headers, dict)
    assert headers.get("Authorization") == "Bearer openai-key"


def test_open_voice_session_normalizes_mcp_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)
    monkeypatch.setattr(realtime_runner, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        realtime_runner,
        "resolve_model_provider_credentials",
        lambda provider_id: None,
    )
    monkeypatch.setattr(
        realtime_runner.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(captured=captured, **kwargs),
    )

    tools_payload = [
        {
            "type": "mcp",
            "url": "https://example.com/mcp",
            "transport": "http_sse",
            "agent": {"type": "workflow", "workflow": {"slug": "sub-agent"}},
            "metadata": {"foo": "bar"},
        }
    ]

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-tools",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_slug="openai",
            tools=tools_payload,
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    requests = captured.get("requests")
    assert isinstance(requests, list)
    assert len(requests) == 1

    payload = requests[0]["json"]
    assert isinstance(payload, dict)
    session_payload = payload.get("session")
    assert isinstance(session_payload, dict)

    session_tools = session_payload.get("tools")
    assert isinstance(session_tools, list) and session_tools
    tool_config = session_tools[0]
    assert tool_config.get("type") == "mcp"
    assert tool_config.get("server_url") == "https://example.com/mcp"
    assert "url" not in tool_config
    assert tool_config.get("server_label") == "example-com-mcp"
    assert "agent" not in tool_config
    assert "metadata" not in tool_config


def test_open_voice_session_connects_mcp_servers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)

    class _StubRunner:
        def __init__(self, agent: RealtimeAgent) -> None:
            self.agent = agent

    monkeypatch.setattr(realtime_runner, "RealtimeRunner", _StubRunner)

    async def _fake_request_client_secret(self, **kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"client_secret": {"value": "secret"}}

    monkeypatch.setattr(
        realtime_runner.RealtimeVoiceSessionOrchestrator,
        "_request_client_secret",
        _fake_request_client_secret,
    )

    gateway_module = import_module("backend.app.realtime_gateway")
    monkeypatch.setattr(gateway_module, "get_realtime_gateway", lambda: None)

    class _StubServer:
        def __init__(self) -> None:
            self.cleaned = False

    stub_server = _StubServer()

    recorded_configs: list[list[Mapping[str, object]]] = []

    async def _fake_connect(configs: Sequence[Mapping[str, object]]):
        recorded_configs.append(list(configs))
        return [stub_server]

    cleaned_servers: list[object] = []

    async def _fake_cleanup(servers: Sequence[object]) -> None:
        cleaned_servers.extend(servers)
        for server in servers:
            if hasattr(server, "cleaned"):
                server.cleaned = True  # type: ignore[attr-defined]

    monkeypatch.setattr(realtime_runner, "_connect_mcp_servers", _fake_connect)
    monkeypatch.setattr(realtime_runner, "_cleanup_mcp_servers", _fake_cleanup)

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-mcp",
            model="gpt-realtime",
            instructions="Salut",
            provider_slug="openai",
            tools=[
                {
                    "type": "mcp",
                    "url": "https://example.com/mcp",
                    "authorization": "Bearer token",
                    "transport": "http_sse",
                }
            ],
        )
    )

    assert handle.mcp_servers == [stub_server]
    assert recorded_configs, "_connect_mcp_servers should receive config"
    config_entry = recorded_configs[0][0]
    assert config_entry.get("server_url") == "https://example.com/mcp"
    assert config_entry.get("authorization") == "Bearer token"
    assert captured.get("tools")
    metadata = handle.metadata.get("mcp_servers")
    assert isinstance(metadata, list) and metadata
    assert metadata[0]["server_url"] == "https://example.com/mcp"
    assert not cleaned_servers, "cleanup should not run during open"


def test_create_mcp_server_from_config_adds_bearer_prefix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class _StubServer:
        def __init__(self, *, params: Mapping[str, Any], name: str | None = None):
            captured["params"] = dict(params)
            captured["name"] = name

    monkeypatch.setattr(realtime_runner, "MCPServerSse", _StubServer)

    config = {
        "server_url": "https://example.com/mcp",
        "transport": "http_sse",
        "authorization": "token-value",
        "server_label": "example",
    }

    server = realtime_runner._create_mcp_server_from_config(config)

    assert isinstance(server, _StubServer)
    params = captured.get("params")
    assert isinstance(params, dict)
    headers = params.get("headers")
    assert isinstance(headers, dict)
    assert headers.get("Authorization") == "Bearer token-value"


def test_normalize_bearer_authorization_handles_existing_prefix() -> None:
    assert (
        realtime_runner._normalize_bearer_authorization("Bearer existing")
        == "Bearer existing"
    )
    assert (
        realtime_runner._normalize_bearer_authorization("bearer Existing")
        == "Bearer Existing"
    )
    assert (
        realtime_runner._normalize_bearer_authorization("  token  ")
        == "Bearer token"
    )
    assert realtime_runner._normalize_bearer_authorization("  ") is None
    assert realtime_runner._normalize_bearer_authorization("Bearer  ") is None


def test_open_voice_session_normalizes_function_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)
    monkeypatch.setattr(realtime_runner, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        realtime_runner,
        "resolve_model_provider_credentials",
        lambda provider_id: None,
    )
    monkeypatch.setattr(
        realtime_runner.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(captured=captured, **kwargs),
    )

    tools_payload = [
        {
            "type": "function",
            "function": {
                "name": "calculate",
                "description": "Calcule une valeur",
                "parameters": {"type": "object", "properties": {}},
                "strict": True,
                "cache_control": {"ttl": 30},
            },
            "metadata": {"scope": "test"},
        }
    ]

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-function",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_slug="openai",
            tools=tools_payload,
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    requests = captured.get("requests")
    assert isinstance(requests, list)
    assert len(requests) == 1

    payload = requests[0]["json"]
    assert isinstance(payload, dict)
    session_payload = payload.get("session")
    assert isinstance(session_payload, dict)

    session_tools = session_payload.get("tools")
    assert isinstance(session_tools, list) and session_tools
    tool_config = session_tools[0]
    assert tool_config.get("type") == "function"
    assert tool_config.get("name") == "calculate"
    assert tool_config.get("description") == "Calcule une valeur"
    assert tool_config.get("parameters") == {"type": "object", "properties": {}}
    assert tool_config.get("strict") is True
    assert tool_config.get("cache_control") == {"ttl": 30}
    assert "function" not in tool_config
    assert "metadata" not in tool_config


def test_open_voice_session_filters_non_sdk_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)

    _reset_orchestrator(monkeypatch)

    clone_calls: list[dict[str, object]] = []
    original_clone = RealtimeAgent.clone

    def _recording_clone(self, **kwargs: object) -> RealtimeAgent:
        clone_calls.append(dict(kwargs))
        return original_clone(self, **kwargs)

    monkeypatch.setattr(RealtimeAgent, "clone", _recording_clone)

    async def _fake_request_client_secret(self, **_: object) -> dict[str, object]:
        return {"client_secret": {"value": "secret"}}

    monkeypatch.setattr(
        realtime_runner.RealtimeVoiceSessionOrchestrator,
        "_request_client_secret",
        _fake_request_client_secret,
    )

    class _StubRunner:
        def __init__(self, agent: RealtimeAgent) -> None:
            self.agent = agent

    monkeypatch.setattr(realtime_runner, "RealtimeRunner", _StubRunner)

    child_agent = RealtimeAgent(name="child", instructions="Bonjour")

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-tools",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_slug="openai",
            tools=[{"type": "mcp", "url": "https://example.com"}],
            handoffs=[child_agent, {"type": "workflow"}],
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    assert clone_calls, "clone should be invoked"
    clone_kwargs = clone_calls[0]
    assert clone_kwargs.get("tools") == []
    assert clone_kwargs.get("handoffs") == [child_agent]
    metadata_tools = handle.metadata.get("tools")
    assert isinstance(metadata_tools, list)
    assert metadata_tools and isinstance(metadata_tools[0], Mapping)
    assert handle.metadata.get("sdk_tools") in (None, [])


def test_open_voice_session_stores_sdk_tools_separately(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)

    _reset_orchestrator(monkeypatch)

    captured_request: dict[str, object] = {}

    async def _fake_request_client_secret(self, **kwargs: object) -> dict[str, object]:
        captured_request.update(kwargs)
        return {"client_secret": {"value": "secret"}}

    monkeypatch.setattr(
        realtime_runner.RealtimeVoiceSessionOrchestrator,
        "_request_client_secret",
        _fake_request_client_secret,
    )

    class _StubRunner:
        def __init__(self, agent: RealtimeAgent) -> None:
            self.agent = agent

    monkeypatch.setattr(realtime_runner, "RealtimeRunner", _StubRunner)

    async def _invoke_tool(context, arguments):  # type: ignore[no-untyped-def]
        return "ok"

    function_tool = FunctionTool(
        name="calc",
        description="Calculator",
        params_json_schema={"type": "object", "properties": {}},
        on_invoke_tool=_invoke_tool,
    )

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-tools",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_slug="openai",
            tools=[
                function_tool,
                {"type": "mcp", "url": "https://example.com/mcp"},
            ],
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}

    sanitized_tools = captured_request.get("tools")
    assert isinstance(sanitized_tools, list)
    assert all(isinstance(entry, Mapping) for entry in sanitized_tools)

    metadata_tools = handle.metadata.get("tools")
    assert isinstance(metadata_tools, list)
    assert all(isinstance(entry, Mapping) for entry in metadata_tools)

    sdk_tools = handle.metadata.get("sdk_tools")
    assert sdk_tools == [function_tool]


def test_close_voice_session_cleans_up_mcp_servers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)

    _reset_orchestrator(monkeypatch)

    class _StubRunner:
        def __init__(self, agent: RealtimeAgent) -> None:
            self.agent = agent

    monkeypatch.setattr(realtime_runner, "RealtimeRunner", _StubRunner)

    async def _fake_request_client_secret(self, **kwargs: object) -> dict[str, object]:
        return {"client_secret": {"value": "secret"}}

    monkeypatch.setattr(
        realtime_runner.RealtimeVoiceSessionOrchestrator,
        "_request_client_secret",
        _fake_request_client_secret,
    )

    gateway_module = import_module("backend.app.realtime_gateway")
    monkeypatch.setattr(gateway_module, "get_realtime_gateway", lambda: None)

    class _StubServer:
        def __init__(self) -> None:
            self.cleaned = False

    stub_server = _StubServer()

    async def _fake_connect(configs: Sequence[Mapping[str, object]]):
        return [stub_server]

    cleaned: list[object] = []

    async def _fake_cleanup(servers: Sequence[object]) -> None:
        cleaned.extend(servers)
        for server in servers:
            if hasattr(server, "cleaned"):
                server.cleaned = True  # type: ignore[attr-defined]

    monkeypatch.setattr(realtime_runner, "_connect_mcp_servers", _fake_connect)
    monkeypatch.setattr(realtime_runner, "_cleanup_mcp_servers", _fake_cleanup)

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-mcp",
            model="gpt-realtime",
            instructions="Salut",
            provider_slug="openai",
            tools=[{"type": "mcp", "url": "https://example.com/mcp"}],
        )
    )

    assert handle.mcp_servers == [stub_server]
    assert not stub_server.cleaned

    closed = asyncio.run(
        realtime_runner.close_voice_session(session_id=handle.session_id)
    )

    assert closed is True
    assert cleaned == [stub_server]
    assert stub_server.cleaned is True


def test_openai_slug_ignores_mismatched_provider_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)
    monkeypatch.setattr(realtime_runner, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        realtime_runner,
        "resolve_model_provider_credentials",
        lambda provider_id: SimpleNamespace(
            id=provider_id,
            provider="groq",
            api_base="https://api.groq.com/openai/v1",
            api_key="groq-alt",
        ),
    )
    monkeypatch.setattr(
        realtime_runner.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(captured=captured, **kwargs),
    )

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-1",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_id="groq-default",
            provider_slug="openai",
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    requests = captured.get("requests")
    assert isinstance(requests, list)
    assert len(requests) == 1
    request = requests[0]
    assert request["url"] == "https://api.openai.com/v1/realtime/client_secrets"
    headers = request["headers"]
    assert isinstance(headers, dict)
    assert headers.get("Authorization") == "Bearer openai-key"


def test_voice_parameter_retries_without_voice(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)
    monkeypatch.setattr(realtime_runner, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        realtime_runner,
        "resolve_model_provider_credentials",
        lambda provider_id: None,
    )

    def _response_factory(
        request: dict[str, object], call_count: int
    ) -> _DummyResponse:
        if call_count == 1:
            return _DummyResponse(
                {
                    "error": {
                        "message": "Unknown parameter: 'audio.output.voice'.",
                        "type": "invalid_request_error",
                        "param": "audio.output.voice",
                        "code": "unknown_parameter",
                    }
                },
                status_code=400,
            )
        return _DummyResponse({"client_secret": {"value": "secret"}})

    monkeypatch.setattr(
        realtime_runner.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(
            captured=captured, response_factory=_response_factory, **kwargs
        ),
    )

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-voice",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_slug="openai",
            voice="alloy",
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    requests = captured.get("requests")
    assert isinstance(requests, list)
    assert len(requests) == 2

    first_request = requests[0]
    assert first_request["url"] == "https://api.openai.com/v1/realtime/client_secrets"
    first_payload = first_request["json"]
    assert isinstance(first_payload, dict)
    assert "voice" not in first_payload
    session_payload = first_payload.get("session")
    assert isinstance(session_payload, dict)
    audio_payload = session_payload.get("audio")
    assert isinstance(audio_payload, dict)
    output_payload = audio_payload.get("output")
    assert isinstance(output_payload, dict)
    assert output_payload.get("voice") == "alloy"

    second_request = requests[1]
    assert second_request["url"] == "https://api.openai.com/v1/realtime/client_secrets"
    second_payload = second_request["json"]
    assert isinstance(second_payload, dict)
    assert "voice" not in second_payload
    second_session = second_payload.get("session")
    assert isinstance(second_session, dict)
    second_audio = second_session.get("audio")
    if isinstance(second_audio, dict):
        assert "voice" not in (second_audio.get("output") or {})


def test_realtime_audio_configuration_embedded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)
    monkeypatch.setattr(realtime_runner, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        realtime_runner,
        "resolve_model_provider_credentials",
        lambda provider_id: None,
    )
    monkeypatch.setattr(
        realtime_runner.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(captured=captured, **kwargs),
    )

    realtime_config = {
        "input_audio_format": {"type": "audio/pcm", "rate": 24_000},
        "output_audio_format": {"type": "audio/pcm", "rate": 24_000},
        "turn_detection": {"type": "server_vad"},
        "speed": 1.0,
        "modalities": ["audio"],
    }

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-realtime",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_slug="openai",
            realtime=realtime_config,
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    requests = captured.get("requests")
    assert isinstance(requests, list)
    assert len(requests) == 1
    first_request = requests[0]
    payload = first_request["json"]
    assert isinstance(payload, dict)
    assert "realtime" not in payload
    session_payload = payload.get("session")
    assert isinstance(session_payload, dict)
    assert session_payload.get("output_modalities") == ["audio"]
    assert "modalities" not in session_payload
    audio_payload = session_payload.get("audio")
    assert isinstance(audio_payload, dict)
    input_payload = audio_payload.get("input")
    assert isinstance(input_payload, dict)
    assert input_payload.get("format") == {"type": "audio/pcm", "rate": 24_000}
    assert input_payload.get("turn_detection") == {"type": "server_vad"}
    output_payload = audio_payload.get("output")
    assert isinstance(output_payload, dict)
    assert output_payload.get("format") == {"type": "audio/pcm", "rate": 24_000}
    assert output_payload.get("speed") == 1.0


def test_realtime_audio_configuration_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)
    monkeypatch.setattr(realtime_runner, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        realtime_runner,
        "resolve_model_provider_credentials",
        lambda provider_id: None,
    )

    def _response_factory(
        request: dict[str, object], call_count: int
    ) -> _DummyResponse:
        if call_count == 1:
            return _DummyResponse(
                {
                    "error": {
                        "message": "Unknown parameter: 'audio.input.turn_detection'.",
                        "type": "invalid_request_error",
                        "param": "audio.input.turn_detection",
                        "code": "unknown_parameter",
                    }
                },
                status_code=400,
            )
        return _DummyResponse({"client_secret": {"value": "secret"}})

    monkeypatch.setattr(
        realtime_runner.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(
            captured=captured, response_factory=_response_factory, **kwargs
        ),
    )

    realtime_config = {
        "input_audio_format": {"type": "audio/pcm", "rate": 16_000},
        "turn_detection": {"type": "server_vad", "threshold": 0.5},
    }

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-realtime",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_slug="openai",
            realtime=realtime_config,
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    requests = captured.get("requests")
    assert isinstance(requests, list)
    assert len(requests) == 2

    first_payload = requests[0]["json"]
    assert isinstance(first_payload, dict)
    assert "realtime" not in first_payload
    first_session_payload = first_payload.get("session")
    assert isinstance(first_session_payload, dict)
    first_audio = first_session_payload.get("audio")
    assert isinstance(first_audio, dict)
    first_input = first_audio.get("input")
    assert isinstance(first_input, dict)
    assert first_input.get("turn_detection") == {
        "type": "server_vad",
        "threshold": 0.5,
    }

    second_payload = requests[1]["json"]
    assert isinstance(second_payload, dict)
    assert "realtime" not in second_payload
    second_session_payload = second_payload.get("session")
    assert isinstance(second_session_payload, dict)
    second_audio = second_session_payload.get("audio")
    if isinstance(second_audio, dict):
        assert "turn_detection" not in (second_audio.get("input") or {})


def test_realtime_audio_configuration_eventually_removed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)
    monkeypatch.setattr(realtime_runner, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        realtime_runner,
        "resolve_model_provider_credentials",
        lambda provider_id: None,
    )

    def _response_factory(
        request: dict[str, object], call_count: int
    ) -> _DummyResponse:
        if call_count == 1:
            return _DummyResponse(
                {
                    "error": {
                        "message": "Unknown parameter: 'audio.input.turn_detection'.",
                        "type": "invalid_request_error",
                        "param": "audio.input.turn_detection",
                        "code": "unknown_parameter",
                    }
                },
                status_code=400,
            )
        return _DummyResponse({"client_secret": {"value": "secret"}})

    monkeypatch.setattr(
        realtime_runner.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(
            captured=captured, response_factory=_response_factory, **kwargs
        ),
    )

    realtime_config = {
        "input_audio_format": {"type": "audio/pcm", "rate": 16_000},
        "turn_detection": {"type": "server_vad"},
    }

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-realtime",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_slug="openai",
            realtime=realtime_config,
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    requests = captured.get("requests")
    assert isinstance(requests, list)
    assert len(requests) == 2

    first_payload = requests[0]["json"]
    assert isinstance(first_payload, dict)
    first_audio = first_payload["session"]["audio"]
    assert first_audio["input"].get("turn_detection") == {"type": "server_vad"}

    second_payload = requests[1]["json"]
    assert isinstance(second_payload, dict)
    second_audio = second_payload["session"].get("audio")
    if isinstance(second_audio, dict):
        assert "turn_detection" not in (second_audio.get("input") or {})
