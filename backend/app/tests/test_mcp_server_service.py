import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

try:  # pragma: no cover - environnement réduit
    from fastapi import FastAPI, HTTPException, status
    from fastapi.testclient import TestClient
except ModuleNotFoundError:  # pragma: no cover - environnement réduit
    pytest.skip("fastapi non disponible", allow_module_level=True)

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("APP_SETTINGS_SECRET_KEY", "tests-secret-key")

from backend.app.database import get_session  # noqa: E402
from backend.app.dependencies import require_admin  # noqa: E402
from backend.app.mcp import server_service as server_service_module  # noqa: E402
from backend.app.models import Base, McpServer  # noqa: E402
from backend.app.routes import admin as admin_routes  # noqa: E402
from backend.app.routes import mcp as mcp_routes  # noqa: E402
from backend.app.schemas import (  # noqa: E402
    McpServerCreateRequest,
    McpServerUpdateRequest,
)


@pytest.fixture
def session_factory():
    from sqlalchemy import create_engine

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionFactory = sessionmaker(bind=engine, expire_on_commit=False)

    yield SessionFactory

    engine.dispose()


def _stub_probe(monkeypatch: pytest.MonkeyPatch, payload: dict[str, object]):
    async def _run(config):  # type: ignore[no-untyped-def]
        payload["config"] = config
        return payload.setdefault(
            "result",
            {"status": "ok", "tool_names": ["alpha"], "detail": "ok"},
        )

    monkeypatch.setattr(server_service_module, "probe_mcp_connection", _run)


def test_create_server_persists_encrypted_and_probes(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _run() -> None:
        recorded: dict[str, object] = {}
        _stub_probe(monkeypatch, recorded)

        with session_factory() as session:
            service = server_service_module.McpServerService(session)
            payload = McpServerCreateRequest(
                label="  Primary  ",
                server_url="https://mcp.example.com/sse",
                transport="http_sse",
                authorization="Bearer secret-token",
                access_token="  at-123  ",
                refresh_token=None,
                oauth_client_secret=" super-secret ",
                oauth_client_id=" client-id ",
                oauth_scope=" scope1 scope2 ",
                oauth_authorization_endpoint="https://idp.example.com/auth",
                oauth_token_endpoint="https://idp.example.com/token",
                oauth_redirect_uri="https://app.example.com/callback",
                oauth_metadata={"provider": "example"},
            )

            await service.create_server(payload)

        with session_factory() as session:
            stored = session.scalar(select(McpServer).limit(1))

        assert stored is not None
        assert stored.label == "Primary"
        assert stored.authorization_encrypted is not None
        assert stored.authorization_hint and stored.authorization_hint.endswith("oken")
        assert stored.access_token_hint and stored.access_token_hint.endswith("123")
        assert (
            stored.oauth_client_secret_hint
            and stored.oauth_client_secret_hint.endswith("cret")
        )
        assert recorded["config"] == {
            "type": "mcp",
            "transport": "http_sse",
            "url": "https://mcp.example.com/sse",
            "authorization": "Bearer secret-token",
        }
        assert stored.tools_cache is not None
        assert stored.tools_cache.get("status") == "ok"
        assert stored.tools_cache_updated_at is not None

    asyncio.run(_run())


def test_update_server_resets_secret_and_reprobes(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _run() -> None:
        recorded: dict[str, object] = {}
        _stub_probe(monkeypatch, recorded)

        with session_factory() as session:
            service = server_service_module.McpServerService(session)
            created = await service.create_server(
                McpServerCreateRequest(
                    label="Initial",
                    server_url="https://mcp.example.com",
                    transport="http_sse",
                    authorization="Bearer abc",
                )
            )

        with session_factory() as session:
            service = server_service_module.McpServerService(session)
            updated = await service.update_server(
                created.id,
                McpServerUpdateRequest(
                    label="Renamed",
                    authorization=None,
                    refresh_tools=True,
                ),
            )

        assert updated.label == "Renamed"
        assert updated.authorization_encrypted is None
        assert updated.authorization_hint is None
        config = recorded["config"]
        assert config["url"] == "https://mcp.example.com"
        assert "authorization" not in config

    asyncio.run(_run())


def test_create_server_detects_conflicts(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _run() -> None:
        _stub_probe(monkeypatch, {})

        with session_factory() as session:
            service = server_service_module.McpServerService(session)
            await service.create_server(
                McpServerCreateRequest(
                    label="Alpha",
                    server_url="https://alpha.example.com",
                    transport="http_sse",
                )
            )

            with pytest.raises(HTTPException) as excinfo:
                await service.create_server(
                    McpServerCreateRequest(
                        label="Alpha",
                        server_url="https://beta.example.com",
                        transport="http_sse",
                    )
                )
        assert excinfo.value.status_code == status.HTTP_409_CONFLICT
        assert excinfo.value.detail.get("field") == "label"

        _stub_probe(monkeypatch, {})
        with session_factory() as session:
            service = server_service_module.McpServerService(session)
            await service.create_server(
                McpServerCreateRequest(
                    label="Beta",
                    server_url="https://beta.example.com",
                    transport="http_sse",
                )
            )

            with pytest.raises(HTTPException) as excinfo_url:
                await service.create_server(
                    McpServerCreateRequest(
                        label="Gamma",
                        server_url="https://beta.example.com",
                        transport="http_sse",
                    )
                )
        assert excinfo_url.value.status_code == status.HTTP_409_CONFLICT
        assert excinfo_url.value.detail.get("field") == "server_url"

    asyncio.run(_run())


def test_public_route_returns_sanitized_servers(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _run() -> None:
        _stub_probe(monkeypatch, {})

        with session_factory() as session:
            service = server_service_module.McpServerService(session)
            await service.create_server(
                McpServerCreateRequest(
                    label="Visible",
                    server_url="https://visible.example.com",
                    transport="http_sse",
                    authorization="Bearer xyz",
                )
            )
            await service.create_server(
                McpServerCreateRequest(
                    label="Hidden",
                    server_url="https://hidden.example.com",
                    transport="http_sse",
                    is_active=False,
                )
            )

        with session_factory() as session:
            result = await mcp_routes.list_mcp_servers(
                session=session, current_user=SimpleNamespace(id=1)
            )

        assert len(result) == 1
        entry = result[0]
        assert entry.label == "Visible"
        assert entry.has_authorization is True
        assert entry.server_url == "https://visible.example.com"
        assert entry.is_active is True
        assert not hasattr(entry, "authorization_encrypted")

    asyncio.run(_run())


@pytest.mark.skipif(
    "FastAPI" not in globals() or "TestClient" not in globals(),
    reason="fastapi non disponible",
)
def test_admin_mcp_server_endpoints_crud_flow(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    assert FastAPI is not None and TestClient is not None

    app = FastAPI()
    app.include_router(admin_routes.router)

    def _get_session_override():  # type: ignore[no-untyped-def]
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    async def _require_admin_override() -> SimpleNamespace:
        return SimpleNamespace(id=42, is_admin=True)

    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[require_admin] = _require_admin_override

    recorded: list[dict[str, object]] = []

    async def _fake_probe(config: dict[str, object]) -> dict[str, object]:
        recorded.append(config)
        return {"status": "ok", "tool_names": ["alpha", "beta"]}

    monkeypatch.setattr(server_service_module, "probe_mcp_connection", _fake_probe)

    client = TestClient(app)

    create_response = client.post(
        "/api/admin/mcp-servers",
        json={
            "label": "Primary",
            "server_url": "https://mcp.example.com",
            "transport": "http_sse",
            "authorization": "Bearer secret",
        },
    )
    assert create_response.status_code == status.HTTP_201_CREATED
    created = create_response.json()
    assert created["label"] == "Primary"
    assert created["authorization_hint"].endswith("cret")
    server_id = created["id"]

    list_response = client.get("/api/admin/mcp-servers")
    assert list_response.status_code == status.HTTP_200_OK
    payload = list_response.json()
    assert len(payload) == 1 and payload[0]["id"] == server_id

    update_response = client.patch(
        f"/api/admin/mcp-servers/{server_id}",
        json={"label": "Renamed", "refresh_tools": True},
    )
    assert update_response.status_code == status.HTTP_200_OK
    updated = update_response.json()
    assert updated["label"] == "Renamed"

    delete_response = client.delete(f"/api/admin/mcp-servers/{server_id}")
    assert delete_response.status_code == status.HTTP_204_NO_CONTENT

    final_list = client.get("/api/admin/mcp-servers")
    assert final_list.status_code == status.HTTP_200_OK
    assert final_list.json() == []

    assert len(recorded) == 2
    assert recorded[0]["url"] == "https://mcp.example.com"
    assert recorded[1]["url"] == "https://mcp.example.com"
