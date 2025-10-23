"""Tests for vector store ingestion when a workflow blueprint is provided."""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

if importlib.util.find_spec("fastapi") is None:  # pragma: no cover - optional dep
    pytest.skip("fastapi non disponible", allow_module_level=True)

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")
os.environ.setdefault("MODEL_API_KEY", "dummy-key")

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

routes_vector_stores = importlib.import_module("backend.app.routes.vector_stores")
vector_store_service = importlib.import_module("backend.app.vector_store.service")
schemas = importlib.import_module("backend.app.schemas")
models = importlib.import_module("backend.app.models")
workflow_errors = importlib.import_module("backend.app.workflows")
workflow_service_module = importlib.import_module("backend.app.workflows.service")
config_module = importlib.import_module("backend.app.config")


def _load_workflow_defaults() -> config_module.WorkflowDefaults:
    defaults_path = ROOT_DIR / "backend" / "app" / "workflows" / "defaults.json"
    payload = json.loads(defaults_path.read_text(encoding="utf-8"))
    return config_module.WorkflowDefaults.from_mapping(payload)


@pytest.fixture()
def engine(tmp_path: Path):
    database_path = tmp_path / "vector-store.db"
    connect_args = {"check_same_thread": False}
    engine = create_engine(
        f"sqlite:///{database_path}", future=True, connect_args=connect_args
    )
    models.Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def session_factory(engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


@pytest.fixture()
def session(session_factory: sessionmaker[Session]):
    db = session_factory()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def workflow_service(session_factory: sessionmaker[Session]):
    defaults = _load_workflow_defaults()
    return workflow_service_module.WorkflowService(
        session_factory=session_factory, workflow_defaults=defaults
    )


class _FakeEmbeddingsAPI:
    def __init__(self, dimension: int) -> None:
        self._dimension = dimension

    def create(self, input: list[str], model: str):  # type: ignore[override]
        embeddings = [
            SimpleNamespace(embedding=[float(index == 0)] * self._dimension)
            for index, _text in enumerate(input)
        ]
        return SimpleNamespace(data=embeddings)


class _FakeOpenAIClient:
    def __init__(self, dimension: int) -> None:
        self.embeddings = _FakeEmbeddingsAPI(dimension)


@pytest.fixture(autouse=True)
def stub_embeddings_client(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_client = _FakeOpenAIClient(models.EMBEDDING_DIMENSION)
    monkeypatch.setattr(
        vector_store_service, "_get_openai_client", lambda: fake_client
    )


async def _ingest(
    session: Session,
    workflow_service: workflow_service_module.WorkflowService,
    request: schemas.VectorStoreDocumentIngestRequest,
):
    admin_user = SimpleNamespace(is_admin=True)
    return await routes_vector_stores.ingest_document(
        "knowledge-base",
        request,
        session=session,
        _=admin_user,
        workflow_service=workflow_service,
    )


def test_ingest_document_with_workflow_blueprint_creates_workflow(
    session: Session, workflow_service: workflow_service_module.WorkflowService
) -> None:
    async def _run() -> None:
        blueprint = schemas.VectorStoreWorkflowBlueprint(
            slug="travel-guide",
            display_name="Travel guide workflow",
            description="Workflow issu du vector store",
            graph={
                "nodes": [
                    {"slug": "start", "kind": "start"},
                    {"slug": "end", "kind": "end"},
                ],
                "edges": [{"source": "start", "target": "end"}],
            },
            mark_active=True,
        )
        request = schemas.VectorStoreDocumentIngestRequest(
            doc_id="guide-paris",
            document={"title": "Guide de Paris"},
            metadata={"language": "fr"},
            workflow_blueprint=blueprint,
        )

        response = await _ingest(session, workflow_service, request)

        assert response.doc_id == "guide-paris"
        assert response.metadata["workflow_slug"] == "travel-guide"
        assert response.metadata["workflow_id"] > 0
        assert response.created_workflow is not None
        assert response.created_workflow.slug == "travel-guide"
        assert response.created_workflow.display_name == "Travel guide workflow"

        workflow_row = session.scalar(
            select(models.Workflow).where(models.Workflow.slug == "travel-guide")
        )
        assert workflow_row is not None
        assert workflow_row.active_version_id is not None

        document_row = session.scalar(
            select(models.JsonDocument).where(
                models.JsonDocument.doc_id == "guide-paris"
            )
        )
        assert document_row is not None
        assert document_row.metadata_json["workflow_id"] == workflow_row.id
        assert document_row.metadata_json["workflow_slug"] == workflow_row.slug

    asyncio.run(_run())


def test_ingest_document_rolls_back_on_workflow_error(
    session: Session,
    workflow_service: workflow_service_module.WorkflowService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _run() -> None:
        request = schemas.VectorStoreDocumentIngestRequest(
            doc_id="guide-lyon",
            document={"title": "Guide de Lyon"},
            metadata={},
            workflow_blueprint=schemas.VectorStoreWorkflowBlueprint(
                slug="travel-guide",
                display_name="Travel guide workflow",
                graph={"nodes": [], "edges": []},
            ),
        )

        def _raise(*_args, **_kwargs):  # type: ignore[no-untyped-def]
            raise workflow_errors.WorkflowValidationError("blueprint invalide")

        monkeypatch.setattr(
            routes_vector_stores,
            "ingest_workflow_blueprint",
            _raise,
        )

        with pytest.raises(routes_vector_stores.HTTPException) as excinfo:
            await _ingest(session, workflow_service, request)

        assert (
            excinfo.value.status_code
            == routes_vector_stores.status.HTTP_400_BAD_REQUEST
        )

        document_row = session.scalar(
            select(models.JsonDocument).where(
                models.JsonDocument.doc_id == "guide-lyon"
            )
        )
        assert document_row is None

    asyncio.run(_run())

