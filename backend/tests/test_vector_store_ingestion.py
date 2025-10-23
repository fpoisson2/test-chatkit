import asyncio
import importlib
import importlib.machinery
import os
import sys
import types
from pathlib import Path

import pytest


def _load_ingestion_helpers():
    backend_dir = Path(__file__).resolve().parents[1]
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    if "app" not in sys.modules:
        package = types.ModuleType("app")
        package.__path__ = [str(backend_dir / "app")]
        package.__spec__ = importlib.machinery.ModuleSpec(
            "app", loader=None, is_package=True
        )
        sys.modules["app"] = package

    os.environ.setdefault("DATABASE_URL", "postgresql://test.local/test")
    os.environ.setdefault("AUTH_SECRET_KEY", "test-secret")

    module = importlib.import_module("app.vector_store.ingestion")
    return module._normalize_workflow_blueprint, module.ingest_workflow_step


(
    _normalize_workflow_blueprint,
    ingest_workflow_step,
) = _load_ingestion_helpers()


def test_normalize_workflow_blueprint_returns_sanitized_dict() -> None:
    blueprint = _normalize_workflow_blueprint(
        {
            "slug": " demo ",
            "display_name": " Workflow Demo ",
            "description": "  Description  ",
            "graph": {
                "nodes": ({"id": "start"},),
                "edges": tuple(),
                "metadata": {"version": 1},
            },
            "mark_active": True,
        },
        step_slug="vector-node",
    )

    assert blueprint == {
        "slug": "demo",
        "display_name": "Workflow Demo",
        "description": "Description",
        "graph": {
            "nodes": [{"id": "start"}],
            "edges": [],
            "metadata": {"version": 1},
        },
        "mark_active": True,
    }


def test_normalize_workflow_blueprint_requires_edges_list() -> None:
    assert (
        _normalize_workflow_blueprint(
            {
                "slug": "demo",
                "display_name": "Workflow",
                "graph": {"nodes": [], "edges": "invalid"},
            },
            step_slug="vector-node",
        )
        is None
    )


def test_ingest_workflow_step_attaches_workflow_blueprint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    async def _fake_ingest_document(
        slug: str,
        doc_id: str,
        document: dict[str, object],
        metadata: dict[str, object],
        *,
        session_factory: object,
    ) -> None:
        captured.update(
            {
                "slug": slug,
                "doc_id": doc_id,
                "document": document,
                "metadata": metadata,
                "session_factory": session_factory,
            }
        )

    monkeypatch.setattr(
        "app.vector_store.ingestion.ingest_document",
        _fake_ingest_document,
    )

    step_context = {
        "output_structured": {
            "doc_id": "doc-123",
            "title": "Document",
            "workflow_blueprint": {
                "slug": " auto-workflow ",
                "display_name": " Demo workflow ",
                "description": "   ",
                "graph": {
                    "nodes": [
                        {
                            "id": "start",
                            "kind": "start",
                        }
                    ],
                    "edges": (
                        {
                            "source": "start",
                            "target": "end",
                        },
                    ),
                },
                "mark_active": False,
            },
        }
    }

    asyncio.run(
        ingest_workflow_step(
            config={
                "vector_store_slug": "my-store",
                "workflow_blueprint_expression": (
                    "input.output_structured.workflow_blueprint"
                ),
            },
            step_slug="vector-node",
            step_title="Vector store",
            step_context=step_context,
            state={},
            default_input_context=step_context,
            session_factory=lambda: None,
        )
    )

    assert captured["slug"] == "my-store"
    assert captured["doc_id"] == "doc-123"
    metadata = captured["metadata"]
    assert isinstance(metadata, dict)
    assert metadata["workflow_step"] == "vector-node"
    blueprint = metadata["workflow_blueprint"]
    assert blueprint == {
        "slug": "auto-workflow",
        "display_name": "Demo workflow",
        "graph": {
            "nodes": [
                {
                    "id": "start",
                    "kind": "start",
                }
            ],
            "edges": [
                {
                    "source": "start",
                    "target": "end",
                }
            ],
        },
        "mark_active": False,
    }
