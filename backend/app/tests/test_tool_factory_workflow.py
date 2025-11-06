from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")


@pytest.fixture()
def workflow_builders(monkeypatch: pytest.MonkeyPatch):
    from backend.app.tool_builders import workflow

    monkeypatch.setattr(workflow, "WorkflowService", lambda: object())
    return workflow


def test_build_workflow_tool_sanitizes_invalid_name(
    workflow_builders,
):
    tool = workflow_builders.build_workflow_tool(
        {"slug": "workflow-demo", "name": "Démo Workflow!"}
    )

    assert tool is not None
    assert tool.name == "Demo_Workflow"
    assert re.fullmatch(r"^[A-Za-z0-9_-]+$", tool.name)


def test_build_workflow_tool_uses_identifier_when_name_missing(
    workflow_builders,
):
    tool = workflow_builders.build_workflow_tool(
        {"slug": "assistant", "identifier": "Agent spécial"}
    )

    assert tool is not None
    assert tool.name == "Agent_special"
    assert re.fullmatch(r"^[A-Za-z0-9_-]+$", tool.name)


def test_build_workflow_tool_fallback_generates_valid_name(workflow_builders):
    tool = workflow_builders.build_workflow_tool({"slug": "***"})

    assert tool is not None
    assert tool.name
    assert re.fullmatch(r"^[A-Za-z0-9_-]+$", tool.name)
