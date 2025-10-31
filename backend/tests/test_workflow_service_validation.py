from __future__ import annotations

import sys
from pathlib import Path

import pytest

pytest.importorskip("fastapi")


def _load_backend_modules():
    backend_dir = Path(__file__).resolve().parents[1]
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    from app.config import WorkflowDefaults as workflow_defaults_cls
    from app.workflows.service import WorkflowService as workflow_service_cls

    return workflow_defaults_cls, workflow_service_cls


WorkflowDefaults, WorkflowService = _load_backend_modules()


def _make_workflow_service() -> WorkflowService:
    defaults = WorkflowDefaults(
        default_end_message="",
        default_workflow_slug="default",
        default_workflow_display_name="Default",
        supported_agent_keys=frozenset(),
        expected_state_slugs=frozenset(),
        default_agent_slugs=frozenset(),
        default_workflow_graph={"nodes": [], "edges": []},
    )
    return WorkflowService(session_factory=lambda: None, workflow_defaults=defaults)


def test_validate_graph_allows_outbound_call_node() -> None:
    service = _make_workflow_service()

    payload = {
        "nodes": [
            {
                "slug": "outbound-call-1",
                "kind": "outbound_call",
                "display_name": "Outbound call",
                "agent_key": None,
                "is_enabled": True,
                "parameters": {},
                "metadata": {},
            }
        ],
        "edges": [],
    }

    normalized = service.validate_graph_payload(payload)

    assert normalized["nodes"][0]["kind"] == "outbound_call"
