import atexit
import os
import tempfile

_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_fd)
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")
os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{_db_path}"

from backend.app.config import get_settings

get_settings.cache_clear()

from fastapi.testclient import TestClient

from backend.app import app
from backend.app.database import SessionLocal, engine
from backend.app.models import Base, User
from backend.app.security import create_access_token, hash_password

Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

client = TestClient(app)


def _cleanup() -> None:
    try:
        os.remove(_db_path)
    except FileNotFoundError:
        pass


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


def test_get_workflow_requires_authentication() -> None:
    response = client.get("/api/workflows/current")
    assert response.status_code == 401


def test_get_workflow_requires_admin() -> None:
    user = _make_user(email="user@example.com", is_admin=False)
    token = create_access_token(user)
    response = client.get("/api/workflows/current", headers=_auth_headers(token))
    assert response.status_code == 403


def test_admin_can_read_default_workflow() -> None:
    admin = _make_user(email="admin@example.com", is_admin=True)
    token = create_access_token(admin)
    response = client.get("/api/workflows/current", headers=_auth_headers(token))
    assert response.status_code == 200
    payload = response.json()
    assert payload["is_active"] is True
    agent_keys = [step["agent_key"] for step in payload["steps"]]
    assert agent_keys == [
        "triage",
        "get_data_from_web",
        "triage_2",
        "get_data_from_user",
        "r_dacteur",
    ]


def test_admin_can_update_workflow_order_and_parameters() -> None:
    admin = _make_user(email="owner@example.com", is_admin=True)
    token = create_access_token(admin)
    payload = {
        "steps": [
            {"agent_key": "triage", "position": 2, "is_enabled": True, "parameters": {}},
            {"agent_key": "get_data_from_user", "position": 1, "is_enabled": True, "parameters": {}},
            {
                "agent_key": "r_dacteur",
                "position": 3,
                "is_enabled": True,
                "parameters": {"model": "gpt-4.1"},
            },
        ]
    }
    response = client.put(
        "/api/workflows/current",
        headers=_auth_headers(token),
        json=payload,
    )
    assert response.status_code == 200
    data = response.json()
    returned_keys = [step["agent_key"] for step in data["steps"]]
    assert returned_keys == ["get_data_from_user", "triage", "r_dacteur"]
    redacteur_step = next(step for step in data["steps"] if step["agent_key"] == "r_dacteur")
    assert redacteur_step["parameters"]["model"] == "gpt-4.1"


def test_update_rejects_unknown_agent() -> None:
    admin = _make_user(email="validator@example.com", is_admin=True)
    token = create_access_token(admin)
    payload = {
        "steps": [
            {"agent_key": "unknown", "position": 1, "is_enabled": True, "parameters": {}},
            {"agent_key": "r_dacteur", "position": 2, "is_enabled": True, "parameters": {}},
        ]
    }
    response = client.put(
        "/api/workflows/current",
        headers=_auth_headers(token),
        json=payload,
    )
    assert response.status_code == 400
    assert "Agent inconnu" in response.json()["detail"]
