import importlib
import importlib.util
import os
import sys
import types
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
CHATKIT_PY_PATH = ROOT_DIR / "chatkit-python"
if str(CHATKIT_PY_PATH) not in sys.path:
    sys.path.insert(0, str(CHATKIT_PY_PATH))


os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")


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
    backend_app_pkg = importlib.import_module("backend.app")
    setattr(backend_app_pkg, "chatkit", backend_chatkit_stub)
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


def test_normalize_does_not_touch_responses_messages() -> None:
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

    assert normalized is items


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


def test_normalize_strips_invalid_ids_for_legacy_providers() -> None:
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
    assert "id" not in normalized[0]
    assert "id" not in normalized[1]
    assert normalized[2]["id"] == "msg_real_id"


def test_normalize_strips_invalid_ids_for_other_providers() -> None:
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
    assert "id" not in normalized[0]
    assert normalized[1]["id"] == "msg_real_id"
    assert normalized[1]["content"] == [{"type": "output_text", "text": "Salut"}]


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

    assert normalized is items


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
