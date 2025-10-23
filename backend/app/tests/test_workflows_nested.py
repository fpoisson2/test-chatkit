import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
CHATKIT_SDK_ROOT = ROOT_DIR / "chatkit-python"
if str(CHATKIT_SDK_ROOT) not in sys.path:
    sys.path.insert(0, str(CHATKIT_SDK_ROOT))
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

def _load_dependencies():
    agents_module = import_module("chatkit.agents")
    types_module = import_module("chatkit.types")
    chatkit_module = import_module("backend.app.chatkit")
    service_module = import_module("backend.app.workflows.service")

    return (
        agents_module.AgentContext,
        types_module.ActiveStatus,
        types_module.ThreadMetadata,
        chatkit_module.WorkflowExecutionError,
        chatkit_module.WorkflowInput,
        chatkit_module.run_workflow,
        service_module.WorkflowNotFoundError,
        service_module.WorkflowVersionNotFoundError,
    )


(
    AgentContext,
    ActiveStatus,
    ThreadMetadata,
    WorkflowExecutionError,
    WorkflowInput,
    run_workflow,
    WorkflowNotFoundError,
    WorkflowVersionNotFoundError,
) = _load_dependencies()


@pytest.fixture()
def anyio_backend() -> str:
    return "asyncio"


@dataclass
class _Step:
    slug: str
    kind: str
    position: int
    is_enabled: bool = True
    parameters: dict[str, Any] = field(default_factory=dict)
    display_name: str | None = None
    agent_key: str | None = None
    ui_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class _Transition:
    source_step: _Step
    target_step: _Step
    condition: str | None = None
    id: int | None = None


class _DummyStore:
    def __init__(self) -> None:
        self._counter = 0

    def generate_item_id(
        self, item_type: str, thread: ThreadMetadata, context: Any
    ) -> str:
        self._counter += 1
        return f"{item_type}-{self._counter}"

    def generate_thread_id(self, context: Any) -> str:
        self._counter += 1
        return f"thread-{self._counter}"


def _build_agent_context() -> AgentContext[Any]:
    thread = ThreadMetadata(
        id="thread-nested",
        created_at=datetime.now(),
        status=ActiveStatus(),
        metadata={},
    )
    request_context = SimpleNamespace(
        user_id="user-1",
        email="user@example.com",
        public_base_url="https://frontend.invalid",
    )
    return AgentContext(
        thread=thread,
        store=_DummyStore(),
        request_context=request_context,
    )


def _build_definition(
    *,
    workflow_id: int,
    slug: str,
    steps: list[_Step],
    transitions: list[_Transition],
    version_id: int,
) -> SimpleNamespace:
    workflow = SimpleNamespace(
        id=workflow_id,
        slug=slug,
        display_name=slug.replace("-", " ").title(),
        active_version_id=version_id,
    )
    return SimpleNamespace(
        id=version_id,
        version=1,
        workflow_id=workflow_id,
        workflow=workflow,
        steps=steps,
        transitions=transitions,
    )


class _FakeWorkflowService:
    def __init__(self, definitions: list[SimpleNamespace]) -> None:
        self._definitions = {
            definition.workflow_id: definition for definition in definitions
        }
        self._workflows = {
            definition.workflow_id: SimpleNamespace(
                id=definition.workflow_id,
                slug=definition.workflow.slug,
                display_name=definition.workflow.display_name,
                active_version_id=definition.id,
            )
            for definition in definitions
        }
        self._current = definitions[0]

    def get_current(self) -> SimpleNamespace:  # pragma: no cover - simple access
        return self._current

    def get_definition_by_slug(self, slug: str) -> SimpleNamespace:
        for definition in self._definitions.values():
            if getattr(definition.workflow, "slug", None) == slug:
                return definition
        raise WorkflowExecutionError(
            "configuration",
            "Slug introuvable",
            RuntimeError(slug),
            [],
        )

    def get_workflow(self, workflow_id: int) -> SimpleNamespace:
        workflow = self._workflows.get(workflow_id)
        if workflow is None:
            raise WorkflowNotFoundError(workflow_id)
        return workflow

    def get_version(self, workflow_id: int, version_id: int) -> SimpleNamespace:
        definition = self._definitions.get(workflow_id)
        if definition is None or definition.id != version_id:
            raise WorkflowVersionNotFoundError(workflow_id, version_id)
        return definition


def _nested_workflow_definition(message: str, workflow_id: int) -> SimpleNamespace:
    start = _Step(slug="start", kind="start", position=1)
    assistant = _Step(
        slug="assistant",
        kind="assistant_message",
        position=2,
        parameters={"message": message},
    )
    end = _Step(slug="end", kind="end", position=3)
    transitions = [
        _Transition(source_step=start, target_step=assistant, id=1),
        _Transition(source_step=assistant, target_step=end, id=2),
    ]
    return _build_definition(
        workflow_id=workflow_id,
        slug=f"nested-{workflow_id}",
        steps=[start, assistant, end],
        transitions=transitions,
        version_id=workflow_id * 10,
    )


def _parent_definition(
    *, workflow_id: int, nested_reference: dict[str, Any]
) -> SimpleNamespace:
    start = _Step(slug="start", kind="start", position=1)
    agent = _Step(
        slug="agent",
        kind="agent",
        position=2,
        parameters={"workflow": nested_reference},
    )
    end = _Step(slug="end", kind="end", position=3)
    transitions = [
        _Transition(source_step=start, target_step=agent, id=1),
        _Transition(source_step=agent, target_step=end, id=2),
    ]
    return _build_definition(
        workflow_id=workflow_id,
        slug=f"parent-{workflow_id}",
        steps=[start, agent, end],
        transitions=transitions,
        version_id=workflow_id * 10,
    )


@pytest.mark.anyio
async def test_nested_workflow_propagates_context() -> None:
    nested_definition = _nested_workflow_definition("Nested response", workflow_id=2)
    parent_definition = _parent_definition(
        workflow_id=1,
        nested_reference={"id": nested_definition.workflow_id},
    )
    service = _FakeWorkflowService([parent_definition, nested_definition])

    summary = await run_workflow(
        WorkflowInput(
            input_as_text="Bonjour",
            auto_start_was_triggered=False,
            auto_start_assistant_message=None,
            source_item_id=None,
        ),
        agent_context=_build_agent_context(),
        workflow_service=service,
    )

    assert summary.last_context is not None
    assert (
        summary.last_context.get("workflow", {}).get("id")
        == nested_definition.workflow_id
    )
    assert summary.state is not None
    assert (
        summary.state.get("last_agent_key")
        == f"workflow:{nested_definition.workflow.slug}"
    )
    assert "Nested response" in summary.state.get("last_agent_output_text", "")
    step_keys = [step.key for step in summary.steps]
    assert "assistant" in step_keys  # nested workflow step recorded


@pytest.mark.anyio
async def test_nested_workflow_cycle_detection_raises() -> None:
    parent_definition = _parent_definition(
        workflow_id=10,
        nested_reference={"id": 20},
    )
    nested_definition = _parent_definition(
        workflow_id=20,
        nested_reference={"id": 10},
    )
    service = _FakeWorkflowService([parent_definition, nested_definition])

    with pytest.raises(WorkflowExecutionError) as exc_info:
        await run_workflow(
            WorkflowInput(
                input_as_text="Bonjour",
                auto_start_was_triggered=False,
                auto_start_assistant_message=None,
                source_item_id=None,
            ),
            agent_context=_build_agent_context(),
            workflow_service=service,
        )

    assert "Cycle de workflow" in str(exc_info.value)
