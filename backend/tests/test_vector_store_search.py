from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text


def _load_vector_store_search_modules():
    backend_dir = Path(__file__).resolve().parents[1]
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    from app import app as fastapi_app
    from app.database import SessionLocal as session_factory
    from app.database import engine as sa_engine
    from app.dependencies import get_current_user as current_user_dependency
    from app.models import EMBEDDING_DIMENSION, JsonChunk, JsonDocument, JsonVectorStore
    from app.vector_store import JsonVectorStoreService

    return (
        fastapi_app,
        session_factory,
        current_user_dependency,
        JsonVectorStoreService,
        EMBEDDING_DIMENSION,
        JsonVectorStore,
        JsonDocument,
        JsonChunk,
        sa_engine,
    )


(
    app,
    SessionLocal,
    get_current_user,
    JsonVectorStoreService,
    EMBEDDING_DIMENSION,
    JsonVectorStore,
    JsonDocument,
    JsonChunk,
    engine,
) = _load_vector_store_search_modules()


def _reset_vector_tables() -> None:
    JsonVectorStore.__table__.create(bind=engine, checkfirst=True)
    JsonDocument.__table__.create(bind=engine, checkfirst=True)
    JsonChunk.__table__.create(bind=engine, checkfirst=True)
    with SessionLocal() as session:
        session.execute(text("DELETE FROM json_chunks"))
        session.execute(text("DELETE FROM json_documents"))
        session.execute(text("DELETE FROM json_vector_stores"))
        session.commit()


def _fake_embedding(value: float) -> list[float]:
    vector = [0.0] * EMBEDDING_DIMENSION
    vector[0] = value
    return vector


def _seed_sample_documents() -> None:
    with SessionLocal() as session:
        store = JsonVectorStore(
            slug="docs",
            title="Documentation",
            metadata_json={"category": "knowledge"},
        )
        session.add(store)
        session.flush()

        documents = [
            (
                "doc-1",
                {"title": "Document 1"},
                (
                    (0, 1.0, "Premier chapitre"),
                    (1, 0.8, "Deuxième chapitre"),
                ),
            ),
            (
                "doc-2",
                {"title": "Document 2"},
                ((0, 0.5, "Section unique"),),
            ),
            (
                "doc-3",
                {"title": "Document 3"},
                ((0, 0.2, "Autre section"),),
            ),
        ]

        for doc_id, metadata, chunk_specs in documents:
            document = JsonDocument(
                store_id=store.id,
                doc_id=doc_id,
                raw_document={"title": metadata["title"]},
                linearized_text=metadata["title"],
                metadata_json=dict(metadata),
            )
            session.add(document)
            session.flush()

            for chunk_index, dense_value, text in chunk_specs:
                session.add(
                    JsonChunk(
                        store_id=store.id,
                        document_id=document.id,
                        doc_id=doc_id,
                        chunk_index=chunk_index,
                        raw_chunk={"text": text},
                        linearized_text=text,
                        embedding=_fake_embedding(dense_value),
                        metadata_json={"section": chunk_index},
                    )
                )
        session.commit()


class _FakeEmbeddingResponse:
    def __init__(self, vector: list[float]) -> None:
        self.data = [SimpleNamespace(embedding=vector)]


class _FakeEmbeddingsClient:
    def __init__(self, vector: list[float]) -> None:
        self._vector = vector

    def create(self, *, input: list[str], model: str) -> _FakeEmbeddingResponse:
        return _FakeEmbeddingResponse(self._vector)


class _FakeOpenAIClient:
    def __init__(self, vector: list[float]) -> None:
        self.embeddings = _FakeEmbeddingsClient(vector)


@pytest.fixture
def fake_embeddings(monkeypatch: pytest.MonkeyPatch) -> None:
    vector = _fake_embedding(1.0)
    monkeypatch.setattr(
        "app.vector_store.service._get_openai_client",
        lambda: _FakeOpenAIClient(vector),
    )


def test_search_documents_ranks_by_aggregated_score(fake_embeddings: None) -> None:
    _reset_vector_tables()
    _seed_sample_documents()

    with SessionLocal() as session:
        service = JsonVectorStoreService(session)
        results = service.search_documents(
            "docs",
            "documentation",
            top_k=2,
            dense_weight=1.0,
            sparse_weight=0.0,
            chunks_per_document=1,
        )

    assert [result.doc_id for result in results] == ["doc-1", "doc-2"]
    assert results[0].score > results[1].score
    assert len(results[0].matches) == 1
    assert results[0].matches[0].chunk_index == 0
    assert results[0].metadata == {"title": "Document 1"}


def test_search_document_chunks_filters_by_doc(fake_embeddings: None) -> None:
    _reset_vector_tables()
    _seed_sample_documents()

    with SessionLocal() as session:
        service = JsonVectorStoreService(session)
        chunks = service.search_document_chunks(
            "docs",
            "doc-1",
            "documentation",
            top_k=2,
            dense_weight=1.0,
            sparse_weight=0.0,
        )

        assert len(chunks) == 2
        assert all(chunk.doc_id == "doc-1" for chunk in chunks)

        with pytest.raises(LookupError):
            service.search_document_chunks(
                "docs",
                "missing-doc",
                "documentation",
            )


def test_document_search_routes_return_expected_payload(
    fake_embeddings: None,
) -> None:
    _reset_vector_tables()
    _seed_sample_documents()

    user = SimpleNamespace(id=1, is_admin=False)
    previous_override = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = lambda: user

    original_startup = list(app.router.on_startup)
    original_shutdown = list(app.router.on_shutdown)
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    try:
        with TestClient(app) as client:
            available_routes = {
                (route.path, tuple(sorted(route.methods or [])))
                for route in app.router.routes
                if getattr(route, "methods", None)
            }
            assert (
                "/api/vector-stores/{store_slug}/documents/{doc_id}/search",
                ("POST",),
            ) in available_routes
            assert (
                client.app.url_path_for(
                    "search_document_chunks", store_slug="docs", doc_id="doc-1"
                )
                == "/api/vector-stores/docs/documents/doc-1/search"
            )

            response = client.post(
                "/api/vector-stores/docs/search_documents",
                json={
                    "query": "documentation",
                    "top_k": 2,
                    "dense_weight": 1.0,
                    "sparse_weight": 0.0,
                    "chunks_per_document": 1,
                },
            )
            assert response.status_code == 200
            payload = response.json()
            assert len(payload) == 2
            first = payload[0]
            assert first["doc_id"] == "doc-1"
            assert first["metadata"] == {"title": "Document 1"}
            assert len(first["matches"]) == 1

            chunk_response = client.post(
                "/api/vector-stores/docs/documents/doc-1/search",
                json={
                    "query": "documentation",
                    "top_k": 2,
                    "dense_weight": 1.0,
                    "sparse_weight": 0.0,
                },
            )
            chunk_payload = chunk_response.json()
            assert chunk_response.status_code == 200, chunk_payload
            assert len(chunk_payload) == 2
            assert {match["doc_id"] for match in chunk_payload} == {"doc-1"}
    finally:
        app.router.on_startup[:] = original_startup
        app.router.on_shutdown[:] = original_shutdown
        if previous_override is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_override
