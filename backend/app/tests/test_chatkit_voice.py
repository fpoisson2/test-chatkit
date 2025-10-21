from __future__ import annotations

import datetime

from fastapi import HTTPException
import pytest

from backend.app.chatkit_sessions import SessionSecretParser
from backend.app.config import get_settings
from backend.app.security import create_access_token
from backend.app.tests.test_workflows import _auth_headers, _make_user, _reset_db, client


FIXED_NOW = datetime.datetime(2024, 1, 1, tzinfo=datetime.timezone.utc)


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
            "client_secret": {"value": "secret-token", "expires_after": 900},
        }

    monkeypatch.setattr(
        "backend.app.routes.chatkit.create_realtime_voice_session",
        _fake_helper,
    )
    monkeypatch.setattr(
        "backend.app.routes.chatkit.SessionSecretParser",
        lambda: SessionSecretParser(clock=lambda: FIXED_NOW),
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
    expected_expiration = (FIXED_NOW + datetime.timedelta(seconds=900)).isoformat().replace("+00:00", "Z")
    assert payload == {
        "client_secret": {"value": "secret-token", "expires_after": 900},
        "expires_at": expected_expiration,
        "model": "gpt-custom",
        "instructions": "Réponds avec empathie",
        "voice": settings.chatkit_realtime_voice,
        "prompt_id": None,
        "prompt_version": None,
        "prompt_variables": {},
    }


def test_create_voice_session_success_with_string_secret(monkeypatch) -> None:
    user = _make_user(email="voice-string@example.com", is_admin=False)
    token = create_access_token(user)

    async def _fake_helper(**kwargs):
        assert kwargs["user_id"] == f"user:{user.id}"
        return {"client_secret": "plain-secret", "expires_after": 321}

    monkeypatch.setattr(
        "backend.app.routes.chatkit.create_realtime_voice_session",
        _fake_helper,
    )
    monkeypatch.setattr(
        "backend.app.routes.chatkit.SessionSecretParser",
        lambda: SessionSecretParser(clock=lambda: FIXED_NOW),
    )

    response = client.post(
        "/api/chatkit/voice/session",
        headers=_auth_headers(token),
        json={},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["client_secret"] == "plain-secret"
    expected_expiration = (FIXED_NOW + datetime.timedelta(seconds=321)).isoformat().replace("+00:00", "Z")
    assert payload["expires_at"] == expected_expiration
    assert payload["prompt_variables"] == {}


def test_admin_can_read_default_voice_settings() -> None:
    _reset_db()
    admin = _make_user(email="voice-admin@example.com", is_admin=True)
    token = create_access_token(admin)
    defaults = get_settings()

    response = client.get(
        "/api/admin/voice-settings",
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["instructions"] == defaults.chatkit_realtime_instructions
    assert payload["model"] == defaults.chatkit_realtime_model
    assert payload["voice"] == defaults.chatkit_realtime_voice
    assert payload["prompt_id"] is None
    assert payload["prompt_version"] is None
    assert payload["prompt_variables"] == {}


def test_admin_can_update_voice_settings(monkeypatch) -> None:
    _reset_db()
    admin = _make_user(email="voice-owner@example.com", is_admin=True)
    admin_token = create_access_token(admin)

    response = client.patch(
        "/api/admin/voice-settings",
        headers=_auth_headers(admin_token),
        json={
            "instructions": "Réponds avec concision.",
            "model": "gpt-realtime-preview",
            "voice": "marin",
            "prompt_id": "pmpt_123",
            "prompt_version": "89",
            "prompt_variables": {"city": "Paris"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["instructions"] == "Réponds avec concision."
    assert payload["model"] == "gpt-realtime-preview"
    assert payload["voice"] == "marin"
    assert payload["prompt_id"] == "pmpt_123"
    assert payload["prompt_version"] == "89"
    assert payload["prompt_variables"] == {"city": "Paris"}

    user = _make_user(email="voice-consumer@example.com", is_admin=False)
    user_token = create_access_token(user)

    async def _fake_helper(**kwargs):
        assert kwargs["model"] == "gpt-realtime-preview"
        assert kwargs["instructions"] == "Réponds avec concision."
        return {"client_secret": "voice-secret"}

    monkeypatch.setattr(
        "backend.app.routes.chatkit.create_realtime_voice_session",
        _fake_helper,
    )

    session_response = client.post(
        "/api/chatkit/voice/session",
        headers=_auth_headers(user_token),
        json={},
    )

    assert session_response.status_code == 200
    data = session_response.json()
    assert data["voice"] == "marin"
    assert data["prompt_id"] == "pmpt_123"
    assert data["prompt_version"] == "89"
    assert data["prompt_variables"] == {"city": "Paris"}


@pytest.mark.parametrize(
    "payload,expected_secret,expected_delta,expected_iso",
    [
        ({"client_secret": "raw-token"}, "raw-token", datetime.timedelta(minutes=9), None),
        (
            {"client_secret": {"value": "abc", "expires_at": "2024-01-01T00:00:00Z"}},
            {"value": "abc", "expires_at": "2024-01-01T00:00:00Z"},
            None,
            "2024-01-01T00:00:00Z",
        ),
        (
            {
                "data": {
                    "client_secret": {"value": "def"},
                    "expires_after": 600,
                }
            },
            {"value": "def"},
            datetime.timedelta(seconds=600),
            None,
        ),
        (
            {
                "session": {
                    "client_secret": {"value": "ghi", "expires_after": 120},
                }
            },
            {"value": "ghi", "expires_after": 120},
            datetime.timedelta(seconds=120),
            None,
        ),
    ],
)
def test_session_secret_parser_handles_various_shapes(
    payload: dict[str, object],
    expected_secret: object,
    expected_delta: datetime.timedelta | None,
    expected_iso: str | None,
) -> None:
    parser = SessionSecretParser(clock=lambda: FIXED_NOW)
    result = parser.parse(payload)
    assert result.raw == expected_secret
    if expected_iso is not None:
        assert result.expires_at_isoformat() == expected_iso
    elif expected_delta is not None:
        target_iso = (FIXED_NOW + expected_delta).isoformat().replace("+00:00", "Z")
        assert result.expires_at_isoformat() == target_iso
    else:
        assert result.expires_at is None


def test_session_secret_parser_missing_secret() -> None:
    parser = SessionSecretParser(clock=lambda: FIXED_NOW)
    result = parser.parse({"foo": "bar", "expires_at": "soon"})
    assert result.raw is None
    assert result.expires_at is None
