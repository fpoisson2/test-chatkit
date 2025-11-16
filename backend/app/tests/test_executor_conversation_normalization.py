import importlib
import importlib.util
import os
import sys
import types
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
CHATKIT_PY_PATH = ROOT_DIR / "chatkit-python"
if str(CHATKIT_PY_PATH) not in sys.path:
    sys.path.insert(0, str(CHATKIT_PY_PATH))


os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")


if "backend" not in sys.modules:
    backend_stub = types.ModuleType("backend")
    backend_stub.__path__ = []  # pragma: no cover - mark as package
    sys.modules["backend"] = backend_stub
if "backend.app" not in sys.modules:
    backend_app_pkg = types.ModuleType("backend.app")
    backend_app_pkg.__path__ = []  # pragma: no cover - mark as package
    sys.modules["backend.app"] = backend_app_pkg
else:
    backend_app_pkg = sys.modules["backend.app"]
if "backend.app.workflows" not in sys.modules:
    workflows_pkg = types.ModuleType("backend.app.workflows")
    workflows_pkg.__path__ = []  # pragma: no cover - mark as package
    sys.modules["backend.app.workflows"] = workflows_pkg
else:
    workflows_pkg = sys.modules["backend.app.workflows"]


EXECUTOR_PATH = ROOT_DIR / "backend" / "app" / "workflows" / "executor.py"
if "agents" not in sys.modules:
    agents_stub = types.ModuleType("agents")
    agents_stub.Agent = object  # type: ignore[attr-defined]
    agents_stub.RunConfig = object  # type: ignore[attr-defined]
    agents_stub.Runner = object  # type: ignore[attr-defined]
    agents_stub.TResponseInputItem = object  # type: ignore[attr-defined]
    agents_stub.InputGuardrailTripwireTriggered = type(
        "InputGuardrailTripwireTriggered",
        (),
        {},
    )
    agents_stub.OutputGuardrailTripwireTriggered = type(
        "OutputGuardrailTripwireTriggered",
        (),
        {},
    )
    agents_stub.RunResultStreaming = object  # type: ignore[attr-defined]
    agents_stub.StreamEvent = object  # type: ignore[attr-defined]
    agents_stub.set_default_openai_client = lambda *args, **kwargs: None
    sys.modules["agents"] = agents_stub
    agents_mcp_stub = types.ModuleType("agents.mcp")
    agents_mcp_stub.MCPServer = object  # type: ignore[attr-defined]
    agents_mcp_stub.MCPServerSse = object  # type: ignore[attr-defined]
    agents_mcp_stub.MCPServerStreamableHttp = object  # type: ignore[attr-defined]
    sys.modules["agents.mcp"] = agents_mcp_stub
    agents_handoffs_stub = types.ModuleType("agents.handoffs")
    agents_handoffs_stub.Handoff = type("Handoff", (), {})
    sys.modules["agents.handoffs"] = agents_handoffs_stub
    agents_tool_stub = types.ModuleType("agents.tool")
    for _tool_name in [
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
        setattr(agents_tool_stub, _tool_name, type(_tool_name, (), {}))
    sys.modules["agents.tool"] = agents_tool_stub
    agents_realtime_stub = types.ModuleType("agents.realtime")
    agents_realtime_stub.__path__ = []  # pragma: no cover - mark as package
    agents_realtime_agent_stub = types.ModuleType("agents.realtime.agent")

    class _StubRealtimeAgent:
        def __init__(self, *args: object, **kwargs: object) -> None:
            return None

    agents_realtime_agent_stub.RealtimeAgent = _StubRealtimeAgent
    agents_realtime_stub.agent = agents_realtime_agent_stub
    agents_realtime_config_stub = types.ModuleType("agents.realtime.config")
    agents_realtime_config_stub.RealtimeRunConfig = type(
        "RealtimeRunConfig",
        (),
        {},
    )
    agents_realtime_runner_stub = types.ModuleType("agents.realtime.runner")
    agents_realtime_runner_stub.RealtimeRunner = type("RealtimeRunner", (), {})
    sys.modules["agents.realtime"] = agents_realtime_stub
    sys.modules["agents.realtime.agent"] = agents_realtime_agent_stub
    sys.modules["agents.realtime.config"] = agents_realtime_config_stub
    sys.modules["agents.realtime.runner"] = agents_realtime_runner_stub
if "pydantic" not in sys.modules:
    pydantic_stub = types.ModuleType("pydantic")

    class _StubBaseModel:
        model_config: dict[str, object] = {}

        def __init__(self, **kwargs: object) -> None:
            for key, value in kwargs.items():
                setattr(self, key, value)

        def model_dump(self, *args: object, **kwargs: object) -> dict[str, object]:
            return dict(self.__dict__)

        @classmethod
        def model_json_schema(
            cls, *args: object, **kwargs: object
        ) -> dict[str, object]:
            return {}

    def _stub_field(default: object = None, **_kwargs: object) -> object:
        return default

    def _stub_create_model(name: str, **fields: object) -> type[_StubBaseModel]:
        attrs: dict[str, object] = {}
        for key, value in fields.items():
            if isinstance(value, tuple) and value:
                attrs[key] = value[0]
            else:
                attrs[key] = value
        return type(name, (_StubBaseModel,), attrs)

    class _StubValidationError(Exception):
        pass

    pydantic_stub.BaseModel = _StubBaseModel  # type: ignore[attr-defined]
    pydantic_stub.Field = _stub_field  # type: ignore[attr-defined]
    pydantic_stub.ValidationError = _StubValidationError  # type: ignore[attr-defined]
    pydantic_stub.create_model = _stub_create_model  # type: ignore[attr-defined]
    sys.modules["pydantic"] = pydantic_stub
if "app" not in sys.modules:
    app_stub = types.ModuleType("app")
    app_stub.__path__ = []  # pragma: no cover - mark as package
    sys.modules["app"] = app_stub
    tool_builders_stub = types.ModuleType("app.tool_builders")
    tool_builders_stub.__path__ = []
    sys.modules["app.tool_builders"] = tool_builders_stub

    def _noop_builder(*args: object, **kwargs: object) -> dict[str, object]:
        return {}

    def _register_module(name: str, attrs: dict[str, object]) -> None:
        module = types.ModuleType(f"app.tool_builders.{name}")
        for key, value in attrs.items():
            setattr(module, key, value)
        sys.modules[f"app.tool_builders.{name}"] = module

    _register_module(
        "web_search",
        {
            "build_web_search_tool": _noop_builder,
            "sanitize_web_search_user_location": lambda value: value,
        },
    )
    _register_module(
        "image_generation",
        {
            "build_image_generation_tool": _noop_builder,
            "ImageGeneration": type("ImageGeneration", (), {}),
            "ImageGenerationTool": type("ImageGenerationTool", (), {}),
        },
    )
    _register_module("computer_use", {"build_computer_use_tool": _noop_builder})
    _register_module("file_search", {"build_file_search_tool": _noop_builder})
    _register_module("weather", {"build_weather_tool": _noop_builder})
    _register_module(
        "mcp",
        {
            "build_mcp_tool": _noop_builder,
            "ResolvedMcpServerContext": type("ResolvedMcpServerContext", (), {}),
            "resolve_mcp_tool_configuration": _noop_builder,
            "get_mcp_runtime_context": _noop_builder,
            "attach_mcp_runtime_context": _noop_builder,
        },
    )
    _register_module(
        "workflow",
        {
            "build_workflow_validation_tool": _noop_builder,
            "build_workflow_tool": _noop_builder,
            "WorkflowValidationResult": type("WorkflowValidationResult", (), {}),
            "validate_workflow_graph": _noop_builder,
        },
    )
    _register_module(
        "widget_validation",
        {
            "build_widget_validation_tool": _noop_builder,
            "WidgetValidationResult": type("WidgetValidationResult", (), {}),
            "validate_widget_definition": _noop_builder,
        },
    )
if "chatkit" not in sys.modules:
    chatkit_stub = types.ModuleType("chatkit")
    chatkit_agents_stub = types.ModuleType("chatkit.agents")

    class _StubThreadItemConverter:
        def __init__(self, *args: object, **kwargs: object) -> None:
            return None

        def to_input_item(self) -> dict[str, object]:  # pragma: no cover - stub
            return {}

    async def _stub_stream_agent_response(*args: object, **kwargs: object):
        if False:  # pragma: no cover - stub generator
            yield None

    chatkit_agents_stub.AgentContext = type(
        "AgentContext",
        (),
        {},
    )
    chatkit_agents_stub.ThreadItemConverter = _StubThreadItemConverter
    chatkit_agents_stub.stream_agent_response = _stub_stream_agent_response
    chatkit_agents_stub.stream_widget = object()  # type: ignore[attr-defined]
    chatkit_stub.agents = chatkit_agents_stub
    sys.modules["chatkit.agents"] = chatkit_agents_stub

    chatkit_types_stub = types.ModuleType("chatkit.types")
    for _name in [
        "AssistantMessageContent",
        "AssistantMessageContentPartTextDelta",
        "AssistantMessageItem",
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
        "ThreadItem",
    ]:
        setattr(chatkit_types_stub, _name, type(_name, (), {}))
    chatkit_stub.types = chatkit_types_stub
    sys.modules["chatkit.types"] = chatkit_types_stub
    sys.modules["chatkit"] = chatkit_stub
if "backend.app.chatkit.agent_registry" not in sys.modules:
    agent_registry_stub = types.ModuleType("backend.app.chatkit.agent_registry")
    agent_registry_stub.AGENT_RESPONSE_FORMATS = {}
    agent_registry_stub.STEP_TITLES = {}
    agent_registry_stub.AGENT_BUILDERS = {}

    class _StubAgentProviderBinding:
        provider_slug: str | None = None

    agent_registry_stub.AgentProviderBinding = _StubAgentProviderBinding
    agent_registry_stub._build_custom_agent = lambda *args, **kwargs: None
    agent_registry_stub._create_response_format_from_pydantic = (
        lambda *args, **kwargs: None
    )
    agent_registry_stub.get_agent_provider_binding = (
        lambda *args, **kwargs: None
    )
    sys.modules["backend.app.chatkit.agent_registry"] = agent_registry_stub
    backend_chatkit_stub = types.ModuleType("backend.app.chatkit")
    backend_chatkit_stub.agent_registry = agent_registry_stub
    backend_chatkit_stub.__path__ = []  # pragma: no cover - mark as package
    sys.modules["backend.app.chatkit"] = backend_chatkit_stub
    backend_app_pkg.chatkit = backend_chatkit_stub
if "backend.app.chatkit_server" not in sys.modules:
    chatkit_server_stub = types.ModuleType("backend.app.chatkit_server")
    chatkit_server_stub.__path__ = []  # pragma: no cover - mark as package
    sys.modules["backend.app.chatkit_server"] = chatkit_server_stub
if "backend.app.chatkit_server.actions" not in sys.modules:
    actions_stub = types.ModuleType("backend.app.chatkit_server.actions")
    actions_stub._json_safe_copy = lambda value: value

    class _StubResponseWidgetConfig(dict):
        pass

    actions_stub._ResponseWidgetConfig = _StubResponseWidgetConfig
    actions_stub._should_wait_for_widget_action = lambda *args, **kwargs: False
    sys.modules["backend.app.chatkit_server.actions"] = actions_stub
    chatkit_server_stub.actions = actions_stub
if "backend.app.chatkit_server.context" not in sys.modules:
    context_stub = types.ModuleType("backend.app.chatkit_server.context")

    def _stub_clone_history(payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, Sequence):
            return [dict(item) for item in payload if isinstance(item, Mapping)]
        return []

    context_stub._clone_conversation_history_snapshot = _stub_clone_history
    context_stub._get_wait_state_metadata = lambda *args, **kwargs: None
    context_stub._normalize_user_text = lambda value: value or ""
    context_stub._set_wait_state_metadata = lambda *args, **kwargs: None
    sys.modules["backend.app.chatkit_server.context"] = context_stub
    chatkit_server_stub.context = context_stub
if "backend.app.chatkit_server.workflow_runner" not in sys.modules:
    workflow_runner_stub = types.ModuleType(
        "backend.app.chatkit_server.workflow_runner"
    )

    class _StubWorkflowStreamResult:
        pass

    workflow_runner_stub._WorkflowStreamResult = _StubWorkflowStreamResult
    sys.modules["backend.app.chatkit_server.workflow_runner"] = workflow_runner_stub
    chatkit_server_stub.workflow_runner = workflow_runner_stub
if "backend.app.database" not in sys.modules:
    database_stub = types.ModuleType("backend.app.database")
    database_stub.SessionLocal = lambda *args, **kwargs: None
    sys.modules["backend.app.database"] = database_stub
    backend_app_pkg.database = database_stub
if "backend.app.image_utils" not in sys.modules:
    image_utils_stub = types.ModuleType("backend.app.image_utils")
    image_utils_stub.append_generated_image_links = lambda *args, **kwargs: None
    image_utils_stub.build_agent_image_absolute_url = lambda *args, **kwargs: ""
    image_utils_stub.format_generated_image_links = lambda *args, **kwargs: []
    image_utils_stub.merge_generated_image_urls_into_payload = (
        lambda *args, **kwargs: None
    )
    image_utils_stub.save_agent_image_file = lambda *args, **kwargs: None
    sys.modules["backend.app.image_utils"] = image_utils_stub
    backend_app_pkg.image_utils = image_utils_stub
if "backend.app.widgets" not in sys.modules:
    widgets_stub = types.ModuleType("backend.app.widgets")
    widgets_stub.WidgetLibraryService = type("WidgetLibraryService", (), {})
    widgets_stub.WidgetTemplateEntry = type("WidgetTemplateEntry", (), {})
    widgets_stub.WidgetValidationError = type(
        "WidgetValidationError",
        (Exception,),
        {},
    )
    sys.modules["backend.app.widgets"] = widgets_stub
    backend_app_pkg.widgets = widgets_stub
if "backend.app.config" not in sys.modules:
    config_stub = types.ModuleType("backend.app.config")

    class _StubSettings:
        backend_public_base_url = "http://localhost"

    config_stub.get_settings = lambda: _StubSettings()  # type: ignore[attr-defined]
    sys.modules["backend.app.config"] = config_stub
    backend_app_pkg.config = config_stub
if "backend.app.models" not in sys.modules:
    models_stub = types.ModuleType("backend.app.models")
    models_stub.WorkflowDefinition = type("WorkflowDefinition", (), {})
    models_stub.WorkflowStep = type("WorkflowStep", (), {})
    models_stub.WorkflowTransition = type("WorkflowTransition", (), {})
    sys.modules["backend.app.models"] = models_stub
    backend_app_pkg.models = models_stub
if "backend.app.vector_store.ingestion" not in sys.modules:
    ingestion_stub = types.ModuleType("backend.app.vector_store.ingestion")
    ingestion_stub.evaluate_state_expression = lambda *args, **kwargs: None
    ingestion_stub.ingest_document = lambda *args, **kwargs: None
    ingestion_stub.ingest_workflow_step = lambda *args, **kwargs: None
    ingestion_stub.resolve_transform_value = lambda *args, **kwargs: None
    sys.modules["backend.app.vector_store.ingestion"] = ingestion_stub
    vector_store_stub = types.ModuleType("backend.app.vector_store")
    vector_store_stub.ingestion = ingestion_stub
    sys.modules["backend.app.vector_store"] = vector_store_stub
    backend_app_pkg.vector_store = vector_store_stub
if "backend.app.workflows.runtime" not in sys.modules:
    runtime_stub = types.ModuleType("backend.app.workflows.runtime")
    runtime_stub._coerce_bool = lambda value: bool(value)
    runtime_stub._resolve_voice_agent_configuration = lambda *args, **kwargs: {}
    runtime_stub._stream_response_widget = lambda *args, **kwargs: None
    runtime_stub.build_edges_by_source = lambda *args, **kwargs: {}
    runtime_stub.ingest_vector_store_step = lambda *args, **kwargs: None

    def _stub_initialize_runtime_context(
        *args: object, **kwargs: object
    ) -> types.SimpleNamespace:
        return types.SimpleNamespace(
            service=None,
            workflow_payload={},
            steps=[],
            conversation_history=[],
            state={},
            last_step_context={},
        )

    runtime_stub.initialize_runtime_context = _stub_initialize_runtime_context
    runtime_stub.prepare_agents = lambda *args, **kwargs: None
    runtime_stub.process_agent_step = lambda *args, **kwargs: None
    sys.modules["backend.app.workflows.runtime"] = runtime_stub
    workflows_pkg.runtime = runtime_stub
if "backend.app.workflows.service" not in sys.modules:
    service_stub = types.ModuleType("backend.app.workflows.service")
    service_stub.WorkflowService = type("WorkflowService", (), {})
    sys.modules["backend.app.workflows.service"] = service_stub
    workflows_pkg.service = service_stub
_EXECUTOR_SPEC = importlib.util.spec_from_file_location(
    "backend.app.workflows.executor",
    EXECUTOR_PATH,
)
assert _EXECUTOR_SPEC and _EXECUTOR_SPEC.loader  # pragma: no cover - test guard
executor_module = importlib.util.module_from_spec(_EXECUTOR_SPEC)
sys.modules[_EXECUTOR_SPEC.name] = executor_module
_EXECUTOR_SPEC.loader.exec_module(executor_module)


def test_normalize_conversation_history_for_groq_converts_text_blocks() -> None:
    items = [
        {
            "role": "user",
            "content": [{"type": "input_text", "text": "Bonjour"}],
        },
        {
            "role": "assistant",
            "content": [{"type": "output_text", "text": "Salut"}],
        },
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "groq",
    )

    assert normalized is not items
    assert items[0]["content"][0]["type"] == "input_text"
    assert items[1]["content"][0]["type"] == "output_text"
    assert normalized[0]["content"] == "Bonjour"
    assert normalized[1]["content"] == "Salut"


def test_normalize_conversation_history_for_litellm_converts_text_blocks() -> None:
    items = [
        {
            "role": "assistant",
            "content": [{"type": "output_text", "text": "Salut"}],
        }
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "litellm",
    )

    assert normalized is not items
    assert normalized[0]["content"] == "Salut"


def test_normalize_preserves_responses_messages_structure() -> None:
    items = [
        {
            "type": "message",
            "role": "assistant",
            "content": [
                {"type": "output_text", "text": "Bonjour"},
            ],
        }
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "groq",
    )

    assert normalized is not items
    assert normalized[0]["id"].startswith("msg_")
    assert items[0].get("id") is None


def test_normalize_conversation_history_for_litellm_with_multiple_text_parts() -> None:
    items = [
        {
            "role": "assistant",
            "content": [
                {"type": "output_text", "text": "Salut"},
                {"type": "output_text", "text": "Comment ça va ?"},
            ],
        }
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "litellm",
    )

    assert normalized is not items
    assert normalized[0]["content"] == "Salut\n\nComment ça va ?"


def test_normalize_discards_non_text_parts_for_legacy_providers() -> None:
    items = [
        {
            "role": "assistant",
            "content": [
                {"type": "output_text", "text": "Salut"},
                {"type": "image_file", "image": {"file_id": "img_1"}},
            ],
        }
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "groq",
    )

    assert normalized is not items
    assert normalized[0]["content"] == "Salut"
    # Original payload must remain untouched so it can be reused elsewhere.
    assert items[0]["content"][1]["type"] == "image_file"


def test_normalize_replaces_invalid_ids_for_legacy_providers() -> None:
    items = [
        {"role": "assistant", "content": "Bonjour", "id": "__fake_id__"},
        {
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": "Salut"}],
            "id": "another_fake",
        },
        {
            "role": "user",
            "content": [{"type": "input_text", "text": "Coucou"}],
            "id": "msg_real_id",
        },
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "groq",
    )

    assert normalized is not items
    assert normalized[0]["id"].startswith("msg_")
    assert normalized[1]["id"].startswith("msg_")
    assert normalized[2]["id"] == "msg_real_id"
    assert items[0]["id"] == "__fake_id__"
    assert items[1]["id"] == "another_fake"


def test_normalize_replaces_invalid_ids_for_other_providers() -> None:
    items = [
        {"role": "assistant", "content": "Bonjour", "id": "__fake_id__"},
        {
            "role": "assistant",
            "content": [{"type": "output_text", "text": "Salut"}],
            "id": "msg_real_id",
        },
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "openai",
    )

    assert normalized is not items
    assert normalized[0]["id"].startswith("msg_")
    assert normalized[1]["id"] == "msg_real_id"
    assert normalized[1]["content"] == [{"type": "output_text", "text": "Salut"}]
    assert items[0]["id"] == "__fake_id__"


def test_normalize_injects_missing_ids_for_message_entries() -> None:
    items = [
        {
            "role": "assistant",
            "content": [{"type": "output_text", "text": "Salut"}],
        }
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "openai",
    )

    assert normalized is not items
    assert normalized[0]["id"].startswith("msg_")
    assert "id" not in items[0]


def test_normalize_strips_ids_from_non_message_entries() -> None:
    items = [
        {"type": "response", "id": "rs_123", "status": "in_progress"},
        {"type": "response", "id": "rs_123", "status": "completed"},
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "openai",
    )

    assert normalized is not items
    assert "id" not in normalized[0]
    assert "id" not in normalized[1]
    assert items[0]["id"] == "rs_123"
    assert items[1]["id"] == "rs_123"


def test_normalize_conversation_history_unchanged_for_other_providers() -> None:
    items = [
        {
            "role": "user",
            "content": [{"type": "input_text", "text": "Bonjour"}],
        }
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "openai",
    )

    assert normalized is not items
    assert normalized[0]["id"].startswith("msg_")
    assert "id" not in items[0]


def test_deduplicate_conversation_history_items_removes_duplicate_ids() -> None:
    first = {"id": "rs_123", "role": "assistant"}
    duplicate = {"id": "rs_123", "role": "assistant", "content": []}
    items = [first, duplicate, {"id": "rs_456", "role": "user"}]

    deduplicated = executor_module._deduplicate_conversation_history_items(items)

    assert len(deduplicated) == 2
    assert first in deduplicated
    assert {"id": "rs_456", "role": "user"} in deduplicated


def test_deduplicate_conversation_history_items_returns_original_when_unique() -> None:
    items = [
        {"id": "rs_a", "role": "assistant"},
        {"id": "rs_b", "role": "user"},
    ]

    deduplicated = executor_module._deduplicate_conversation_history_items(items)

    assert deduplicated is items


def test_sanitize_previous_response_id_returns_trimmed_valid_value() -> None:
    assert (
        executor_module._sanitize_previous_response_id("  resp-123 ")
        == "resp-123"
    )


def test_sanitize_previous_response_id_rejects_invalid_values() -> None:
    assert executor_module._sanitize_previous_response_id("__fake_id__") is None
    assert executor_module._sanitize_previous_response_id(123) is None
    assert executor_module._sanitize_previous_response_id(None) is None


def test_generate_conversation_history_message_id_uses_msg_prefix() -> None:
    generated = executor_module._generate_conversation_history_message_id()

    assert isinstance(generated, str)
    assert generated.startswith("msg_")
    assert len(generated) > len("msg_")
