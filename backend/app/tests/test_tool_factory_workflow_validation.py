import json
import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.app.tool_builders.workflow import (  # noqa: E402 - import après ajustement du path
    WorkflowValidationResult,
    validate_workflow_graph,
)


@pytest.mark.parametrize(
    "payload",
    ["", "   ", "\n\t"],
)
def test_validate_workflow_graph_rejects_empty_string(payload: str) -> None:
    result = validate_workflow_graph(payload)

    assert isinstance(result, WorkflowValidationResult)
    assert result.valid is False
    assert result.normalized_graph is None
    assert result.errors == ["Le graphe de workflow fourni est vide."]


def test_validate_workflow_graph_rejects_invalid_json() -> None:
    result = validate_workflow_graph('{"nodes": [}')

    assert result.valid is False
    assert result.normalized_graph is None
    assert result.errors and "JSON invalide" in result.errors[0]


def test_validate_workflow_graph_reports_functional_errors() -> None:
    payload = json.dumps({"nodes": [], "edges": []})

    result = validate_workflow_graph(payload)

    assert result.valid is False
    assert result.normalized_graph is None
    assert result.errors == ["Le workflow doit contenir au moins un nœud."]


def test_validate_workflow_graph_returns_normalized_structure() -> None:
    graph = {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {
                "slug": "assistant",
                "kind": "assistant_message",
                "parameters": {"message": "Bonjour"},
            },
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [
            {"source": "start", "target": "assistant"},
            {"source": "assistant", "target": "end"},
        ],
    }

    result = validate_workflow_graph(graph)

    assert result.valid is True
    assert result.errors == []
    assert result.normalized_graph is not None

    normalized_nodes = (
        result.normalized_graph.get("nodes") if result.normalized_graph else None
    )
    assert isinstance(normalized_nodes, list)
    assert {node["slug"] for node in normalized_nodes} == {
        "start",
        "assistant",
        "end",
    }

    assistant_node = next(
        node for node in normalized_nodes if node["slug"] == "assistant"
    )
    assert assistant_node["parameters"] == {"message": "Bonjour"}

    normalized_edges = (
        result.normalized_graph.get("edges") if result.normalized_graph else None
    )
    assert isinstance(normalized_edges, list)
    assert {(
        edge["source_slug"],
        edge["target_slug"],
    ) for edge in normalized_edges} == {("start", "assistant"), ("assistant", "end")}
