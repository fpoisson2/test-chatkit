import datetime
import os
import sys
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///./chatkit-tests.db")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")

config = import_module("backend.app.config")
service_module = import_module("backend.app.workflows.service")

WorkflowDefaults = config.WorkflowDefaults
WorkflowService = service_module.WorkflowService
WorkflowValidationError = service_module.WorkflowValidationError
serialize_definition = service_module.serialize_definition


def _build_service(
    *,
    supported_agent_keys: frozenset[str] | set[str] | tuple[str, ...] = frozenset(),
) -> WorkflowService:
    defaults = WorkflowDefaults(
        default_end_message="Fin",
        default_workflow_slug="workflow",
        default_workflow_display_name="Workflow",
        supported_agent_keys=frozenset(supported_agent_keys),
        expected_state_slugs=frozenset(),
        default_agent_slugs=frozenset(),
        default_workflow_graph={"nodes": [], "edges": []},
    )
    return WorkflowService(workflow_defaults=defaults)


def test_normalize_graph_accepts_voice_agent() -> None:
    service = _build_service()
    payload = {
        "nodes": [
            {
                "slug": "start",
                "kind": "start",
                "display_name": "Start",
                "is_enabled": True,
                "parameters": {},
                "metadata": {},
            },
            {
                "slug": "voice",
                "kind": "voice_agent",
                "display_name": "Voice",
                "is_enabled": True,
                "parameters": {"model": "gpt-4o-mini"},
                "metadata": {},
            },
            {
                "slug": "end",
                "kind": "end",
                "display_name": "End",
                "is_enabled": True,
                "parameters": {},
                "metadata": {},
            },
        ],
        "edges": [
            {"source": "start", "target": "voice", "metadata": {}},
            {"source": "voice", "target": "end", "metadata": {}},
        ],
    }

    nodes, edges = service._normalize_graph(payload)

    assert len(edges) == 2
    assert any(node.slug == "voice" and node.kind == "voice_agent" for node in nodes)


def test_normalize_graph_validates_voice_agent_keys() -> None:
    service = _build_service(supported_agent_keys={"custom"})
    payload = {
        "nodes": [
            {
                "slug": "start",
                "kind": "start",
                "display_name": "Start",
                "is_enabled": True,
                "parameters": {},
                "metadata": {},
            },
            {
                "slug": "voice",
                "kind": "voice_agent",
                "display_name": "Voice",
                "agent_key": "unknown",
                "is_enabled": True,
                "parameters": {},
                "metadata": {},
            },
            {
                "slug": "end",
                "kind": "end",
                "display_name": "End",
                "is_enabled": True,
                "parameters": {},
                "metadata": {},
            },
        ],
        "edges": [
            {"source": "start", "target": "voice", "metadata": {}},
            {"source": "voice", "target": "end", "metadata": {}},
        ],
    }

    with pytest.raises(WorkflowValidationError):
        service._normalize_graph(payload)


def test_serialize_definition_includes_voice_agent_step() -> None:
    timestamp = datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC)
    start_step = SimpleNamespace(
        id=1,
        slug="start",
        kind="start",
        display_name="Start",
        agent_key=None,
        position=1,
        is_enabled=True,
        parameters={},
        ui_metadata={},
        created_at=timestamp,
        updated_at=timestamp,
    )
    voice_step = SimpleNamespace(
        id=2,
        slug="voice",
        kind="voice_agent",
        display_name="Voice Agent",
        agent_key=None,
        position=2,
        is_enabled=True,
        parameters={"voice": "alloy"},
        ui_metadata={},
        created_at=timestamp,
        updated_at=timestamp,
    )
    end_step = SimpleNamespace(
        id=3,
        slug="end",
        kind="end",
        display_name="End",
        agent_key=None,
        position=3,
        is_enabled=True,
        parameters={},
        ui_metadata={},
        created_at=timestamp,
        updated_at=timestamp,
    )

    definition = SimpleNamespace(
        id=10,
        workflow_id=4,
        workflow=None,
        name="Test Workflow",
        version=1,
        is_active=True,
        created_at=timestamp,
        updated_at=timestamp,
        steps=[start_step, voice_step, end_step],
        transitions=[],
    )

    payload = serialize_definition(definition)

    assert any(step["id"] == voice_step.id for step in payload["steps"])
    assert any(node["kind"] == "voice_agent" for node in payload["graph"]["nodes"])
