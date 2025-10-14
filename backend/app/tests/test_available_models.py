import os

from fastapi.testclient import TestClient
from sqlalchemy import text

from backend.app import app
from backend.app.database import SessionLocal, engine
from backend.app.models import AvailableModel, Base, User
from backend.app.security import create_access_token, hash_password

_db_path = engine.url.database or ""


def _reset_db() -> None:
    if engine.dialect.name == "postgresql":
        Base.metadata.create_all(bind=engine)
        table_names = ", ".join(f'"{name}"' for name in Base.metadata.tables)
        if not table_names:
            return
        with engine.begin() as connection:
            connection.execute(
                text(f"TRUNCATE TABLE {table_names} RESTART IDENTITY CASCADE")
            )
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


os.environ.setdefault("PYTEST_AVAILABLE_MODELS_CLEANUP", "1")
if os.environ["PYTEST_AVAILABLE_MODELS_CLEANUP"] == "1":
    import atexit

    atexit.register(_cleanup)


def test_admin_can_create_and_list_models() -> None:
    _reset_db()
    admin = _make_user(email="owner@example.com", is_admin=True)
    token = create_access_token(admin)

    response = client.post(
        "/api/admin/models",
        headers=_auth_headers(token),
        json={
            "name": "o4-mini",
            "display_name": "o4-mini",
            "description": "Modèle de raisonnement compact",
            "supports_reasoning": True,
        },
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["name"] == "o4-mini"
    assert payload["supports_reasoning"] is True

    list_response = client.get("/api/models", headers=_auth_headers(token))
    assert list_response.status_code == 200
    data = list_response.json()
    assert len(data) == 1
    assert data[0]["name"] == "o4-mini"


def test_non_admin_cannot_manage_models() -> None:
    _reset_db()
    user = _make_user(email="user@example.com", is_admin=False)
    token = create_access_token(user)

    response = client.post(
        "/api/admin/models",
        headers=_auth_headers(token),
        json={
            "name": "gpt-4.1-mini",
            "supports_reasoning": False,
        },
    )
    assert response.status_code == 403


def test_admin_can_delete_model() -> None:
    _reset_db()
    admin = _make_user(email="owner@example.com", is_admin=True)
    token = create_access_token(admin)

    with SessionLocal() as session:
        model = AvailableModel(
            name="gpt-4.1-mini",
            supports_reasoning=False,
        )
        session.add(model)
        session.commit()
        session.refresh(model)
        model_id = model.id

    delete_response = client.delete(
        f"/api/admin/models/{model_id}",
        headers=_auth_headers(token),
    )
    assert delete_response.status_code == 204

    with SessionLocal() as session:
        assert session.get(AvailableModel, model_id) is None
