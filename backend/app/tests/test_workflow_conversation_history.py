from __future__ import annotations

import asyncio
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from chatkit.agents import ThreadItemConverter
from chatkit.types import (
    ActiveStatus,
    FileAttachment,
    InferenceOptions,
    ThreadMetadata,
    ThreadStreamEvent,
    UserMessageItem,
    UserMessageTextContent,
)

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///./chatkit-tests.db")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")

import_module("backend.app.chatkit")
executor_module = import_module("backend.app.workflows.executor")
_build_user_message_history_items = executor_module._build_user_message_history_items
WorkflowInput = executor_module.WorkflowInput
WorkflowExecutionError = executor_module.WorkflowExecutionError
run_workflow = executor_module.run_workflow


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class DummyConverter(ThreadItemConverter):
    def __init__(self, output: list[object]) -> None:
        super().__init__()
        self._output = output
        self.calls: list[object] = []

    async def to_agent_input(self, thread_items):  # type: ignore[override]
        self.calls.append(thread_items)
        return list(self._output)


def test_build_user_history_items_includes_fallback_for_attachment_only() -> None:
    message = UserMessageItem(
        id="msg-attachment",
        thread_id="thr-1",
        created_at=datetime.now(),
        content=[],
        attachments=[
            FileAttachment(
                id="att-1",
                name="Recu.pdf",
                mime_type="application/pdf",
            )
        ],
        inference_options=InferenceOptions(),
    )
    converter = DummyConverter(
        [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_file",
                        "file_data": "data:application/pdf;base64,ZmFrZQ==",
                        "filename": "Recu.pdf",
                    }
                ],
            }
        ]
    )
    fallback = "Attachment 1: Recu.pdf (file, application/pdf)"

    items = asyncio.run(
        _build_user_message_history_items(
            converter=converter,
            message=message,
            fallback_text=fallback,
        )
    )

    assert converter.calls and converter.calls[0] is message
    assert len(items) == 2
    assert items[0]["content"][0]["filename"] == "Recu.pdf"
    assert items[1]["content"][0]["text"] == fallback


def test_build_user_history_items_skips_fallback_when_text_present() -> None:
    message = UserMessageItem(
        id="msg-text",
        thread_id="thr-1",
        created_at=datetime.now(),
        content=[UserMessageTextContent(text="Bonjour")],
        attachments=[],
        inference_options=InferenceOptions(),
    )
    converter = DummyConverter(
        [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": "Bonjour",
                    }
                ],
            }
        ]
    )

    items = asyncio.run(
        _build_user_message_history_items(
            converter=converter,
            message=message,
            fallback_text="Bonjour",
        )
    )

    assert len(items) == 1
    assert items[0]["content"][0]["text"] == "Bonjour"


def test_build_user_history_items_only_uses_fallback_when_converter_empty() -> None:
    message = UserMessageItem(
        id="msg-empty",
        thread_id="thr-1",
        created_at=datetime.now(),
        content=[],
        attachments=[],
        inference_options=InferenceOptions(),
    )
    converter = DummyConverter([])
    fallback = "Attachment 1: document.pdf (file, application/pdf)"

    items = asyncio.run(
        _build_user_message_history_items(
            converter=converter,
            message=message,
            fallback_text=fallback,
        )
    )

    assert len(items) == 1
    assert items[0]["content"][0]["text"] == fallback


@dataclass
class _Step:
    slug: str
    kind: str
    position: int
    is_enabled: bool = True
    parameters: dict[str, Any] = field(default_factory=dict)
    display_name: str | None = None
    agent_key: str | None = None


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

    async def save_thread(
        self, thread: ThreadMetadata, context: Any
    ) -> None:  # pragma: no cover - stockage mémoire simple
        return None


class _AgentContext:
    def __init__(self) -> None:
        self.thread = ThreadMetadata(
            id="thread-parallel",
            created_at=datetime.now(),
            status=ActiveStatus(),
            metadata={},
        )
        self.store = _DummyStore()
        self.request_context = SimpleNamespace(
            user_id="user-1",
            email="user@example.com",
            public_base_url="https://frontend.invalid",
        )
        self._counter = 0

    def generate_id(self, prefix: str) -> str:
        self._counter += 1
        return f"{prefix}-{self._counter}"


def _build_parallel_definition(*, failing_branch: bool) -> SimpleNamespace:
    split_slug = "parallel-split"
    join_slug = "parallel-join"
    start = _Step(slug="start", kind="start", position=1)
    split = _Step(
        slug=split_slug,
        kind="parallel_split",
        position=2,
        parameters={
            "join_slug": join_slug,
            "branches": [
                {"slug": "branch-a", "label": "Branche A"},
                {"slug": "branch-b", "label": "Branche B"},
            ],
        },
        display_name="Split",
    )
    branch_a = _Step(
        slug="branch-a",
        kind="assistant_message",
        position=3,
        parameters={"message": "Réponse A"},
        display_name="Assistant A",
    )
    branch_b_parameters: dict[str, Any]
    if failing_branch:
        branch_b_parameters = {"expressions": "invalid"}
        branch_b_kind = "transform"
    else:
        branch_b_parameters = {"message": "Réponse B"}
        branch_b_kind = "assistant_message"
    branch_b = _Step(
        slug="branch-b",
        kind=branch_b_kind,
        position=4,
        parameters=branch_b_parameters,
        display_name="Branche B",
    )
    join = _Step(
        slug=join_slug,
        kind="parallel_join",
        position=5,
        parameters={},
        display_name="Join",
    )
    end = _Step(slug="end", kind="end", position=6)

    transitions = [
        _Transition(source_step=start, target_step=split, id=1),
        _Transition(source_step=split, target_step=branch_a, id=2),
        _Transition(source_step=split, target_step=branch_b, id=3),
        _Transition(source_step=branch_a, target_step=join, id=4),
        _Transition(source_step=branch_b, target_step=join, id=5),
        _Transition(source_step=join, target_step=end, id=6),
    ]

    workflow = SimpleNamespace(slug="parallel-demo", display_name="Parallel Demo")

    return SimpleNamespace(
        steps=[start, split, branch_a, branch_b, join, end],
        transitions=transitions,
        workflow=workflow,
        workflow_id=1,
    )


def _build_workflow_input() -> WorkflowInput:
    return WorkflowInput(
        input_as_text="Bonjour",
        auto_start_was_triggered=False,
        auto_start_assistant_message=None,
        source_item_id="msg-1",
    )


@pytest.mark.anyio
async def test_parallel_split_aggregates_branch_outputs() -> None:
    definition = _build_parallel_definition(failing_branch=False)
    agent_context = _AgentContext()
    workflow_input = _build_workflow_input()

    step_updates: list[tuple[str, int]] = []

    async def _on_step(summary, index):  # type: ignore[no-untyped-def]
        step_updates.append((summary.key, index))

    stream_events: list[ThreadStreamEvent] = []

    async def _on_stream(event: ThreadStreamEvent) -> None:
        stream_events.append(event)

    summary = await run_workflow(
        workflow_input,
        agent_context=agent_context,
        on_step=_on_step,
        on_stream_event=_on_stream,
        workflow_definition=definition,
        workflow_slug="parallel-demo",
    )

    step_keys = [step.key for step in summary.steps]
    assert step_keys == [
        "parallel-split",
        "branch-a:branch-a",
        "branch-b:branch-b",
        "parallel-join",
    ]

    # L'état final ne conserve pas les sorties parallèles après la jointure.
    assert "parallel_outputs" not in (summary.state or {})

    assert summary.last_context is not None
    join_payload = summary.last_context.get("parallel_join")
    assert isinstance(join_payload, dict)
    assert join_payload["split_slug"] == "parallel-split"
    assert join_payload["join_slug"] == "parallel-join"

    branches = join_payload["branches"]
    assert set(branches.keys()) == {"branch-a", "branch-b"}
    assert branches["branch-a"]["last_context"]["assistant_message"] == "Réponse A"
    assert branches["branch-b"]["last_context"]["assistant_message"] == "Réponse B"

    # Chaque branche émet un couple d'évènements (ajout et fin de message).
    assert len(stream_events) == 4

    assert step_updates == [
        ("parallel-split", 1),
        ("branch-a:branch-a", 2),
        ("branch-b:branch-b", 3),
        ("parallel-join", 4),
    ]


@pytest.mark.anyio
async def test_parallel_branch_failure_preserves_branch_context() -> None:
    definition = _build_parallel_definition(failing_branch=True)
    agent_context = _AgentContext()
    workflow_input = _build_workflow_input()

    with pytest.raises(WorkflowExecutionError) as exc_info:
        await run_workflow(
            workflow_input,
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_slug="parallel-demo",
        )

    error = exc_info.value
    assert error.step == "branch-b"
    assert "expressions" in str(error)
