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
    serialize_definition,
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


def test_update_current_rejects_nested_self_reference(
    workflow_service: WorkflowService,
) -> None:
    current_definition = workflow_service.get_current()
    assert current_definition.workflow_id is not None

    graph_payload = {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {
                "slug": "agent", "kind": "agent", "is_enabled": True,
                "parameters": {
                    "workflow": {"id": current_definition.workflow_id}
                },
            },
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [
            {"source": "start", "target": "agent"},
            {"source": "agent", "target": "end"},
        ],
    }

    with pytest.raises(WorkflowValidationError) as exc_info:
        workflow_service.update_current(graph_payload)

    assert "ne peut pas exécuter son propre workflow" in str(exc_info.value)


def test_update_current_accepts_nested_workflow_reference(
    workflow_service: WorkflowService,
) -> None:
    target_graph = {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [{"source": "start", "target": "end"}],
    }
    target_definition = workflow_service.create_workflow(
        slug="nested-target",
        display_name="Nested target",
        graph_payload=target_graph,
    )

    graph_payload = {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {
                "slug": "agent",
                "kind": "agent",
                "is_enabled": True,
                "parameters": {"workflow": {"id": target_definition.workflow_id}},
            },
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [
            {"source": "start", "target": "agent"},
            {"source": "agent", "target": "end"},
        ],
    }

    updated = workflow_service.update_current(graph_payload)

    agent_step = next(
        step for step in updated.steps if step.slug == "agent"
    )
    assert agent_step.parameters["workflow"] == {"id": target_definition.workflow_id}

    serialized = serialize_definition(updated)
    serialized_agent = next(
        step for step in serialized["steps"] if step["agent_key"] is None
    )
    assert serialized_agent["parameters"]["workflow"] == {
        "id": target_definition.workflow_id
    }


def test_update_current_normalizes_nested_workflow_slug(
    workflow_service: WorkflowService,
) -> None:
    target_graph = {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [{"source": "start", "target": "end"}],
    }
    target_definition = workflow_service.create_workflow(
        slug="nested-target-slug",
        display_name="Nested target",
        graph_payload=target_graph,
    )

    graph_payload = {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {
                "slug": "agent",
                "kind": "agent",
                "is_enabled": True,
                "parameters": {"workflow": {"slug": "  nested-target-slug  "}},
            },
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [
            {"source": "start", "target": "agent"},
            {"source": "agent", "target": "end"},
        ],
    }

    updated = workflow_service.update_current(graph_payload)

    agent_step = next(step for step in updated.steps if step.slug == "agent")
    assert agent_step.parameters["workflow"] == {
        "slug": target_definition.workflow.slug
    }

    serialized = serialize_definition(updated)
    serialized_agent = next(
        step for step in serialized["steps"] if step["agent_key"] is None
    )
    assert serialized_agent["parameters"]["workflow"] == {
        "slug": target_definition.workflow.slug
    }


def test_import_workflow_creates_definition_from_vector_store_blueprint(
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

    definition = workflow_service.import_workflow(
        graph_payload=graph_payload,
        slug="vector-blueprint",
        display_name="Vector blueprint",
        description="Importé depuis un vector store",
        mark_as_active=True,
    )

    workflow = definition.workflow
    assert workflow.slug == "vector-blueprint"
    assert workflow.display_name == "Vector blueprint"
    assert workflow.description == "Importé depuis un vector store"
    assert workflow.active_version_id == definition.id
    assert definition.version == 1
    assert definition.is_active is True
    assert definition.name == "Version importée"
    assert [step.slug for step in definition.steps] == [
        "start",
        "assistant",
        "end",
    ]


def test_import_workflow_updates_existing_workflow_from_vector_store_payload(
    workflow_service: WorkflowService,
) -> None:
    initial_graph = {
        "nodes": [
            {"slug": "start", "kind": "start"},
            {"slug": "end", "kind": "end"},
        ],
        "edges": [{"source": "start", "target": "end"}],
    }
    initial_definition = workflow_service.create_workflow(
        slug="legacy-blueprint",
        display_name="Legacy blueprint",
        graph_payload=initial_graph,
    )

    updated_graph = {
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

    imported = workflow_service.import_workflow(
        graph_payload=updated_graph,
        workflow_id=initial_definition.workflow_id,
        slug="vector-blueprint",
        display_name="Vector blueprint v2",
        description="Mise à jour depuis le vector store",
        version_name="Vector import",
        mark_as_active=True,
    )

    workflow = imported.workflow
    assert workflow.id == initial_definition.workflow_id
    assert workflow.slug == "vector-blueprint"
    assert workflow.display_name == "Vector blueprint v2"
    assert workflow.description == "Mise à jour depuis le vector store"
    assert workflow.active_version_id == imported.id
    assert imported.version == initial_definition.version + 1
    assert imported.is_active is True
    assert imported.name == "Vector import"
    assert [step.slug for step in imported.steps] == [
        "start",
        "assistant",
        "end",
    ]

