import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from chatkit.agents import AgentContext
from chatkit.types import (
    ActiveStatus,
    TaskItem,
    ThreadItemAddedEvent,
    ThreadMetadata,
    ThreadStreamEvent,
    UserMessageItem,
)

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

import_module("backend.app.chatkit")
executor_module = import_module("backend.app.workflows.executor")
context_module = import_module("backend.app.chatkit_server.context")

ChatKitRequestContext = context_module.ChatKitRequestContext
_WAIT_STATE_METADATA_KEY = context_module._WAIT_STATE_METADATA_KEY
WorkflowInput = executor_module.WorkflowInput
run_workflow = executor_module.run_workflow


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


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


@dataclass
class _Step:
    slug: str
    kind: str
    position: int
    is_enabled: bool
    parameters: dict[str, Any]
    display_name: str | None = None
    agent_key: str | None = None


@dataclass
class _Transition:
    source_step: _Step
    target_step: _Step
    condition: str | None = None
    id: int | None = None


class _FakeWorkflowService:
    def __init__(self, definition: Any) -> None:
        self._definition = definition

    def get_current(self) -> Any:  # pragma: no cover - simple accessor
        return self._definition


class _FakeSettings:
    backend_public_base_url = "https://example.invalid"
    chatkit_realtime_model = "gpt-voice"
    chatkit_realtime_instructions = "Soyez utile."
    chatkit_realtime_voice = "alloy"


def _build_definition() -> Any:
    start = _Step(
        slug="start",
        kind="start",
        position=1,
        is_enabled=True,
        parameters={},
        display_name="Start",
    )
    voice = _Step(
        slug="voice",
        kind="voice_agent",
        position=2,
        is_enabled=True,
        agent_key="voice-writer",
        display_name="Voice",
        parameters={
            "model": "gpt-voice",
            "voice": "ember",
            "instructions": "Répondez brièvement.",
            "realtime": {
                "start_mode": "auto",
                "stop_mode": "manual",
                "tools": {
                    "response": True,
                    "transcription": True,
                    "function_call": False,
                },
            },
            "tools": [
                {
                    "type": "web_search",
                    "web_search": {"search_context_size": "small"},
                }
            ],
        },
    )
    end = _Step(
        slug="end",
        kind="end",
        position=3,
        is_enabled=True,
        parameters={},
        display_name="End",
    )
    transitions = [
        _Transition(source_step=start, target_step=voice, id=1),
        _Transition(source_step=voice, target_step=end, id=2),
    ]
    return SimpleNamespace(
        steps=[start, voice, end],
        transitions=transitions,
        workflow_id=None,
        workflow=SimpleNamespace(slug="demo", display_name="Demo"),
    )


def _build_agent_context() -> AgentContext[ChatKitRequestContext]:
    thread = ThreadMetadata(
        id="thread-voice",
        created_at=datetime.now(),
        status=ActiveStatus(),
        metadata={},
    )
    context = ChatKitRequestContext(
        user_id="user-123",
        email="user@example.com",
        authorization=None,
        public_base_url="https://frontend.invalid",
    )
    return AgentContext(thread=thread, store=_DummyStore(), request_context=context)


@pytest.mark.anyio
async def test_voice_agent_starts_session(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_args: dict[str, Any] = {}

    async def _fake_create_session(**kwargs: Any) -> dict[str, Any]:
        captured_args.update(kwargs)
        return {"client_secret": {"value": "secret-123"}, "expires_at": "2099-01-01"}

    events: list[ThreadStreamEvent] = []

    async def _on_stream(event: ThreadStreamEvent) -> None:
        events.append(event)

    monkeypatch.setattr(
        executor_module,
        "create_realtime_voice_session",
        _fake_create_session,
    )
    monkeypatch.setattr(executor_module, "get_settings", lambda: _FakeSettings())

    agent_context = _build_agent_context()
    definition = _build_definition()
    service = _FakeWorkflowService(definition)
    workflow_input = WorkflowInput(
        input_as_text="Bonjour",
        auto_start_was_triggered=False,
        auto_start_assistant_message=None,
        source_item_id="msg-1",
    )

    summary = await run_workflow(
        workflow_input,
        agent_context=agent_context,
        on_stream_event=_on_stream,
        workflow_service=service,
    )

    assert summary.end_state is not None
    assert summary.end_state.slug == "voice"
    assert summary.end_state.status_type == "waiting"

    assert captured_args == {
        "user_id": "user-123",
        "model": "gpt-voice",
        "instructions": "Répondez brièvement.",
    }

    added_events = [
        event for event in events if isinstance(event, ThreadItemAddedEvent)
    ]
    assert added_events, "expected a task event for the voice session"
    task_event = added_events[0]
    assert isinstance(task_event.item, TaskItem)
    payload = json.loads(task_event.item.task.content or "{}")
    assert payload["type"] == "voice_session.created"
    client_secret = payload["client_secret"]
    assert "secret-123" in json.dumps(client_secret)
    assert payload["session"]["voice"] == "ember"
    assert payload["tool_permissions"] == {
        "response": True,
        "transcription": True,
        "function_call": False,
    }

    wait_state = agent_context.thread.metadata.get(_WAIT_STATE_METADATA_KEY)
    assert isinstance(wait_state, dict)
    assert wait_state.get("slug") == "voice"
    assert wait_state.get("type") == "voice"


@pytest.mark.anyio
async def test_voice_agent_processes_transcripts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_create_session(**_: Any) -> dict[str, Any]:
        return {"client_secret": {"value": "secret"}, "expires_at": "2099"}

    monkeypatch.setattr(
        executor_module,
        "create_realtime_voice_session",
        _fake_create_session,
    )
    monkeypatch.setattr(executor_module, "get_settings", lambda: _FakeSettings())

    agent_context = _build_agent_context()
    definition = _build_definition()
    service = _FakeWorkflowService(definition)
    workflow_input = WorkflowInput(
        input_as_text="Bonjour",
        auto_start_was_triggered=False,
        auto_start_assistant_message=None,
        source_item_id="msg-voice",
    )

    await run_workflow(
        workflow_input,
        agent_context=agent_context,
        workflow_service=service,
    )

    wait_state = agent_context.thread.metadata.get(_WAIT_STATE_METADATA_KEY)
    assert isinstance(wait_state, dict)

    transcripts = [
        {"role": "user", "text": "Salut"},
        {"role": "assistant", "text": "Bonjour !"},
    ]
    wait_state["voice_transcripts"] = transcripts
    agent_context.thread.metadata[_WAIT_STATE_METADATA_KEY] = wait_state

    events: list[ThreadStreamEvent] = []

    async def _on_stream(event: ThreadStreamEvent) -> None:
        events.append(event)

    # Replace create session with sentinel to ensure it is not invoked again
    async def _fail_create_session(**kwargs: Any) -> dict[str, Any]:  # pragma: no cover
        raise AssertionError("create_realtime_voice_session should not be called")

    monkeypatch.setattr(
        executor_module,
        "create_realtime_voice_session",
        _fail_create_session,
    )

    resume_input = WorkflowInput(
        input_as_text="",
        auto_start_was_triggered=False,
        auto_start_assistant_message=None,
        source_item_id="msg-voice",
    )

    summary = await run_workflow(
        resume_input,
        agent_context=agent_context,
        on_stream_event=_on_stream,
        workflow_service=service,
    )

    assert summary.final_node_slug == "end"
    assert agent_context.thread.metadata.get(_WAIT_STATE_METADATA_KEY) is None

    user_events = [
        event
        for event in events
        if isinstance(event, ThreadItemAddedEvent)
        and isinstance(event.item, UserMessageItem)
    ]
    assistant_events = [
        event
        for event in events
        if isinstance(event, ThreadItemAddedEvent)
        and not isinstance(event.item, UserMessageItem)
    ]

    assert user_events and user_events[0].item.content[0].text == "Salut"
    assert assistant_events and assistant_events[0].item.content[0].text == "Bonjour !"

    step_outputs = [step.output for step in summary.steps]
    assert any("transcripts" in output for output in step_outputs)
