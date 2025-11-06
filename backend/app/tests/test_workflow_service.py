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
    HostedWorkflowNotFoundError,
    WorkflowAppearanceService,
    WorkflowGraphValidator,
    WorkflowPersistenceService,
    WorkflowService,
    WorkflowValidationError,
    serialize_definition,
)


def _load_workflow_defaults() -> WorkflowDefaults:
    defaults_path = ROOT_DIR / "backend" / "app" / "workflows" / "defaults.json"
    payload = json.loads(defaults_path.read_text(encoding="utf-8"))
    return WorkflowDefaults.from_mapping(payload)


def _build_parallel_graph() -> dict[str, object]:
    join_slug = "parallel-join-1"
    return {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {
                "slug": "split",
                "kind": "parallel_split",
                "is_enabled": True,
                "parameters": {
                    "join_slug": join_slug,
                    "branches": [
                        {"slug": "branch-a", "label": "Branche A"},
                        {"slug": "branch-b", "label": "Branche B"},
                    ],
                },
            },
            {
                "slug": "agent-a",
                "kind": "assistant_message",
                "is_enabled": True,
                "parameters": {"message": "A"},
            },
            {
                "slug": "agent-b",
                "kind": "assistant_message",
                "is_enabled": True,
                "parameters": {"message": "B"},
            },
            {
                "slug": join_slug,
                "kind": "parallel_join",
                "is_enabled": True,
                "parameters": {},
            },
            {
                "slug": "end",
                "kind": "end",
                "is_enabled": True,
                "parameters": {"message": "Fin"},
            },
        ],
        "edges": [
            {"source": "start", "target": "split"},
            {"source": "split", "target": "agent-a"},
            {"source": "split", "target": "agent-b"},
            {"source": "agent-a", "target": join_slug},
            {"source": "agent-b", "target": join_slug},
            {"source": join_slug, "target": "end"},
        ],
    }


@pytest.fixture()
def workflow_defaults() -> WorkflowDefaults:
    return _load_workflow_defaults()


@pytest.fixture()
def workflow_service(
    tmp_path: Path, workflow_defaults: WorkflowDefaults
) -> WorkflowService:
    database_path = tmp_path / "workflow.db"
    connect_args = {"check_same_thread": False}
    engine = create_engine(
        f"sqlite:///{database_path}", future=True, connect_args=connect_args
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    service = WorkflowService(
        session_factory=session_factory, workflow_defaults=workflow_defaults
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


def test_parallel_split_join_workflow_is_valid(
    workflow_service: WorkflowService,
) -> None:
    created = workflow_service.create_workflow(
        slug="parallel-valid",
        display_name="Workflow parallèle",
        graph_payload=_build_parallel_graph(),
    )

    kinds = {step.kind for step in created.steps}
    assert "parallel_split" in kinds
    assert "parallel_join" in kinds


def test_parallel_split_requires_matching_join(
    workflow_service: WorkflowService,
) -> None:
    graph_payload = _build_parallel_graph()
    for node in graph_payload["nodes"]:
        if node["slug"] == "split":
            node["parameters"]["join_slug"] = "missing-join"
            break

    with pytest.raises(WorkflowValidationError) as exc_info:
        workflow_service.create_workflow(
            slug="parallel-missing-join",
            display_name="Workflow invalide",
            graph_payload=graph_payload,
        )

    assert "jointure inconnue" in str(exc_info.value)


def test_parallel_join_requires_multiple_inputs(
    workflow_service: WorkflowService,
) -> None:
    graph_payload = _build_parallel_graph()
    graph_payload["edges"] = [
        edge
        for edge in graph_payload["edges"]
        if not (edge["source"] == "agent-b" and edge["target"] == "parallel-join-1")
    ]

    with pytest.raises(WorkflowValidationError) as exc_info:
        workflow_service.create_workflow(
            slug="parallel-single-input",
            display_name="Workflow invalide",
            graph_payload=graph_payload,
        )

    assert "au moins deux entrées" in str(exc_info.value)


def test_parallel_split_requires_multiple_outputs(
    workflow_service: WorkflowService,
) -> None:
    graph_payload = _build_parallel_graph()
    graph_payload["edges"] = [
        edge
        for edge in graph_payload["edges"]
        if not (edge["source"] == "split" and edge["target"] == "agent-b")
    ]

    with pytest.raises(WorkflowValidationError) as exc_info:
        workflow_service.create_workflow(
            slug="parallel-single-output",
            display_name="Workflow invalide",
            graph_payload=graph_payload,
        )

    assert "au moins deux sorties" in str(exc_info.value)


def test_parallel_split_requires_branch_alignment(
    workflow_service: WorkflowService,
) -> None:
    graph_payload = _build_parallel_graph()
    for node in graph_payload["nodes"]:
        if node["slug"] == "split":
            node["parameters"]["branches"].append(
                {"slug": "branch-c", "label": "Branche C"}
            )
            break

    with pytest.raises(WorkflowValidationError) as exc_info:
        workflow_service.create_workflow(
            slug="parallel-branches",
            display_name="Workflow invalide",
            graph_payload=graph_payload,
        )

    assert "autant de branches" in str(exc_info.value)


def test_create_hosted_workflow_persists_entry(
    workflow_service: WorkflowService,
) -> None:
    entry = workflow_service.create_hosted_workflow(
        slug="support",
        workflow_id="wf-remote-1",
        label="Support",
        description="Flux support",
    )

    stored = workflow_service.list_managed_hosted_workflows()
    assert len(stored) == 1
    assert stored[0].slug == entry.slug
    assert stored[0].remote_workflow_id == "wf-remote-1"

    configs = workflow_service.list_hosted_workflow_configs()
    assert len(configs) == 1
    assert configs[0].managed is True
    assert configs[0].workflow_id == "wf-remote-1"
    assert configs[0].label == "Support"


def test_create_hosted_workflow_rejects_duplicate_slug(
    workflow_service: WorkflowService,
) -> None:
    workflow_service.create_hosted_workflow(
        slug="duplicate",
        workflow_id="wf-original",
        label="Original",
    )

    with pytest.raises(WorkflowValidationError):
        workflow_service.create_hosted_workflow(
            slug="duplicate",
            workflow_id="wf-other",
            label="Autre",
        )


def test_delete_hosted_workflow_removes_entry(
    workflow_service: WorkflowService,
) -> None:
    workflow_service.create_hosted_workflow(
        slug="to-remove",
        workflow_id="wf-remove",
        label="À retirer",
    )

    workflow_service.delete_hosted_workflow("to-remove")
    assert workflow_service.list_managed_hosted_workflows() == []

    with pytest.raises(HostedWorkflowNotFoundError):
        workflow_service.delete_hosted_workflow("to-remove")



def test_graph_validator_rejects_duplicate_slug(
    workflow_defaults: WorkflowDefaults,
) -> None:
    validator = WorkflowGraphValidator(workflow_defaults)
    graph_payload = {
        "nodes": [
            {"slug": "start", "kind": "start"},
            {"slug": "start", "kind": "end"},
        ],
        "edges": [],
    }

    with pytest.raises(WorkflowValidationError):
        validator.validate_graph_payload(graph_payload)


def test_appearance_service_override_roundtrip(
    workflow_service: WorkflowService,
) -> None:
    appearance_service = WorkflowAppearanceService(workflow_service._session_factory)

    definition = workflow_service.create_workflow(
        slug="appearance-workflow",
        display_name="Appearance Workflow",
        graph_payload={
            "nodes": [
                {"slug": "start", "kind": "start", "is_enabled": True},
                {"slug": "end", "kind": "end", "is_enabled": True},
            ],
            "edges": [{"source": "start", "target": "end"}],
        },
    )

    baseline = appearance_service.get_workflow_appearance(definition.workflow_id)
    assert baseline["inherited_from_global"] is True

    updated = appearance_service.update_workflow_appearance(
        definition.workflow_id,
        {"color_scheme": "dark", "start_screen_greeting": "Bonjour"},
    )
    assert updated["inherited_from_global"] is False
    assert updated["effective"]["color_scheme"] == "dark"
    assert updated["effective"]["start_screen_greeting"] == "Bonjour"

    reset = appearance_service.update_workflow_appearance(
        definition.workflow_id, {"inherit_from_global": True}
    )
    assert reset["inherited_from_global"] is True


def test_persistence_service_create_and_delete(
    workflow_service: WorkflowService, workflow_defaults: WorkflowDefaults
) -> None:
    persistence = WorkflowPersistenceService(
        session_factory=workflow_service._session_factory,
        workflow_defaults=workflow_defaults,
    )
    definition = persistence.create_workflow(
        slug="temporary", display_name="Temp", graph_payload=None
    )
    assert definition.workflow.slug == "temporary"

    persistence.delete_workflow(definition.workflow_id)

    with pytest.raises(WorkflowValidationError):
        persistence.get_definition_by_slug("temporary")
