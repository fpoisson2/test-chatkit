import os
import sys
import types
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

CHATKIT_DIR = ROOT_DIR / "chatkit-python"
if str(CHATKIT_DIR) not in sys.path:
    sys.path.insert(0, str(CHATKIT_DIR))

if "backend" not in sys.modules:
    backend_pkg = types.ModuleType("backend")
    backend_pkg.__path__ = [str(ROOT_DIR / "backend")]
    sys.modules["backend"] = backend_pkg

if "backend.app" not in sys.modules:
    backend_app_pkg = types.ModuleType("backend.app")
    backend_app_pkg.__path__ = [str(ROOT_DIR / "backend" / "app")]
    sys.modules["backend.app"] = backend_app_pkg
    backend_pkg.app = backend_app_pkg  # type: ignore[attr-defined]

if "backend.app.telephony" not in sys.modules:
    telephony_pkg = types.ModuleType("backend.app.telephony")
    telephony_pkg.__path__ = [str(ROOT_DIR / "backend" / "app" / "telephony")]
    sys.modules["backend.app.telephony"] = telephony_pkg
    backend_app_pkg.telephony = telephony_pkg  # type: ignore[attr-defined]

if "backend.app.telephony.voice_bridge" not in sys.modules:
    voice_bridge_pkg = types.ModuleType("backend.app.telephony.voice_bridge")

    class _StubVoiceBridge:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            return

        async def run(self, *args: Any, **kwargs: Any) -> Any:
            return SimpleNamespace(
                duration_seconds=0,
                inbound_audio_bytes=0,
                outbound_audio_bytes=0,
                transcript_count=0,
                error=None,
            )

    class _StubHooks(SimpleNamespace):
        pass

    class _StubMetricsRecorder(SimpleNamespace):
        pass

    voice_bridge_pkg.TelephonyVoiceBridge = _StubVoiceBridge  # type: ignore[attr-defined]
    voice_bridge_pkg.VoiceBridgeHooks = _StubHooks  # type: ignore[attr-defined]
    voice_bridge_pkg.VoiceBridgeMetricsRecorder = _StubMetricsRecorder  # type: ignore[attr-defined]
    sys.modules["backend.app.telephony.voice_bridge"] = voice_bridge_pkg

if "backend.app.telephony.rtp_server" not in sys.modules:
    rtp_server_pkg = types.ModuleType("backend.app.telephony.rtp_server")

    class _StubRtpServer(SimpleNamespace):
        async def start(self) -> None:  # type: ignore[override]
            return None

        async def stop(self) -> None:  # type: ignore[override]
            return None

    class _StubRtpConfig(SimpleNamespace):
        pass

    rtp_server_pkg.RtpServer = _StubRtpServer  # type: ignore[attr-defined]
    rtp_server_pkg.RtpServerConfig = _StubRtpConfig  # type: ignore[attr-defined]
    sys.modules["backend.app.telephony.rtp_server"] = rtp_server_pkg

try:  # pragma: no cover - dépendances optionnelles
    import sqlalchemy  # type: ignore # noqa: F401
except ModuleNotFoundError:  # pragma: no cover - environnement minimal
    sqlalchemy_pkg = types.ModuleType("sqlalchemy")
    sqlalchemy_orm_pkg = types.ModuleType("sqlalchemy.orm")

    class _StubSession:
        ...

    sqlalchemy_orm_pkg.Session = _StubSession  # type: ignore[attr-defined]
    sqlalchemy_pkg.orm = sqlalchemy_orm_pkg  # type: ignore[attr-defined]
    sys.modules["sqlalchemy"] = sqlalchemy_pkg
    sys.modules["sqlalchemy.orm"] = sqlalchemy_orm_pkg

if "agents" not in sys.modules:
    agents_pkg = types.ModuleType("agents")
    agents_pkg.__path__ = []
    agents_pkg.set_default_openai_client = lambda *args, **kwargs: None  # type: ignore[attr-defined]

    class _StubAgent(SimpleNamespace):
        async def arun(self, *args: Any, **kwargs: Any) -> Any:  # pragma: no cover
            return None

    class _StubRunConfig(SimpleNamespace):
        pass

    class _StubRunner(SimpleNamespace):
        async def run(self, *args: Any, **kwargs: Any) -> Any:  # pragma: no cover
            return None

    agents_pkg.Agent = _StubAgent  # type: ignore[attr-defined]
    agents_pkg.RunConfig = _StubRunConfig  # type: ignore[attr-defined]
    agents_pkg.Runner = _StubRunner  # type: ignore[attr-defined]

    class _StubModelSettings(SimpleNamespace):
        pass

    agents_pkg.ModelSettings = _StubModelSettings  # type: ignore[attr-defined]
    sys.modules["agents"] = agents_pkg

    agents_models_pkg = types.ModuleType("agents.models")
    agents_models_pkg.__path__ = []  # type: ignore[attr-defined]
    sys.modules["agents.models"] = agents_models_pkg
    agents_pkg.models = agents_models_pkg  # type: ignore[attr-defined]

    chatcmpl_helpers_pkg = types.ModuleType("agents.models.chatcmpl_helpers")

    class _StubHeaders(dict):
        pass

    chatcmpl_helpers_pkg.HEADERS_OVERRIDE = _StubHeaders()  # type: ignore[attr-defined]
    sys.modules["agents.models.chatcmpl_helpers"] = chatcmpl_helpers_pkg

    openai_responses_pkg = types.ModuleType("agents.models.openai_responses")
    openai_responses_pkg._HEADERS_OVERRIDE = _StubHeaders()  # type: ignore[attr-defined]
    sys.modules["agents.models.openai_responses"] = openai_responses_pkg

    interface_pkg = types.ModuleType("agents.models.interface")

    class _StubModelProvider(SimpleNamespace):
        pass

    interface_pkg.ModelProvider = _StubModelProvider  # type: ignore[attr-defined]
    sys.modules["agents.models.interface"] = interface_pkg

    openai_provider_pkg = types.ModuleType("agents.models.openai_provider")
    openai_provider_pkg.OpenAIProvider = type("OpenAIProvider", (), {})  # type: ignore[attr-defined]
    sys.modules["agents.models.openai_provider"] = openai_provider_pkg

    computer_pkg = types.ModuleType("agents.computer")

    class _StubAsyncComputer(SimpleNamespace):
        async def open(self, *args: Any, **kwargs: Any) -> None:  # pragma: no cover
            return None

    class _StubButton(SimpleNamespace):
        pass

    class _StubEnvironment(SimpleNamespace):
        pass

    computer_pkg.AsyncComputer = _StubAsyncComputer  # type: ignore[attr-defined]
    computer_pkg.Button = _StubButton  # type: ignore[attr-defined]
    computer_pkg.Environment = _StubEnvironment  # type: ignore[attr-defined]
    sys.modules["agents.computer"] = computer_pkg

    for _event_name in [
        "InputGuardrailTripwireTriggered",
        "OutputGuardrailTripwireTriggered",
        "RunResultStreaming",
        "StreamEvent",
        "TResponseInputItem",
    ]:
        setattr(agents_pkg, _event_name, type(_event_name, (), {}))

    handoffs_pkg = types.ModuleType("agents.handoffs")

    class _StubHandoff(SimpleNamespace):
        pass

    handoffs_pkg.Handoff = _StubHandoff  # type: ignore[attr-defined]
    sys.modules["agents.handoffs"] = handoffs_pkg

    mcp_pkg = types.ModuleType("agents.mcp")

    class _StubMCP(SimpleNamespace):
        pass

    mcp_pkg.MCPServer = _StubMCP  # type: ignore[attr-defined]
    mcp_pkg.MCPServerSse = _StubMCP  # type: ignore[attr-defined]
    mcp_pkg.MCPServerStreamableHttp = _StubMCP  # type: ignore[attr-defined]
    sys.modules["agents.mcp"] = mcp_pkg

    realtime_pkg = types.ModuleType("agents.realtime")
    realtime_pkg.__path__ = []
    sys.modules["agents.realtime"] = realtime_pkg

    realtime_agent_pkg = types.ModuleType("agents.realtime.agent")

    class _StubRealtimeAgent:
        def __init__(self, name: str | None = None, instructions: str | None = None, **_: Any) -> None:
            self.name = name
            self.instructions = instructions

        def clone(self, **kwargs: Any) -> "_StubRealtimeAgent":
            clone_kwargs = {
                "name": kwargs.get("name", self.name),
                "instructions": kwargs.get("instructions", self.instructions),
            }
            return _StubRealtimeAgent(**clone_kwargs)

    realtime_agent_pkg.RealtimeAgent = _StubRealtimeAgent  # type: ignore[attr-defined]
    sys.modules["agents.realtime.agent"] = realtime_agent_pkg

    realtime_config_pkg = types.ModuleType("agents.realtime.config")
    realtime_config_pkg.RealtimeRunConfig = dict  # type: ignore[attr-defined]
    sys.modules["agents.realtime.config"] = realtime_config_pkg

    realtime_runner_pkg = types.ModuleType("agents.realtime.runner")

    class _StubRealtimeRunner:
        def __init__(self, agent: _StubRealtimeAgent, config: Any = None) -> None:
            self.agent = agent
            self.config = config

        async def run(self, *args: Any, **kwargs: Any) -> Any:
            class _StubSession:
                async def __aenter__(self) -> "_StubSession":
                    return self

                async def __aexit__(self, exc_type, exc, tb) -> bool:  # type: ignore[no-untyped-def]
                    return False

                def __aiter__(self):  # type: ignore[no-untyped-def]
                    return self

                async def __anext__(self):  # type: ignore[no-untyped-def]
                    raise StopAsyncIteration

            return _StubSession()

    realtime_runner_pkg.RealtimeRunner = _StubRealtimeRunner  # type: ignore[attr-defined]
    sys.modules["agents.realtime.runner"] = realtime_runner_pkg

    realtime_events_pkg = types.ModuleType("agents.realtime.events")
    for _name in [
        "RealtimeAgentEndEvent",
        "RealtimeAgentStartEvent",
        "RealtimeAudio",
        "RealtimeAudioEnd",
        "RealtimeAudioInterrupted",
        "RealtimeError",
        "RealtimeHandoffEvent",
        "RealtimeHistoryAdded",
        "RealtimeHistoryUpdated",
        "RealtimeToolEnd",
        "RealtimeToolStart",
    ]:
        setattr(realtime_events_pkg, _name, type(_name, (), {}))
    sys.modules["agents.realtime.events"] = realtime_events_pkg

    realtime_items_pkg = types.ModuleType("agents.realtime.items")
    realtime_items_pkg.AssistantMessageItem = type("RealtimeAssistantMessageItem", (), {})  # type: ignore[attr-defined]
    realtime_items_pkg.UserMessageItem = type("RealtimeUserMessageItem", (), {})  # type: ignore[attr-defined]
    sys.modules["agents.realtime.items"] = realtime_items_pkg

    realtime_model_inputs_pkg = types.ModuleType("agents.realtime.model_inputs")
    realtime_model_inputs_pkg.RealtimeModelSendRawMessage = type("RealtimeModelSendRawMessage", (), {})  # type: ignore[attr-defined]
    sys.modules["agents.realtime.model_inputs"] = realtime_model_inputs_pkg

    realtime_model_pkg = types.ModuleType("agents.realtime.model")
    realtime_model_pkg.RealtimePlaybackTracker = type("RealtimePlaybackTracker", (), {})  # type: ignore[attr-defined]
    realtime_model_pkg.RealtimePlaybackState = type("RealtimePlaybackState", (), {})  # type: ignore[attr-defined]
    sys.modules["agents.realtime.model"] = realtime_model_pkg

    tool_pkg = types.ModuleType("agents.tool")

    class _StubTool(SimpleNamespace):
        pass

    for _tool_name in [
        "Tool",
        "FunctionTool",
        "CodeInterpreterTool",
        "ComputerTool",
        "FileSearchTool",
        "HostedMCPTool",
        "ImageGenerationTool",
        "LocalShellTool",
        "WebSearchTool",
    ]:
        setattr(tool_pkg, _tool_name, type(_tool_name, (_StubTool,), {}))

    sys.modules["agents.tool"] = tool_pkg
    agents_pkg.FunctionTool = getattr(tool_pkg, "FunctionTool")  # type: ignore[attr-defined]
    agents_pkg.WebSearchTool = getattr(tool_pkg, "WebSearchTool")  # type: ignore[attr-defined]
    agents_pkg.RunContextWrapper = SimpleNamespace  # type: ignore[attr-defined]

    def _stub_function_tool(*args: Any, **kwargs: Any) -> Any:  # pragma: no cover
        return SimpleNamespace()

    agents_pkg.function_tool = _stub_function_tool  # type: ignore[attr-defined]

if "openai" not in sys.modules:
    openai_pkg = types.ModuleType("openai")

    class _StubAsyncOpenAI(SimpleNamespace):  # pragma: no cover
        pass

    openai_pkg.AsyncOpenAI = _StubAsyncOpenAI  # type: ignore[attr-defined]
    openai_pkg.OpenAI = SimpleNamespace  # type: ignore[attr-defined]
    sys.modules["openai"] = openai_pkg

    responses_pkg = types.ModuleType("openai.types.responses")
    for _response_name in [
        "EasyInputMessageParam",
        "ResponseComputerToolCall",
        "ResponseFunctionToolCallParam",
        "ResponseFunctionWebSearch",
        "ResponseInputContentParam",
        "ResponseInputMessageContentListParam",
        "ResponseInputTextParam",
        "ResponseOutputText",
    ]:
        setattr(responses_pkg, _response_name, type(_response_name, (), {}))

    types_pkg = types.ModuleType("openai.types")
    types_pkg.responses = responses_pkg  # type: ignore[attr-defined]
    openai_pkg.types = types_pkg  # type: ignore[attr-defined]
    sys.modules["openai.types"] = types_pkg
    sys.modules["openai.types.responses"] = responses_pkg

    response_input_pkg = types.ModuleType("openai.types.responses.response_input_item_param")
    response_input_pkg.FunctionCallOutput = type("FunctionCallOutput", (), {})  # type: ignore[attr-defined]
    response_input_pkg.Message = type("Message", (), {})  # type: ignore[attr-defined]
    responses_pkg.response_input_item_param = response_input_pkg  # type: ignore[attr-defined]
    sys.modules["openai.types.responses.response_input_item_param"] = response_input_pkg

    response_output_pkg = types.ModuleType("openai.types.responses.response_output_message")
    response_output_pkg.Content = type("Content", (), {})  # type: ignore[attr-defined]
    responses_pkg.response_output_message = response_output_pkg  # type: ignore[attr-defined]
    sys.modules["openai.types.responses.response_output_message"] = response_output_pkg

    response_output_text_pkg = types.ModuleType(
        "openai.types.responses.response_output_text"
    )
    response_output_text_pkg.Annotation = type("Annotation", (), {})  # type: ignore[attr-defined]
    responses_pkg.response_output_text = response_output_text_pkg  # type: ignore[attr-defined]
    sys.modules["openai.types.responses.response_output_text"] = response_output_text_pkg

if "multidict" not in sys.modules:
    multidict_pkg = types.ModuleType("multidict")

    class _StubCIMultiDict(dict):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, **kwargs)

        def copy(self) -> "_StubCIMultiDict":  # pragma: no cover
            return _StubCIMultiDict(self)

    multidict_pkg.CIMultiDict = _StubCIMultiDict  # type: ignore[attr-defined]
    sys.modules["multidict"] = multidict_pkg

os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

from backend.app.telephony.outbound_call_manager import (  # noqa: E402
    OutboundCallManager,
    OutboundCallSession,
)


class _StubGateway:
    def __init__(self) -> None:
        self.connections: list[_StubConnection] = []

    async def register_connection(self, connection: "_StubConnection") -> None:
        self.connections.append(connection)

    async def register_session(self, handle: Any) -> None:
        payload = {
            "type": "session_created",
            "session_id": handle.session_id,
            "thread_id": handle.metadata.get("thread_id"),
        }
        for connection in list(self.connections):
            await connection.send_json(payload)


class _StubConnection:
    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []

    async def send_json(self, payload: dict[str, Any]) -> None:
        self.messages.append(dict(payload))


@pytest.mark.anyio
async def test_outbound_voice_session_exposes_owner_user_id(monkeypatch: pytest.MonkeyPatch) -> None:
    gateway = _StubGateway()
    connection = _StubConnection()
    await gateway.register_connection(connection)

    async def _fake_open_voice_session(
        *,
        user_id: str,
        model: str,
        instructions: str,
        voice: str | None,
        provider_id: str | None,
        provider_slug: str | None,
        tools: Any,
        handoffs: Any,
        realtime: Any,
        metadata: Any,
    ) -> Any:
        metadata_payload = {
            "user_id": user_id,
            "model": model,
            "voice": voice,
            "realtime": realtime,
        }
        if isinstance(metadata, dict):
            metadata_payload.update(metadata)
        session_id = uuid.uuid4().hex
        handle = SimpleNamespace(
            session_id=session_id,
            client_secret="secret",
            metadata=metadata_payload,
            runner=SimpleNamespace(),
            agent=SimpleNamespace(instructions=instructions),
        )
        await gateway.register_session(handle)
        return handle

    monkeypatch.setattr(
        "backend.app.telephony.outbound_call_manager.open_voice_session",
        _fake_open_voice_session,
    )

    manager = OutboundCallManager()
    session = OutboundCallSession(
        call_id="call-123",
        to_number="+33123456789",
        from_number="+33987654321",
        workflow_id=1,
        sip_account_id=2,
        metadata={"user_id": "user-42", "thread_id": "thread-xyz"},
    )

    handle = await manager._open_voice_session_for_call(
        session,
        model="gpt-voice",
        instructions="Répondez gentiment",
        voice="alloy",
        provider_id=None,
        provider_slug="openai",
        tools=[],
        handoffs=[],
        realtime={},
    )

    assert handle.metadata.get("user_id") == "user-42"
    assert handle.metadata.get("thread_id") == "thread-xyz"
    assert connection.messages, "aucun événement session_created reçu"
    payload = connection.messages[-1]
    assert payload.get("type") == "session_created"
    assert payload.get("session_id") == handle.session_id
    assert payload.get("thread_id") == "thread-xyz"


@pytest.fixture
def anyio_backend() -> str:
    """Force AnyIO to use asyncio for this test module."""

    return "asyncio"
