import asyncio
import os
import sys
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("DATABASE_URL", "sqlite:///./test-mcp-connection.db")

from agents.mcp.server import MCPServer
from backend.app.mcp.connection import MCPConnectionStatus, probe_mcp_connection
from backend.app.routes import tools as tools_routes


class _StubServer(MCPServer):
    def __init__(self, *, name: str = "stub") -> None:
        super().__init__(use_structured_content=False)
        self._name = name
        self.connected = False
        self.cleaned = False
        self.should_timeout = False

    @property
    def name(self) -> str:  # type: ignore[override]
        return self._name

    async def connect(self) -> None:
        if self.should_timeout:
            await asyncio.sleep(0.05)
        self.connected = True

    async def list_tools(self) -> list[str]:
        if self.should_timeout:
            await asyncio.sleep(0.05)
        return ["one", "two"]

    async def cleanup(self) -> None:
        self.cleaned = True

    async def call_tool(  # type: ignore[override]
        self, tool_name: str, arguments: dict[str, Any] | None
    ) -> Any:
        raise NotImplementedError

    async def get_prompt(  # type: ignore[override]
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> Any:
        raise NotImplementedError

    async def list_prompts(self) -> Any:  # type: ignore[override]
        return []


def test_probe_mcp_connection_http_success(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        server = _StubServer(name="remote")

        def _stub_build_mcp_tool(payload: Any, *, raise_on_error: bool = False) -> Any:
            return server

        monkeypatch.setattr(
            "backend.app.mcp.connection.build_mcp_tool", _stub_build_mcp_tool
        )

        result = await probe_mcp_connection({"type": "mcp", "mcp": {"kind": "http"}})

        assert result.ok is True
        assert "remote" in result.message
        assert "2" in result.message
        assert server.connected is True
        assert server.cleaned is True

    asyncio.run(_run())


def test_probe_mcp_connection_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        server = _StubServer()
        server.should_timeout = True

        monkeypatch.setattr(
            "backend.app.mcp.connection.build_mcp_tool", lambda *args, **kwargs: server
        )

        result = await probe_mcp_connection(
            {"type": "mcp", "mcp": {"kind": "http"}}, timeout=0.001
        )

        assert result.ok is False
        assert "expiré" in result.message

    asyncio.run(_run())


def test_probe_mcp_connection_hosted_unauthorized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _StubAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self) -> "_StubAsyncClient":
            return self

        async def __aexit__(self, exc_type, exc, tb) -> None:
            return None

        async def post(
            self, url: str, *, json: Any, headers: dict[str, str]
        ) -> httpx.Response:
            response = httpx.Response(401, request=httpx.Request("POST", url))
            raise httpx.HTTPStatusError(
                "unauthorized",
                request=response.request,
                response=response,
            )

    async def _run() -> None:
        monkeypatch.setattr(
            "backend.app.mcp.connection.httpx.AsyncClient", _StubAsyncClient
        )

        result = await probe_mcp_connection(
            {
                "type": "mcp",
                "mcp": {
                    "kind": "hosted",
                    "server_label": "Docs",
                    "server_url": "https://example.invalid/mcp",
                },
            }
        )

        assert result.ok is False
        assert "refusé" in result.message

    asyncio.run(_run())


def test_mcp_connection_route_returns_status(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_probe(
        config: Any, *, timeout: float | None = None
    ) -> MCPConnectionStatus:
        assert config.get("type") == "mcp"
        return MCPConnectionStatus(ok=True, message="ok")

    monkeypatch.setattr(tools_routes, "probe_mcp_connection", _fake_probe)

    app = FastAPI()
    app.include_router(tools_routes.router)

    client = TestClient(app)
    response = client.post(
        "/api/tools/mcp/test-connection",
        json={"type": "mcp", "mcp": {"kind": "http", "url": "https://remote"}},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "message": "ok"}
