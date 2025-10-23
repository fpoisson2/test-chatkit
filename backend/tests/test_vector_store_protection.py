from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text


def _load_vector_store_modules():
    backend_dir = Path(__file__).resolve().parents[1]
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    from app import app as fastapi_app
    from app.database import SessionLocal as session_factory
    from app.database import engine as sa_engine
    from app.dependencies import get_current_user as current_user_dependency
    from app.models import JsonChunk, JsonDocument, JsonVectorStore
    from app.vector_store import (
        PROTECTED_VECTOR_STORE_ERROR_MESSAGE,
        WORKFLOW_VECTOR_STORE_METADATA,
        WORKFLOW_VECTOR_STORE_SLUG,
        WORKFLOW_VECTOR_STORE_TITLE,
        JsonVectorStoreService,
    )

    return (
        fastapi_app,
        session_factory,
        current_user_dependency,
        JsonVectorStoreService,
        WORKFLOW_VECTOR_STORE_SLUG,
        PROTECTED_VECTOR_STORE_ERROR_MESSAGE,
        WORKFLOW_VECTOR_STORE_TITLE,
        WORKFLOW_VECTOR_STORE_METADATA,
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
    JsonVectorStoreService,
    WORKFLOW_VECTOR_STORE_SLUG,
    PROTECTED_VECTOR_STORE_ERROR_MESSAGE,
    WORKFLOW_VECTOR_STORE_TITLE,
    WORKFLOW_VECTOR_STORE_METADATA,
    engine,
    VECTOR_TABLES,
) = _load_vector_store_modules()


def _reset_vector_tables() -> None:
    for table in VECTOR_TABLES:
        table.create(bind=engine, checkfirst=True)
    with SessionLocal() as session:
        session.execute(text("DELETE FROM json_chunks"))
        session.execute(text("DELETE FROM json_documents"))
        session.execute(text("DELETE FROM json_vector_stores"))
        session.commit()


def test_service_blocks_deletion_of_protected_store() -> None:
    _reset_vector_tables()

    with SessionLocal() as session:
        service = JsonVectorStoreService(session)
        service.ensure_store_exists(
            WORKFLOW_VECTOR_STORE_SLUG,
            title=WORKFLOW_VECTOR_STORE_TITLE,
            metadata=dict(WORKFLOW_VECTOR_STORE_METADATA),
        )
        session.commit()

        with pytest.raises(PermissionError) as excinfo:
            service.delete_store(WORKFLOW_VECTOR_STORE_SLUG)

    assert str(excinfo.value) == PROTECTED_VECTOR_STORE_ERROR_MESSAGE


def test_route_returns_error_for_protected_store() -> None:
    _reset_vector_tables()
    with SessionLocal() as session:
        service = JsonVectorStoreService(session)
        service.ensure_store_exists(
            WORKFLOW_VECTOR_STORE_SLUG,
            title=WORKFLOW_VECTOR_STORE_TITLE,
            metadata=dict(WORKFLOW_VECTOR_STORE_METADATA),
        )
        session.commit()

    admin_user = SimpleNamespace(id=1, is_admin=True)
    previous_override = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        original_startup = list(app.router.on_startup)
        original_shutdown = list(app.router.on_shutdown)
        app.router.on_startup.clear()
        app.router.on_shutdown.clear()
        try:
            with TestClient(app) as client:
                response = client.delete(
                    f"/api/vector-stores/{WORKFLOW_VECTOR_STORE_SLUG}"
                )
            assert response.status_code == 400
            assert response.json() == {
                "detail": PROTECTED_VECTOR_STORE_ERROR_MESSAGE
            }
        finally:
            app.router.on_startup[:] = original_startup
            app.router.on_shutdown[:] = original_shutdown
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_override

