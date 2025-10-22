import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text


def _load_backend_modules():
    backend_dir = Path(__file__).resolve().parents[1]
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    from app import app as fastapi_app
    from app.database import SessionLocal as session_factory
    from app.database import engine as sa_engine
    from app.dependencies import get_current_user as current_user_dependency
    from app.models import EMBEDDING_DIMENSION, JsonChunk, JsonDocument, JsonVectorStore
    from app.vector_store import service as vector_service_module

    return (
        fastapi_app,
        session_factory,
        current_user_dependency,
        vector_service_module,
        EMBEDDING_DIMENSION,
        sa_engine,
        (
            JsonVectorStore.__table__,
            JsonDocument.__table__,
            JsonChunk.__table__,
        ),
    )


(
    app,
    SessionLocal,
    get_current_user,
    vector_store_service,
    EMBEDDING_DIMENSION,
    engine,
    VECTOR_TABLES,
) = _load_backend_modules()


class _FakeEmbeddingsAPI:
    def __init__(self, dimension: int) -> None:
        self.dimension = dimension
        self.calls: list[tuple[list[str], str]] = []

    def create(self, input: list[str], model: str):  # type: ignore[override]
        self.calls.append((list(input), model))
        data = []
        for index, _text in enumerate(input):
            value = float(index + 1)
            embedding = [value] * self.dimension
            data.append(SimpleNamespace(embedding=embedding))
        return SimpleNamespace(data=data)


@pytest.fixture
def fake_embeddings(monkeypatch: pytest.MonkeyPatch) -> _FakeEmbeddingsAPI:
    api = _FakeEmbeddingsAPI(EMBEDDING_DIMENSION)
    monkeypatch.setattr(
        vector_store_service,
        "_get_openai_client",
        lambda: SimpleNamespace(embeddings=api),
    )
    return api


def _reset_docs_tables() -> None:
    for table in VECTOR_TABLES:
        table.create(bind=engine, checkfirst=True)
    with SessionLocal() as session:
        session.execute(text("DELETE FROM json_chunks"))
        session.execute(text("DELETE FROM json_documents"))
        session.execute(text("DELETE FROM json_vector_stores"))
        session.commit()


def test_docs_crud_flow(fake_embeddings: _FakeEmbeddingsAPI) -> None:
    admin_user = SimpleNamespace(id=1, is_admin=True)
    regular_user = SimpleNamespace(id=2, is_admin=False)

    previous_override = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        original_startup = list(app.router.on_startup)
        original_shutdown = list(app.router.on_shutdown)
        app.router.on_startup.clear()
        app.router.on_shutdown.clear()
        try:
            with TestClient(app) as client:
                _reset_docs_tables()

                response = client.get("/api/docs")
                assert response.status_code == 200
                assert response.json() == []

                create_payload = {
                    "slug": "workflow-builder",
                    "title": "Workflow Builder",
                    "summary": "Guide court",
                    "language": "en",
                    "content_markdown": "# Workflow Builder\n\nContenu initial.",
                    "metadata": {"category": "guides"},
                }
                response = client.post("/api/docs", json=create_payload)
                assert response.status_code == 201
                created = response.json()
                assert created["slug"] == "workflow-builder"
                assert created["language"] == "en"
                assert created["metadata"] == {"category": "guides"}

                create_calls = len(fake_embeddings.calls)
                assert create_calls == 1

                app.dependency_overrides[get_current_user] = lambda: regular_user
                response = client.get("/api/docs")
                assert response.status_code == 200
                listings = response.json()
                assert len(listings) == 1
                assert listings[0]["slug"] == "workflow-builder"
                assert listings[0]["summary"] == "Guide court"
                assert listings[0]["language"] == "en"

                response = client.get("/api/docs", params={"language": "en"})
                assert response.status_code == 200
                filtered = response.json()
                assert len(filtered) == 1
                assert filtered[0]["slug"] == "workflow-builder"

                response = client.get("/api/docs", params={"language": "fr"})
                assert response.status_code == 200
                assert response.json() == []

                response = client.get("/api/docs", params={"language": "fr!"})
                assert response.status_code == 400

                response = client.get("/api/docs/workflow-builder")
                assert response.status_code == 200
                detail = response.json()
                assert detail["slug"] == "workflow-builder"
                assert detail["language"] == "en"
                assert detail["metadata"] == {"category": "guides"}

                app.dependency_overrides[get_current_user] = lambda: admin_user
                update_payload = {
                    "summary": "Résumé mis à jour",
                    "language": "fr",
                    "metadata": {"category": "guides", "audience": "experts"},
                }
                response = client.patch(
                    "/api/docs/workflow-builder", json=update_payload
                )
                assert response.status_code == 200
                updated = response.json()
                assert updated["summary"] == "Résumé mis à jour"
                assert updated["language"] == "fr"
                assert updated["metadata"]["audience"] == "experts"

                update_calls = len(fake_embeddings.calls)
                assert update_calls == create_calls + 1

                response = client.delete("/api/docs/workflow-builder")
                assert response.status_code == 204

                app.dependency_overrides[get_current_user] = lambda: regular_user
                response = client.get("/api/docs")
                assert response.status_code == 200
                assert response.json() == []

                response = client.get("/api/docs/workflow-builder")
                assert response.status_code == 404
        finally:
            app.router.on_startup[:] = original_startup
            app.router.on_shutdown[:] = original_shutdown
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_override


def test_docs_requires_authentication(fake_embeddings: _FakeEmbeddingsAPI) -> None:
    original_startup = list(app.router.on_startup)
    original_shutdown = list(app.router.on_shutdown)
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    try:
        with TestClient(app) as client:
            _reset_docs_tables()
            response = client.get("/api/docs")
            assert response.status_code == 401

            response = client.post(
                "/api/docs",
                json={
                    "slug": "secure-doc",
                    "content_markdown": "# Secure",
                },
            )
            assert response.status_code == 401
    finally:
        app.router.on_startup[:] = original_startup
        app.router.on_shutdown[:] = original_shutdown


def test_docs_admin_guard(fake_embeddings: _FakeEmbeddingsAPI) -> None:
    non_admin = SimpleNamespace(id=3, is_admin=False)
    previous_override = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = lambda: non_admin
    try:
        original_startup = list(app.router.on_startup)
        original_shutdown = list(app.router.on_shutdown)
        app.router.on_startup.clear()
        app.router.on_shutdown.clear()
        try:
            with TestClient(app) as client:
                _reset_docs_tables()
                response = client.post(
                    "/api/docs",
                    json={
                        "slug": "unauthorized",
                        "content_markdown": "# Unauthorized",
                    },
                )
                assert response.status_code == 403
        finally:
            app.router.on_startup[:] = original_startup
            app.router.on_shutdown[:] = original_shutdown
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_override
