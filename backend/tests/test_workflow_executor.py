import asyncio
import importlib
import sys
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace


def _load_workflow_modules():
    backend_dir = Path(__file__).resolve().parents[1]
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    import types

    if "agents" not in sys.modules:
        agents_module = types.ModuleType("agents")

        class _StubAgent:  # pragma: no cover - stub
            pass

        class _StubRunConfig:  # pragma: no cover - stub
            def __init__(self, **kwargs) -> None:
                self.kwargs = kwargs

        class _StubRunner:  # pragma: no cover - stub
            @staticmethod
            def run_streamed(*args, **kwargs):  # type: ignore[explicit-any]
                raise RuntimeError("run_streamed stub should be patched in tests")

        agents_module.Agent = _StubAgent  # type: ignore[attr-defined]
        agents_module.RunConfig = _StubRunConfig  # type: ignore[attr-defined]
        agents_module.Runner = _StubRunner  # type: ignore[attr-defined]
        agents_module.TResponseInputItem = dict  # type: ignore[attr-defined]
        agents_module.ModelSettings = object  # type: ignore[attr-defined]
        agents_module.WebSearchTool = object  # type: ignore[attr-defined]
        agents_module.ComputerTool = object  # type: ignore[attr-defined]
        agents_module.set_default_openai_client = (  # type: ignore[attr-defined]
            lambda *args, **kwargs: None
        )
        sys.modules["agents"] = agents_module

        mcp_module = types.ModuleType("agents.mcp")

        class _StubMCPServer:  # pragma: no cover - stub
            async def connect(self) -> None:
                return None

            async def cleanup(self) -> None:
                return None

        class _StubMCPServerSse(_StubMCPServer):  # pragma: no cover - stub
            pass

        class _StubMCPServerStreamableHttp(_StubMCPServer):  # pragma: no cover
            pass

        mcp_module.MCPServer = _StubMCPServer  # type: ignore[attr-defined]
        mcp_module.MCPServerSse = _StubMCPServerSse  # type: ignore[attr-defined]
        mcp_module.MCPServerStreamableHttp = (  # type: ignore[attr-defined]
            _StubMCPServerStreamableHttp
        )
        sys.modules["agents.mcp"] = mcp_module

        realtime_pkg = types.ModuleType("agents.realtime")
        realtime_agent_module = types.ModuleType("agents.realtime.agent")
        realtime_config_module = types.ModuleType("agents.realtime.config")
        realtime_runner_module = types.ModuleType("agents.realtime.runner")

        class _StubRealtimeAgent:  # pragma: no cover - stub
            def __init__(self, *args, **kwargs) -> None:
                self.args = args
                self.kwargs = kwargs

        class _StubRealtimeRunConfig:  # pragma: no cover - stub
            def __init__(self, *args, **kwargs) -> None:
                self.args = args
                self.kwargs = kwargs

        class _StubRealtimeRunner:  # pragma: no cover - stub
            def __init__(self, *args, **kwargs) -> None:
                self.args = args
                self.kwargs = kwargs

        realtime_agent_module.RealtimeAgent = _StubRealtimeAgent  # type: ignore[attr-defined]
        realtime_config_module.RealtimeRunConfig = (  # type: ignore[attr-defined]
            _StubRealtimeRunConfig
        )
        realtime_runner_module.RealtimeRunner = (  # type: ignore[attr-defined]
            _StubRealtimeRunner
        )

        sys.modules["agents.realtime"] = realtime_pkg
        sys.modules["agents.realtime.agent"] = realtime_agent_module
        sys.modules["agents.realtime.config"] = realtime_config_module
        sys.modules["agents.realtime.runner"] = realtime_runner_module

        tool_module = types.ModuleType("agents.tool")

        class _StubTool:  # pragma: no cover - stub
            pass

        for class_name in [
            "CodeInterpreterTool",
            "ComputerTool",
            "FileSearchTool",
            "FunctionTool",
            "HostedMCPTool",
            "ImageGenerationTool",
            "LocalShellTool",
            "Tool",
            "WebSearchTool",
        ]:
            setattr(tool_module, class_name, type(class_name, (_StubTool,), {}))

        sys.modules["agents.tool"] = tool_module

        handoffs_module = types.ModuleType("agents.handoffs")

        class _StubHandoff:  # pragma: no cover - stub
            pass

        handoffs_module.Handoff = _StubHandoff  # type: ignore[attr-defined]
        sys.modules["agents.handoffs"] = handoffs_module

    if "chatkit.types" not in sys.modules:
        types_module = types.ModuleType("chatkit.types")

        def _simple_type(name: str):  # pragma: no cover - stub factory
            return type(
                name,
                (),
                {
                    "__init__": lambda self, **kwargs: self.__dict__.update(kwargs),
                },
            )

        for class_name in [
            "AssistantMessageContent",
            "AssistantMessageItem",
            "AssistantMessageContentPartTextDelta",
            "CustomTask",
            "EndOfTurnItem",
            "GeneratedImage",
            "ImageTask",
            "InferenceOptions",
            "TaskItem",
            "ThreadItem",
            "ThreadItemAddedEvent",
            "ThreadItemDoneEvent",
            "ThreadItemUpdated",
            "ThreadStreamEvent",
            "UserMessageItem",
            "UserMessageTextContent",
            "WorkflowTaskAdded",
            "WorkflowTaskUpdated",
        ]:
            setattr(types_module, class_name, _simple_type(class_name))

        sys.modules["chatkit.types"] = types_module

    if "chatkit.agents" not in sys.modules:
        chatkit_agents = types.ModuleType("chatkit.agents")

        class _StubAgentContext:  # pragma: no cover - stub
            def __init__(self, **kwargs) -> None:
                self.__dict__.update(kwargs)

        class _StubThreadItemConverter:  # pragma: no cover - stub
            async def to_agent_input(self, items):
                return []

        async def _stub_stream_agent_response(*args, **kwargs):  # pragma: no cover
            if False:
                yield None

        chatkit_agents.AgentContext = _StubAgentContext  # type: ignore[attr-defined]
        chatkit_agents.ThreadItemConverter = _StubThreadItemConverter  # type: ignore[attr-defined]
        chatkit_agents.stream_agent_response = _stub_stream_agent_response  # type: ignore[attr-defined]
        sys.modules["chatkit.agents"] = chatkit_agents

    if "pgvector.sqlalchemy" not in sys.modules:
        pgvector_module = types.ModuleType("pgvector.sqlalchemy")

        class _StubVector:  # pragma: no cover - stub
            def __init__(self, *args, **kwargs) -> None:
                pass

        pgvector_module.Vector = _StubVector  # type: ignore[attr-defined]
        sys.modules["pgvector.sqlalchemy"] = pgvector_module

    if "app.models" not in sys.modules:
        models_module = types.ModuleType("app.models")

        @dataclass
        class WorkflowStep:  # pragma: no cover - stub
            slug: str
            kind: str
            position: int
            is_enabled: bool = True
            parameters: dict | None = None
            agent_key: str | None = None
            display_name: str | None = None
            id: int | None = None

        @dataclass
        class WorkflowTransition:  # pragma: no cover - stub
            source_step: WorkflowStep
            target_step: WorkflowStep
            id: int | None = None
            condition: str | None = None

        @dataclass
        class WorkflowDefinition:  # pragma: no cover - stub
            workflow_id: int | None
            workflow: object
            steps: list[WorkflowStep]
            transitions: list[WorkflowTransition]

        @dataclass
        class Workflow:  # pragma: no cover - stub
            slug: str

        @dataclass
        class AppSettings:  # pragma: no cover - stub
            thread_title_prompt: str = ""
            thread_title_model: str = ""
            appearance_color_scheme: str = "system"

        @dataclass
        class WorkflowAppearance:  # pragma: no cover - stub
            id: int
            workflow_id: int
            data: dict

        @dataclass
        class McpServer:  # pragma: no cover - stub
            id: int | None = None
            label: str | None = None
            server_url: str = ""
            transport: str = "http_sse"
            authorization: str | None = None
            authorization_token: str | None = None
            allowlist: list[str] | None = None
            headers: dict | None = None
            heartbeat_interval: float | None = None
            max_connection_duration: float | None = None
            is_active: bool = True

        @dataclass
        class JsonVectorStore:  # pragma: no cover - stub
            slug: str

        @dataclass
        class JsonDocument:  # pragma: no cover - stub
            doc_id: str

        @dataclass
        class JsonChunk:  # pragma: no cover - stub
            chunk_id: str

        models_module.WorkflowStep = WorkflowStep  # type: ignore[attr-defined]
        models_module.WorkflowTransition = WorkflowTransition  # type: ignore[attr-defined]
        models_module.WorkflowDefinition = WorkflowDefinition  # type: ignore[attr-defined]
        models_module.Workflow = Workflow  # type: ignore[attr-defined]
        models_module.AppSettings = AppSettings  # type: ignore[attr-defined]
        models_module.WorkflowAppearance = WorkflowAppearance  # type: ignore[attr-defined]
        models_module.McpServer = McpServer  # type: ignore[attr-defined]
        models_module.JsonVectorStore = JsonVectorStore  # type: ignore[attr-defined]
        models_module.JsonDocument = JsonDocument  # type: ignore[attr-defined]
        models_module.JsonChunk = JsonChunk  # type: ignore[attr-defined]
        models_module.EMBEDDING_DIMENSION = 1536  # type: ignore[attr-defined]
        sys.modules["app.models"] = models_module
        sys.modules.setdefault("app.workflows.models", models_module)

    if "app.widgets" not in sys.modules:
        widgets_module = types.ModuleType("app.widgets")
        widgets_service_module = types.ModuleType("app.widgets.service")

        class _StubWidgetLibraryService:  # pragma: no cover - stub
            def __init__(self, *args, **kwargs) -> None:
                return None

        class _StubWidgetTemplateEntry:  # pragma: no cover - stub
            def __init__(self, *args, **kwargs) -> None:
                return None

        class _StubWidgetValidationError(Exception):  # pragma: no cover - stub
            pass

        widgets_service_module.WidgetLibraryService = _StubWidgetLibraryService  # type: ignore[attr-defined]
        widgets_service_module.WidgetTemplateEntry = _StubWidgetTemplateEntry  # type: ignore[attr-defined]
        widgets_service_module.WidgetValidationError = _StubWidgetValidationError  # type: ignore[attr-defined]

        widgets_module.WidgetLibraryService = _StubWidgetLibraryService  # type: ignore[attr-defined]
        widgets_module.WidgetTemplateEntry = _StubWidgetTemplateEntry  # type: ignore[attr-defined]
        widgets_module.WidgetValidationError = _StubWidgetValidationError  # type: ignore[attr-defined]

        sys.modules["app.widgets.service"] = widgets_service_module
        sys.modules["app.widgets"] = widgets_module

    if "openai" not in sys.modules:
        openai_module = types.ModuleType("openai")

        class _StubOpenAIClient:  # pragma: no cover - stub
            def __init__(self, *args, **kwargs) -> None:
                pass

        openai_module.OpenAI = _StubOpenAIClient  # type: ignore[attr-defined]
        openai_module.AsyncOpenAI = _StubOpenAIClient  # type: ignore[attr-defined]
        sys.modules["openai"] = openai_module

    if "app.schemas" not in sys.modules:
        schemas_module = types.ModuleType("app.schemas")

        class VectorStoreWorkflowBlueprint:  # pragma: no cover - stub
            pass

        schemas_module.VectorStoreWorkflowBlueprint = VectorStoreWorkflowBlueprint  # type: ignore[attr-defined]
        sys.modules["app.schemas"] = schemas_module

    if "app.model_capabilities" not in sys.modules:
        capabilities_module = types.ModuleType("app.model_capabilities")

        @dataclass
        class ModelCapabilities:  # pragma: no cover - stub
            supports_reasoning_summary: bool = False
            supports_previous_response_id: bool = False

        def lookup_model_capabilities(*args, **kwargs):  # pragma: no cover - stub
            return None

        capabilities_module.ModelCapabilities = ModelCapabilities  # type: ignore[attr-defined]
        capabilities_module.lookup_model_capabilities = lookup_model_capabilities  # type: ignore[attr-defined]
        sys.modules["app.model_capabilities"] = capabilities_module
        sys.modules.setdefault("app.workflows.model_capabilities", capabilities_module)

    if "app.chatkit.agent_registry" not in sys.modules:
        registry_module = types.ModuleType("app.chatkit.agent_registry")

        class _StubProviderBinding:  # pragma: no cover - stub
            def __init__(self, provider=None, provider_id=None, provider_slug=None):
                self.provider = provider
                self.provider_id = provider_id
                self.provider_slug = provider_slug

        class _StubAgentBuilderResult:  # pragma: no cover - stub
            def __init__(self, **overrides) -> None:
                self.overrides = overrides

        registry_module.AgentProviderBinding = _StubProviderBinding  # type: ignore[attr-defined]
        registry_module.AGENT_BUILDERS = {}  # type: ignore[attr-defined]
        registry_module.AGENT_RESPONSE_FORMATS = {}  # type: ignore[attr-defined]
        registry_module.STEP_TITLES = {}  # type: ignore[attr-defined]
        registry_module._build_custom_agent = (  # type: ignore[attr-defined]
            lambda overrides: _StubAgentBuilderResult(**overrides)
        )
        registry_module._create_response_format_from_pydantic = (  # type: ignore[attr-defined]
            lambda model: {}
        )
        registry_module.get_agent_provider_binding = (  # type: ignore[attr-defined]
            lambda provider_id, provider_slug: None
        )
        sys.modules["app.chatkit.agent_registry"] = registry_module

        if "app.chatkit" not in sys.modules:
            chatkit_pkg = types.ModuleType("app.chatkit")
            chatkit_pkg.agent_registry = registry_module  # type: ignore[attr-defined]
            sys.modules["app.chatkit"] = chatkit_pkg
        else:
            chatkit_pkg = sys.modules["app.chatkit"]

        sys.modules.setdefault("app.workflows.chatkit", chatkit_pkg)
        sys.modules.setdefault(
            "app.workflows.chatkit.agent_registry", registry_module
        )

    if "app.workflows.service" not in sys.modules:
        service_module = types.ModuleType("app.workflows.service")

        class _StubWorkflowService:  # pragma: no cover - stub pour les tests
            def __init__(self, *args, **kwargs) -> None:
                pass

            def get_available_model_capabilities(self) -> dict:
                return {}

        service_module.WorkflowService = _StubWorkflowService  # type: ignore[attr-defined]

        def _bool_false(*args, **kwargs) -> bool:  # pragma: no cover - stub
            return False

        def _empty_str(*args, **kwargs) -> str:  # pragma: no cover - stub
            return ""

        def _empty_mapping(*args, **kwargs) -> dict:  # pragma: no cover - stub
            return {}

        def _empty_sequence(*args, **kwargs) -> list:  # pragma: no cover - stub
            return []

        for class_name in [
            "HostedWorkflowConfig",
            "HostedWorkflowNotFoundError",
            "TelephonyRouteConfig",
            "TelephonyRouteOverrides",
            "TelephonyStartConfiguration",
            "WorkflowAppearanceService",
            "WorkflowGraphValidator",
            "WorkflowNotFoundError",
            "WorkflowPersistenceService",
            "WorkflowValidationError",
            "WorkflowVersionNotFoundError",
        ]:
            setattr(service_module, class_name, type(class_name, (), {}))

        service_module.resolve_start_auto_start = _bool_false
        service_module.resolve_start_auto_start_message = _empty_str
        service_module.resolve_start_auto_start_assistant_message = _empty_str
        service_module.resolve_start_hosted_workflows = _empty_sequence
        service_module.resolve_start_telephony_config = _empty_mapping
        service_module.serialize_definition = _empty_mapping
        service_module.serialize_definition_graph = _empty_mapping
        service_module.serialize_version_summary = _empty_mapping
        service_module.serialize_viewport = _empty_mapping
        service_module.serialize_workflow_summary = _empty_mapping

        sys.modules["app.workflows.service"] = service_module

    if "httpx" not in sys.modules:
        from urllib.parse import urlparse, urlunparse

        httpx_module = types.ModuleType("httpx")

        class Timeout:  # pragma: no cover - stub
            def __init__(self, *args, **kwargs) -> None:
                self.args = args
                self.kwargs = kwargs

        class URL:  # pragma: no cover - stub
            def __init__(self, value: str) -> None:
                self._parts = urlparse(value)
                self.path = self._parts.path or ""

            def copy_with(self, *, path=None, query=None, fragment=None):
                parts = list(self._parts)
                if path is not None:
                    parts[2] = path
                if query is not None:
                    parts[4] = "" if query is None else query
                if fragment is not None:
                    parts[5] = "" if fragment is None else fragment
                return URL(urlunparse(parts))

            def __str__(self) -> str:
                return urlunparse(self._parts)

        class HTTPError(Exception):  # pragma: no cover - stub
            pass

        class HTTPStatusError(HTTPError):  # pragma: no cover - stub
            def __init__(self, response=None):
                super().__init__("HTTP status error")
                self.response = response

        class _StubResponse:  # pragma: no cover - stub
            def __init__(self, status_code=200, payload=None, text="") -> None:
                self.status_code = status_code
                self._payload = payload or {}
                self.text = text

            def json(self):
                return dict(self._payload)

        class AsyncClient:  # pragma: no cover - stub
            def __init__(self, *args, **kwargs) -> None:
                self.args = args
                self.kwargs = kwargs

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def post(self, *args, **kwargs):
                return _StubResponse()

        httpx_module.Timeout = Timeout  # type: ignore[attr-defined]
        httpx_module.URL = URL  # type: ignore[attr-defined]
        httpx_module.AsyncClient = AsyncClient  # type: ignore[attr-defined]
        httpx_module.HTTPError = HTTPError  # type: ignore[attr-defined]
        httpx_module.HTTPStatusError = HTTPStatusError  # type: ignore[attr-defined]
        sys.modules["httpx"] = httpx_module

    if "fastapi" not in sys.modules:
        fastapi_module = types.ModuleType("fastapi")

        class HTTPException(Exception):  # pragma: no cover - stub
            def __init__(self, status_code: int, detail: str | None = None):
                super().__init__(detail)
                self.status_code = status_code
                self.detail = detail

        fastapi_module.HTTPException = HTTPException  # type: ignore[attr-defined]
        fastapi_module.status = SimpleNamespace(  # type: ignore[attr-defined]
            HTTP_400_BAD_REQUEST=400,
            HTTP_401_UNAUTHORIZED=401,
            HTTP_404_NOT_FOUND=404,
            HTTP_500_INTERNAL_SERVER_ERROR=500,
        )
        sys.modules["fastapi"] = fastapi_module

    if "cryptography" not in sys.modules:
        try:  # pragma: no cover - prefer real dependency when available
            import cryptography  # type: ignore  # noqa: F401
            from cryptography.hazmat.primitives import serialization  # noqa: F401
            from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: F401
        except Exception:  # pragma: no cover - fallback stubs when dependency missing
            crypto_module = types.ModuleType("cryptography")
            hazmat_module = types.ModuleType("cryptography.hazmat")
            primitives_module = types.ModuleType("cryptography.hazmat.primitives")
            serialization_module = types.ModuleType(
                "cryptography.hazmat.primitives.serialization"
            )
            asymmetric_module = types.ModuleType(
                "cryptography.hazmat.primitives.asymmetric"
            )
            rsa_module = types.ModuleType(
                "cryptography.hazmat.primitives.asymmetric.rsa"
            )
            fernet_module = types.ModuleType("cryptography.fernet")

            class InvalidToken(Exception):  # pragma: no cover - stub
                pass

            class _DummyKey:  # pragma: no cover - stub
                def private_bytes(self, *args, **kwargs):
                    return b""

            class Fernet:  # pragma: no cover - stub
                def __init__(self, key: bytes) -> None:
                    self.key = key

                def encrypt(self, data: bytes) -> bytes:
                    return data

                def decrypt(self, token: bytes) -> bytes:
                    return token

            def _generate_private_key(*args, **kwargs):  # pragma: no cover - stub
                return _DummyKey()

            def _load_pem_private_key(*args, **kwargs):  # pragma: no cover - stub
                return _DummyKey()

            class _EnumValue(str):  # pragma: no cover - stub
                def __new__(cls, value: str):
                    return str.__new__(cls, value)

            serialization_module.Encoding = SimpleNamespace(PEM=_EnumValue("PEM"))
            serialization_module.PrivateFormat = SimpleNamespace(
                PKCS8=_EnumValue("PKCS8")
            )
            serialization_module.NoEncryption = lambda: None
            serialization_module.load_pem_private_key = _load_pem_private_key

            rsa_module.generate_private_key = _generate_private_key

            fernet_module.Fernet = Fernet  # type: ignore[attr-defined]
            fernet_module.InvalidToken = InvalidToken  # type: ignore[attr-defined]

            sys.modules["cryptography"] = crypto_module
            sys.modules["cryptography.hazmat"] = hazmat_module
            sys.modules["cryptography.hazmat.primitives"] = primitives_module
            sys.modules[
                "cryptography.hazmat.primitives.serialization"
            ] = serialization_module
            sys.modules["cryptography.hazmat.primitives.asymmetric"] = (
                asymmetric_module
            )
            sys.modules["cryptography.hazmat.primitives.asymmetric.rsa"] = rsa_module
            sys.modules["cryptography.fernet"] = fernet_module

    executor_module = importlib.import_module("app.workflows.executor")
    agents_module = importlib.import_module("app.workflows.runtime.agents")
    return executor_module, agents_module


executor, runtime_agents = _load_workflow_modules()


class _DummyAgent:
    def __init__(self, name: str) -> None:
        self.name = name
        self.model_settings = {}
        self.mcp_servers: list = []


class _FakeStreamResult:
    def __init__(self, output: dict[str, str]) -> None:
        self.final_output = output
        self.new_items: list = []
        self.last_response_id: str | None = None


class _FakeStore:
    async def save_thread(self, thread, context):  # pragma: no cover - stub
        return None


class _FakeAgentContext:
    def __init__(self) -> None:
        self.thread = SimpleNamespace(id="thread-1", metadata={})
        self.request_context = SimpleNamespace(
            user_id="user-1", public_base_url="https://example.test"
        )
        self.previous_response_id = None
        self.store = _FakeStore()
        self._counter = 0

    def generate_id(self, prefix: str) -> str:
        self._counter += 1
        return f"{prefix}-{self._counter}"


class _FakeWorkflowService:
    def get_available_model_capabilities(self):  # pragma: no cover - stub
        return {}


def _build_while_workflow(
    condition_expr: str,
    *,
    max_iterations: int = 3,
    iteration_var: str | None = None,
):
    def _step(slug: str, kind: str, position: int, **kwargs):
        defaults = {
            "slug": slug,
            "kind": kind,
            "position": position,
            "is_enabled": True,
            "parameters": kwargs.get("parameters", {}),
            "agent_key": kwargs.get("agent_key"),
            "display_name": kwargs.get("display_name"),
            "ui_metadata": kwargs.get("ui_metadata", {}),
        }
        return SimpleNamespace(**defaults)

    while_params = {"condition": condition_expr, "max_iterations": max_iterations}
    if iteration_var is not None:
        while_params["iteration_var"] = iteration_var

    start_step = _step(
        "start", "start", 0, ui_metadata={"position": {"x": -200, "y": 0}}
    )
    while_step = _step(
        "loop",
        "while",
        1,
        parameters=while_params,
        ui_metadata={
            "position": {"x": 0, "y": 0},
            "size": {"width": 400, "height": 300},
        },
    )
    body_step = _step(
        "body",
        "state",
        2,
        parameters={
            "state": [
                {
                    "target": "state.executions",
                    "expression": "state.get('state', {}).get('executions', 0) + 1",
                }
            ]
        },
        ui_metadata={"position": {"x": 50, "y": 50}},
    )
    end_step = _step("end", "end", 3, ui_metadata={"position": {"x": 500, "y": 0}})

    transitions = [
        SimpleNamespace(
            source_step=start_step, target_step=while_step, id=1, condition=None
        ),
        SimpleNamespace(
            source_step=start_step, target_step=body_step, id=2, condition="loop-entry"
        ),
        SimpleNamespace(
            source_step=while_step, target_step=end_step, id=3, condition="exit"
        ),
        SimpleNamespace(
            source_step=body_step, target_step=end_step, id=4, condition=None
        ),
    ]

    definition = SimpleNamespace(
        workflow_id=99,
        workflow=SimpleNamespace(slug="while-workflow", display_name="While"),
        steps=[start_step, while_step, body_step, end_step],
        transitions=transitions,
    )

    return definition


def _build_basic_workflow():
    def _step(slug: str, kind: str, position: int, **kwargs):
        defaults = {
            "slug": slug,
            "kind": kind,
            "position": position,
            "is_enabled": True,
            "parameters": kwargs.get("parameters", {}),
            "agent_key": kwargs.get("agent_key"),
            "display_name": kwargs.get("display_name"),
            "ui_metadata": kwargs.get("ui_metadata", {}),
            "workflow_id": kwargs.get("workflow_id"),
            "definition_id": kwargs.get("definition_id"),
        }
        return SimpleNamespace(**defaults)

    start_step = _step(
        "start",
        "start",
        0,
        ui_metadata={"position": {"x": 0, "y": 0}},
    )
    state_step = _step(
        "update",
        "state",
        1,
        parameters={
            "state": [
                {
                    "target": "state.value",
                    "expression": "1",
                }
            ]
        },
        ui_metadata={"position": {"x": 100, "y": 0}},
    )
    end_step = _step(
        "end",
        "end",
        2,
        parameters={
            "status": {"type": "success", "reason": "done"},
            "message": "done",
        },
        ui_metadata={"position": {"x": 200, "y": 0}},
    )

    transitions = [
        SimpleNamespace(
            source_step=start_step, target_step=state_step, id=1, condition=None
        ),
        SimpleNamespace(
            source_step=state_step, target_step=end_step, id=2, condition=None
        ),
    ]

    definition = SimpleNamespace(
        workflow_id=1,
        workflow=SimpleNamespace(slug="base-workflow", display_name="Base"),
        steps=[start_step, state_step, end_step],
        transitions=transitions,
    )

    return definition


def _build_while_workflow_without_end(*, max_iterations: int = 3):
    def _step(slug: str, kind: str, position: int, **kwargs):
        defaults = {
            "slug": slug,
            "kind": kind,
            "position": position,
            "is_enabled": True,
            "parameters": kwargs.get("parameters", {}),
            "agent_key": kwargs.get("agent_key"),
            "display_name": kwargs.get("display_name"),
            "ui_metadata": kwargs.get("ui_metadata", {}),
        }
        return SimpleNamespace(**defaults)

    start_step = _step(
        "start", "start", 0, ui_metadata={"position": {"x": 0, "y": 0}}
    )

    while_step = _step(
        "loop",
        "while",
        1,
        parameters={"condition": "True", "max_iterations": max_iterations},
        ui_metadata={
            "position": {"x": 100, "y": 0},
            "size": {"width": 400, "height": 300},
        },
    )

    state_step = _step(
        "increment",
        "state",
        2,
        parameters={
            "state": [
                {
                    "target": "state.counter",
                    "expression": "(state.get('counter', 0) or 0) + 1",
                }
            ]
        },
        ui_metadata={"position": {"x": 200, "y": 100}},
    )

    agent_step = _step(
        "agent",
        "agent",
        3,
        ui_metadata={"position": {"x": 550, "y": 50}},
    )

    transitions = [
        SimpleNamespace(
            source_step=start_step, target_step=while_step, id=1, condition=None
        ),
    ]

    definition = SimpleNamespace(
        workflow_id=1,
        workflow=SimpleNamespace(slug="while-no-end", display_name="While No End"),
        steps=[start_step, while_step, state_step, agent_step],
        transitions=transitions,
    )

    return definition


def _get_workflow_input_cls():
    WorkflowInput = executor.WorkflowInput
    if not hasattr(WorkflowInput, "model_dump"):
        WorkflowInput.model_dump = WorkflowInput.dict  # type: ignore[assignment]
    return WorkflowInput


def test_while_condition_false_is_not_counted():
    async def _run() -> None:
        WorkflowInput = _get_workflow_input_cls()

        summary = await executor.run_workflow(
            WorkflowInput(input_as_text="No loop"),
            agent_context=_FakeAgentContext(),
            workflow_definition=_build_while_workflow(
                "False", iteration_var="loop_iteration"
            ),
            workflow_service=_FakeWorkflowService(),
        )

        state_values = summary.state.get("state", {}) if summary.state else {}
        assert "__while_loop_counter" not in state_values
        assert state_values.get("loop_iteration") is None
        assert state_values.get("executions") is None

    asyncio.run(_run())


def test_while_respects_max_iterations():
    async def _run() -> None:
        WorkflowInput = _get_workflow_input_cls()

        summary = await executor.run_workflow(
            WorkflowInput(input_as_text="Loop"),
            agent_context=_FakeAgentContext(),
            workflow_definition=_build_while_workflow(
                "True", max_iterations=3, iteration_var="loop_iteration"
            ),
            workflow_service=_FakeWorkflowService(),
        )

        state_values = summary.state.get("state", {}) if summary.state else {}
        assert state_values.get("executions") == 2
        assert state_values.get("loop_iteration") == 2
        assert "__while_loop_counter" not in state_values

    asyncio.run(_run())


def test_while_nodes_are_limited_to_current_workflow():
    async def _run() -> None:
        WorkflowInput = _get_workflow_input_cls()

        definition = _build_basic_workflow()

        foreign_while = SimpleNamespace(
            slug="foreign-loop",
            kind="while",
            position=99,
            is_enabled=True,
            parameters={"condition": "True", "max_iterations": 2},
            ui_metadata={
                "position": {"x": -100, "y": -100},
                "size": {"width": 800, "height": 600},
            },
            workflow_id=999,
            definition_id=999,
        )
        definition.steps.append(foreign_while)

        summary = await executor.run_workflow(
            WorkflowInput(input_as_text=""),
            agent_context=_FakeAgentContext(),
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
        )

        assert summary.end_state is not None
        assert summary.final_node_slug == "end"
        assert summary.state.get("state", {}).get("value") == 1

    asyncio.run(_run())


def test_workflow_scope_filtering():
    """Test that start nodes and transitions from foreign workflows are filtered out."""
    async def _run() -> None:
        WorkflowInput = _get_workflow_input_cls()

        definition = _build_basic_workflow()

        # Add a foreign start node that should be ignored
        foreign_start = SimpleNamespace(
            slug="foreign-start",
            kind="start",
            position=98,
            is_enabled=True,
            parameters={},
            ui_metadata={"position": {"x": -200, "y": 0}},
            workflow_id=888,
            definition_id=888,
        )

        # Add a foreign node with transitions
        foreign_node = SimpleNamespace(
            slug="foreign-node",
            kind="agent",
            position=99,
            is_enabled=True,
            parameters={},
            ui_metadata={"position": {"x": -100, "y": 0}},
            workflow_id=888,
            definition_id=888,
        )

        definition.steps.extend([foreign_start, foreign_node])

        # Add a transition from foreign_start to foreign_node
        foreign_transition = SimpleNamespace(
            source_step=foreign_start,
            target_step=foreign_node,
            id=99,
            condition=None
        )
        definition.transitions.append(foreign_transition)

        summary = await executor.run_workflow(
            WorkflowInput(input_as_text=""),
            agent_context=_FakeAgentContext(),
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
        )

        # Should still start from the correct "start" node, not the foreign one
        assert summary.end_state is not None
        assert summary.final_node_slug == "end"
        assert summary.state.get("state", {}).get("value") == 1

    asyncio.run(_run())


def test_workflow_without_end_node():
    """Test workflow behavior when there is no END node - should wait for user input."""
    async def _run() -> None:
        WorkflowInput = _get_workflow_input_cls()

        def _step(slug: str, kind: str, position: int, **kwargs):
            defaults = {
                "slug": slug,
                "kind": kind,
                "position": position,
                "is_enabled": True,
                "parameters": kwargs.get("parameters", {}),
                "agent_key": kwargs.get("agent_key"),
                "display_name": kwargs.get("display_name"),
                "ui_metadata": kwargs.get("ui_metadata", {}),
            }
            return SimpleNamespace(**defaults)

        start_step = _step(
            "start", "start", 0, ui_metadata={"position": {"x": 0, "y": 0}}
        )
        state_step = _step(
            "update",
            "state",
            1,
            parameters={
                "state": [
                    {
                        "target": "state.value",
                        "expression": "42",
                    }
                ]
            },
            ui_metadata={"position": {"x": 100, "y": 0}},
        )

        # No END node - state_step has no outgoing transitions
        transitions = [
            SimpleNamespace(
                source_step=start_step, target_step=state_step, id=1, condition=None
            ),
        ]

        definition = SimpleNamespace(
            workflow_id=1,
            workflow=SimpleNamespace(slug="no-end-workflow", display_name="No End"),
            steps=[start_step, state_step],
            transitions=transitions,
        )

        summary = await executor.run_workflow(
            WorkflowInput(input_as_text=""),
            agent_context=_FakeAgentContext(),
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
        )

        # Should wait for user input (status_type="waiting") instead of terminating
        assert summary.final_node_slug == "update"
        assert summary.state.get("state", {}).get("value") == 42
        assert summary.end_state is not None
        assert summary.end_state.get("status_type") == "waiting"
        assert "attente" in summary.end_state.get("message", "").lower()

    asyncio.run(_run())


def test_workflow_with_circular_transitions():
    """Test workflow behavior with circular transitions (infinite loop protection)."""
    async def _run() -> None:
        WorkflowInput = _get_workflow_input_cls()

        def _step(slug: str, kind: str, position: int, **kwargs):
            defaults = {
                "slug": slug,
                "kind": kind,
                "position": position,
                "is_enabled": True,
                "parameters": kwargs.get("parameters", {}),
                "agent_key": kwargs.get("agent_key"),
                "display_name": kwargs.get("display_name"),
                "ui_metadata": kwargs.get("ui_metadata", {}),
            }
            return SimpleNamespace(**defaults)

        start_step = _step(
            "start", "start", 0, ui_metadata={"position": {"x": 0, "y": 0}}
        )
        state_a = _step(
            "state-a",
            "state",
            1,
            parameters={
                "state": [
                    {
                        "target": "state.counter",
                        "expression": "(state.get('counter', 0) or 0) + 1",
                    }
                ]
            },
            ui_metadata={"position": {"x": 100, "y": 0}},
        )
        state_b = _step(
            "state-b",
            "state",
            2,
            parameters={
                "state": [
                    {
                        "target": "state.visited_b",
                        "expression": "True",
                    }
                ]
            },
            ui_metadata={"position": {"x": 200, "y": 0}},
        )

        # Circular transitions: start -> state-a -> state-b -> state-a (loop)
        transitions = [
            SimpleNamespace(
                source_step=start_step, target_step=state_a, id=1, condition=None
            ),
            SimpleNamespace(
                source_step=state_a, target_step=state_b, id=2, condition=None
            ),
            SimpleNamespace(
                source_step=state_b, target_step=state_a, id=3, condition=None
            ),
        ]

        definition = SimpleNamespace(
            workflow_id=1,
            workflow=SimpleNamespace(slug="circular-workflow", display_name="Circular"),
            steps=[start_step, state_a, state_b],
            transitions=transitions,
        )

        # This should hit the 1000 iteration limit
        try:
            await executor.run_workflow(
                WorkflowInput(input_as_text=""),
                agent_context=_FakeAgentContext(),
                workflow_definition=definition,
                workflow_service=_FakeWorkflowService(),
            )
            # Should not reach here - expect an error
            raise AssertionError("Expected WorkflowExecutionError for infinite loop")
        except executor.WorkflowExecutionError as e:
            assert "Nombre maximal d'étapes dépassé" in str(e)

    asyncio.run(_run())


def test_while_without_end_node_waits_for_input():
    """While without END should wait for user input after max iterations."""
    async def _run() -> None:
        WorkflowInput = _get_workflow_input_cls()
        definition = _build_while_workflow_without_end()

        summary = await executor.run_workflow(
            WorkflowInput(input_as_text=""),
            agent_context=_FakeAgentContext(),
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
        )

        # Should wait for user input after two iterations
        assert summary.final_node_slug == "loop"
        assert summary.state.get("state", {}).get("counter") == 2
        assert summary.end_state is not None
        assert summary.end_state.status_type == "waiting"
        assert "attente" in (summary.end_state.message or "").lower()

    asyncio.run(_run())


def test_while_without_end_resets_counter_on_resume():
    async def _run() -> None:
        WorkflowInput = _get_workflow_input_cls()
        agent_context = _FakeAgentContext()

        definition = _build_while_workflow_without_end()

        summary = await executor.run_workflow(
            WorkflowInput(input_as_text=""),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
        )

        assert summary.state.get("state", {}).get("counter") == 2

        resumed_summary = await executor.run_workflow(
            WorkflowInput(input_as_text="Continuer", source_item_id="msg-2"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
        )

        assert resumed_summary.final_node_slug == "loop"
        assert resumed_summary.end_state is not None
        assert resumed_summary.end_state.status_type == "waiting"
        assert resumed_summary.state.get("state", {}).get("counter") == 4

        state_values = resumed_summary.state.get("state", {})
        assert "__while_loop_counter" not in state_values
        assert "__while_loop_entry" not in state_values

    asyncio.run(_run())


def test_while_counters_are_reset_when_resuming_after_new_input(monkeypatch):
    async def _run() -> None:
        WorkflowInput = _get_workflow_input_cls()
        agent_context = _FakeAgentContext()

        definition = _build_while_workflow_without_end()

        def _fake_run_streamed(
            agent,
            *,
            input,
            run_config,
            context,
            previous_response_id,
        ):
            agent_name = getattr(agent, "name", "unknown")
            return _FakeStreamResult({"agent": agent_name})

        async def _fake_stream_agent_response(agent_context, result):
            if False:  # pragma: no cover - générateur vide
                yield result

        monkeypatch.setattr(executor.Runner, "run_streamed", _fake_run_streamed)
        monkeypatch.setattr(
            executor, "stream_agent_response", _fake_stream_agent_response
        )

        initial_summary = await executor.run_workflow(
            WorkflowInput(input_as_text="Première passe", source_item_id="msg-1"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
        )

        pending_state = agent_context.thread.metadata.get(
            "workflow_wait_for_user_input", {}
        )
        stored_values = pending_state.setdefault("state", {}).setdefault("state", {})
        assert initial_summary.state.get("state", {}).get("counter") == 2

        stored_values.update(
            {
                "__while_loop_counter": 1,
                "__while_loop_entry": "increment",
            }
        )

        summary = await executor.run_workflow(
            WorkflowInput(input_as_text="Continuer", source_item_id="msg-2"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
        )

        state_values = summary.state.get("state", {})
        assert state_values.get("counter") == 4
        assert "__while_loop_counter" not in state_values
        assert "__while_loop_entry" not in state_values

    asyncio.run(_run())


def test_while_counters_are_reset_when_resuming_without_input_id(monkeypatch):
    async def _run() -> None:
        WorkflowInput = _get_workflow_input_cls()
        agent_context = _FakeAgentContext()

        definition = _build_while_workflow_without_end()

        def _fake_run_streamed(
            agent,
            *,
            input,
            run_config,
            context,
            previous_response_id,
        ):
            agent_name = getattr(agent, "name", "unknown")
            return _FakeStreamResult({"agent": agent_name})

        async def _fake_stream_agent_response(agent_context, result):
            if False:  # pragma: no cover - générateur vide
                yield result

        monkeypatch.setattr(executor.Runner, "run_streamed", _fake_run_streamed)
        monkeypatch.setattr(
            executor, "stream_agent_response", _fake_stream_agent_response
        )

        await executor.run_workflow(
            WorkflowInput(input_as_text="Première passe", source_item_id="msg-1"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
        )

        pending_state = agent_context.thread.metadata.get(
            "workflow_wait_for_user_input", {}
        )
        stored_values = pending_state.setdefault("state", {}).setdefault("state", {})
        stored_values.update(
            {
                "__while_loop_counter": 1,
                "__while_loop_entry": "increment",
            }
        )
        pending_state.pop("input_item_id", None)

        summary = await executor.run_workflow(
            WorkflowInput(input_as_text="Nouvelle entrée"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
        )

        state_values = summary.state.get("state", {})
        assert state_values.get("counter") == 4
        assert "__while_loop_counter" not in state_values
        assert "__while_loop_entry" not in state_values

    asyncio.run(_run())


def test_run_workflow_multi_step_with_widget(monkeypatch):
    async def _run() -> None:
        WorkflowInput = executor.WorkflowInput
        run_workflow = executor.run_workflow

        if not hasattr(WorkflowInput, "model_dump"):
            WorkflowInput.model_dump = WorkflowInput.dict  # type: ignore[assignment]

        # Préparer un agent context minimaliste
        class _FakeStore:
            async def save_thread(self, thread, context):  # pragma: no cover - stub
                return None

        class _FakeAgentContext:
            def __init__(self) -> None:
                self.thread = SimpleNamespace(id="thread-1", metadata={})
                self.request_context = SimpleNamespace(
                    user_id="user-1", public_base_url="https://example.test"
                )
                self.previous_response_id = None
                self.store = _FakeStore()
                self._counter = 0

            def generate_id(self, prefix: str) -> str:
                self._counter += 1
                return f"{prefix}-{self._counter}"

        agent_context = _FakeAgentContext()

        # Stub pour Runner.run_streamed
        def _fake_run_streamed(
            agent, *, input, run_config, context, previous_response_id
        ):
            agent_name = getattr(agent, "name", "unknown")
            return _FakeStreamResult({"agent": agent_name})

        async def _fake_stream_agent_response(agent_context, result):
            if False:  # pragma: no cover - générateur vide
                yield result

        async def _fake_ingest_vector_store_step(*args, **kwargs):
            return None

        widget_calls: list[dict[str, str | None]] = []

        async def _fake_stream_response_widget(config, **kwargs):
            widget_calls.append({"slug": config.slug, "source": config.source})
            return {"widget": config.slug}

        # Patched builders pour les agents utilisés par le workflow
        monkeypatch.setitem(
            runtime_agents.AGENT_BUILDERS,
            "first_agent",
            lambda overrides: _DummyAgent("first-agent"),
        )
        monkeypatch.setitem(
            runtime_agents.AGENT_BUILDERS,
            "second_agent",
            lambda overrides: _DummyAgent("second-agent"),
        )

        monkeypatch.setattr(executor.Runner, "run_streamed", _fake_run_streamed)
        monkeypatch.setattr(
            executor, "stream_agent_response", _fake_stream_agent_response
        )
        monkeypatch.setattr(
            executor, "ingest_vector_store_step", _fake_ingest_vector_store_step
        )
        monkeypatch.setattr(
            executor, "_stream_response_widget", _fake_stream_response_widget
        )

        # Définition d'un workflow multi-étapes avec widget
        def _step(slug: str, kind: str, position: int, **kwargs):
            defaults = {
                "slug": slug,
                "kind": kind,
                "position": position,
                "is_enabled": True,
                "parameters": kwargs.get("parameters", {}),
                "agent_key": kwargs.get("agent_key"),
                "display_name": kwargs.get("display_name"),
            }
            return SimpleNamespace(**defaults)

        start_step = _step("start", "start", 0)
        agent_step_one = _step(
            "first",
            "agent",
            1,
            agent_key="first_agent",
            parameters={
                "response_widget": {"source": "library", "slug": "demo-widget"}
            },
        )
        widget_step = _step(
            "show-widget",
            "widget",
            2,
            parameters={"widget": {"source": "library", "slug": "demo-widget"}},
        )
        agent_step_two = _step("second", "agent", 3, agent_key="second_agent")
        end_step = _step("end", "end", 4)

        transitions = [
        SimpleNamespace(
            source_step=start_step,
            target_step=agent_step_one,
            id=1,
            condition=None,
        ),
        SimpleNamespace(
            source_step=agent_step_one,
            target_step=widget_step,
            id=2,
            condition=None,
        ),
        SimpleNamespace(
            source_step=widget_step,
            target_step=agent_step_two,
            id=3,
            condition=None,
        ),
        SimpleNamespace(
            source_step=agent_step_two,
            target_step=end_step,
            id=4,
            condition=None,
        ),
        ]

        definition = SimpleNamespace(
            workflow_id=42,
            workflow=SimpleNamespace(slug="demo-workflow", display_name="Demo"),
            steps=[start_step, agent_step_one, widget_step, agent_step_two, end_step],
            transitions=transitions,
        )

        class _FakeWorkflowService:
            def get_available_model_capabilities(self):  # pragma: no cover - stub
                return {}

        summary = await run_workflow(
            WorkflowInput(input_as_text="Bonjour"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
        )

        assert summary.final_output == {"agent": "second-agent"}
        assert summary.state["last_agent_output_text"]
        assert widget_calls  # Le widget a été diffusé

    asyncio.run(_run())

