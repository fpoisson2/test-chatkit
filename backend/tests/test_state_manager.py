import sys
import types
import asyncio
from pathlib import Path

backend_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_dir))

_agents_stub = types.ModuleType("agents")
_app_stub = types.ModuleType("app")
_workflows_stub = types.ModuleType("app.workflows")
_runtime_stub = types.ModuleType("app.workflows.runtime")
_app_stub.__path__ = [str(backend_dir / "app")]
_workflows_stub.__path__ = [str(backend_dir / "app" / "workflows")]
_runtime_stub.__path__ = [str(backend_dir / "app" / "workflows" / "runtime")]
sys.modules.setdefault("app", _app_stub)
sys.modules.setdefault("app.workflows", _workflows_stub)
sys.modules.setdefault("app.workflows.runtime", _runtime_stub)

_chatkit_stub = types.ModuleType("chatkit")
_chatkit_types_stub = types.ModuleType("chatkit.types")
_chatkit_agents_stub = types.ModuleType("chatkit.agents")
_chatkit_stub.__path__ = []


class _StubAgent:  # pragma: no cover - test helper
    pass


_agents_stub.Agent = _StubAgent
_agents_stub.TResponseInputItem = dict
sys.modules.setdefault("agents", _agents_stub)
_chatkit_types_stub.ThreadItem = type("ThreadItem", (), {})
_chatkit_types_stub.UserMessageItem = type("UserMessageItem", (), {})
_chatkit_stub.types = _chatkit_types_stub
_chatkit_agents_stub.AgentContext = type("AgentContext", (), {})
_chatkit_agents_stub.ThreadItemConverter = type("ThreadItemConverter", (), {})
sys.modules.setdefault("chatkit", _chatkit_stub)
sys.modules.setdefault("chatkit.types", _chatkit_types_stub)
sys.modules.setdefault("chatkit.agents", _chatkit_agents_stub)

import pytest

from app.workflows.runtime.state_manager import StateInitializer


class _DummyThreadItem:
    def __init__(self, item_id: str) -> None:
        self.id = item_id


class _DummyWorkflowInput:
    def __init__(
        self,
        *,
        input_as_text: str,
        auto_start_was_triggered: bool | None,
        auto_start_assistant_message: str | None,
        source_item_id: str | None,
        model_override: str | None,
    ) -> None:
        self.input_as_text = input_as_text
        self.auto_start_was_triggered = auto_start_was_triggered
        self.auto_start_assistant_message = auto_start_assistant_message
        self.source_item_id = source_item_id
        self.model_override = model_override

    def model_dump(self) -> dict:
        return {
            "input_as_text": self.input_as_text,
            "auto_start_was_triggered": self.auto_start_was_triggered,
            "auto_start_assistant_message": self.auto_start_assistant_message,
            "source_item_id": self.source_item_id,
            "model_override": self.model_override,
        }


class _DummyWorkflow:
    def __init__(self, slug: str = "dummy") -> None:
        self.slug = slug


class _DummyDefinition:
    def __init__(self) -> None:
        self.workflow_id = 1
        self.workflow = _DummyWorkflow()


class _DummyContent:
    def __init__(self, text: str) -> None:
        self.text = text


class _DummyUserMessage:
    def __init__(self, message_id: str, text: str) -> None:
        self.id = message_id
        self.content = [_DummyContent(text)]
        self.attachments = []


class _DummyConverter:
    def __init__(self, history_text: str, current_text: str) -> None:
        self.history_text = history_text
        self.current_text = current_text

    async def to_agent_input(self, items):  # pragma: no cover - exercised in test
        if isinstance(items, list):
            return [
                {"role": "user", "content": [{"type": "input_text", "text": self.history_text}]}
                for _ in items
            ]
        return [
            {"role": "user", "content": [{"type": "input_text", "text": self.current_text}]}
        ]


class _DummyAgentContext:
    thread = None


def test_current_user_message_not_duplicated_when_source_item_id_differs():
    initializer = StateInitializer(service=None)

    workflow_input = _DummyWorkflowInput(
        input_as_text="hello",
        auto_start_was_triggered=False,
        auto_start_assistant_message=None,
        source_item_id="unrelated-id",
        model_override=None,
    )

    current_message = _DummyUserMessage("message-123", "hello")
    converter = _DummyConverter(history_text="from-history", current_text="from-current")

    context = asyncio.run(
        initializer.initialize(
            workflow_input=workflow_input,
            agent_context=_DummyAgentContext(),
            thread_item_converter=converter,
            thread_items_history=[_DummyThreadItem("message-123")],
            current_user_message=current_message,
            runtime_snapshot=None,
            workflow_definition=_DummyDefinition(),
            workflow_slug=None,
            workflow_call_stack=None,
        )
    )

    assert len(context.conversation_history) == 1
    assert context.conversation_history[0]["content"][0]["text"] == "from-current"
