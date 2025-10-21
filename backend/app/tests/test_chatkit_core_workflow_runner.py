import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[3]))
import asyncio
import os
os.environ.setdefault("DATABASE_URL", "sqlite:///")
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")


import pytest

from backend.app.chatkit_core import WorkflowExecutionError, WorkflowInput, run_workflow


class _FakeAgentContext:
    thread = None
    store = None
    request_context = None

    def generate_id(self, prefix: str) -> str:  # pragma: no cover - simple stub
        return f"{prefix}-stub"


class _EmptyWorkflowService:
    class _Definition:
        steps = []
        transitions = []
        workflow_id = None
        workflow = None

    def get_current(self):  # pragma: no cover - simple stub
        return self._Definition()


def test_run_workflow_without_start_node_raises() -> None:
    workflow_input = WorkflowInput(input_as_text="bonjour")
    service = _EmptyWorkflowService()

    with pytest.raises(WorkflowExecutionError) as exc:
        asyncio.run(
            run_workflow(
                workflow_input,
                agent_context=_FakeAgentContext(),
                workflow_service=service,
            )
        )

    assert "Aucun nœud actif disponible" in str(exc.value)
