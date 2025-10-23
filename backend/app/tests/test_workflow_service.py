import json
import os
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.app.config import WorkflowDefaults  # noqa: E402 - import après maj du path
from backend.app.models import Base  # noqa: E402 - import après maj du path
from backend.app.workflows.service import (  # noqa: E402 - import après maj du path
    WorkflowService,
    WorkflowValidationError,
)


def _load_workflow_defaults() -> WorkflowDefaults:
    defaults_path = ROOT_DIR / "backend" / "app" / "workflows" / "defaults.json"
    payload = json.loads(defaults_path.read_text(encoding="utf-8"))
    return WorkflowDefaults.from_mapping(payload)


@pytest.fixture()
def workflow_service(tmp_path: Path) -> WorkflowService:
    database_path = tmp_path / "workflow.db"
    connect_args = {"check_same_thread": False}
    engine = create_engine(
        f"sqlite:///{database_path}", future=True, connect_args=connect_args
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    defaults = _load_workflow_defaults()
    service = WorkflowService(
        session_factory=session_factory, workflow_defaults=defaults
    )
    try:
        yield service
    finally:
        engine.dispose()


def test_get_definition_by_slug_returns_specific_workflow(
    workflow_service: WorkflowService,
) -> None:
    graph_payload = {
        "nodes": [
            {"slug": "start", "kind": "start"},
            {
                "slug": "assistant",
                "kind": "assistant_message",
                "parameters": {"message": "Bonjour"},
            },
            {"slug": "end", "kind": "end"},
        ],
        "edges": [
            {"source": "start", "target": "assistant"},
            {"source": "assistant", "target": "end"},
        ],
    }

    created = workflow_service.create_workflow(
        slug="custom-workflow",
        display_name="Workflow personnalisé",
        graph_payload=graph_payload,
    )

    loaded = workflow_service.get_definition_by_slug("custom-workflow")

    assert loaded.id == created.id
    assert loaded.workflow.slug == "custom-workflow"
    assert [step.slug for step in loaded.steps] == [
        "start",
        "assistant",
        "end",
    ]


def test_get_definition_by_slug_matches_default_workflow(
    workflow_service: WorkflowService,
) -> None:
    default_definition = workflow_service.get_current()
    default_slug = workflow_service._workflow_defaults.default_workflow_slug

    loaded = workflow_service.get_definition_by_slug(default_slug)

    assert loaded.id == default_definition.id
    assert loaded.workflow.slug == default_slug
    assert len(loaded.steps) == len(default_definition.steps)


def test_get_definition_by_slug_unknown_slug_raises(
    workflow_service: WorkflowService,
) -> None:
    with pytest.raises(WorkflowValidationError):
        workflow_service.get_definition_by_slug("unknown-workflow")

