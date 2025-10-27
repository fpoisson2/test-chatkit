from __future__ import annotations

import asyncio
import importlib.util
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

from app import tool_factory as tool_factory_module  # noqa: E402
from app.chatkit import agent_registry  # noqa: E402
from app.mcp import connection as mcp_connection  # noqa: E402

FASTAPI_AVAILABLE = importlib.util.find_spec("fastapi") is not None
if FASTAPI_AVAILABLE:  # pragma: no branch - dépendances optionnelles
    from app.routes import tools as tools_routes  # noqa: E402
    from fastapi import FastAPI  # noqa: E402
    from fastapi.testclient import TestClient  # noqa: E402
else:  # pragma: no cover - environnement réduit
    FastAPI = None  # type: ignore[assignment]
    TestClient = None  # type: ignore[assignment]
    tools_routes = None  # type: ignore[assignment]


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

    monkeypatch.setattr(tool_factory_module, "MCPServerSse", _StubServer)

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

    server = tool_factory_module.build_mcp_tool(payload)

    assert isinstance(server, _StubServer)
    params = created["params"]
    assert params["url"] == "https://example.com/mcp"
    assert params["headers"]["Authorization"] == "Bearer token"
    assert params["timeout"] == 12
    assert params["sse_read_timeout"] == 34
    assert created["cache_tools_list"] is True
    assert created["name"] == "Example"
    assert created["client_session_timeout_seconds"] == 5


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
