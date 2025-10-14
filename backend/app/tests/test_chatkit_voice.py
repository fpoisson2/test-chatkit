from __future__ import annotations

from fastapi import HTTPException

from backend.app.config import get_settings
from backend.app.security import create_access_token
from backend.app.tests.test_workflows import _auth_headers, _make_user, client


def test_create_voice_session_requires_authentication() -> None:
    response = client.post("/api/chatkit/voice/session", json={})
    assert response.status_code == 401


def test_create_voice_session_handles_upstream_error(monkeypatch) -> None:
    user = _make_user(email="voice-error@example.com", is_admin=False)
    token = create_access_token(user)

    async def _raise_http_exception(**_: str):
        raise HTTPException(status_code=500, detail={"error": "test-error"})

    monkeypatch.setattr(
        "backend.app.routes.chatkit.create_realtime_voice_session",
        _raise_http_exception,
    )

    response = client.post(
        "/api/chatkit/voice/session",
        headers=_auth_headers(token),
        json={},
    )

    assert response.status_code == 500
    assert response.json()["detail"] == {"error": "test-error"}


def test_create_voice_session_success(monkeypatch) -> None:
    user = _make_user(email="voice-success@example.com", is_admin=False)
    token = create_access_token(user)
    settings = get_settings()

    async def _fake_helper(**kwargs):
        assert kwargs["user_id"] == f"user:{user.id}"
        assert kwargs["model"] == "gpt-custom"
        assert kwargs["instructions"] == "Réponds avec empathie"
        assert "voice" not in kwargs
        return {
            "client_secret": {"value": "secret-token"},
            "expires_at": "2024-01-01T00:00:00Z",
        }

    monkeypatch.setattr(
        "backend.app.routes.chatkit.create_realtime_voice_session",
        _fake_helper,
    )

    response = client.post(
        "/api/chatkit/voice/session",
        headers=_auth_headers(token),
        json={
            "model": "gpt-custom",
            "instructions": "Réponds avec empathie",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload == {
        "client_secret": {"value": "secret-token"},
        "expires_at": "2024-01-01T00:00:00Z",
        "model": "gpt-custom",
        "instructions": "Réponds avec empathie",
        "voice": settings.chatkit_realtime_voice,
    }
