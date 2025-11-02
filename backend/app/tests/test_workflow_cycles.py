import json
import os
import sys
import types
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

CHATKIT_SDK_ROOT = ROOT_DIR / "chatkit-python"
if str(CHATKIT_SDK_ROOT) not in sys.path:
    sys.path.insert(0, str(CHATKIT_SDK_ROOT))

try:  # pragma: no cover - dépend de l'environnement
    import fastapi  # noqa: F401
    from fastapi.middleware import cors as _cors  # noqa: F401
except ModuleNotFoundError:  # pragma: no cover - environnements légers
    fastapi_stub = types.ModuleType("fastapi")

    class _FastAPIStub:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def add_middleware(self, *args: Any, **kwargs: Any) -> None:
            pass

        def include_router(self, *args: Any, **kwargs: Any) -> None:
            pass

    fastapi_stub.FastAPI = _FastAPIStub  # type: ignore[attr-defined]

    middleware_module = types.ModuleType("fastapi.middleware")
    cors_module = types.ModuleType("fastapi.middleware.cors")

    class _CORSMiddlewareStub:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

    cors_module.CORSMiddleware = _CORSMiddlewareStub  # type: ignore[attr-defined]
    middleware_module.cors = cors_module  # type: ignore[attr-defined]
    fastapi_stub.middleware = middleware_module  # type: ignore[attr-defined]

    sys.modules["fastapi"] = fastapi_stub
    sys.modules["fastapi.middleware"] = middleware_module
    sys.modules["fastapi.middleware.cors"] = cors_module

if "dotenv" not in sys.modules:
    dotenv_stub = types.ModuleType("dotenv")

    def _load_dotenv_stub(*args: Any, **kwargs: Any) -> None:
        pass

    dotenv_stub.load_dotenv = _load_dotenv_stub  # type: ignore[attr-defined]
    sys.modules["dotenv"] = dotenv_stub

if "pydantic" not in sys.modules:
    pydantic_stub = types.ModuleType("pydantic")

    class _BaseModelStub:
        def model_dump(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
            return {}

    pydantic_stub.BaseModel = _BaseModelStub  # type: ignore[attr-defined]
    sys.modules["pydantic"] = pydantic_stub

try:  # pragma: no cover - dépendances installées dynamiquement
    import agents as _agents_module
except ModuleNotFoundError:  # pragma: no cover - environnement minimal
    agents_stub = types.ModuleType("agents")

    class _AgentStub:
        pass

    class _RunConfigStub:
        pass

    class _RunnerStub:
        async def arun(self, *args: Any, **kwargs: Any) -> None:
            raise NotImplementedError

    agents_stub.Agent = _AgentStub  # type: ignore[attr-defined]
    agents_stub.RunConfig = _RunConfigStub  # type: ignore[attr-defined]
    agents_stub.Runner = _RunnerStub  # type: ignore[attr-defined]
    agents_stub.TResponseInputItem = Any  # type: ignore[attr-defined]

    mcp_stub = types.ModuleType("agents.mcp")

    class _MCPServerStub:
        async def cleanup(self) -> None:
            pass

    mcp_stub.MCPServer = _MCPServerStub  # type: ignore[attr-defined]
    agents_stub.mcp = mcp_stub  # type: ignore[attr-defined]
    sys.modules["agents"] = agents_stub
    sys.modules["agents.mcp"] = mcp_stub
else:  # pragma: no cover - lorsque le SDK Agents est disponible
    sys.modules["agents"] = _agents_module

try:  # pragma: no cover - dépend des versions du SDK
    from agents.mcp import MCPServerSse  # type: ignore  # noqa: F401
except (ModuleNotFoundError, AttributeError, ImportError):
    # pragma: no cover - compatibilité avec les anciennes versions du SDK
    mcp_module = sys.modules.get("agents.mcp")
if mcp_module is None:
    mcp_module = types.ModuleType("agents.mcp")
    sys.modules["agents.mcp"] = mcp_module

if not hasattr(mcp_module, "MCPServer"):
    class _MCPServerStub:  # pragma: no cover - simple gardien
        async def cleanup(self) -> None:
            pass

    mcp_module.MCPServer = _MCPServerStub  # type: ignore[attr-defined]

if not hasattr(mcp_module, "MCPServerSse"):
    class _MCPServerSseStub:  # pragma: no cover - simple gardien
        async def cleanup(self) -> None:
            pass

    mcp_module.MCPServerSse = _MCPServerSseStub  # type: ignore[attr-defined]

if not hasattr(mcp_module, "MCPServerStreamableHttp"):
    class _MCPServerStreamableHttpStub:  # pragma: no cover - simple gardien
        async def cleanup(self) -> None:
            pass

    mcp_module.MCPServerStreamableHttp = _MCPServerStreamableHttpStub  # type: ignore[attr-defined]

from backend.app.workflows.executor import WorkflowInput, run_workflow  # noqa: E402
from backend.app.workflows.service import WorkflowService  # noqa: E402

from chatkit.agents import AgentContext  # noqa: E402
from chatkit.types import ActiveStatus, ThreadMetadata  # noqa: E402


@pytest.fixture()
def anyio_backend() -> str:
    return "asyncio"


class _StubWorkflowDefaults:
    def __init__(self) -> None:
        defaults_path = ROOT_DIR / "backend" / "app" / "workflows" / "defaults.json"
        payload = json.loads(defaults_path.read_text(encoding="utf-8"))
        self.default_end_message = payload.get("default_end_message", "")
        self.default_workflow_slug = payload.get("default_workflow_slug", "workflow")
        self.default_workflow_display_name = payload.get(
            "default_workflow_display_name", "Workflow"
        )
        self.supported_agent_keys = tuple(payload.get("supported_agent_keys", []))
        self.expected_state_slugs = frozenset(payload.get("expected_state_slugs", []))
        self.default_agent_slugs = frozenset(payload.get("default_agent_slugs", []))
        self._graph = payload.get("default_workflow_graph", {})

    def clone_workflow_graph(self) -> dict[str, Any]:
        return json.loads(json.dumps(self._graph))


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

    async def save_thread(
        self, thread: ThreadMetadata, context: Any
    ) -> None:  # pragma: no cover - simple in-memory store
        return None


def _build_agent_context() -> AgentContext[Any]:
    thread = ThreadMetadata(
        id="thread-cycle",
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


def _looping_graph() -> dict[str, object]:
    return {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {
                "slug": "say",
                "kind": "assistant_message",
                "is_enabled": True,
                "parameters": {"message": "Boucle"},
            },
            {
                "slug": "check",
                "kind": "condition",
                "is_enabled": True,
                "parameters": {"mode": "truthy", "path": "should_stop"},
            },
            {
                "slug": "flag",
                "kind": "state",
                "is_enabled": True,
                "parameters": {
                    "state": [
                        {"target": "state.should_stop", "expression": True},
                    ]
                },
            },
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [
            {"source": "start", "target": "say"},
            {"source": "say", "target": "check"},
            {"source": "check", "target": "end", "condition": "true"},
            {"source": "check", "target": "flag", "condition": "false"},
            {"source": "flag", "target": "check"},
        ],
    }


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


class _FakeWorkflowService:
    def __init__(self, definition: SimpleNamespace) -> None:
        self._definition = definition

    def get_available_model_capabilities(self) -> dict[tuple[str, str, str], Any]:
        return {}


def _looping_definition() -> SimpleNamespace:
    start = _Step(slug="start", kind="start", position=1)
    say = _Step(
        slug="say",
        kind="assistant_message",
        position=2,
        parameters={"message": "Boucle"},
    )
    check = _Step(
        slug="check",
        kind="condition",
        position=3,
        parameters={"mode": "truthy", "path": "should_stop"},
    )
    flag = _Step(
        slug="flag",
        kind="state",
        position=4,
        parameters={"state": [{"target": "state.should_stop", "expression": True}]},
    )
    end = _Step(slug="end", kind="end", position=5)
    transitions = [
        _Transition(source_step=start, target_step=say, id=1),
        _Transition(source_step=say, target_step=check, id=2),
        _Transition(source_step=check, target_step=end, condition="true", id=3),
        _Transition(source_step=check, target_step=flag, condition="false", id=4),
        _Transition(source_step=flag, target_step=check, id=5),
    ]
    workflow = SimpleNamespace(
        id=1,
        slug="looping-workflow",
        display_name="Looping workflow",
        active_version_id=10,
    )
    return SimpleNamespace(
        id=10,
        version=1,
        workflow_id=workflow.id,
        workflow=workflow,
        steps=[start, say, check, flag, end],
        transitions=transitions,
    )


@pytest.mark.anyio
async def test_looping_workflow_executes_until_condition() -> None:
    graph_payload = _looping_graph()

    validation_service = WorkflowService(
        session_factory=lambda: None,
        workflow_defaults=_StubWorkflowDefaults(),
    )

    normalized = validation_service.validate_graph_payload(graph_payload)
    assert normalized["edges"]

    workflow_definition = _looping_definition()
    fake_service = _FakeWorkflowService(workflow_definition)

    summary = await run_workflow(
        WorkflowInput(
            input_as_text="Salut",
            auto_start_was_triggered=False,
            auto_start_assistant_message=None,
            source_item_id=None,
        ),
        agent_context=_build_agent_context(),
        workflow_service=fake_service,
        workflow_definition=workflow_definition,
    )

    assert summary.state is not None
    assert summary.state.get("should_stop") is True
    executed_keys = [step.key for step in summary.steps]
    assert "say" in executed_keys
