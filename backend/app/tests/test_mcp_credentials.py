from __future__ import annotations

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

os.environ.setdefault("AUTH_SECRET_KEY", "unit-test-secret")
db_path = ROOT_DIR / "test-mcp-credentials.db"
os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"

from backend.app.database import SessionLocal, engine  # noqa: E402
from backend.app.models import Base, McpCredential  # noqa: E402
from backend.app.routes import tools as tools_routes  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_database() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    if db_path.exists():
        db_path.unlink()


@pytest.fixture()
def client() -> TestClient:
    app = FastAPI()
    app.include_router(tools_routes.router)
    return TestClient(app)


def test_create_api_key_credential(client: TestClient) -> None:
    payload = {
        "label": "Docs",
        "auth_type": "api_key",
        "authorization": "Bearer secret-token",
        "headers": {"X-Custom": "value"},
    }

    response = client.post("/api/mcp/credentials", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["label"] == "Docs"
    assert data["auth_type"] == "api_key"
    assert data["secret_hint"].endswith("oken")

    with SessionLocal() as session:
        credential = session.get(McpCredential, data["id"])
        assert credential is not None
        assert credential.auth_type == "api_key"
        assert credential.secret_hint is not None
        assert credential.encrypted_payload != "Bearer secret-token"


def test_start_and_complete_oauth_flow(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    payload = {
        "label": "Remote OAuth",
        "auth_type": "oauth",
        "oauth": {
            "authorization_url": "https://example.com/oauth/authorize",
            "token_url": "https://example.com/oauth/token",
            "client_id": "client-123",
            "client_secret": "secret",
            "scope": ["tools.read"],
        },
    }

    create_response = client.post("/api/mcp/credentials", json=payload)
    assert create_response.status_code == 201
    credential_id = create_response.json()["id"]

    start_response = client.post(
        "/api/mcp/oauth/start",
        json={
            "credential_id": credential_id,
            "redirect_uri": "https://chatkit.local/oauth/callback",
        },
    )
    assert start_response.status_code == 200
    start_data = start_response.json()
    assert "authorization_url" in start_data
    assert "state" in start_data

    class _StubClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self.last_request: tuple[str, dict[str, Any]] | None = None

        def __enter__(self) -> _StubClient:
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, *, data: dict[str, Any]) -> httpx.Response:
            self.last_request = (url, data)
            return httpx.Response(
                200,
                request=httpx.Request("POST", url),
                json={
                    "access_token": "oauth-token",
                    "refresh_token": "refresh-token",
                    "token_type": "Bearer",
                    "expires_in": 60,
                },
            )

    stub_client = _StubClient()
    monkeypatch.setattr(
        "backend.app.mcp.credentials.httpx.Client",
        lambda *args, **kwargs: stub_client,
    )

    callback_response = client.post(
        "/api/mcp/oauth/callback",
        json={
            "credential_id": credential_id,
            "code": "auth-code",
            "state": start_data["state"],
            "redirect_uri": "https://chatkit.local/oauth/callback",
        },
    )
    assert callback_response.status_code == 200
    callback_data = callback_response.json()
    assert callback_data["connected"] is True

    with SessionLocal() as session:
        credential = session.get(McpCredential, credential_id)
        assert credential is not None
        payload = credential.encrypted_payload
        assert "oauth-token" not in payload


def test_delete_credential(client: TestClient) -> None:
    create = client.post(
        "/api/mcp/credentials",
        json={"label": "ToRemove", "auth_type": "api_key", "authorization": "token"},
    )
    credential_id = create.json()["id"]

    delete_response = client.delete(f"/api/mcp/credentials/{credential_id}")
    assert delete_response.status_code == 204

    missing_response = client.delete(f"/api/mcp/credentials/{credential_id}")
    assert missing_response.status_code == 404
