from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import select, text


def _load_workflow_import_modules():
    backend_dir = Path(__file__).resolve().parents[1]
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    database = importlib.import_module("app.database")
    models = importlib.import_module("app.models")
    vector_store_module = importlib.import_module("app.vector_store")

    return (
        database.SessionLocal,
        database.engine,
        models.Base,
        vector_store_module.JsonVectorStoreService,
        vector_store_module.WORKFLOW_VECTOR_STORE_SLUG,
        models.Workflow,
        models.WorkflowDefinition,
        models.EMBEDDING_DIMENSION,
        models.JsonVectorStore,
        models.JsonDocument,
    )


(
    SessionLocal,
    engine,
    Base,
    JsonVectorStoreService,
    WORKFLOW_VECTOR_STORE_SLUG,
    Workflow,
    WorkflowDefinition,
    EMBEDDING_DIMENSION,
    JsonVectorStore,
    JsonDocument,
) = _load_workflow_import_modules()


def _reset_database() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as session:
        session.execute(text("DELETE FROM json_chunks"))
        session.execute(text("DELETE FROM json_documents"))
        session.execute(text("DELETE FROM json_vector_stores"))
        session.execute(text("DELETE FROM workflow_transitions"))
        session.execute(text("DELETE FROM workflow_steps"))
        session.execute(text("DELETE FROM workflow_definitions"))
        session.execute(text("DELETE FROM workflows"))
        session.commit()


def test_ingest_document_imports_workflow_blueprint(monkeypatch):
    _reset_database()

    fake_vector = [0.0] * EMBEDDING_DIMENSION

    class _FakeEmbeddingsAPI:
        def create(self, *, input, model):  # type: ignore[override]
            return SimpleNamespace(
                data=[
                    SimpleNamespace(embedding=list(fake_vector))
                    for _ in range(len(input))
                ]
            )

    class _FakeOpenAIClient:
        def __init__(self) -> None:
            self.embeddings = _FakeEmbeddingsAPI()

    monkeypatch.setattr(
        "app.vector_store.service._get_openai_client",
        lambda: _FakeOpenAIClient(),
    )

    blueprint = {
        "slug": "workflow-vector",
        "display_name": "Workflow importé",
        "description": "Workflow créé depuis le vector store.",
        "graph": {
            "nodes": [
                {
                    "slug": "start",
                    "kind": "start",
                    "is_enabled": True,
                    "parameters": {},
                    "metadata": {},
                },
                {
                    "slug": "end",
                    "kind": "end",
                    "is_enabled": True,
                    "parameters": {},
                    "metadata": {},
                },
            ],
            "edges": [
                {
                    "source": "start",
                    "target": "end",
                }
            ],
        },
        "mark_active": True,
    }

    with SessionLocal() as session:
        service = JsonVectorStoreService(session)
        service.ensure_store_exists(WORKFLOW_VECTOR_STORE_SLUG)
        service.ingest(
            WORKFLOW_VECTOR_STORE_SLUG,
            "doc-001",
            {"title": "Demo"},
            document_metadata={"workflow_blueprint": blueprint},
        )
        session.commit()

        workflow = session.scalar(
            select(Workflow).where(Workflow.slug == blueprint["slug"])
        )
        assert workflow is not None
        assert workflow.display_name == "Workflow importé"

        definition = session.scalar(
            select(WorkflowDefinition).where(
                WorkflowDefinition.workflow_id == workflow.id
            )
        )
        assert definition is not None
        assert definition.is_active is True

        document = session.scalar(
            select(JsonDocument)
            .join(JsonVectorStore)
            .where(JsonVectorStore.slug == WORKFLOW_VECTOR_STORE_SLUG)
            .where(JsonDocument.doc_id == "doc-001")
        )
        assert document is not None
        metadata = document.metadata_json or {}
        assert metadata.get("workflow_blueprint") == blueprint
