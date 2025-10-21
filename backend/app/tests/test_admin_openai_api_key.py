from __future__ import annotations

import os
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from backend.app import app
from backend.app.database import SessionLocal, engine
from backend.app.models import Base, SecretSetting, User
from backend.app.security import create_access_token, hash_password

_db_path = engine.url.database or ""


def _reset_db() -> None:
    if engine.dialect.name == "postgresql":
        Base.metadata.create_all(bind=engine)
        table_names = ", ".join(f'"{name}"' for name in Base.metadata.tables)
        if not table_names:
            return
        with engine.begin() as connection:
            connection.execute(text(f"TRUNCATE TABLE {table_names} RESTART IDENTITY CASCADE"))
    else:
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)


_reset_db()

client = TestClient(app)


def _cleanup() -> None:
    if _db_path and os.path.exists(_db_path):
        try:
            os.remove(_db_path)
        except FileNotFoundError:
            pass


os.environ.setdefault("PYTEST_ADMIN_API_KEY_CLEANUP", "1")
if os.environ["PYTEST_ADMIN_API_KEY_CLEANUP"] == "1":
    import atexit

    atexit.register(_cleanup)


def _make_user(*, email: str, is_admin: bool) -> User:
    with SessionLocal() as session:
        user = User(
            email=email,
            password_hash=hash_password("password"),
            is_admin=is_admin,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return user


def _auth_headers(token: str | None = None) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def test_admin_can_update_openai_api_key() -> None:
    _reset_db()
    admin = _make_user(email="owner@example.com", is_admin=True)
    token = create_access_token(admin)

    response = client.put(
        "/api/admin/openai-api-key",
        headers=_auth_headers(token),
        json={"api_key": "sk-live-123"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["is_configured"] is True
    assert payload["updated_at"] is not None

    status_response = client.get(
        "/api/admin/openai-api-key",
        headers=_auth_headers(token),
    )
    assert status_response.status_code == 200
    status_payload = status_response.json()
    assert status_payload["is_configured"] is True
    assert status_payload["updated_at"] == payload["updated_at"]

    with SessionLocal() as session:
        stored = session.scalar(
            select(SecretSetting).where(SecretSetting.name == "openai_api_key")
        )
        assert stored is not None
        assert stored.value == "sk-live-123"


def test_non_admin_cannot_manage_openai_api_key() -> None:
    _reset_db()
    user = _make_user(email="user@example.com", is_admin=False)
    token = create_access_token(user)

    response = client.put(
        "/api/admin/openai-api-key",
        headers=_auth_headers(token),
        json={"api_key": "sk-live-456"},
    )
    assert response.status_code == 403

    status_response = client.get(
        "/api/admin/openai-api-key",
        headers=_auth_headers(token),
    )
    assert status_response.status_code == 403


def test_status_uses_environment_when_no_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    _reset_db()
    admin = _make_user(email="owner@example.com", is_admin=True)
    token = create_access_token(admin)

    monkeypatch.setattr(
        "backend.app.secret_settings.get_settings",
        lambda: SimpleNamespace(openai_api_key="sk-env"),
    )

    response = client.get(
        "/api/admin/openai-api-key",
        headers=_auth_headers(token),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["is_configured"] is True
    assert payload["updated_at"] is None
