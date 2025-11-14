import asyncio
import json
import os
import sys
import types
from collections.abc import Awaitable, Callable
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

try:  # pragma: no cover - dépendance optionnelle
    import pgvector.sqlalchemy  # noqa: F401
except ModuleNotFoundError:  # pragma: no cover - dépendance optionnelle
    pgvector_module = types.ModuleType("pgvector")
    sql_module = types.ModuleType("pgvector.sqlalchemy")

    class _FallbackVector:  # pragma: no cover - simple stub
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            del args, kwargs

    sql_module.Vector = _FallbackVector
    sys.modules["pgvector"] = pgvector_module
    sys.modules["pgvector.sqlalchemy"] = sql_module
if "agents" not in sys.modules:  # pragma: no cover - dépendance optionnelle
    agents_module = types.ModuleType("agents")

    class _FallbackAgent:
        def __init__(self, name: str, model: str | None = None, **kwargs: Any) -> None:
            self.name = name
            self.model = model
            self.kwargs = kwargs

    class _FallbackRunConfig(dict):
        def __init__(self, **kwargs: Any) -> None:
            super().__init__(**kwargs)
            self.__dict__.update(kwargs)

    class _FallbackRunner:
        @staticmethod
        async def run_streamed(*args: Any, **kwargs: Any) -> Any:  # pragma: no cover
            raise RuntimeError("Runner non disponible dans les tests")

    class _FallbackModelSettings(dict):
        def model_dump(self, **kwargs: Any) -> dict[str, Any]:  # pragma: no cover
            return dict(self)

    class _FallbackWebSearchTool:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            del args, kwargs

    agents_module.Agent = _FallbackAgent
    agents_module.RunConfig = _FallbackRunConfig
    agents_module.Runner = _FallbackRunner
    agents_module.TResponseInputItem = Any
    def _fallback_set_default_openai_client(*args: Any, **kwargs: Any) -> None:
        return None

    agents_module.ModelSettings = _FallbackModelSettings
    agents_module.WebSearchTool = _FallbackWebSearchTool
    agents_module.set_default_openai_client = _fallback_set_default_openai_client

    mcp_module = types.ModuleType("agents.mcp")

    class _FallbackMCPServer:
        async def connect(self) -> None:  # pragma: no cover - simple stub
            return None

        async def cleanup(self) -> None:  # pragma: no cover - simple stub
            return None

    mcp_module.MCPServer = _FallbackMCPServer
    mcp_module.MCPServerSse = _FallbackMCPServer
    mcp_module.MCPServerStreamableHttp = _FallbackMCPServer
    sys.modules["agents"] = agents_module
    sys.modules["agents.mcp"] = mcp_module
    handoffs_module = types.ModuleType("agents.handoffs")

    class _FallbackHandoff:
        pass

    handoffs_module.Handoff = _FallbackHandoff
    sys.modules["agents.handoffs"] = handoffs_module

    realtime_package = types.ModuleType("agents.realtime")
    realtime_agent_module = types.ModuleType("agents.realtime.agent")

    class _FallbackRealtimeAgent:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            del args, kwargs

    realtime_agent_module.RealtimeAgent = _FallbackRealtimeAgent
    sys.modules["agents.realtime"] = realtime_package
    sys.modules["agents.realtime.agent"] = realtime_agent_module
    realtime_config_module = types.ModuleType("agents.realtime.config")

    class _FallbackRealtimeRunConfig(dict):
        pass

    realtime_config_module.RealtimeRunConfig = _FallbackRealtimeRunConfig
    sys.modules["agents.realtime.config"] = realtime_config_module
    realtime_runner_module = types.ModuleType("agents.realtime.runner")

    class _FallbackRealtimeRunner:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            del args, kwargs

    realtime_runner_module.RealtimeRunner = _FallbackRealtimeRunner
    sys.modules["agents.realtime.runner"] = realtime_runner_module
    sys.modules.setdefault("agents.extensions", types.ModuleType("agents.extensions"))
    sys.modules.setdefault(
        "agents.extensions.models", types.ModuleType("agents.extensions.models")
    )
    litellm_module = types.ModuleType("agents.extensions.models.litellm_model")

    class _FallbackLitellmModel:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            del args, kwargs

    litellm_module.LitellmModel = _FallbackLitellmModel
    sys.modules["agents.extensions.models.litellm_model"] = litellm_module

    models_package = types.ModuleType("agents.models")
    sys.modules.setdefault("agents.models", models_package)
    interface_module = types.ModuleType("agents.models.interface")

    class _FallbackModelProvider:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            del args, kwargs

    interface_module.ModelProvider = _FallbackModelProvider
    sys.modules["agents.models.interface"] = interface_module

    openai_module = types.ModuleType("agents.models.openai_provider")

    class _FallbackOpenAIProvider(_FallbackModelProvider):
        pass

    openai_module.OpenAIProvider = _FallbackOpenAIProvider
    sys.modules["agents.models.openai_provider"] = openai_module

    tool_module = types.ModuleType("agents.tool")

    class _FallbackComputerTool:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            del args, kwargs

    class _FallbackTool(_FallbackComputerTool):
        pass

    tool_module.ComputerTool = _FallbackComputerTool
    tool_module.Tool = _FallbackTool
    tool_module.CodeInterpreterTool = _FallbackTool
    tool_module.FileSearchTool = _FallbackTool
    tool_module.FunctionTool = _FallbackTool
    tool_module.HostedMCPTool = _FallbackTool
    tool_module.ImageGenerationTool = _FallbackTool
    tool_module.LocalShellTool = _FallbackTool
    tool_module.WebSearchTool = _FallbackWebSearchTool
    sys.modules["agents.tool"] = tool_module

@dataclass
class _FallbackThreadMetadata:
    id: str
    created_at: datetime
    status: Any | None = None
    metadata: dict[str, Any] | None = None


class _FallbackActiveStatus:
    type = "active"

    def __init__(self, *args: Any, **kwargs: Any) -> None:  # pragma: no cover - trivial
        del args, kwargs


@dataclass
class _FallbackAgentContext:
    thread: Any
    store: Any
    request_context: Any

    @classmethod
    def __class_getitem__(
        cls, _: Any
    ) -> type["_FallbackAgentContext"]:  # pragma: no cover
        return cls


if "chatkit.agents" not in sys.modules:  # pragma: no cover - dépendance optionnelle
    chatkit_agents_module = types.ModuleType("chatkit.agents")

    class _FallbackThreadItemConverter:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            del args, kwargs

        def to_input_items(self, items: list[Any]) -> list[Any]:
            return list(items or [])

        def for_context(self, context: Any) -> "_FallbackThreadItemConverter":
            return self

    async def _fallback_stream_agent_response(*args: Any, **kwargs: Any):
        if False:
            yield None  # pragma: no cover - generator requirement

    def _fallback_simple_to_agent_input(*args: Any, **kwargs: Any) -> list[Any]:
        return []

    chatkit_agents_module.AgentContext = _FallbackAgentContext
    chatkit_agents_module.ThreadItemConverter = _FallbackThreadItemConverter
    chatkit_agents_module.TResponseInputItem = Any
    chatkit_agents_module.stream_agent_response = _fallback_stream_agent_response
    chatkit_agents_module.simple_to_agent_input = _fallback_simple_to_agent_input

    sys.modules["chatkit.agents"] = chatkit_agents_module

if (
    "backend.app.tool_factory" not in sys.modules
):  # pragma: no cover - dépendance optionnelle
    tool_factory_module = types.ModuleType("backend.app.tool_factory")

    @dataclass
    class _FallbackResolvedMcpServerContext:
        server_id: str | None = None

    def _noop_tool(*args: Any, **kwargs: Any) -> None:
        return None

    tool_factory_module.ResolvedMcpServerContext = _FallbackResolvedMcpServerContext
    tool_factory_module.build_computer_use_tool = _noop_tool
    tool_factory_module.build_file_search_tool = _noop_tool
    tool_factory_module.build_image_generation_tool = _noop_tool
    tool_factory_module.build_mcp_tool = _noop_tool
    tool_factory_module.build_weather_tool = _noop_tool
    tool_factory_module.build_web_search_tool = _noop_tool
    tool_factory_module.build_widget_validation_tool = _noop_tool
    tool_factory_module.build_workflow_tool = _noop_tool
    tool_factory_module.get_mcp_runtime_context = _noop_tool
    tool_factory_module._MODULE_PATHS = {}

    def _fallback_getattr(name: str) -> Any:  # pragma: no cover - robustness
        return _noop_tool

    tool_factory_module.__getattr__ = _fallback_getattr  # type: ignore[assignment]
    sys.modules["backend.app.tool_factory"] = tool_factory_module

try:
    from agents import Agent  # noqa: E402
except ModuleNotFoundError:  # pragma: no cover - dépendance optionnelle
    @dataclass
    class Agent:  # type: ignore[override]
        name: str
        model: str | None = None
from backend.app.model_capabilities import (  # noqa: E402
    ModelCapabilities,
    NormalizedModelKey,
    iter_model_capability_keys,
)


def _load_dependencies():
    try:
        agents_module = import_module("chatkit.agents")
    except Exception:  # pragma: no cover - dépendances externes manquantes
        agents_module = SimpleNamespace(
            AgentContext=_FallbackAgentContext,
        )

    try:
        types_module = import_module("chatkit.types")
    except Exception:  # pragma: no cover - dépendances externes manquantes
        types_module = SimpleNamespace(
            ActiveStatus=_FallbackActiveStatus,
            ThreadMetadata=_FallbackThreadMetadata,
        )
    try:
        chatkit_module = import_module("backend.app.chatkit")
    except Exception:  # pragma: no cover - dépendances externes manquantes
        from backend.app.workflows.executor import (  # noqa: E402
            WorkflowExecutionError as _WorkflowExecutionError,
        )
        from backend.app.workflows.executor import (
            WorkflowInput as _WorkflowInput,
        )
        from backend.app.workflows.executor import (
            run_workflow as _run_workflow,
        )

        chatkit_module = SimpleNamespace(
            WorkflowExecutionError=_WorkflowExecutionError,
            WorkflowInput=_WorkflowInput,
            run_workflow=_run_workflow,
        )

    try:
        service_module = import_module("backend.app.workflows.service")
    except Exception:  # pragma: no cover - dépendances externes manquantes
        from backend.app.workflows.service import (  # noqa: E402
            WorkflowNotFoundError as _WorkflowNotFoundError,
        )
        from backend.app.workflows.service import (
            WorkflowVersionNotFoundError as _WorkflowVersionNotFoundError,
        )

        service_module = SimpleNamespace(
            WorkflowNotFoundError=_WorkflowNotFoundError,
            WorkflowVersionNotFoundError=_WorkflowVersionNotFoundError,
        )

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
        self.saved_threads: list[ThreadMetadata] = []

    def generate_item_id(
        self, item_type: str, thread: ThreadMetadata, context: Any
    ) -> str:
        self._counter += 1
        return f"{item_type}-{self._counter}"

    def generate_thread_id(self, context: Any) -> str:
        self._counter += 1
        return f"thread-{self._counter}"

    async def save_thread(
        self, thread: ThreadMetadata, context: Any
    ) -> None:  # pragma: no cover - simple stockage en mémoire
        self.saved_threads.append(thread.model_copy(deep=True))


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
    def __init__(
        self,
        definitions: list[SimpleNamespace],
        *,
        model_capabilities: dict[tuple[str, str, str], ModelCapabilities] | None = None,
    ) -> None:
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
        self._model_capabilities = model_capabilities or {}

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

    def get_available_model_capabilities(
        self,
    ) -> dict[NormalizedModelKey, ModelCapabilities]:
        return dict(self._model_capabilities)


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
async def test_end_block_populates_final_output() -> None:
    start = _Step(slug="start", kind="start", position=1)
    end_message = "À bientôt"
    end_reason = "Conversation terminée"
    end = _Step(
        slug="end",
        kind="end",
        position=2,
        parameters={
            "message": end_message,
            "status": {"type": "closed", "reason": end_reason},
        },
    )

    definition = _build_definition(
        workflow_id=42,
        slug="simple-end",
        steps=[start, end],
        transitions=[_Transition(source_step=start, target_step=end)],
        version_id=420,
    )

    service = _FakeWorkflowService([definition])

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

    assert summary.final_output is not None
    assert summary.final_output.get("message") == end_message
    assert summary.final_output.get("status_reason") == end_reason

    assert summary.steps, "Le bloc de fin doit être enregistré dans l'historique"
    final_step = summary.steps[-1]
    assert final_step.key == "end"
    assert end_message in final_step.output

    assert summary.last_context is not None
    assert summary.last_context.get("output_text") == end_message


@pytest.mark.anyio
async def test_end_block_with_ags_configuration() -> None:
    start = _Step(slug="start", kind="start", position=1)
    set_state = _Step(
        slug="set-grade",
        kind="state",
        position=2,
        parameters={
            "state": [
                {"target": "state.grade.score", "expression": 17.5},
                {
                    "target": "state.grade.comment",
                    "expression": '"Très bon travail"',
                },
            ]
        },
    )
    end = _Step(
        slug="end",
        kind="end",
        position=3,
        parameters={
            "message": "Félicitations",
            "status": {"type": "closed", "reason": "Évaluation terminée"},
            "ags": {
                "score_variable_id": "quiz-final",
                "maximum": 20,
                "value": "state.grade.score",
                "comment": "state.grade.comment",
            },
        },
    )

    definition = _build_definition(
        workflow_id=99,
        slug="ags-end",
        steps=[start, set_state, end],
        transitions=[
            _Transition(source_step=start, target_step=set_state),
            _Transition(source_step=set_state, target_step=end),
        ],
        version_id=990,
    )

    service = _FakeWorkflowService([definition])

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

    assert summary.end_state is not None
    assert summary.end_state.ags_variable_id == "quiz-final"
    assert summary.end_state.ags_score_value == pytest.approx(17.5)
    assert summary.end_state.ags_score_maximum == pytest.approx(20.0)
    assert summary.end_state.ags_comment == "Très bon travail"

    assert summary.final_output is not None
    ags_payload = summary.final_output.get("ags")
    assert ags_payload == {
        "variable_id": "quiz-final",
        "score": pytest.approx(17.5),
        "maximum": pytest.approx(20.0),
        "comment": "Très bon travail",
    }

    assert summary.last_context is not None
    end_state_payload = summary.last_context.get("end_state")
    assert end_state_payload is not None
    assert end_state_payload.get("ags") == ags_payload


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


@pytest.mark.anyio
async def test_nested_workflow_conversation_history_propagates() -> None:
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

    assert summary.state is not None
    conversation_history = summary.state.get("conversation_history")
    assert isinstance(conversation_history, list)
    assert any(
        isinstance(entry, dict)
        and entry.get("role") == "assistant"
        and any(
            isinstance(content_item, dict)
            and isinstance(content_item.get("text"), str)
            and "Nested response" in content_item.get("text", "")
            for content_item in entry.get("content", [])
        )
        for entry in conversation_history
    )


@pytest.mark.anyio
async def test_run_workflow_reuses_previous_response_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor_module = import_module("backend.app.workflows.executor")

    recorded_previous_ids: list[str | None] = []
    call_counter = {"value": 0}

    class _StubRunItem:
        def __init__(self, label: str) -> None:
            self._label = label

        def to_input_item(self) -> dict[str, Any]:
            return {
                "type": "message",
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": f"Sortie {self._label}",
                    }
                ],
            }

    class _StubRunResult:
        def __init__(self, response_id: str) -> None:
            self.last_response_id = response_id
            self.new_items = [_StubRunItem(response_id)]
            self.final_output = {"message": f"output-{response_id}"}

    def _fake_run_streamed(cls, *args, **kwargs):
        recorded_previous_ids.append(kwargs.get("previous_response_id"))
        call_counter["value"] += 1
        return _StubRunResult(f"resp-{call_counter['value']}")

    async def _fake_stream_agent_response(*_args, **_kwargs):
        if False:  # pragma: no cover - générateur artificiel
            yield None
        return

    async def _fake_ingest_workflow_step(*_args, **_kwargs) -> None:
        return None

    monkeypatch.setattr(
        executor_module.Runner,
        "run_streamed",
        classmethod(_fake_run_streamed),
    )
    monkeypatch.setattr(
        executor_module,
        "stream_agent_response",
        _fake_stream_agent_response,
    )
    monkeypatch.setattr(
        executor_module,
        "ingest_workflow_step",
        _fake_ingest_workflow_step,
    )

    from backend.app.chatkit.agent_registry import AGENT_BUILDERS

    def _build_test_agent(_overrides: dict[str, Any] | None = None) -> Agent:
        return Agent(name="Test agent", model="gpt-4o-mini")

    monkeypatch.setitem(AGENT_BUILDERS, "agent", _build_test_agent)

    start = _Step(slug="start", kind="start", position=1)
    agent_step = _Step(
        slug="agent",
        kind="agent",
        position=2,
        agent_key="agent",
    )
    end = _Step(slug="end", kind="end", position=3)
    transitions = [
        _Transition(source_step=start, target_step=agent_step, id=1),
        _Transition(source_step=agent_step, target_step=end, id=2),
    ]
    definition = _build_definition(
        workflow_id=99,
        slug="response-loop",
        steps=[start, agent_step, end],
        transitions=transitions,
        version_id=990,
    )
    service = _FakeWorkflowService([definition])

    context = _build_agent_context()
    context.previous_response_id = "initial-response"

    payload = WorkflowInput(
        input_as_text="Bonjour",
        auto_start_was_triggered=False,
        auto_start_assistant_message=None,
        source_item_id=None,
    )

    await run_workflow(payload, agent_context=context, workflow_service=service)
    await run_workflow(payload, agent_context=context, workflow_service=service)

    assert recorded_previous_ids == ["initial-response", "resp-1"]
    assert context.previous_response_id == "resp-2"
    assert context.thread.metadata.get("previous_response_id") == "resp-2"
    saved_threads = getattr(context.store, "saved_threads", [])
    assert saved_threads
    assert saved_threads[-1].metadata.get("previous_response_id") == "resp-2"


@pytest.mark.anyio
async def test_run_workflow_skips_previous_response_when_unsupported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor_module = import_module("backend.app.workflows.executor")

    recorded_previous_ids: list[str | None] = []

    class _StubRunItem:
        def __init__(self, label: str) -> None:
            self._label = label

        def to_input_item(self) -> dict[str, Any]:
            return {
                "type": "message",
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": f"Sortie {self._label}",
                    }
                ],
            }

    class _StubRunResult:
        def __init__(self, response_id: str) -> None:
            self.last_response_id = response_id
            self.new_items = [_StubRunItem(response_id)]
            self.final_output = {"message": f"output-{response_id}"}

    def _fake_run_streamed(cls, *args, **kwargs):
        recorded_previous_ids.append(kwargs.get("previous_response_id"))
        return _StubRunResult("resp-1")

    async def _fake_stream_agent_response(*_args, **_kwargs):
        if False:  # pragma: no cover - générateur artificiel
            yield None
        return

    async def _fake_ingest_workflow_step(*_args, **_kwargs) -> None:
        return None

    monkeypatch.setattr(
        executor_module.Runner,
        "run_streamed",
        classmethod(_fake_run_streamed),
    )
    monkeypatch.setattr(
        executor_module,
        "stream_agent_response",
        _fake_stream_agent_response,
    )
    monkeypatch.setattr(
        executor_module,
        "ingest_workflow_step",
        _fake_ingest_workflow_step,
    )

    from backend.app.chatkit.agent_registry import AGENT_BUILDERS

    def _build_test_agent(_overrides: dict[str, Any] | None = None) -> Agent:
        return Agent(name="Test agent", model="gpt-4o-mini")

    monkeypatch.setitem(AGENT_BUILDERS, "agent", _build_test_agent)

    start = _Step(slug="start", kind="start", position=1)
    agent_step = _Step(
        slug="agent",
        kind="agent",
        position=2,
        agent_key="agent",
        parameters={"model": "gpt-4o-mini"},
    )
    end = _Step(slug="end", kind="end", position=3)
    transitions = [
        _Transition(source_step=start, target_step=agent_step, id=1),
        _Transition(source_step=agent_step, target_step=end, id=2),
    ]
    definition = _build_definition(
        workflow_id=100,
        slug="response-loop-disabled",
        steps=[start, agent_step, end],
        transitions=transitions,
        version_id=991,
    )

    capabilities = ModelCapabilities(
        supports_previous_response_id=False,
        supports_reasoning_summary=True,
    )
    capability_index = {
        key: capabilities
        for key in iter_model_capability_keys("gpt-4o-mini", None, None)
    }
    service = _FakeWorkflowService([definition], model_capabilities=capability_index)

    context = _build_agent_context()
    context.previous_response_id = "initial-response"

    payload = WorkflowInput(
        input_as_text="Bonjour",
        auto_start_was_triggered=False,
        auto_start_assistant_message=None,
        source_item_id=None,
    )

    await run_workflow(payload, agent_context=context, workflow_service=service)
    await run_workflow(payload, agent_context=context, workflow_service=service)

    assert recorded_previous_ids == [None, None]
    assert context.previous_response_id == "initial-response"
    assert context.thread.metadata.get("previous_response_id") is None
    saved_threads = getattr(context.store, "saved_threads", [])
    assert not saved_threads


@pytest.mark.anyio
async def test_workflow_tool_emits_ui_events(monkeypatch: pytest.MonkeyPatch) -> None:
    from agents.tool_context import ToolContext  # noqa: I001
    from backend.app import tool_factory
    from backend.app.workflows import executor as executor_module
    from backend.app.workflows.executor import (
        WorkflowAgentRunContext,
        WorkflowRunSummary,
        WorkflowStepStreamUpdate,
        WorkflowStepSummary,
    )

    from chatkit.types import (
        ThreadItemAddedEvent,
        ThreadItemDoneEvent,
        ThreadItemUpdated,
        WorkflowTaskAdded,
        WorkflowTaskUpdated,
    )

    agent_context = _build_agent_context()
    step_context = {"previous": "value"}
    context_wrapper = WorkflowAgentRunContext(
        agent_context=agent_context,
        step_context=step_context,
    )

    assert context_wrapper.agent_context is agent_context
    assert context_wrapper.get("previous") == "value"

    captured: dict[str, Any] = {}

    async def _fake_run_workflow(
        workflow_input: Any,
        *,
        agent_context: AgentContext,
        on_step: Callable[[WorkflowStepSummary, int], Awaitable[None]] | None,
        on_step_stream: Callable[[WorkflowStepStreamUpdate], Awaitable[None]] | None,
        on_stream_event: Callable[[Any], Awaitable[None]] | None,
        workflow_service: Any,
        workflow_slug: str,
        **_kwargs: Any,
    ) -> WorkflowRunSummary:
        captured["agent_context"] = agent_context
        if on_step_stream is not None:
            await on_step_stream(
                WorkflowStepStreamUpdate(
                    key="step-1",
                    title="Étape test",
                    index=1,
                    delta="Bonjour",
                    text="Bonjour",
                )
            )
        summary_step = WorkflowStepSummary(
            key="step-1",
            title="Étape test",
            output="Sortie finale",
        )
        if on_step is not None:
            await on_step(summary_step, 1)
        return WorkflowRunSummary(
            steps=[summary_step],
            final_output={"result": "ok"},
            final_node_slug="end",
            end_state=None,
            last_context={"output": "Sortie finale"},
            state={"last_agent_output_text": "Sortie finale"},
        )

    fake_service = SimpleNamespace()
    monkeypatch.setattr(tool_factory, "WorkflowService", lambda: fake_service)
    monkeypatch.setattr(executor_module, "run_workflow", _fake_run_workflow)

    tool = tool_factory.build_workflow_tool(
        {"slug": "child-workflow", "show_ui": True, "name": "child_workflow"}
    )

    tool_arguments = json.dumps({"initial_message": "Bonjour"})
    tool_context = ToolContext(
        context=context_wrapper,
        tool_name=tool.name,
        tool_call_id="call-1",
        tool_arguments=tool_arguments,
    )

    result = await tool.on_invoke_tool(tool_context, tool_arguments)

    assert "Étape 1" in result
    assert captured["agent_context"] is agent_context

    events: list[Any] = []
    while True:
        try:
            events.append(agent_context._events.get_nowait())
        except asyncio.QueueEmpty:
            break

    assert any(isinstance(event, ThreadItemAddedEvent) for event in events)
    assert any(
        isinstance(event, ThreadItemUpdated)
        and isinstance(getattr(event, "update", None), WorkflowTaskAdded)
        for event in events
    )
    assert any(
        isinstance(event, ThreadItemUpdated)
        and isinstance(getattr(event, "update", None), WorkflowTaskUpdated)
        for event in events
    )
    assert any(isinstance(event, ThreadItemDoneEvent) for event in events)

    assert agent_context.workflow_item is None
