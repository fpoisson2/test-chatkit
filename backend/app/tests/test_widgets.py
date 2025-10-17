import atexit
import os
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.app.database import SessionLocal, engine
from backend.app.models import Base, User
from backend.app.security import create_access_token, hash_password

_db_path = engine.url.database or ""


_vector_store_events: list[dict[str, Any]] = []


@pytest.fixture(autouse=True)
def _stub_vector_store(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.app.widgets import service as widgets_service

    _vector_store_events.clear()

    class _StubVectorStoreService:
        def __init__(self, session: Any) -> None:
            self.session = session

        def ingest(
            self,
            store_slug: str,
            doc_id: str,
            payload: dict[str, Any],
            *,
            store_title: str | None = None,
            store_metadata: dict[str, Any] | None = None,
            document_metadata: dict[str, Any] | None = None,
        ) -> SimpleNamespace:
            _vector_store_events.append(
                {
                    "action": "ingest",
                    "store": store_slug,
                    "doc_id": doc_id,
                    "payload": payload,
                    "store_title": store_title,
                    "store_metadata": store_metadata,
                    "document_metadata": document_metadata,
                }
            )
            return SimpleNamespace(doc_id=doc_id)

        def delete_document(self, store_slug: str, doc_id: str) -> None:
            _vector_store_events.append(
                {"action": "delete", "store": store_slug, "doc_id": doc_id}
            )

    monkeypatch.setattr(
        widgets_service,
        "JsonVectorStoreService",
        _StubVectorStoreService,
    )
    yield
    _vector_store_events.clear()


@pytest.fixture
def vector_store_events() -> list[dict[str, Any]]:
    return _vector_store_events


def _reset_db() -> None:
    if engine.dialect.name == "postgresql":
        Base.metadata.create_all(bind=engine)
        table_names = ", ".join(f'"{name}"' for name in Base.metadata.tables)
        if not table_names:
            return
        from sqlalchemy import text

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


def _sample_widget_definition() -> dict[str, object]:
    return {
        "type": "Card",
        "size": "lg",
        "children": [
            {"type": "Text", "id": "title", "value": "Résumé"},
            {
                "type": "Markdown",
                "id": "content",
                "value": "**Détails :**\n- Élément A\n- Élément B",
            },
        ],
    }


atexit.register(_cleanup)


def test_admin_can_manage_widget_library(
    vector_store_events: list[dict[str, Any]]
) -> None:
    _reset_db()
    admin = _make_user(email="admin@example.com", is_admin=True)
    token = create_access_token(admin)

    create_response = client.post(
        "/api/widgets",
        headers=_auth_headers(token),
        json={
            "slug": "resume",
            "title": "Résumé automatique",
            "description": "Widget de synthèse pour les agents",
            "definition": _sample_widget_definition(),
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["slug"] == "resume"
    assert created["definition"]["type"] == "Card"

    list_response = client.get("/api/widgets", headers=_auth_headers(token))
    assert list_response.status_code == 200
    widgets = list_response.json()
    assert any(widget["slug"] == "resume" for widget in widgets)

    detail_response = client.get("/api/widgets/resume", headers=_auth_headers(token))
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["title"] == "Résumé automatique"

    update_response = client.patch(
        "/api/widgets/resume",
        headers=_auth_headers(token),
        json={
            "title": "Résumé enrichi",
            "definition": {
                "type": "Text",
                "id": "summary",
                "value": "Nouvelle synthèse",
            },
        },
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["title"] == "Résumé enrichi"
    assert updated["definition"]["type"] == "Text"

    preview_response = client.post(
        "/api/widgets/preview",
        headers=_auth_headers(token),
        json={"definition": _sample_widget_definition()},
    )
    assert preview_response.status_code == 200
    preview = preview_response.json()
    assert preview["definition"]["children"][0]["value"].startswith("Résumé")

    delete_response = client.delete(
        "/api/widgets/resume", headers=_auth_headers(token)
    )
    assert delete_response.status_code == 204

    assert len(vector_store_events) == 3
    create_event, update_event, delete_event = vector_store_events
    assert create_event["action"] == "ingest"
    assert create_event["doc_id"] == "resume"
    assert create_event["payload"]["definition"]["type"] == "Card"
    assert update_event["action"] == "ingest"
    assert update_event["payload"]["definition"]["type"] == "Text"
    assert delete_event == {
        "action": "delete",
        "store": "chatkit-widgets",
        "doc_id": "resume",
    }

    missing_response = client.get(
        "/api/widgets/resume", headers=_auth_headers(token)
    )
    assert missing_response.status_code == 404


def test_non_admin_cannot_access_widget_library(
    vector_store_events: list[dict[str, Any]]
) -> None:
    _reset_db()
    admin = _make_user(email="owner@example.com", is_admin=True)
    user = _make_user(email="member@example.com", is_admin=False)
    admin_token = create_access_token(admin)
    user_token = create_access_token(user)

    client.post(
        "/api/widgets",
        headers=_auth_headers(admin_token),
        json={
            "slug": "resume",
            "definition": _sample_widget_definition(),
        },
    )

    response = client.get("/api/widgets", headers=_auth_headers(user_token))
    assert response.status_code == 403

    workflow_widgets = client.get(
        "/api/workflow-widgets", headers=_auth_headers(user_token)
    )
    assert workflow_widgets.status_code == 200
    widgets = workflow_widgets.json()
    assert widgets == [
        {"slug": "resume", "title": None, "description": None}
    ]

    create_attempt = client.post(
        "/api/widgets",
        headers=_auth_headers(user_token),
        json={
            "slug": "notes",
            "definition": _sample_widget_definition(),
        },
    )
    assert create_attempt.status_code == 403

    assert vector_store_events == [
        {
            "action": "ingest",
            "store": "chatkit-widgets",
            "doc_id": "resume",
            "payload": {
                "slug": "resume",
                "title": None,
                "description": None,
                "definition": _sample_widget_definition(),
            },
            "store_title": "Bibliothèque de widgets",
            "store_metadata": {"scope": "widget_library"},
            "document_metadata": {"slug": "resume"},
        }
    ]


def test_invalid_widget_definition_returns_error() -> None:
    _reset_db()
    admin = _make_user(email="validator@example.com", is_admin=True)
    token = create_access_token(admin)

    response = client.post(
        "/api/widgets",
        headers=_auth_headers(token),
        json={
            "slug": "invalid",
            "definition": {"value": "Manque le type"},
        },
    )
    assert response.status_code == 400
    payload = response.json()
    assert payload["detail"]["message"].startswith("Définition de widget invalide")
