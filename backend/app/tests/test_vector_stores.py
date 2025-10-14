"""Tests des endpoints de gestion des magasins vectoriels JSON."""

from __future__ import annotations

import atexit
import os
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import app
from backend.app.database import SessionLocal, engine
from backend.app.models import Base, User, EMBEDDING_DIMENSION
from backend.app.security import create_access_token, hash_password
from backend.app.vector_store import service as vector_service

_db_path = engine.url.database or ""


def _reset_db() -> None:
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


atexit.register(_cleanup)


class DummyVector(list):
    """Vecteur minimaliste imitant l'API numpy utilisée par le service."""

    def __init__(self, data: list[float]):
        super().__init__(data)

    def tolist(self) -> list[float]:  # pragma: no cover - compatibilité numpy
        return list(self)


class DummyMatrix(list):
    """Matrice renvoyée par le modèle factice."""

    def __init__(self, rows: list[list[float]]):
        super().__init__([DummyVector(row) for row in rows])

    def __getitem__(self, index: int) -> DummyVector:  # pragma: no cover - compatibilité numpy
        return super().__getitem__(index)

    def tolist(self) -> list[list[float]]:  # pragma: no cover - compatibilité numpy
        return [list(row) for row in self]


class DummyModel:
    """Faux modèle d'embedding qui renvoie des vecteurs déterministes."""

    def encode(self, inputs: list[str], **_: object) -> DummyMatrix:
        rows: list[list[float]] = []
        for idx, text in enumerate(inputs):
            vector = [0.0] * EMBEDDING_DIMENSION
            position = idx % EMBEDDING_DIMENSION
            value = float(len(text) + idx + 1)
            vector[position] = value
            rows.append(vector)
        return DummyMatrix(rows)


def test_admin_can_create_vector_store() -> None:
    _reset_db()
    admin = _make_user(email="owner@example.com", is_admin=True)
    token = create_access_token(admin)

    payload = {
        "slug": "guides",
        "title": "Guides de voyage",
        "description": "Index des ressources pour les agents",
        "metadata": {"lang": "fr"},
    }
    response = client.post(
        "/api/vector-stores",
        headers=_auth_headers(token),
        json=payload,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["slug"] == payload["slug"]
    assert data["metadata"]["lang"] == "fr"
    assert data["documents_count"] == 0

    listing = client.get("/api/vector-stores", headers=_auth_headers(token))
    assert listing.status_code == 200
    stores = listing.json()
    assert any(store["slug"] == "guides" for store in stores)


def test_ingest_search_and_retrieve_document() -> None:
    _reset_db()
    admin = _make_user(email="admin@example.com", is_admin=True)
    agent = _make_user(email="agent@example.com", is_admin=False)
    admin_token = create_access_token(admin)
    agent_token = create_access_token(agent)

    create_response = client.post(
        "/api/vector-stores",
        headers=_auth_headers(admin_token),
        json={"slug": "guides", "title": "Guides"},
    )
    assert create_response.status_code == 201

    vector_service._load_model.cache_clear()
    with patch("backend.app.vector_store.service._load_model", new=lambda _: DummyModel()):
        ingest_payload = {
            "doc_id": "paris-guide",
            "document": {
                "title": "Guide de Paris",
                "sections": [
                    {"heading": "Transport", "content": "Prendre le métro"},
                    {"heading": "Cuisine", "content": "Déguster des croissants"},
                ],
            },
            "metadata": {"topic": "travel"},
            "store_title": "Guides actualisés",
            "store_metadata": {"owner": "team-agents"},
        }
        response = client.post(
            "/api/vector-stores/guides/documents",
            headers=_auth_headers(admin_token),
            json=ingest_payload,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["doc_id"] == "paris-guide"
        assert data["chunk_count"] >= 1

        second_payload = {
            "doc_id": "lyon-recettes",
            "document": {
                "title": "Recettes de Lyon",
                "sections": [
                    {"heading": "Spécialités", "content": "Goûter les quenelles"},
                ],
            },
            "metadata": {"topic": "food"},
        }
        response = client.post(
            "/api/vector-stores/guides/documents",
            headers=_auth_headers(admin_token),
            json=second_payload,
        )
        assert response.status_code == 201

    vector_service._load_model.cache_clear()
    with patch("backend.app.vector_store.service._load_model", new=lambda _: DummyModel()):
        search_response = client.post(
            "/api/vector-stores/guides/search_json",
            headers=_auth_headers(agent_token),
            json={
                "query": "Guide Paris",
                "top_k": 5,
                "metadata_filters": {"topic": "travel"},
                "dense_weight": 0.7,
                "sparse_weight": 0.3,
            },
        )
    assert search_response.status_code == 200
    results = search_response.json()
    assert len(results) == 1
    first = results[0]
    assert first["doc_id"] == "paris-guide"
    assert first["metadata"]["doc_id"] == "paris-guide"
    assert first["document_metadata"]["topic"] == "travel"
    assert first["score"] >= first["dense_score"] / 2

    detail_response = client.get(
        "/api/vector-stores/guides/documents/paris-guide",
        headers=_auth_headers(agent_token),
    )
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["doc_id"] == "paris-guide"
    assert detail["document"]["title"] == "Guide de Paris"
    assert detail["chunk_count"] >= 1

