"""Tests de régression pour la reprise après un bloc d'attente."""

from __future__ import annotations

import asyncio
from datetime import datetime
from types import SimpleNamespace

_WAIT_STATE_METADATA_KEY = "workflow_wait_for_user_input"

try:  # pragma: no cover - compatibilité d'import selon l'exécution
    from .test_workflow_executor import (
        _DummyAgent,
        _FakeStreamResult,
        _load_workflow_modules,
    )
except ImportError:  # pragma: no cover - fallback lorsque pytest ajuste PYTHONPATH
    from test_workflow_executor import (  # type: ignore[no-redef]
        _DummyAgent,
        _FakeStreamResult,
        _load_workflow_modules,
    )

executor, runtime_agents = _load_workflow_modules()


async def _noop_async_generator(*args, **kwargs):  # pragma: no cover - helper
    if False:
        yield None


class _FakeStore:
    async def save_thread(self, thread, context):  # pragma: no cover - helper
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


def _build_step(slug: str, kind: str, position: int, **kwargs):
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


def _build_transition(source, target, identifier: int):
    return SimpleNamespace(
        source_step=source,
        target_step=target,
        id=identifier,
        condition=None,
    )


def test_resume_wait_state_without_source_item_id(monkeypatch):
    async def _run() -> None:
        WorkflowInput = executor.WorkflowInput
        run_workflow = executor.run_workflow

        if not hasattr(WorkflowInput, "model_dump"):
            WorkflowInput.model_dump = WorkflowInput.dict  # type: ignore[assignment]

        agent_calls: list[str] = []

        def _fake_run_streamed(
            agent, *, input, run_config, context, previous_response_id
        ):
            agent_name = getattr(agent, "name", "unknown")
            agent_calls.append(agent_name)
            return _FakeStreamResult({"agent": agent_name})

        async def _fake_ingest_vector_store_step(*args, **kwargs):
            return None

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
        monkeypatch.setattr(executor, "stream_agent_response", _noop_async_generator)
        monkeypatch.setattr(
            executor,
            "ingest_vector_store_step",
            _fake_ingest_vector_store_step,
        )

        start_step = _build_step("start", "start", 0)
        first_agent = _build_step(
            "agent-one",
            "agent",
            1,
            agent_key="first_agent",
        )
        wait_step = _build_step("wait", "wait_for_user_input", 2)
        second_agent = _build_step(
            "agent-two",
            "agent",
            3,
            agent_key="second_agent",
        )
        end_step = _build_step("end", "end", 4)

        transitions = [
            _build_transition(start_step, first_agent, 1),
            _build_transition(first_agent, wait_step, 2),
            _build_transition(wait_step, second_agent, 3),
            _build_transition(second_agent, end_step, 4),
        ]

        definition = SimpleNamespace(
            workflow_id=1,
            workflow=SimpleNamespace(slug="demo-workflow", display_name="Demo"),
            steps=[start_step, first_agent, wait_step, second_agent, end_step],
            transitions=transitions,
        )

        class _FakeWorkflowService:
            def get_available_model_capabilities(self):  # pragma: no cover - helper
                return {}

        agent_context = _FakeAgentContext()

        user_message_one = SimpleNamespace(
            id="msg-1",
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[SimpleNamespace(type="input_text", text="Bonjour")],
            inference_options=SimpleNamespace(),
        )

        summary_one = await run_workflow(
            WorkflowInput(input_as_text="Bonjour"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=user_message_one,
        )

        assert summary_one.end_state is not None
        assert summary_one.end_state.status_type == "waiting"
        assert agent_calls == ["first-agent"]

        user_message_two = SimpleNamespace(
            id="msg-2",
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[SimpleNamespace(type="input_text", text="Réponse")],
            inference_options=SimpleNamespace(),
        )

        summary_two = await run_workflow(
            WorkflowInput(input_as_text="Réponse"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=user_message_two,
        )

        assert summary_two.final_output == {"agent": "second-agent"}
        assert agent_calls == ["first-agent", "second-agent"]

    asyncio.run(_run())


def test_wait_state_cleared_when_workflow_ends_without_transition(monkeypatch):
    async def _run() -> None:
        WorkflowInput = executor.WorkflowInput
        run_workflow = executor.run_workflow

        if not hasattr(WorkflowInput, "model_dump"):
            WorkflowInput.model_dump = WorkflowInput.dict  # type: ignore[assignment]

        agent_calls: list[str] = []

        def _fake_run_streamed(
            agent, *, input, run_config, context, previous_response_id
        ):
            agent_name = getattr(agent, "name", "unknown")
            agent_calls.append(agent_name)
            return _FakeStreamResult({"agent": agent_name})

        async def _fake_ingest_vector_store_step(*args, **kwargs):
            return None

        monkeypatch.setitem(
            runtime_agents.AGENT_BUILDERS,
            "first_agent",
            lambda overrides: _DummyAgent("first-agent"),
        )

        monkeypatch.setattr(executor.Runner, "run_streamed", _fake_run_streamed)
        monkeypatch.setattr(executor, "stream_agent_response", _noop_async_generator)
        monkeypatch.setattr(
            executor,
            "ingest_vector_store_step",
            _fake_ingest_vector_store_step,
        )

        start_step = _build_step("start", "start", 0)
        wait_step = _build_step("wait", "wait_for_user_input", 1)
        agent_step = _build_step("agent-one", "agent", 2, agent_key="first_agent")

        transitions = [
            _build_transition(start_step, wait_step, 1),
            _build_transition(wait_step, agent_step, 2),
        ]

        definition = SimpleNamespace(
            workflow_id=1,
            workflow=SimpleNamespace(slug="demo-wait-clear", display_name="Demo"),
            steps=[start_step, wait_step, agent_step],
            transitions=transitions,
        )

        class _FakeWorkflowService:
            def get_available_model_capabilities(self):  # pragma: no cover - helper
                return {}

        agent_context = _FakeAgentContext()

        first_message = SimpleNamespace(
            id="msg-1",
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[SimpleNamespace(type="input_text", text="Bonjour")],
            inference_options=SimpleNamespace(),
        )

        summary_one = await run_workflow(
            WorkflowInput(input_as_text="Bonjour"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=first_message,
        )

        assert summary_one.end_state is not None
        assert summary_one.end_state.status_type == "waiting"
        assert _WAIT_STATE_METADATA_KEY in agent_context.thread.metadata
        assert agent_calls == []

        second_message = SimpleNamespace(
            id="msg-2",
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[SimpleNamespace(type="input_text", text="Réponse")],
            inference_options=SimpleNamespace(),
        )

        summary_two = await run_workflow(
            WorkflowInput(input_as_text="Réponse"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=second_message,
        )

        assert summary_two.final_output == {"agent": "first-agent"}
        assert summary_two.end_state is not None
        assert summary_two.end_state.status_type == "waiting"
        assert _WAIT_STATE_METADATA_KEY not in agent_context.thread.metadata
        assert agent_calls == ["first-agent"]

        third_message = SimpleNamespace(
            id="msg-3",
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[SimpleNamespace(type="input_text", text="Encore")],
            inference_options=SimpleNamespace(),
        )

        summary_three = await run_workflow(
            WorkflowInput(input_as_text="Encore"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=third_message,
        )

        assert summary_three.end_state is not None
        assert summary_three.end_state.status_type == "waiting"
        assert _WAIT_STATE_METADATA_KEY in agent_context.thread.metadata
        assert agent_calls == ["first-agent"]

    asyncio.run(_run())


def test_wait_does_not_resume_with_same_user_message_id(monkeypatch):
    async def _run() -> None:
        WorkflowInput = executor.WorkflowInput
        run_workflow = executor.run_workflow

        if not hasattr(WorkflowInput, "model_dump"):
            WorkflowInput.model_dump = WorkflowInput.dict  # type: ignore[assignment]

        agent_calls: list[str] = []

        def _fake_run_streamed(
            agent, *, input, run_config, context, previous_response_id
        ):
            agent_name = getattr(agent, "name", "unknown")
            agent_calls.append(agent_name)
            return _FakeStreamResult({"agent": agent_name})

        async def _fake_ingest_vector_store_step(*args, **kwargs):
            return None

        monkeypatch.setitem(
            runtime_agents.AGENT_BUILDERS,
            "post_wait_agent",
            lambda overrides: _DummyAgent("post-wait"),
        )
        monkeypatch.setattr(executor.Runner, "run_streamed", _fake_run_streamed)
        monkeypatch.setattr(executor, "stream_agent_response", _noop_async_generator)
        monkeypatch.setattr(
            executor,
            "ingest_vector_store_step",
            _fake_ingest_vector_store_step,
        )

        start_step = _build_step("start", "start", 0)
        wait_step = _build_step("wait", "wait_for_user_input", 1)
        after_wait_agent = _build_step(
            "after-wait", "agent", 2, agent_key="post_wait_agent"
        )
        transitions = [
            _build_transition(start_step, wait_step, 1),
            _build_transition(wait_step, after_wait_agent, 2),
        ]

        definition = SimpleNamespace(
            workflow_id=1,
            workflow=SimpleNamespace(slug="no-resume-same-id", display_name="No resume"),
            steps=[start_step, wait_step, after_wait_agent],
            transitions=transitions,
        )

        class _FakeWorkflowService:
            def get_available_model_capabilities(self):  # pragma: no cover - helper
                return {}

        agent_context = _FakeAgentContext()

        first_message = SimpleNamespace(
            id="msg-1",
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[SimpleNamespace(type="input_text", text="Bonjour")],
            inference_options=SimpleNamespace(),
        )

        summary_one = await run_workflow(
            WorkflowInput(input_as_text="Bonjour"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=first_message,
        )

        assert summary_one.end_state is not None
        assert summary_one.end_state.status_type == "waiting"
        assert agent_calls == []

        # Re-run the workflow with the same user message id; it should keep waiting
        retry_input = WorkflowInput(input_as_text="", source_item_id="msg-retry")
        summary_two = await run_workflow(
            retry_input,
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=first_message,
        )

        assert summary_two.end_state is not None
        assert summary_two.end_state.status_type == "waiting"
        assert agent_calls == []
        wait_state_after_retry = agent_context.thread.metadata.get(_WAIT_STATE_METADATA_KEY)
        assert wait_state_after_retry is not None
        assert wait_state_after_retry.get("input_item_id") == "msg-1"

    asyncio.run(_run())


def test_post_wait_terminal_step_without_transition(monkeypatch):
    async def _run() -> None:
        WorkflowInput = executor.WorkflowInput
        run_workflow = executor.run_workflow

        if not hasattr(WorkflowInput, "model_dump"):
            WorkflowInput.model_dump = WorkflowInput.dict  # type: ignore[assignment]

        agent_calls: list[str] = []

        def _fake_run_streamed(
            agent, *, input, run_config, context, previous_response_id
        ):
            agent_name = getattr(agent, "name", "unknown")
            agent_calls.append(agent_name)
            return _FakeStreamResult({"agent": agent_name})

        async def _fake_ingest_vector_store_step(*args, **kwargs):
            return None

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
        monkeypatch.setattr(executor, "stream_agent_response", _noop_async_generator)
        monkeypatch.setattr(
            executor,
            "ingest_vector_store_step",
            _fake_ingest_vector_store_step,
        )

        start_step = _build_step("start", "start", 0)
        agent_one = _build_step("agent-one", "agent", 1, agent_key="first_agent")
        wait_step = _build_step("wait", "wait_for_user_input", 2)
        agent_two = _build_step("agent-two", "agent", 3, agent_key="second_agent")

        transitions = [
            _build_transition(start_step, agent_one, 1),
            _build_transition(agent_one, wait_step, 2),
            _build_transition(wait_step, agent_two, 3),
        ]

        definition = SimpleNamespace(
            workflow_id=1,
            workflow=SimpleNamespace(slug="post-wait-end", display_name="Demo"),
            steps=[start_step, agent_one, wait_step, agent_two],
            transitions=transitions,
        )

        class _FakeWorkflowService:
            def get_available_model_capabilities(self):  # pragma: no cover - helper
                return {}

        agent_context = _FakeAgentContext()

        first_message = SimpleNamespace(
            id="msg-1",
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[SimpleNamespace(type="input_text", text="Bonjour")],
            inference_options=SimpleNamespace(),
        )

        summary_one = await run_workflow(
            WorkflowInput(input_as_text="Bonjour"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=first_message,
        )

        assert summary_one.end_state is not None
        assert summary_one.end_state.status_type == "waiting"
        assert _WAIT_STATE_METADATA_KEY in agent_context.thread.metadata
        assert agent_calls == ["first-agent"]

        second_message = SimpleNamespace(
            id="msg-2",
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[SimpleNamespace(type="input_text", text="Réponse")],
            inference_options=SimpleNamespace(),
        )

        summary_two = await run_workflow(
            WorkflowInput(input_as_text="Réponse"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=second_message,
        )

        assert summary_two.final_output == {"agent": "second-agent"}
        assert summary_two.end_state is not None
        assert summary_two.end_state.status_type == "waiting"
        assert _WAIT_STATE_METADATA_KEY not in agent_context.thread.metadata
        assert agent_calls == ["first-agent", "second-agent"]

    asyncio.run(_run())


def test_while_runs_wait_node_on_second_iteration(monkeypatch):
    async def _run() -> None:
        WorkflowInput = executor.WorkflowInput
        run_workflow = executor.run_workflow

        if not hasattr(WorkflowInput, "model_dump"):
            WorkflowInput.model_dump = WorkflowInput.dict  # type: ignore[assignment]

        async def _fake_ingest_vector_store_step(*args, **kwargs):
            return None

        monkeypatch.setattr(executor, "ingest_vector_store_step", _fake_ingest_vector_store_step)

        start_step = _build_step("start", "start", 0)
        while_step = _build_step(
            "loop",
            "while",
            1,
            parameters={"condition": "state.get('state', {}).get('loop_index', 0) < 3", "iteration_var": "loop_index"},
        )
        wait_step = _build_step("wait", "wait_for_user_input", 2)
        wait_step.parent_slug = "loop"
        wait_step.ui_metadata = {"position": {"x": 0, "y": 0}}
        end_step = _build_step("end", "end", 3)

        transitions = [
            _build_transition(start_step, while_step, 1),
            _build_transition(while_step, wait_step, 2),
            _build_transition(while_step, end_step, 3),
        ]
        transitions[2].condition = "exit"

        definition = SimpleNamespace(
            workflow_id=1,
            workflow=SimpleNamespace(slug="while-wait", display_name="While with wait"),
            steps=[start_step, while_step, wait_step, end_step],
            transitions=transitions,
        )

        class _FakeWorkflowService:
            def get_available_model_capabilities(self):  # pragma: no cover - helper
                return {}

        agent_context = _FakeAgentContext()

        first_message = SimpleNamespace(
            id="msg-1",
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[SimpleNamespace(type="input_text", text="Bonjour")],
            inference_options=SimpleNamespace(),
        )

        summary_one = await run_workflow(
            WorkflowInput(input_as_text="Bonjour"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=first_message,
        )

        assert summary_one.end_state is not None
        assert summary_one.end_state.status_type == "waiting"
        assert agent_context.thread.metadata.get(_WAIT_STATE_METADATA_KEY) is not None

        second_message = SimpleNamespace(
            id="msg-2",
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[SimpleNamespace(type="input_text", text="Encore")],
            inference_options=SimpleNamespace(),
        )

        summary_two = await run_workflow(
            WorkflowInput(input_as_text="Encore"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=second_message,
        )

        assert summary_two.end_state is not None
        assert summary_two.end_state.status_type == "waiting"
        wait_state = agent_context.thread.metadata.get(_WAIT_STATE_METADATA_KEY)
        assert wait_state is not None
        assert wait_state.get("input_item_id") == "msg-2"

    asyncio.run(_run())


def test_wait_in_while_does_not_resume_without_new_user_message(monkeypatch):
    async def _run() -> None:
        WorkflowInput = executor.WorkflowInput
        run_workflow = executor.run_workflow

        if not hasattr(WorkflowInput, "model_dump"):
            WorkflowInput.model_dump = WorkflowInput.dict  # type: ignore[assignment]

        async def _fake_ingest_vector_store_step(*args, **kwargs):
            return None

        monkeypatch.setattr(executor, "ingest_vector_store_step", _fake_ingest_vector_store_step)

        start_step = _build_step("start", "start", 0)
        while_step = _build_step(
            "loop",
            "while",
            1,
            parameters={"condition": "state.get('state', {}).get('loop_index', 0) < 2", "iteration_var": "loop_index"},
        )
        wait_step = _build_step("wait", "wait_for_user_input", 2)
        wait_step.parent_slug = "loop"
        wait_step.ui_metadata = {"position": {"x": 0, "y": 0}}

        transitions = [
            _build_transition(start_step, while_step, 1),
            _build_transition(while_step, wait_step, 2),
        ]

        definition = SimpleNamespace(
            workflow_id=1,
            workflow=SimpleNamespace(slug="while-wait-retry", display_name="While with wait retry"),
            steps=[start_step, while_step, wait_step],
            transitions=transitions,
        )

        class _FakeWorkflowService:
            def get_available_model_capabilities(self):  # pragma: no cover - helper
                return {}

        agent_context = _FakeAgentContext()

        first_message = SimpleNamespace(
            id="msg-1",
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[SimpleNamespace(type="input_text", text="Bonjour")],
            inference_options=SimpleNamespace(),
        )

        summary_one = await run_workflow(
            WorkflowInput(input_as_text="Bonjour"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=first_message,
        )

        assert summary_one.end_state is not None
        assert summary_one.end_state.status_type == "waiting"
        wait_state = agent_context.thread.metadata.get(_WAIT_STATE_METADATA_KEY)
        assert wait_state is not None
        assert wait_state.get("input_item_id") == "msg-1"

        # Re-run the workflow without a new user message (e.g., retry/resume)
        retry_input = WorkflowInput(input_as_text="", source_item_id="msg-retry")
        summary_two = await run_workflow(
            retry_input,
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=None,
        )

        assert summary_two.end_state is not None
        assert summary_two.end_state.status_type == "waiting"
        wait_state_after_retry = agent_context.thread.metadata.get(_WAIT_STATE_METADATA_KEY)
        assert wait_state_after_retry is not None
        assert wait_state_after_retry.get("input_item_id") == "msg-1"

    asyncio.run(_run())


def test_wait_in_while_ignores_resumed_message_with_same_source_id(monkeypatch):
    async def _run() -> None:
        WorkflowInput = executor.WorkflowInput
        run_workflow = executor.run_workflow

        if not hasattr(WorkflowInput, "model_dump"):
            WorkflowInput.model_dump = WorkflowInput.dict  # type: ignore[assignment]

        async def _fake_ingest_vector_store_step(*args, **kwargs):
            return None

        monkeypatch.setattr(executor, "ingest_vector_store_step", _fake_ingest_vector_store_step)

        start_step = _build_step("start", "start", 0)
        while_step = _build_step(
            "loop",
            "while",
            1,
            parameters={"condition": "state.get('state', {}).get('loop_index', 0) < 2", "iteration_var": "loop_index"},
        )
        wait_step = _build_step("wait", "wait_for_user_input", 2)
        wait_step.parent_slug = "loop"
        wait_step.ui_metadata = {"position": {"x": 0, "y": 0}}

        transitions = [
            _build_transition(start_step, while_step, 1),
            _build_transition(while_step, wait_step, 2),
        ]

        definition = SimpleNamespace(
            workflow_id=1,
            workflow=SimpleNamespace(slug="while-wait-retry", display_name="While with wait retry"),
            steps=[start_step, while_step, wait_step],
            transitions=transitions,
        )

        class _FakeWorkflowService:
            def get_available_model_capabilities(self):  # pragma: no cover - helper
                return {}

        agent_context = _FakeAgentContext()

        first_message = SimpleNamespace(
            id="msg-1",
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[SimpleNamespace(type="input_text", text="Bonjour")],
            inference_options=SimpleNamespace(),
        )

        summary_one = await run_workflow(
            WorkflowInput(input_as_text="Bonjour"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=first_message,
        )

        assert summary_one.end_state is not None
        assert summary_one.end_state.status_type == "waiting"
        wait_state = agent_context.thread.metadata.get(_WAIT_STATE_METADATA_KEY)
        assert wait_state is not None
        assert wait_state.get("input_item_id") == "msg-1"

        # Retry with a different user message ID but the same source_item_id as the saved wait input
        resumed_message = SimpleNamespace(
            id="msg-2",
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[SimpleNamespace(type="input_text", text="Bonjour")],
            inference_options=SimpleNamespace(),
        )

        retry_input = WorkflowInput(input_as_text="", source_item_id="msg-1")
        summary_two = await run_workflow(
            retry_input,
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=resumed_message,
        )

        assert summary_two.end_state is not None
        assert summary_two.end_state.status_type == "waiting"
        wait_state_after_retry = agent_context.thread.metadata.get(_WAIT_STATE_METADATA_KEY)
        assert wait_state_after_retry is not None
        # The wait should continue to track the original input id
        assert wait_state_after_retry.get("input_item_id") == "msg-1"

    asyncio.run(_run())


def test_wait_in_while_skips_reentry_without_new_user_message(monkeypatch):
    async def _run() -> None:
        WorkflowInput = executor.WorkflowInput
        run_workflow = executor.run_workflow

        if not hasattr(WorkflowInput, "model_dump"):
            WorkflowInput.model_dump = WorkflowInput.dict  # type: ignore[assignment]

        async def _fake_ingest_vector_store_step(*args, **kwargs):
            return None

        monkeypatch.setattr(executor, "ingest_vector_store_step", _fake_ingest_vector_store_step)

        agent_calls: list[str] = []

        def _fake_run_streamed(agent, *, input, run_config, context, previous_response_id):
            agent_name = getattr(agent, "name", "unknown")
            agent_calls.append(agent_name)
            return _FakeStreamResult({"agent": agent_name})

        monkeypatch.setattr(executor.Runner, "run_streamed", _fake_run_streamed)
        monkeypatch.setitem(
            runtime_agents.AGENT_BUILDERS,
            "loop_agent",
            lambda overrides: _DummyAgent("loop-agent"),
        )

        start_step = _build_step("start", "start", 0)
        while_step = _build_step(
            "loop",
            "while",
            1,
            parameters={"condition": "state.get('state', {}).get('loop_index', 0) < 3", "iteration_var": "loop_index"},
        )
        agent_step = _build_step("agent", "agent", 2, agent_key="loop_agent")
        agent_step.parent_slug = "loop"
        agent_step.ui_metadata = {"position": {"x": 0, "y": 0}}
        wait_step = _build_step("wait", "wait_for_user_input", 3)
        wait_step.parent_slug = "loop"
        wait_step.ui_metadata = {"position": {"x": 0, "y": 1}}

        transitions = [
            _build_transition(start_step, while_step, 1),
            _build_transition(while_step, agent_step, 2),
            _build_transition(agent_step, wait_step, 3),
        ]

        definition = SimpleNamespace(
            workflow_id=1,
            workflow=SimpleNamespace(slug="while-wait-retry-agent", display_name="While with wait and agent"),
            steps=[start_step, while_step, agent_step, wait_step],
            transitions=transitions,
        )

        class _FakeWorkflowService:
            def get_available_model_capabilities(self):  # pragma: no cover - helper
                return {}

        agent_context = _FakeAgentContext()

        first_message = SimpleNamespace(
            id="msg-1",
            thread_id=agent_context.thread.id,
            created_at=datetime.now(),
            content=[SimpleNamespace(type="input_text", text="Bonjour")],
            inference_options=SimpleNamespace(),
        )

        summary_one = await run_workflow(
            WorkflowInput(input_as_text="Bonjour"),
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=first_message,
        )

        assert summary_one.end_state is not None
        assert summary_one.end_state.status_type == "waiting"
        assert agent_calls == ["loop-agent"]

        wait_state = agent_context.thread.metadata.get(_WAIT_STATE_METADATA_KEY)
        assert wait_state is not None
        assert wait_state.get("input_item_id") == "msg-1"

        retry_input = WorkflowInput(input_as_text="", source_item_id="msg-retry")
        summary_two = await run_workflow(
            retry_input,
            agent_context=agent_context,
            workflow_definition=definition,
            workflow_service=_FakeWorkflowService(),
            current_user_message=None,
        )

        assert summary_two.end_state is not None
        assert summary_two.end_state.status_type == "waiting"
        wait_state_after_retry = agent_context.thread.metadata.get(_WAIT_STATE_METADATA_KEY)
        assert wait_state_after_retry is not None
        assert wait_state_after_retry.get("input_item_id") == "msg-1"
        assert agent_calls == ["loop-agent"]

    asyncio.run(_run())

