from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

from app import realtime_runner as realtime_runner_module  # noqa: E402
from app.chatkit import agent_registry  # noqa: E402
from app.database import SessionLocal, engine  # noqa: E402
from app.mcp import connection as mcp_connection  # noqa: E402
from app.mcp import oauth as oauth_module  # noqa: E402
from app.models import Base, McpServer  # noqa: E402
from app.secret_utils import encrypt_secret  # noqa: E402
from app.tool_builders import mcp as mcp_module  # noqa: E402

FASTAPI_AVAILABLE = importlib.util.find_spec("fastapi") is not None
if FASTAPI_AVAILABLE:  # pragma: no branch - dépendances optionnelles
    from app.routes import tools as tools_routes  # noqa: E402
    from fastapi import FastAPI  # noqa: E402
    from fastapi.testclient import TestClient  # noqa: E402
else:  # pragma: no cover - environnement réduit
    FastAPI = None  # type: ignore[assignment]
    TestClient = None  # type: ignore[assignment]
    tools_routes = None  # type: ignore[assignment]


@pytest.fixture(scope="module", autouse=True)
def _setup_mcp_tables() -> None:
    Base.metadata.create_all(engine)
    yield


def test_build_mcp_tool_constructs_server(monkeypatch: pytest.MonkeyPatch) -> None:
    created: dict[str, Any] = {}

    class _StubServer:
        def __init__(
            self,
            *,
            params: dict[str, Any],
            cache_tools_list: bool,
            name: str | None = None,
            client_session_timeout_seconds: float | None = None,
        ) -> None:
            created["params"] = params
            created["cache_tools_list"] = cache_tools_list
            created["name"] = name
            created["client_session_timeout_seconds"] = client_session_timeout_seconds

    monkeypatch.setattr(mcp_module, "MCPServerSse", _StubServer)

    payload = {
        "type": "mcp",
        "transport": "http_sse",
        "url": "https://example.com/mcp",
        "authorization": "Bearer token",
        "timeout": 12,
        "sse_read_timeout": 34,
        "client_session_timeout_seconds": 5,
        "name": "Example",
    }

    server = mcp_module.build_mcp_tool(payload)

    assert isinstance(server, _StubServer)
    params = created["params"]
    assert params["url"] == "https://example.com/mcp"
    headers = params["headers"]
    assert headers["Authorization"] == "Bearer token"
    assert headers["Accept"] == "text/event-stream"
    assert headers["Cache-Control"] == "no-cache"
    assert params["timeout"] == 12
    assert params["sse_read_timeout"] == 34
    assert created["cache_tools_list"] is True
    assert created["name"] == "Example"
    assert created["client_session_timeout_seconds"] == 5


def test_build_mcp_tool_adds_bearer_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class _StubServer:
        def __init__(self, *, params: dict[str, Any], cache_tools_list: bool) -> None:
            captured["params"] = params
            captured["cache_tools_list"] = cache_tools_list

    monkeypatch.setattr(mcp_module, "MCPServerSse", _StubServer)

    payload = {
        "type": "mcp",
        "transport": "http_sse",
        "url": "https://ha.ve2fpd.com/mcp_server/sse",
        "authorization": "token-value",
    }

    server = mcp_module.build_mcp_tool(payload)

    assert isinstance(server, _StubServer)
    params = captured["params"]
    headers = params["headers"]
    assert headers["Authorization"] == "Bearer token-value"
    assert headers["Accept"] == "text/event-stream"
    assert headers["Cache-Control"] == "no-cache"


def test_build_mcp_tool_supports_legacy_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    class _StubServer:
        def __init__(self, *, params: dict[str, Any], cache_tools_list: bool) -> None:
            captured["params"] = params
            captured["cache_tools_list"] = cache_tools_list

    monkeypatch.setattr(mcp_module, "MCPServerSse", _StubServer)

    payload = {
        "type": "mcp",
        "kind": "sse",
        "server_url": "https://legacy.example/mcp",
        "authorization": "legacy-token",
    }

    server = mcp_module.build_mcp_tool(payload)

    assert isinstance(server, _StubServer)
    params = captured["params"]
    assert params["url"] == "https://legacy.example/mcp"
    headers = params["headers"]
    assert headers["Authorization"] == "Bearer legacy-token"
    assert headers["Accept"] == "text/event-stream"
    assert headers["Cache-Control"] == "no-cache"


def test_build_mcp_tool_rejects_empty_bearer(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FailingServer:
        def __init__(self, **_kwargs: Any) -> None:  # pragma: no cover - garde-fou
            raise AssertionError("MCPServerSse ne doit pas être instancié")

    monkeypatch.setattr(mcp_module, "MCPServerSse", _FailingServer)

    payload = {
        "type": "mcp",
        "transport": "http_sse",
        "url": "https://ha.ve2fpd.com/mcp_server/sse",
        "authorization": "Bearer   ",
    }

    with pytest.raises(ValueError):
        mcp_module.build_mcp_tool(payload)


def test_build_mcp_tool_supports_server_id(monkeypatch: pytest.MonkeyPatch) -> None:
    with SessionLocal() as session:
        record = McpServer(
            label="Stored",
            server_url="https://stored.example/mcp",
            transport="http_sse",
            is_active=True,
            authorization_encrypted=encrypt_secret("stored-token"),
            tools_cache={"tool_names": ["alpha", "beta"]},
        )
        session.add(record)
        session.commit()
        session.refresh(record)

    created: dict[str, Any] = {}

    class _StubServer:
        def __init__(
            self,
            *,
            params: dict[str, Any],
            cache_tools_list: bool,
            name: str | None = None,
        ) -> None:
            created["params"] = params
            created["cache_tools_list"] = cache_tools_list
            created["name"] = name

    monkeypatch.setattr(mcp_module, "MCPServerSse", _StubServer)

    server = mcp_module.build_mcp_tool({"type": "mcp", "server_id": record.id})

    assert isinstance(server, _StubServer)
    params = created["params"]
    assert params["url"] == "https://stored.example/mcp"
    headers = params.get("headers")
    assert isinstance(headers, dict)
    assert headers.get("Authorization") == "Bearer stored-token"
    assert headers.get("Accept") == "text/event-stream"
    assert headers.get("Cache-Control") == "no-cache"

    context = mcp_module.get_mcp_runtime_context(server)
    assert context is not None
    assert context.server_id == record.id
    assert context.server_url == "https://stored.example/mcp"
    assert context.allowlist == ("alpha", "beta")


def test_coerce_agent_tools_supports_mcp(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fake_builder(config: Any) -> str:
        assert isinstance(config, dict)
        assert config["url"] == "https://mcp.example"
        return "mcp-tool"

    monkeypatch.setattr(agent_registry, "build_mcp_tool", _fake_builder)

    tools = agent_registry._coerce_agent_tools(
        [
            {
                "type": "mcp",
                "transport": "http_sse",
                "url": "https://mcp.example",
            }
        ]
    )

    assert tools == ["mcp-tool"]


def test_coerce_agent_tools_propagates_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise(_config: Any) -> None:
        raise ValueError("invalid mcp config")

    monkeypatch.setattr(agent_registry, "build_mcp_tool", _raise)

    with pytest.raises(ValueError):
        agent_registry._coerce_agent_tools(
            [
                {
                    "type": "mcp",
                    "transport": "http_sse",
                    "url": "https://mcp.example",
                }
            ]
        )


@pytest.fixture(autouse=True)
def _reset_oauth_sessions() -> None:
    oauth_module._sessions.clear()
    yield
    oauth_module._sessions.clear()


class _StubMcpServer(agent_registry.MCPServer):
    def __init__(self, name: str = "stub") -> None:
        super().__init__()
        self._name = name

    @property
    def name(self) -> str:
        return self._name

    async def connect(self) -> None:  # pragma: no cover - interface
        return None

    async def cleanup(self) -> None:  # pragma: no cover - interface
        return None

    async def list_tools(self, run_context=None, agent=None) -> list[Any]:
        return []

    async def call_tool(
        self, tool_name: str, arguments: dict[str, Any] | None
    ) -> Any:
        return None

    async def list_prompts(self) -> list[Any]:
        return []

    async def get_prompt(
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> Any:
        return None


def test_build_agent_kwargs_routes_mcp_servers(monkeypatch: pytest.MonkeyPatch) -> None:
    stub_server = _StubMcpServer()

    monkeypatch.setattr(agent_registry, "build_mcp_tool", lambda *_: stub_server)

    result = agent_registry._build_agent_kwargs(
        {"name": "Base"},
        {
            "tools": [
                {
                    "type": "mcp",
                    "transport": "http_sse",
                    "url": "https://mcp.example",
                }
            ]
        },
    )

    assert result["tools"] == []
    assert result["mcp_servers"] == [stub_server]


def test_build_agent_kwargs_preserves_existing_mcp_servers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    existing = _StubMcpServer(name="existing")
    created: list[_StubMcpServer] = []

    def _builder(_config: Any) -> _StubMcpServer:
        server = _StubMcpServer(name="new")
        created.append(server)
        return server

    monkeypatch.setattr(agent_registry, "build_mcp_tool", _builder)

    result = agent_registry._build_agent_kwargs(
        {"name": "Base", "mcp_servers": [existing]},
        {
            "tools": [
                {
                    "type": "mcp",
                    "transport": "http_sse",
                    "url": "https://mcp.example",
                }
            ]
        },
    )

    assert result["tools"] == []
    assert result["mcp_servers"] == [existing, created[0]]


def test_normalize_realtime_tools_payload_uses_allowlist() -> None:
    with SessionLocal() as session:
        record = McpServer(
            label="Realtime",
            server_url="https://realtime.example/mcp",
            transport="http_sse",
            is_active=True,
            authorization_encrypted=encrypt_secret("runtime-token"),
            tools_cache={"tool_names": ["delta", "gamma"]},
        )
        session.add(record)
        session.commit()
        session.refresh(record)

    mcp_configs: list[dict[str, Any]] = []
    normalized = realtime_runner_module._normalize_realtime_tools_payload(
        [
            {
                "type": "mcp",
                "server_id": record.id,
            }
        ],
        mcp_server_configs=mcp_configs,
    )

    assert normalized is not None and len(normalized) == 1
    entry = normalized[0]
    assert entry.get("server_url") == "https://realtime.example/mcp"
    assert entry.get("authorization") == "Bearer runtime-token"
    assert entry.get("allow") == {"tools": ["delta", "gamma"]}

    assert mcp_configs and len(mcp_configs) == 1
    config_entry = mcp_configs[0]
    assert config_entry.get("server_id") == record.id
    assert config_entry.get("authorization") == "Bearer runtime-token"
    assert config_entry.get("allow") == ["delta", "gamma"]


def test_probe_mcp_connection_success(monkeypatch: pytest.MonkeyPatch) -> None:
    class _StubServer:
        def __init__(self) -> None:
            self.cleaned = False

        async def connect(self) -> None:
            return None

        async def list_tools(self) -> list[Any]:
            return [SimpleNamespace(name="alpha"), SimpleNamespace(name=None)]

        async def cleanup(self) -> None:
            self.cleaned = True

    stub_server = _StubServer()
    monkeypatch.setattr(mcp_connection, "build_mcp_tool", lambda _config: stub_server)

    result = asyncio.run(
        mcp_connection.probe_mcp_connection(
            {"type": "mcp", "transport": "http_sse", "url": "https://example.com"}
        )
    )

    assert result["status"] == "ok"
    assert result["tool_names"] == ["alpha"]
    assert stub_server.cleaned is True


def test_probe_mcp_connection_unauthorized(monkeypatch: pytest.MonkeyPatch) -> None:
    class _StubServer:
        def __init__(self) -> None:
            self.cleaned = False

        async def connect(self) -> None:
            return None

        async def list_tools(self) -> list[Any]:
            request = httpx.Request("GET", "https://example.com/mcp")
            response = httpx.Response(status_code=401, request=request)
            raise httpx.HTTPStatusError(
                "unauthorized",
                request=request,
                response=response,
            )

        async def cleanup(self) -> None:
            self.cleaned = True

    stub_server = _StubServer()
    monkeypatch.setattr(mcp_connection, "build_mcp_tool", lambda _config: stub_server)

    result = asyncio.run(
        mcp_connection.probe_mcp_connection(
            {"type": "mcp", "transport": "http_sse", "url": "https://example.com"}
        )
    )

    assert result["status"] == "unauthorized"
    assert result["status_code"] == 401
    assert stub_server.cleaned is True


@pytest.mark.skipif(not FASTAPI_AVAILABLE, reason="fastapi non disponible")
def test_post_mcp_test_connection(monkeypatch: pytest.MonkeyPatch) -> None:
    assert FastAPI is not None and TestClient is not None and tools_routes is not None

    app = FastAPI()
    app.include_router(tools_routes.router)

    async def _fake_probe(config: dict[str, Any]) -> dict[str, Any]:
        assert config["url"] == "https://example.com/mcp"
        return {"status": "ok", "detail": "ok"}

    monkeypatch.setattr(tools_routes, "probe_mcp_connection", _fake_probe)

    client = TestClient(app)
    response = client.post(
        "/api/tools/mcp/test-connection",
        json={
            "type": "mcp",
            "transport": "http_sse",
            "url": "https://example.com/mcp",
            "authorization": "Bearer token",
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.skipif(not FASTAPI_AVAILABLE, reason="fastapi non disponible")
def test_post_mcp_test_connection_supports_server_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert FastAPI is not None and TestClient is not None and tools_routes is not None

    app = FastAPI()
    app.include_router(tools_routes.router)

    captured: dict[str, Any] = {}

    async def _fake_probe(config: dict[str, Any]) -> dict[str, Any]:
        captured.update(config)
        return {"status": "ok"}

    monkeypatch.setattr(tools_routes, "probe_mcp_connection", _fake_probe)

    client = TestClient(app)
    response = client.post(
        "/api/tools/mcp/test-connection",
        json={
            "type": "mcp",
            "transport": "http_sse",
            "url": "https://example.com/mcp",
            "server_id": 7,
        },
    )

    assert response.status_code == 200
    assert captured["server_id"] == 7


@pytest.mark.skipif(not FASTAPI_AVAILABLE, reason="fastapi non disponible")
def test_post_mcp_test_connection_handles_validation_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert FastAPI is not None and TestClient is not None and tools_routes is not None

    app = FastAPI()
    app.include_router(tools_routes.router)

    async def _fake_probe(_config: dict[str, Any]) -> dict[str, Any]:
        raise ValueError("config invalid")

    monkeypatch.setattr(tools_routes, "probe_mcp_connection", _fake_probe)

    client = TestClient(app)
    response = client.post(
        "/api/tools/mcp/test-connection",
        json={
            "type": "mcp",
            "transport": "http_sse",
            "url": "https://example.com/mcp",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "config invalid"


class _MockAsyncClient:
    def __init__(
        self,
        *,
        discovery: dict[str, Any],
        token: dict[str, Any],
        token_status: int = 200,
    ) -> None:
        self._discovery = discovery
        self._token = token
        self._token_status = token_status
        self._calls: list[tuple[str, dict[str, Any] | None]] = []

    async def __aenter__(self) -> _MockAsyncClient:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:  # type: ignore[override]
        return None

    async def get(self, url: str) -> httpx.Response:
        self._calls.append(("GET", {"url": url}))
        return httpx.Response(
            status_code=200,
            request=httpx.Request("GET", url),
            headers={"Content-Type": "application/json"},
            content=json.dumps(self._discovery).encode("utf-8"),
        )

    async def post(
        self,
        url: str,
        data: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> httpx.Response:
        payload = {"url": url, "data": data, "headers": headers}
        if kwargs:
            payload["extra"] = kwargs
        self._calls.append(("POST", payload))
        return httpx.Response(
            status_code=self._token_status,
            request=httpx.Request("POST", url),
            headers={"Content-Type": "application/json"},
            content=json.dumps(self._token).encode("utf-8"),
        )


@pytest.mark.skipif(not FASTAPI_AVAILABLE, reason="fastapi non disponible")
def test_mcp_oauth_flow_success(monkeypatch: pytest.MonkeyPatch) -> None:
    assert FastAPI is not None and TestClient is not None and tools_routes is not None

    app = FastAPI()
    app.include_router(tools_routes.router)

    discovery = {
        "authorization_endpoint": "https://auth.example/authorize",
        "token_endpoint": "https://auth.example/token",
    }
    token_payload = {"access_token": "abc", "token_type": "Bearer"}

    client_stub = _MockAsyncClient(discovery=discovery, token=token_payload)
    monkeypatch.setattr(
        tools_routes.httpx, "AsyncClient", lambda *args, **kwargs: client_stub
    )

    test_client = TestClient(app)
    start_response = test_client.post(
        "/api/tools/mcp/oauth/start",
        json={
            "url": "https://auth.example",
            "client_id": "client-1",
            "scope": "profile",
        },
    )

    assert start_response.status_code == 200
    start_payload = start_response.json()
    state = start_payload["state"]
    assert start_payload["authorization_url"].startswith("https://auth.example/authorize")
    assert start_payload["redirect_uri"] == "http://testserver/api/tools/mcp/oauth/callback"

    callback_response = test_client.get(
        "/api/tools/mcp/oauth/callback",
        params={"state": state, "code": "auth-code"},
    )

    assert callback_response.status_code == 200
    assert "Authentification terminée" in callback_response.text

    status_response = test_client.get(f"/api/tools/mcp/oauth/session/{state}")
    assert status_response.status_code == 200
    status_payload = status_response.json()
    assert status_payload["status"] == "ok"
    assert status_payload["token"] == token_payload


@pytest.mark.skipif(not FASTAPI_AVAILABLE, reason="fastapi non disponible")
def test_mcp_oauth_flow_uses_client_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    assert FastAPI is not None and TestClient is not None and tools_routes is not None

    oauth_module._sessions.clear()

    with SessionLocal() as session:
        record = McpServer(
            label="OAuth Server",
            server_url="https://auth.example",
            transport="http_sse",
            is_active=True,
            oauth_client_id="stored-client",
            oauth_client_secret_encrypted=encrypt_secret("super-secret"),
            oauth_metadata={
                "token_endpoint_auth_method": "client_secret_basic",
                "token_request_params": {
                    "resource": "https://api.example/resource",
                    "custom_param": "custom-value",
                },
            },
        )
        session.add(record)
        session.commit()
        session.refresh(record)

    app = FastAPI()
    app.include_router(tools_routes.router)

    discovery = {
        "authorization_endpoint": "https://auth.example/authorize",
        "token_endpoint": "https://auth.example/token",
    }
    token_payload = {"access_token": "abc", "token_type": "Bearer"}

    client_stub = _MockAsyncClient(discovery=discovery, token=token_payload)
    monkeypatch.setattr(
        tools_routes.httpx, "AsyncClient", lambda *args, **kwargs: client_stub
    )

    test_client = TestClient(app)
    start_response = test_client.post(
        "/api/tools/mcp/oauth/start",
        json={
            "url": "https://auth.example",
            "client_id": "explicit-client",
            "scope": "profile",
            "server_id": record.id,
        },
    )

    assert start_response.status_code == 200
    start_payload = start_response.json()
    state = start_payload["state"]
    assert start_payload["server_id"] == record.id

    callback_response = test_client.get(
        "/api/tools/mcp/oauth/callback",
        params={"state": state, "code": "auth-code"},
    )

    assert callback_response.status_code == 200
    assert "Authentification terminée" in callback_response.text

    post_calls = [payload for method, payload in client_stub._calls if method == "POST"]
    assert post_calls
    token_call = post_calls[0]
    headers = token_call.get("headers") or {}
    assert headers.get("Authorization", "").startswith("Basic ")
    data = token_call.get("data") or {}
    assert "client_secret" not in data
    assert data.get("resource") == "https://api.example/resource"
    assert data.get("custom_param") == "custom-value"

    status_response = test_client.get(f"/api/tools/mcp/oauth/session/{state}")
    assert status_response.status_code == 200
    status_payload = status_response.json()
    assert status_payload["status"] == "ok"
    assert status_payload["token"] == token_payload


@pytest.mark.skipif(not FASTAPI_AVAILABLE, reason="fastapi non disponible")
def test_mcp_oauth_flow_relative_endpoints(monkeypatch: pytest.MonkeyPatch) -> None:
    assert FastAPI is not None and TestClient is not None and tools_routes is not None

    app = FastAPI()
    app.include_router(tools_routes.router)

    discovery = {
        "issuer": "https://auth.example/base",
        "authorization_endpoint": "/oauth/authorize",
        "token_endpoint": "/oauth/token",
    }
    token_payload = {"access_token": "token", "token_type": "Bearer"}

    client_stub = _MockAsyncClient(discovery=discovery, token=token_payload)
    monkeypatch.setattr(
        tools_routes.httpx, "AsyncClient", lambda *args, **kwargs: client_stub
    )

    test_client = TestClient(app)
    start_response = test_client.post(
        "/api/tools/mcp/oauth/start",
        json={"url": "https://auth.example/base"},
    )

    assert start_response.status_code == 200
    start_payload = start_response.json()
    assert start_payload["authorization_url"].startswith(
        "https://auth.example/oauth/authorize"
    )

    state = start_payload["state"]

    callback_response = test_client.get(
        "/api/tools/mcp/oauth/callback",
        params={"state": state, "code": "auth-code"},
    )

    assert callback_response.status_code == 200
    assert "Authentification terminée" in callback_response.text

    post_calls = [payload for method, payload in client_stub._calls if method == "POST"]
    assert post_calls
    assert post_calls[0]["url"] == "https://auth.example/oauth/token"


@pytest.mark.skipif(not FASTAPI_AVAILABLE, reason="fastapi non disponible")
def test_mcp_oauth_flow_token_error(monkeypatch: pytest.MonkeyPatch) -> None:
    assert FastAPI is not None and TestClient is not None and tools_routes is not None

    app = FastAPI()
    app.include_router(tools_routes.router)

    discovery = {
        "authorization_endpoint": "https://auth.example/authorize",
        "token_endpoint": "https://auth.example/token",
    }
    error_payload = {
        "error": "invalid_client",
        "error_description": "Client non reconnu",
    }

    client_stub = _MockAsyncClient(
        discovery=discovery,
        token=error_payload,
        token_status=400,
    )
    monkeypatch.setattr(
        tools_routes.httpx, "AsyncClient", lambda *args, **kwargs: client_stub
    )

    test_client = TestClient(app)
    start_response = test_client.post(
        "/api/tools/mcp/oauth/start",
        json={"url": "https://auth.example"},
    )

    state = start_response.json()["state"]

    callback_response = test_client.get(
        "/api/tools/mcp/oauth/callback",
        params={"state": state, "code": "auth-code"},
    )

    assert callback_response.status_code == 200
    assert "Échec de l'authentification" in callback_response.text

    status_response = test_client.get(f"/api/tools/mcp/oauth/session/{state}")
    assert status_response.status_code == 200
    status_payload = status_response.json()
    assert status_payload["status"] == "error"
    assert status_payload["error"] == "invalid_client: Client non reconnu"


@pytest.mark.skipif(not FASTAPI_AVAILABLE, reason="fastapi non disponible")
def test_mcp_oauth_flow_error(monkeypatch: pytest.MonkeyPatch) -> None:
    assert FastAPI is not None and TestClient is not None and tools_routes is not None

    app = FastAPI()
    app.include_router(tools_routes.router)

    discovery = {
        "authorization_endpoint": "https://auth.example/authorize",
        "token_endpoint": "https://auth.example/token",
    }
    token_payload = {"access_token": "abc", "token_type": "Bearer"}

    client_stub = _MockAsyncClient(discovery=discovery, token=token_payload)
    monkeypatch.setattr(
        tools_routes.httpx, "AsyncClient", lambda *args, **kwargs: client_stub
    )

    test_client = TestClient(app)
    start_response = test_client.post(
        "/api/tools/mcp/oauth/start",
        json={"url": "https://auth.example"},
    )

    state = start_response.json()["state"]

    callback_response = test_client.get(
        "/api/tools/mcp/oauth/callback",
        params={
            "state": state,
            "error": "access_denied",
            "error_description": "Utilisateur refusé",
        },
    )

    assert callback_response.status_code == 200
    assert "Échec de l'authentification" in callback_response.text

    status_response = test_client.get(f"/api/tools/mcp/oauth/session/{state}")
    assert status_response.status_code == 200
    status_payload = status_response.json()
    assert status_payload["status"] == "error"
    assert status_payload["error"] == "Utilisateur refusé"


@pytest.mark.skipif(not FASTAPI_AVAILABLE, reason="fastapi non disponible")
def test_mcp_oauth_unknown_session() -> None:
    assert FastAPI is not None and TestClient is not None and tools_routes is not None

    app = FastAPI()
    app.include_router(tools_routes.router)

    test_client = TestClient(app)

    response = test_client.get("/api/tools/mcp/oauth/session/does-not-exist")
    assert response.status_code == 404
