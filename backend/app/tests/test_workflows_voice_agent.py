from __future__ import annotations

import datetime as dt
import importlib
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

config_module = importlib.import_module("backend.app.config")
workflows_service_module = importlib.import_module("backend.app.workflows.service")

WorkflowDefaults = config_module.WorkflowDefaults
WorkflowService = workflows_service_module.WorkflowService
WorkflowValidationError = workflows_service_module.WorkflowValidationError
serialize_definition = workflows_service_module.serialize_definition


def _build_defaults() -> WorkflowDefaults:
    return WorkflowDefaults(
        default_end_message="Fin",
        default_workflow_slug="demo",
        default_workflow_display_name="Demo",
        supported_agent_keys=frozenset({"voice-writer"}),
        expected_state_slugs=frozenset(),
        default_agent_slugs=frozenset(),
        default_workflow_graph={
            "nodes": [
                {
                    "slug": "start",
                    "kind": "start",
                    "display_name": "Start",
                    "is_enabled": True,
                    "parameters": {},
                    "metadata": {"position": {"x": 0, "y": 0}},
                },
                {
                    "slug": "end",
                    "kind": "end",
                    "display_name": "End",
                    "is_enabled": True,
                    "parameters": {},
                    "metadata": {"position": {"x": 320, "y": 0}},
                },
            ],
            "edges": [
                {
                    "source": "start",
                    "target": "end",
                    "metadata": {"label": ""},
                }
            ],
        },
    )


def test_normalize_graph_accepts_voice_agent() -> None:
    service = WorkflowService(
        session_factory=lambda: None,
        workflow_defaults=_build_defaults(),
    )

    nodes, edges = service._normalize_graph(  # type: ignore[attr-defined]
        {
            "nodes": [
                {"slug": "start", "kind": "start", "is_enabled": True},
                {
                    "slug": "voice",
                    "kind": "voice_agent",
                    "agent_key": " voice-writer ",
                    "is_enabled": True,
                },
                {"slug": "end", "kind": "end", "is_enabled": True},
            ],
            "edges": [
                {"source": "start", "target": "voice"},
                {"source": "voice", "target": "end"},
            ],
        }
    )

    voice_node = next(node for node in nodes if node.slug == "voice")
    assert voice_node.kind == "voice_agent"
    assert voice_node.agent_key == "voice-writer"
    assert edges[0].source_slug == "start"
    assert edges[1].target_slug == "end"


def test_normalize_graph_voice_agent_validates_supported_keys() -> None:
    service = WorkflowService(
        session_factory=lambda: None,
        workflow_defaults=_build_defaults(),
    )

    with pytest.raises(WorkflowValidationError) as excinfo:
        service._normalize_graph(  # type: ignore[attr-defined]
            {
                "nodes": [
                    {"slug": "start", "kind": "start", "is_enabled": True},
                    {
                        "slug": "voice",
                        "kind": "voice_agent",
                        "agent_key": "unknown",
                        "is_enabled": True,
                    },
                    {"slug": "end", "kind": "end", "is_enabled": True},
                ],
                "edges": [
                    {"source": "start", "target": "voice"},
                    {"source": "voice", "target": "end"},
                ],
            }
        )

    assert "Agent inconnu" in str(excinfo.value)


def test_normalize_graph_voice_agent_accepts_tools() -> None:
    service = WorkflowService(
        session_factory=lambda: None,
        workflow_defaults=_build_defaults(),
    )

    nodes, _edges = service._normalize_graph(  # type: ignore[attr-defined]
        {
            "nodes": [
                {"slug": "start", "kind": "start", "is_enabled": True},
                {
                    "slug": "voice",
                    "kind": "voice_agent",
                    "agent_key": "voice-writer",
                    "is_enabled": True,
                    "parameters": {
                        "tools": [
                            {
                                "type": "workflow",
                                "workflow": {"slug": "  demo-voice  ", "id": "12"},
                                "title": "Demo workflow",
                            }
                        ]
                    },
                },
                {"slug": "end", "kind": "end", "is_enabled": True},
            ],
            "edges": [
                {"source": "start", "target": "voice"},
                {"source": "voice", "target": "end"},
            ],
        }
    )

    voice_node = next(node for node in nodes if node.slug == "voice")
    parameters = (
        voice_node.parameters if isinstance(voice_node.parameters, dict) else {}
    )
    tools = parameters.get("tools")
    assert isinstance(tools, list)
    assert tools and tools[0]["type"] == "workflow"
    assert tools[0]["workflow"] == {"slug": "demo-voice", "id": 12}


@dataclass
class _Step:
    id: int
    slug: str
    kind: str
    position: int
    is_enabled: bool
    parameters: dict[str, object]
    created_at: dt.datetime
    updated_at: dt.datetime
    display_name: str | None = None
    agent_key: str | None = None
    ui_metadata: dict[str, object] | None = None


@dataclass
class _Transition:
    id: int
    source_step: _Step
    target_step: _Step
    condition: str | None
    created_at: dt.datetime
    updated_at: dt.datetime
    ui_metadata: dict[str, object] | None = None


def test_serialize_definition_includes_voice_agent_step() -> None:
    timestamp = dt.datetime(2024, 1, 1, tzinfo=dt.UTC)
    start_step = _Step(
        id=1,
        slug="start",
        kind="start",
        position=1,
        is_enabled=True,
        parameters={},
        created_at=timestamp,
        updated_at=timestamp,
        display_name="Start",
        ui_metadata={"position": {"x": 0, "y": 0}},
    )
    voice_step = _Step(
        id=2,
        slug="voice",
        kind="voice_agent",
        position=2,
        is_enabled=True,
        parameters={
            "mode": "voice",
            "tools": [
                {"type": "workflow", "workflow": {"slug": "demo", "id": 7}}
            ],
        },
        created_at=timestamp,
        updated_at=timestamp,
        display_name="Voice agent",
        agent_key="voice-writer",
        ui_metadata={"position": {"x": 160, "y": 0}},
    )
    end_step = _Step(
        id=3,
        slug="end",
        kind="end",
        position=3,
        is_enabled=True,
        parameters={},
        created_at=timestamp,
        updated_at=timestamp,
        display_name="End",
        ui_metadata={"position": {"x": 320, "y": 0}},
    )

    transitions = [
        _Transition(
            id=10,
            source_step=start_step,
            target_step=voice_step,
            condition=None,
            created_at=timestamp,
            updated_at=timestamp,
            ui_metadata={"position": {}},
        ),
        _Transition(
            id=11,
            source_step=voice_step,
            target_step=end_step,
            condition=None,
            created_at=timestamp,
            updated_at=timestamp,
            ui_metadata={"position": {}},
        ),
    ]

    workflow = SimpleNamespace(
        slug="demo",
        display_name="Demo",
        is_chatkit_default=False,
    )

    definition = SimpleNamespace(
        id=100,
        workflow_id=200,
        workflow=workflow,
        name="Voice workflow",
        version=1,
        is_active=True,
        created_at=timestamp,
        updated_at=timestamp,
        steps=[start_step, voice_step, end_step],
        transitions=transitions,
    )

    payload = serialize_definition(definition)

    assert [step["slug"] for step in payload["graph"]["nodes"]] == [
        "start",
        "voice",
        "end",
    ]
    assert payload["steps"] == [
        {
            "id": 2,
            "agent_key": "voice-writer",
            "position": 2,
            "is_enabled": True,
            "parameters": {
                "mode": "voice",
                "tools": [
                    {"type": "workflow", "workflow": {"slug": "demo", "id": 7}}
                ],
            },
            "created_at": timestamp,
            "updated_at": timestamp,
        }
    ]

    assert any(
        node["kind"] == "voice_agent" for node in payload["graph"]["nodes"]
    )

