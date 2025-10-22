"""Tests de vérification pour l'export de workflow sans positions UI."""

from __future__ import annotations

import datetime
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient


def _load_backend_modules():
    os.environ.setdefault("DATABASE_URL", "sqlite:///./chatkit-tests.db")
    os.environ.setdefault("OPENAI_API_KEY", "sk-test")
    os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")

    backend_dir = Path(__file__).resolve().parents[1]
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    from app import app as fastapi_app
    from app.dependencies import get_current_user as current_user_dependency
    from app.workflows import WorkflowService as workflow_service_cls
    from app.workflows import serialize_definition_graph as serialize_graph

    return fastapi_app, workflow_service_cls, serialize_graph, current_user_dependency


(
    app,
    WorkflowService,
    serialize_definition_graph,
    get_current_user,
) = _load_backend_modules()


def build_definition() -> SimpleNamespace:
    now = datetime.datetime.now(datetime.UTC)
    workflow = SimpleNamespace(
        id=1,
        slug="demo-workflow",
        display_name="Workflow démo",
        is_chatkit_default=False,
    )
    start_step = SimpleNamespace(
        id=10,
        slug="start",
        kind="start",
        display_name="Début",
        agent_key=None,
        position=1,
        is_enabled=True,
        parameters={"message": "Bonjour"},
        ui_metadata={"position": {"x": 0, "y": 0}},
        created_at=now,
        updated_at=now,
    )
    agent_step = SimpleNamespace(
        id=11,
        slug="agent",
        kind="agent",
        display_name="Agent",
        agent_key="assistant",
        position=2,
        is_enabled=True,
        parameters={"config": {"foo": "bar"}},
        ui_metadata={"position": {"x": 200, "y": 0}},
        created_at=now,
        updated_at=now,
    )
    transition = SimpleNamespace(
        id=21,
        source_step=start_step,
        target_step=agent_step,
        condition=None,
        ui_metadata={"label": "continuer"},
        created_at=now,
        updated_at=now,
    )
    definition = SimpleNamespace(
        id=7,
        workflow_id=workflow.id,
        workflow=workflow,
        name="v1",
        version=1,
        is_active=True,
        created_at=now,
        updated_at=now,
        steps=[start_step, agent_step],
        transitions=[transition],
    )
    return definition


def test_serialize_definition_graph_excludes_position_metadata() -> None:
    """Le helper de sérialisation doit supprimer metadata.position."""

    definition = build_definition()
    graph = serialize_definition_graph(definition, include_position_metadata=False)

    assert "nodes" in graph and graph["nodes"], "Les blocs doivent être présents"
    assert "edges" in graph and graph["edges"], "Les connexions doivent être présentes"

    for node in graph["nodes"]:
        metadata = node.get("metadata") or {}
        assert "position" not in metadata
        assert isinstance(node.get("parameters"), dict)

    for edge in graph["edges"]:
        metadata = edge.get("metadata") or {}
        assert "position" not in metadata

    for step in definition.steps:
        if step.ui_metadata:
            assert "position" in step.ui_metadata


def test_export_endpoint_returns_sanitized_graph(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """L'endpoint d'export doit renvoyer le graphe sans metadata.position."""

    definition = build_definition()

    async def _override_current_user():
        return SimpleNamespace(is_admin=True)

    def _fake_get_version(self, workflow_id: int, version_id: int, session=None):
        assert workflow_id == definition.workflow_id
        assert version_id == definition.id
        return definition

    app.dependency_overrides[get_current_user] = _override_current_user
    monkeypatch.setattr(WorkflowService, "get_version", _fake_get_version)
    original_startup = list(app.router.on_startup)
    original_shutdown = list(app.router.on_shutdown)
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    try:
        with TestClient(app) as client:
            response = client.get(
                f"/api/workflows/{definition.workflow_id}/versions/{definition.id}/export"
            )

        assert response.status_code == 200
        payload = response.json()

        assert isinstance(payload.get("nodes"), list) and payload["nodes"]
        assert isinstance(payload.get("edges"), list)

        for node in payload["nodes"]:
            metadata = node.get("metadata") or {}
            assert "position" not in metadata
            assert isinstance(node.get("parameters"), dict)

        for edge in payload["edges"]:
            metadata = edge.get("metadata") or {}
            assert "position" not in metadata
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.router.on_startup[:] = original_startup
        app.router.on_shutdown[:] = original_shutdown
