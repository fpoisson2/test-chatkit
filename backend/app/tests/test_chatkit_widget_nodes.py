import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[3]))
sys.path.append(str(Path(__file__).resolve().parents[2]))
sys.path.append(str(Path(__file__).resolve().parents[1]))

import asyncio
import json
from datetime import datetime
from types import SimpleNamespace
from typing import Any, Callable

import pytest

from backend.app.chatkit import (
    AutoStartConfiguration,
    ChatKitRequestContext,
    DemoChatKitServer,
    WorkflowInput,
    _STREAM_DONE,
    run_workflow,
)
from backend.app.config import Settings
from backend.app.workflows.service import WorkflowService, WorkflowValidationError
from chatkit.types import (
    ActiveStatus,
    AssistantMessageContent,
    AssistantMessageContentPartTextDelta,
    AssistantMessageItem,
    NoticeEvent,
    Page,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    ThreadItemUpdated,
    ThreadMetadata,
    UserMessageItem,
)

from .test_chatkit_vector_store_ingestion import (
    _DummyRunnerResult,
    _DummyWorkflowService,
    chatkit_module,
)


def test_normalize_graph_accepts_widget_node() -> None:
    service = WorkflowService(session_factory=lambda: None)
    payload = {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {
                "slug": "analysis",
                "kind": "agent",
                "agent_key": "triage",
                "is_enabled": True,
            },
            {
                "slug": "widget-view",
                "kind": "widget",
                "is_enabled": True,
                "parameters": {"widget": {"slug": "resume"}},
            },
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [
            {"source": "start", "target": "analysis"},
            {"source": "analysis", "target": "widget-view"},
            {"source": "widget-view", "target": "end"},
        ],
    }

    nodes, edges = service._normalize_graph(payload)

    assert any(node.kind == "widget" for node in nodes)
    assert any(edge.target_slug == "widget-view" for edge in edges)


def test_normalize_graph_accepts_watch_node() -> None:
    service = WorkflowService(session_factory=lambda: None)
    payload = {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {
                "slug": "analysis",
                "kind": "agent",
                "agent_key": "triage",
                "is_enabled": True,
            },
            {"slug": "watch-payload", "kind": "watch", "is_enabled": True},
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [
            {"source": "start", "target": "analysis"},
            {"source": "analysis", "target": "watch-payload"},
            {"source": "watch-payload", "target": "end"},
        ],
    }

    nodes, edges = service._normalize_graph(payload)

    assert any(node.kind == "watch" for node in nodes)
    assert any(edge.target_slug == "watch-payload" for edge in edges)


def test_normalize_graph_accepts_assistant_message_node() -> None:
    service = WorkflowService(session_factory=lambda: None)
    payload = {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {"slug": "assistant", "kind": "assistant_message", "is_enabled": True},
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [
            {"source": "start", "target": "assistant"},
            {"source": "assistant", "target": "end"},
        ],
    }

    nodes, edges = service._normalize_graph(payload)

    assert any(node.kind == "assistant_message" for node in nodes)
    assert any(edge.source_slug == "assistant" for edge in edges)


def test_normalize_graph_accepts_user_message_node() -> None:
    service = WorkflowService(session_factory=lambda: None)
    payload = {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {"slug": "user", "kind": "user_message", "is_enabled": True},
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [
            {"source": "start", "target": "user"},
            {"source": "user", "target": "end"},
        ],
    }

    nodes, edges = service._normalize_graph(payload)

    assert any(node.kind == "user_message" for node in nodes)
    assert any(edge.source_slug == "user" for edge in edges)


def test_normalize_graph_accepts_wait_for_user_input_node() -> None:
    service = WorkflowService(session_factory=lambda: None)
    payload = {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {"slug": "pause", "kind": "wait_for_user_input", "is_enabled": True},
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [
            {"source": "start", "target": "pause"},
            {"source": "pause", "target": "end"},
        ],
    }

    nodes, edges = service._normalize_graph(payload)

    assert any(node.kind == "wait_for_user_input" for node in nodes)
    assert any(edge.source_slug == "pause" for edge in edges)


def test_watch_node_requires_single_incoming_edge() -> None:
    service = WorkflowService(session_factory=lambda: None)
    payload = {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {"slug": "collecte-a", "kind": "agent", "agent_key": "triage", "is_enabled": True},
            {"slug": "collecte-b", "kind": "agent", "agent_key": "triage", "is_enabled": True},
            {"slug": "watch-multiple", "kind": "watch", "is_enabled": True},
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [
            {"source": "start", "target": "collecte-a"},
            {"source": "start", "target": "collecte-b"},
            {"source": "collecte-a", "target": "watch-multiple"},
            {"source": "collecte-b", "target": "watch-multiple"},
            {"source": "watch-multiple", "target": "end"},
        ],
    }

    with pytest.raises(WorkflowValidationError, match="bloc watch watch-multiple"):
        service._normalize_graph(payload)


def test_watch_node_emits_assistant_message(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[Any] = []

    def _run_agent(*args, **kwargs) -> _DummyRunnerResult:  # type: ignore[no-untyped-def]
        return _DummyRunnerResult({"status": "ok", "details": {"count": 3}})

    async def _noop_stream(*args, **kwargs):  # type: ignore[no-untyped-def]
        if False:
            yield None
        return

    monkeypatch.setattr(chatkit_module.Runner, "run_streamed", _run_agent)
    monkeypatch.setattr(chatkit_module, "stream_agent_response", _noop_stream)

    async def _collect(event):  # type: ignore[no-untyped-def]
        events.append(event)

    agent_context = SimpleNamespace(store=None, thread=None, request_context=None)

    start_step = SimpleNamespace(
        slug="start",
        kind="start",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=0,
        id=1,
        display_name="Début",
    )
    agent_step = SimpleNamespace(
        slug="analyse",
        kind="agent",
        is_enabled=True,
        parameters={},
        agent_key="triage",
        position=1,
        id=2,
        display_name="Analyse",
    )
    watch_step = SimpleNamespace(
        slug="watch-result",
        kind="watch",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=2,
        id=3,
        display_name="Watch",
    )
    end_step = SimpleNamespace(
        slug="end",
        kind="end",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=3,
        id=4,
        display_name="Fin",
    )

    transitions = [
        SimpleNamespace(id=1, source_step=start_step, target_step=agent_step, condition=None),
        SimpleNamespace(id=2, source_step=agent_step, target_step=watch_step, condition=None),
        SimpleNamespace(id=3, source_step=watch_step, target_step=end_step, condition=None),
    ]

    definition = SimpleNamespace(
        steps=[start_step, agent_step, watch_step, end_step],
        transitions=transitions,
        workflow_id=1,
        workflow=SimpleNamespace(slug="demo", display_name="Démo"),
    )

    async def _run() -> None:
        await run_workflow(
            WorkflowInput(input_as_text="Bonjour"),
            agent_context=agent_context,
            workflow_service=_DummyWorkflowService(definition),
            on_stream_event=_collect,
        )

    asyncio.run(_run())

    assistant_messages = [
        event
        for event in events
        if isinstance(event, ThreadItemDoneEvent)
        and isinstance(event.item, AssistantMessageItem)
        and any("Bloc watch" in part.text for part in event.item.content)
    ]
    assert assistant_messages, "Le bloc watch devrait diffuser un message assistant."
    watch_message_text = assistant_messages[0].item.content[0].text
    assert "Bloc watch" in watch_message_text
    assert "status" in watch_message_text

    assert not [event for event in events if isinstance(event, NoticeEvent)], (
        "Le bloc watch ne doit plus diffuser de notice d'information."
    )


def test_assistant_message_node_streams_message() -> None:
    events: list[Any] = []

    async def _collect(event):  # type: ignore[no-untyped-def]
        events.append(event)

    agent_context = SimpleNamespace(
        store=None,
        thread=SimpleNamespace(id="thread-demo", metadata={}),
        request_context=None,
        generate_id=lambda prefix: f"{prefix}-1",
    )

    start_step = SimpleNamespace(
        slug="start",
        kind="start",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=0,
        id=1,
        display_name="Début",
    )
    assistant_step = SimpleNamespace(
        slug="message-bienvenue",
        kind="assistant_message",
        is_enabled=True,
        parameters={"message": "Bienvenue à bord."},
        agent_key=None,
        position=1,
        id=2,
        display_name="Message",
    )
    end_step = SimpleNamespace(
        slug="end",
        kind="end",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=2,
        id=3,
        display_name="Fin",
    )

    transitions = [
        SimpleNamespace(id=1, source_step=start_step, target_step=assistant_step, condition=None),
        SimpleNamespace(id=2, source_step=assistant_step, target_step=end_step, condition=None),
    ]

    definition = SimpleNamespace(
        steps=[start_step, assistant_step, end_step],
        transitions=transitions,
        workflow_id=1,
        workflow=SimpleNamespace(slug="demo", display_name="Démo"),
    )

    async def _run() -> None:
        await run_workflow(
            WorkflowInput(input_as_text="Bonjour"),
            agent_context=agent_context,
            workflow_service=_DummyWorkflowService(definition),
            on_stream_event=_collect,
        )

    asyncio.run(_run())

    assistant_events = [
        event
        for event in events
        if isinstance(event, ThreadItemDoneEvent)
        and isinstance(event.item, AssistantMessageItem)
        and any("Bienvenue" in part.text for part in event.item.content)
    ]

    assert assistant_events, "Le bloc message assistant doit diffuser un message."
    assert assistant_events[0].item.content[0].text.strip() == "Bienvenue à bord."


def test_wait_for_user_input_node_streams_message_and_stops(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[Any] = []
    recorded_agents: list[str] = []
    inputs_by_agent: list[list[Any]] = []

    async def _collect(event):  # type: ignore[no-untyped-def]
        events.append(event)

    def _capture_run(agent, *args, **kwargs):  # type: ignore[no-untyped-def]
        recorded_agents.append(getattr(agent, "name", "unknown"))
        inputs_by_agent.append(json.loads(json.dumps(kwargs.get("input", []))))
        result = _DummyRunnerResult({"status": "ok"})
        if getattr(agent, "name", "") == "Agent Triage":
            result.new_items.append(
                SimpleNamespace(
                    to_input_item=lambda: {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "output_text",
                                "text": "Réponse initiale",
                            }
                        ],
                    }
                )
            )
        return result

    async def _noop_stream(*args, **kwargs):  # type: ignore[no-untyped-def]
        if False:
            yield None
        return

    monkeypatch.setattr(chatkit_module.Runner, "run_streamed", _capture_run)
    monkeypatch.setattr(chatkit_module, "stream_agent_response", _noop_stream)
    monkeypatch.setitem(
        chatkit_module._AGENT_BUILDERS,  # type: ignore[attr-defined]
        "triage",
        lambda overrides: SimpleNamespace(name="Agent Triage"),
    )
    monkeypatch.setitem(
        chatkit_module._AGENT_BUILDERS,  # type: ignore[attr-defined]
        "triage_2",
        lambda overrides: SimpleNamespace(name="Agent Secondaire"),
    )

    agent_context = SimpleNamespace(
        store=None,
        thread=SimpleNamespace(id="thread-demo", metadata={}),
        request_context=None,
        generate_id=lambda prefix: f"{prefix}-1",
    )

    start_step = SimpleNamespace(
        slug="start",
        kind="start",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=0,
        id=1,
        display_name="Début",
    )
    first_agent = SimpleNamespace(
        slug="collecte-initiale",
        kind="agent",
        is_enabled=True,
        parameters={},
        agent_key="triage",
        position=1,
        id=2,
        display_name="Collecte",
    )
    wait_step = SimpleNamespace(
        slug="attente-utilisateur",
        kind="wait_for_user_input",
        is_enabled=True,
        parameters={"message": "Merci de compléter les informations."},
        agent_key=None,
        position=2,
        id=3,
        display_name="Attente",
    )
    second_agent = SimpleNamespace(
        slug="analyse-suite",
        kind="agent",
        is_enabled=True,
        parameters={},
        agent_key="triage_2",
        position=3,
        id=4,
        display_name="Analyse finale",
    )
    end_step = SimpleNamespace(
        slug="end",
        kind="end",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=4,
        id=5,
        display_name="Fin",
    )

    transitions = [
        SimpleNamespace(id=1, source_step=start_step, target_step=first_agent, condition=None),
        SimpleNamespace(id=2, source_step=first_agent, target_step=wait_step, condition=None),
        SimpleNamespace(id=3, source_step=wait_step, target_step=second_agent, condition=None),
        SimpleNamespace(id=4, source_step=second_agent, target_step=end_step, condition=None),
    ]

    definition = SimpleNamespace(
        steps=[start_step, first_agent, wait_step, second_agent, end_step],
        transitions=transitions,
        workflow_id=1,
        workflow=SimpleNamespace(slug="demo", display_name="Démo"),
    )

    async def _run() -> "WorkflowRunSummary":
        return await run_workflow(
            WorkflowInput(input_as_text="Bonjour"),
            agent_context=agent_context,
            workflow_service=_DummyWorkflowService(definition),
            on_stream_event=_collect,
        )

    summary = asyncio.run(_run())

    assert recorded_agents == ["Agent Triage"], "Le second agent ne doit pas être exécuté."
    assert summary.final_node_slug == "attente-utilisateur"
    assert summary.end_state is not None, "Le résumé doit marquer le bloc d'attente comme état final."
    assert summary.end_state.slug == "attente-utilisateur"
    assert summary.end_state.status_type == "waiting"
    assert summary.end_state.status_reason is not None
    assert "Merci de compléter" in summary.end_state.status_reason

    wait_step_summary = next(step for step in summary.steps if step.key == "attente-utilisateur")
    assert "Merci de compléter" in wait_step_summary.output

    wait_metadata_key = getattr(chatkit_module, "_WAIT_STATE_METADATA_KEY")
    wait_state = agent_context.thread.metadata.get(wait_metadata_key)
    assert wait_state is not None
    assert wait_state["slug"] == "attente-utilisateur"
    assert wait_state["input_item_id"] is None

    assistant_events = [
        event
        for event in events
        if isinstance(event, ThreadItemDoneEvent)
        and isinstance(event.item, AssistantMessageItem)
        and any("Merci de compléter" in part.text for part in event.item.content)
    ]
    assert assistant_events, "Le bloc d'attente doit diffuser un message assistant."


def test_wait_for_user_input_node_resumes_after_new_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[Any] = []
    recorded_agents: list[str] = []
    inputs_by_agent: list[list[Any]] = []

    async def _collect(event):  # type: ignore[no-untyped-def]
        events.append(event)

    def _capture_run(agent, *args, **kwargs):  # type: ignore[no-untyped-def]
        recorded_agents.append(getattr(agent, "name", "unknown"))
        inputs_by_agent.append(json.loads(json.dumps(kwargs.get("input", []))))
        result = _DummyRunnerResult({"status": "ok"})
        if getattr(agent, "name", "") == "Agent Triage":
            result.new_items.append(
                SimpleNamespace(
                    to_input_item=lambda: {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "output_text",
                                "text": "Réponse initiale",
                            }
                        ],
                    }
                )
            )
        return result

    async def _noop_stream(*args, **kwargs):  # type: ignore[no-untyped-def]
        if False:
            yield None
        return

    monkeypatch.setattr(chatkit_module.Runner, "run_streamed", _capture_run)
    monkeypatch.setattr(chatkit_module, "stream_agent_response", _noop_stream)
    monkeypatch.setitem(
        chatkit_module._AGENT_BUILDERS,  # type: ignore[attr-defined]
        "triage",
        lambda overrides: SimpleNamespace(name="Agent Triage"),
    )
    monkeypatch.setitem(
        chatkit_module._AGENT_BUILDERS,  # type: ignore[attr-defined]
        "triage_2",
        lambda overrides: SimpleNamespace(name="Agent Secondaire"),
    )

    agent_context = SimpleNamespace(
        store=None,
        thread=SimpleNamespace(id="thread-demo", metadata={}),
        request_context=None,
        generate_id=lambda prefix: f"{prefix}-1",
    )

    start_step = SimpleNamespace(
        slug="start",
        kind="start",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=0,
        id=1,
        display_name="Début",
    )
    first_agent = SimpleNamespace(
        slug="collecte-initiale",
        kind="agent",
        is_enabled=True,
        parameters={},
        agent_key="triage",
        position=1,
        id=2,
        display_name="Collecte",
    )
    wait_step = SimpleNamespace(
        slug="attente-utilisateur",
        kind="wait_for_user_input",
        is_enabled=True,
        parameters={"message": "Merci de compléter les informations."},
        agent_key=None,
        position=2,
        id=3,
        display_name="Attente",
    )
    second_agent = SimpleNamespace(
        slug="analyse-suite",
        kind="agent",
        is_enabled=True,
        parameters={},
        agent_key="triage_2",
        position=3,
        id=4,
        display_name="Analyse finale",
    )
    end_step = SimpleNamespace(
        slug="end",
        kind="end",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=4,
        id=5,
        display_name="Fin",
    )

    transitions = [
        SimpleNamespace(id=1, source_step=start_step, target_step=first_agent, condition=None),
        SimpleNamespace(id=2, source_step=first_agent, target_step=wait_step, condition=None),
        SimpleNamespace(id=3, source_step=wait_step, target_step=second_agent, condition=None),
        SimpleNamespace(id=4, source_step=second_agent, target_step=end_step, condition=None),
    ]

    definition = SimpleNamespace(
        steps=[start_step, first_agent, wait_step, second_agent, end_step],
        transitions=transitions,
        workflow_id=1,
        workflow=SimpleNamespace(slug="demo", display_name="Démo"),
    )

    async def _run_first() -> "WorkflowRunSummary":
        return await run_workflow(
            WorkflowInput(input_as_text="Bonjour", source_item_id="msg-1"),
            agent_context=agent_context,
            workflow_service=_DummyWorkflowService(definition),
            on_stream_event=_collect,
        )

    summary_first = asyncio.run(_run_first())

    assert summary_first.final_node_slug == "attente-utilisateur"
    assert recorded_agents == ["Agent Triage"]
    assert inputs_by_agent == [
        [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "Bonjour"},
                ],
            }
        ]
    ]

    wait_metadata_key = getattr(chatkit_module, "_WAIT_STATE_METADATA_KEY")
    wait_state = agent_context.thread.metadata.get(wait_metadata_key)
    assert wait_state is not None
    assert wait_state["input_item_id"] == "msg-1"
    assert wait_state.get("conversation_history") == [
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "Bonjour"},
            ],
        },
        {
            "role": "assistant",
            "content": [
                {"type": "output_text", "text": "Réponse initiale"},
            ],
        },
    ]

    recorded_agents.clear()
    events.clear()
    inputs_by_agent.clear()

    async def _run_second() -> "WorkflowRunSummary":
        return await run_workflow(
            WorkflowInput(
                input_as_text="Voici les informations manquantes",
                source_item_id="msg-2",
            ),
            agent_context=agent_context,
            workflow_service=_DummyWorkflowService(definition),
            on_stream_event=_collect,
        )

    summary_second = asyncio.run(_run_second())

    assert recorded_agents == ["Agent Secondaire"]
    assert summary_second.final_node_slug == "end"
    assert summary_second.end_state is not None
    assert summary_second.end_state.slug == "end"
    assert inputs_by_agent == [
        [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "Bonjour"},
                ],
            },
            {
                "role": "assistant",
                "content": [
                    {"type": "output_text", "text": "Réponse initiale"},
                ],
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": "Voici les informations manquantes",
                    },
                ],
            },
        ]
    ]
    assert agent_context.thread.metadata.get(wait_metadata_key) is None


def test_assistant_message_node_streams_with_effect() -> None:
    events: list[Any] = []

    async def _collect(event):  # type: ignore[no-untyped-def]
        events.append(event)

    agent_context = SimpleNamespace(
        store=None,
        thread=SimpleNamespace(id="thread-demo"),
        request_context=None,
        generate_id=lambda prefix: f"{prefix}-1",
    )

    start_step = SimpleNamespace(
        slug="start",
        kind="start",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=0,
        id=1,
        display_name="Début",
    )
    assistant_step = SimpleNamespace(
        slug="message-bienvenue",
        kind="assistant_message",
        is_enabled=True,
        parameters={
            "message": "Bienvenue en streaming.",
            "simulate_stream": True,
            "simulate_stream_delay_ms": 0,
        },
        agent_key=None,
        position=1,
        id=2,
        display_name="Message",
    )
    end_step = SimpleNamespace(
        slug="end",
        kind="end",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=2,
        id=3,
        display_name="Fin",
    )

    transitions = [
        SimpleNamespace(id=1, source_step=start_step, target_step=assistant_step, condition=None),
        SimpleNamespace(id=2, source_step=assistant_step, target_step=end_step, condition=None),
    ]

    definition = SimpleNamespace(
        steps=[start_step, assistant_step, end_step],
        transitions=transitions,
        workflow_id=1,
        workflow=SimpleNamespace(slug="demo", display_name="Démo"),
    )

    async def _run() -> None:
        await run_workflow(
            WorkflowInput(input_as_text="Bonjour"),
            agent_context=agent_context,
            workflow_service=_DummyWorkflowService(definition),
            on_stream_event=_collect,
        )

    asyncio.run(_run())

    added_events = [
        event
        for event in events
        if isinstance(event, ThreadItemAddedEvent)
        and isinstance(getattr(event, "item", None), AssistantMessageItem)
    ]
    assert added_events, "Un événement d'ajout doit être émis en mode streaming."
    added_item = added_events[0].item
    assert added_item.content[0].text == ""

    update_events = [
        event
        for event in events
        if isinstance(event, ThreadItemUpdated)
        and isinstance(event.update, AssistantMessageContentPartTextDelta)
    ]
    assert update_events, "Le mode streaming doit produire des mises à jour incrémentales."
    for update in update_events:
        assert (
            update.update.content_index == 0
        ), "Les deltas doivent cibler le premier contenu de message."
    streamed_text = "".join(update.update.delta for update in update_events)
    assert streamed_text == "Bienvenue en streaming."

    done_events = [
        event
        for event in events
        if isinstance(event, ThreadItemDoneEvent)
        and isinstance(getattr(event, "item", None), AssistantMessageItem)
    ]
    assert done_events, "Un événement final doit conclure le streaming."
    assert done_events[0].item.content[0].text == "Bienvenue en streaming."


def test_user_message_node_streams_message() -> None:
    events: list[Any] = []

    async def _collect(event):  # type: ignore[no-untyped-def]
        events.append(event)

    agent_context = SimpleNamespace(
        store=None,
        thread=SimpleNamespace(id="thread-demo"),
        request_context=None,
        generate_id=lambda prefix: f"{prefix}-1",
    )

    start_step = SimpleNamespace(
        slug="start",
        kind="start",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=0,
        id=1,
        display_name="Début",
    )
    user_step = SimpleNamespace(
        slug="message-utilisateur",
        kind="user_message",
        is_enabled=True,
        parameters={"message": "Je suis prêt."},
        agent_key=None,
        position=1,
        id=2,
        display_name="Message utilisateur",
    )
    end_step = SimpleNamespace(
        slug="end",
        kind="end",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=2,
        id=3,
        display_name="Fin",
    )

    transitions = [
        SimpleNamespace(id=1, source_step=start_step, target_step=user_step, condition=None),
        SimpleNamespace(id=2, source_step=user_step, target_step=end_step, condition=None),
    ]

    definition = SimpleNamespace(
        steps=[start_step, user_step, end_step],
        transitions=transitions,
        workflow_id=1,
        workflow=SimpleNamespace(slug="demo", display_name="Démo"),
    )

    async def _run() -> None:
        await run_workflow(
            WorkflowInput(input_as_text="Bonjour"),
            agent_context=agent_context,
            workflow_service=_DummyWorkflowService(definition),
            on_stream_event=_collect,
        )

    asyncio.run(_run())

    added_events = [
        event
        for event in events
        if isinstance(event, ThreadItemAddedEvent)
        and isinstance(event.item, UserMessageItem)
        and any("Je suis prêt" in part.text for part in event.item.content)
    ]
    done_events = [
        event
        for event in events
        if isinstance(event, ThreadItemDoneEvent)
        and isinstance(event.item, UserMessageItem)
        and any("Je suis prêt" in part.text for part in event.item.content)
    ]

    assert added_events, "Le bloc message utilisateur doit signaler l'ajout du message."
    assert done_events, "Le bloc message utilisateur doit finaliser le message injecté."
    assert events.index(done_events[0]) > events.index(added_events[0])


def test_resolve_watch_payload_prefers_structured_output() -> None:
    steps = [
        chatkit_module.WorkflowStepSummary(
            key="agent_1",
            title="Analyse",
            output="{\"status\": \"ok\"}",
        )
    ]
    context = {
        "output_parsed": {"status": "ok", "details": {"count": 3}},
        "output_text": "status: ok",
        "output": {"status": "ok"},
    }

    resolved = chatkit_module._resolve_watch_payload(context, steps)

    assert resolved == {"status": "ok", "details": {"count": 3}}


def test_resolve_watch_payload_falls_back_to_last_step_output() -> None:
    steps = [
        chatkit_module.WorkflowStepSummary(
            key="agent_1",
            title="Analyse",
            output="{\"status\": \"ok\"}",
        )
    ]

    resolved = chatkit_module._resolve_watch_payload(None, steps)

    assert resolved == "{\"status\": \"ok\"}"


def test_resolve_watch_payload_preserves_context_when_unknown() -> None:
    context = {"widget": "form", "action": {"value": "yes"}}

    resolved = chatkit_module._resolve_watch_payload(context, [])

    assert resolved is context


def _execute_widget_workflow(
    monkeypatch: pytest.MonkeyPatch,
    *,
    widget_parameters: dict[str, Any],
    runner_payload: dict[str, Any],
    widget_definition: dict[str, Any] | None = None,
    start_parameters: dict[str, Any] | None = None,
    workflow_input_text: str = "Bonjour",
    runner_callable: Callable[..., _DummyRunnerResult] | None = None,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []

    async def _fake_stream_widget(thread_metadata, widget, *, generate_id):  # type: ignore[no-untyped-def]
        events.append(widget)
        _ = generate_id("assistant_message")
        if False:
            yield None
        return

    monkeypatch.setattr(chatkit_module, "_sdk_stream_widget", _fake_stream_widget)
    monkeypatch.setattr(
        chatkit_module,
        "_load_widget_definition",
        lambda slug, *, context: widget_definition
        or {
            "type": "Card",
            "children": [
                {"type": "Text", "id": "title", "value": ""},
                {"type": "Markdown", "id": "details", "value": ""},
            ],
        },
    )
    monkeypatch.setattr(
        chatkit_module.WidgetLibraryService,
        "_validate_widget",
        staticmethod(lambda definition: definition),
    )
    runner = (
        runner_callable
        if runner_callable is not None
        else lambda *args, **kwargs: _DummyRunnerResult(dict(runner_payload))
    )
    monkeypatch.setattr(chatkit_module.Runner, "run_streamed", runner)

    async def _fake_stream_agent_response(*args, **kwargs):  # type: ignore[no-untyped-def]
        if False:
            yield None
        return

    monkeypatch.setattr(chatkit_module, "stream_agent_response", _fake_stream_agent_response)

    agent_context = SimpleNamespace(
        store=SimpleNamespace(
            generate_item_id=lambda item_type, thread, request_context: f"{item_type}_1"
        ),
        thread=SimpleNamespace(id="thread_1"),
        request_context=None,
    )

    start_step = SimpleNamespace(
        slug="start",
        kind="start",
        is_enabled=True,
        parameters=start_parameters or {},
        agent_key=None,
        position=0,
        id=1,
        display_name="Début",
    )
    agent_step = SimpleNamespace(
        slug="writer",
        kind="agent",
        is_enabled=True,
        parameters={},
        agent_key="demo_agent",
        position=1,
        id=2,
        display_name="Rédaction",
    )
    widget_step = SimpleNamespace(
        slug="show-widget",
        kind="widget",
        is_enabled=True,
        parameters=widget_parameters,
        agent_key=None,
        position=2,
        id=3,
        display_name="Widget",
    )
    end_step = SimpleNamespace(
        slug="end",
        kind="end",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=3,
        id=4,
        display_name="Fin",
    )

    transitions = [
        SimpleNamespace(id=1, source_step=start_step, target_step=agent_step, condition=None),
        SimpleNamespace(id=2, source_step=agent_step, target_step=widget_step, condition=None),
        SimpleNamespace(id=3, source_step=widget_step, target_step=end_step, condition=None),
    ]

    definition = SimpleNamespace(
        steps=[start_step, agent_step, widget_step, end_step],
        transitions=transitions,
        workflow_id=1,
        workflow=SimpleNamespace(slug="demo", display_name="Démo"),
    )

    async def _exercise() -> None:
        await run_workflow(
            WorkflowInput(input_as_text=workflow_input_text),
            agent_context=agent_context,
            workflow_service=_DummyWorkflowService(definition),
        )

    asyncio.run(_exercise())

    return events


def test_widget_node_streams_widget_with_input(monkeypatch: pytest.MonkeyPatch) -> None:
    events = _execute_widget_workflow(
        monkeypatch,
        widget_parameters={
            "widget": {
                "slug": "resume",
                "variables": {"title": "input.output_parsed.title", "details": "state.resume"},
            }
        },
        runner_payload={"title": "Synthèse", "extra": "Ignored"},
    )

    assert events, "Le widget devrait être diffusé"
    widget = events[0]
    assert isinstance(widget, dict)
    values = widget.get("children", [])
    assert any(child.get("value") == "Synthèse" for child in values if isinstance(child, dict))


def test_widget_step_records_action_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_stream_widget(thread_metadata, widget, *, generate_id):  # type: ignore[no-untyped-def]
        _ = generate_id("assistant_message")
        if False:
            yield None
        return

    monkeypatch.setattr(chatkit_module, "_sdk_stream_widget", _fake_stream_widget)
    monkeypatch.setattr(
        chatkit_module,
        "_load_widget_definition",
        lambda slug, *, context: {
            "type": "Card",
            "children": [
                {"type": "Button", "id": "action", "label": "Choisir"},
            ],
        },
    )
    monkeypatch.setattr(
        chatkit_module.WidgetLibraryService,
        "_validate_widget",
        staticmethod(lambda definition: definition),
    )

    agent_context = SimpleNamespace(
        store=SimpleNamespace(
            generate_item_id=lambda prefix, thread, request_context: f"{prefix}_1"
        ),
        thread=SimpleNamespace(id="thread-1"),
        request_context=None,
    )

    start_step = SimpleNamespace(
        slug="start",
        kind="start",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=0,
        id=1,
        display_name="Début",
    )
    widget_step = SimpleNamespace(
        slug="widget-choice",
        kind="widget",
        is_enabled=True,
        parameters={"widget": {"slug": "selection", "await_action": True}},
        agent_key=None,
        position=1,
        id=2,
        display_name="Widget",
    )
    end_step = SimpleNamespace(
        slug="end",
        kind="end",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=2,
        id=3,
        display_name="Fin",
    )

    transitions = [
        SimpleNamespace(id=1, source_step=start_step, target_step=widget_step, condition=None),
        SimpleNamespace(id=2, source_step=widget_step, target_step=end_step, condition=None),
    ]

    definition = SimpleNamespace(
        steps=[start_step, widget_step, end_step],
        transitions=transitions,
        workflow_id=1,
        workflow=SimpleNamespace(slug="demo", display_name="Démo"),
    )

    async def _run_workflow() -> "WorkflowRunSummary":
        async def _capture_action(step, config):  # type: ignore[no-untyped-def]
            return {
                "type": "menu.select",
                "widget": config.slug,
                "values": {"button": "meteo-actuelle"},
            }

        return await run_workflow(
            WorkflowInput(input_as_text="Bonjour"),
            agent_context=agent_context,
            workflow_service=_DummyWorkflowService(definition),
            on_widget_step=_capture_action,
        )

    summary = asyncio.run(_run_workflow())
    widget_summary = next(step for step in summary.steps if step.key == "widget-choice")
    payload = json.loads(widget_summary.output)

    assert payload["widget"] == "selection"
    assert payload["action"]["type"] == "menu.select"
    assert payload["action"]["values"]["button"] == "meteo-actuelle"


def test_auto_start_workflow_runs_without_user_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorded_inputs: list[Any] = []
    runner_payload = {"title": "Synthèse"}

    def _capture_runner(*args, **kwargs):  # type: ignore[no-untyped-def]
        recorded_inputs.append(kwargs.get("input"))
        return _DummyRunnerResult(dict(runner_payload))

    _execute_widget_workflow(
        monkeypatch,
        widget_parameters={"widget": {"slug": "resume"}},
        runner_payload=runner_payload,
        start_parameters={"auto_start": True},
        workflow_input_text="",
        runner_callable=_capture_runner,
    )

    assert recorded_inputs, "L'agent devrait être exécuté"
    assert recorded_inputs[0] == [], "Le workflow auto-start ne doit pas injecter de message utilisateur"


def test_auto_start_workflow_strips_zero_width_input(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorded_inputs: list[Any] = []
    runner_payload = {"title": "Synthèse"}

    def _capture_runner(*args, **kwargs):  # type: ignore[no-untyped-def]
        recorded_inputs.append(kwargs.get("input"))
        return _DummyRunnerResult(dict(runner_payload))

    _execute_widget_workflow(
        monkeypatch,
        widget_parameters={"widget": {"slug": "resume"}},
        runner_payload=runner_payload,
        start_parameters={"auto_start": True},
        workflow_input_text="\u200B",
        runner_callable=_capture_runner,
    )

    assert recorded_inputs, "L'agent devrait être exécuté"
    assert recorded_inputs[0] == [], "Les caractères invisibles doivent être ignorés lors du démarrage automatique"


def test_auto_start_workflow_injects_configured_user_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorded_inputs: list[Any] = []
    runner_payload = {"title": "Synthèse"}

    def _capture_runner(*args, **kwargs):  # type: ignore[no-untyped-def]
        recorded_inputs.append(kwargs.get("input"))
        return _DummyRunnerResult(dict(runner_payload))

    _execute_widget_workflow(
        monkeypatch,
        widget_parameters={"widget": {"slug": "resume"}},
        runner_payload=runner_payload,
        start_parameters={"auto_start": True, "auto_start_user_message": "Bonjour"},
        workflow_input_text="",
        runner_callable=_capture_runner,
    )

    assert recorded_inputs, "L'agent devrait être exécuté"
    assert recorded_inputs[0] == [
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "Bonjour",
                }
            ],
        }
    ], "Le message défini sur le bloc début doit être injecté pour l'auto-start"


def test_auto_start_workflow_ignores_assistant_message_when_user_message_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorded_inputs: list[Any] = []
    runner_payload = {"title": "Synthèse"}

    def _capture_runner(*args, **kwargs):  # type: ignore[no-untyped-def]
        recorded_inputs.append(kwargs.get("input"))
        return _DummyRunnerResult(dict(runner_payload))

    _execute_widget_workflow(
        monkeypatch,
        widget_parameters={"widget": {"slug": "resume"}},
        runner_payload=runner_payload,
        start_parameters={
            "auto_start": True,
            "auto_start_user_message": "Bonjour",
            "auto_start_assistant_message": "Bienvenue dans cet espace.",
        },
        workflow_input_text="",
        runner_callable=_capture_runner,
    )

    assert recorded_inputs, "L'agent devrait être exécuté"
    assert recorded_inputs[0] == [
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "Bonjour",
                }
            ],
        }
    ], (
        "Le workflow auto-start doit ignorer le message assistant lorsque le bloc début "
        "fournit déjà un message utilisateur."
    )


@pytest.mark.asyncio
async def test_auto_start_server_streams_only_user_message_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        allowed_origins=["*"],
        openai_api_key="sk-test",
        chatkit_workflow_id=None,
        chatkit_api_base="https://api.openai.com",
        chatkit_agent_model="gpt-5",
        chatkit_agent_instructions="Assistant",
        chatkit_realtime_model="gpt-realtime",
        chatkit_realtime_instructions="Assistant vocal",
        chatkit_realtime_voice="verse",
        database_url="sqlite://",
        auth_secret_key="secret",
        access_token_expire_minutes=60,
        admin_email=None,
        admin_password=None,
        database_connect_retries=1,
        database_connect_delay=0.1,
    )
    server = DemoChatKitServer(settings)

    class _FakeStore:
        def __init__(self) -> None:
            self.items: list[Any] = []
            self.generated = 0

        async def load_thread_items(
            self, thread_id: str, after: str | None, limit: int, order: str, context
        ) -> Page[UserMessageItem]:
            return Page(data=[], has_more=False, after=None)

        async def delete_thread_item(self, thread_id: str, item_id: str, context) -> None:
            return None

        async def add_thread_item(self, thread_id: str, item, context) -> None:  # type: ignore[no-untyped-def]
            self.items.append(item)

        def generate_item_id(self, prefix: str, thread, context) -> str:  # type: ignore[no-untyped-def]
            self.generated += 1
            return f"{prefix}-{self.generated}"

    fake_store = _FakeStore()
    server.store = fake_store  # type: ignore[assignment]

    monkeypatch.setattr(
        server,
        "_resolve_auto_start_configuration",
        lambda: AutoStartConfiguration(
            True,
            "Bonjour",
            "Bienvenue dans cet espace.",
        ),
    )

    async def _fake_execute_workflow(**kwargs):  # type: ignore[no-untyped-def]
        await kwargs["event_queue"].put(_STREAM_DONE)

    monkeypatch.setattr(server, "_execute_workflow", _fake_execute_workflow)

    thread = ThreadMetadata(
        id="thread-1",
        created_at=datetime.now(),
        status=ActiveStatus(),
        metadata={},
    )
    context = ChatKitRequestContext(user_id="user-1", email="user@example.com")

    events: list[Any] = []
    async for event in server.respond(thread, None, context):
        events.append(event)

    user_added = [
        event
        for event in events
        if isinstance(event, ThreadItemAddedEvent)
        and isinstance(event.item, UserMessageItem)
    ]
    user_done = [
        event
        for event in events
        if isinstance(event, ThreadItemDoneEvent)
        and isinstance(event.item, UserMessageItem)
    ]
    assistant_events = [
        event
        for event in events
        if isinstance(event, (ThreadItemAddedEvent, ThreadItemDoneEvent))
        and isinstance(event.item, AssistantMessageItem)
    ]

    assert user_added, "Le message utilisateur automatique doit être signalé immédiatement"
    assert user_done, "Le message utilisateur automatique doit être finalisé"
    assert events.index(user_done[0]) > events.index(user_added[0])
    assert not assistant_events, (
        "Aucun message assistant ne doit être diffusé lorsqu'un message utilisateur est configuré"
    )


@pytest.mark.asyncio
async def test_auto_start_server_streams_assistant_message_and_runs_workflow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        allowed_origins=["*"],
        openai_api_key="sk-test",
        chatkit_workflow_id=None,
        chatkit_api_base="https://api.openai.com",
        chatkit_agent_model="gpt-5",
        chatkit_agent_instructions="Assistant",
        chatkit_realtime_model="gpt-realtime",
        chatkit_realtime_instructions="Assistant vocal",
        chatkit_realtime_voice="verse",
        database_url="sqlite://",
        auth_secret_key="secret",
        access_token_expire_minutes=60,
        admin_email=None,
        admin_password=None,
        database_connect_retries=1,
        database_connect_delay=0.1,
    )
    server = DemoChatKitServer(settings)

    class _FakeStore:
        def __init__(self) -> None:
            self.items: list[Any] = []
            self.generated = 0

        async def load_thread_items(
            self, thread_id: str, after: str | None, limit: int, order: str, context
        ) -> Page[UserMessageItem]:
            return Page(data=[], has_more=False, after=None)

        async def delete_thread_item(self, thread_id: str, item_id: str, context) -> None:
            return None

        async def add_thread_item(self, thread_id: str, item, context) -> None:  # type: ignore[no-untyped-def]
            self.items.append(item)

        def generate_item_id(self, prefix: str, thread, context) -> str:  # type: ignore[no-untyped-def]
            self.generated += 1
            return f"{prefix}-{self.generated}"

    fake_store = _FakeStore()
    server.store = fake_store  # type: ignore[assignment]

    monkeypatch.setattr(
        server,
        "_resolve_auto_start_configuration",
        lambda: AutoStartConfiguration(True, "", "Bienvenue dans cet espace."),
    )

    workflow_called = False

    async def _fake_execute_workflow(**kwargs):  # type: ignore[no-untyped-def]
        nonlocal workflow_called
        workflow_called = True
        await kwargs["event_queue"].put(
            ThreadItemDoneEvent(
                item=AssistantMessageItem(
                    id="assistant-widget",
                    thread_id=thread.id,
                    created_at=datetime.now(),
                    content=[
                        AssistantMessageContent(text="Widget auto-start"),
                    ],
                )
            )
        )
        await kwargs["event_queue"].put(_STREAM_DONE)

    monkeypatch.setattr(server, "_execute_workflow", _fake_execute_workflow)

    thread = ThreadMetadata(
        id="thread-1",
        created_at=datetime.now(),
        status=ActiveStatus(),
        metadata={},
    )
    context = ChatKitRequestContext(user_id="user-1", email="user@example.com")

    events: list[Any] = []
    async for event in server.respond(thread, None, context):
        events.append(event)

    user_events = [
        event
        for event in events
        if isinstance(event, ThreadItemDoneEvent)
        and isinstance(event.item, UserMessageItem)
    ]
    assistant_events = [
        event
        for event in events
        if isinstance(event, ThreadItemDoneEvent)
        and isinstance(event.item, AssistantMessageItem)
    ]

    assert not user_events, "Aucun message utilisateur ne doit être injecté"
    assert assistant_events, "Le message assistant doit être diffusé"
    assert assistant_events[0].item.content[0].text == "Bienvenue dans cet espace."
    assert any(
        event.item.id == "assistant-widget" for event in assistant_events
    ), "Le workflow doit diffuser les événements supplémentaires (widget, etc.)"
    assert workflow_called, "Le workflow doit être exécuté pour diffuser les étapes suivantes"


@pytest.mark.asyncio
async def test_auto_start_messages_are_persisted_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        allowed_origins=["*"],
        openai_api_key="sk-test",
        chatkit_workflow_id=None,
        chatkit_api_base="https://api.openai.com",
        chatkit_agent_model="gpt-5",
        chatkit_agent_instructions="Assistant",
        chatkit_realtime_model="gpt-realtime",
        chatkit_realtime_instructions="Assistant vocal",
        chatkit_realtime_voice="verse",
        database_url="sqlite://",
        auth_secret_key="secret",
        access_token_expire_minutes=60,
        admin_email=None,
        admin_password=None,
        database_connect_retries=1,
        database_connect_delay=0.1,
    )
    server = DemoChatKitServer(settings)

    class _FakeStore:
        def __init__(self) -> None:
            self.items: dict[str, Any] = {}
            self.generated = 0

        async def load_thread_items(
            self, thread_id: str, after: str | None, limit: int, order: str, context
        ) -> Page[UserMessageItem]:
            return Page(data=[], has_more=False, after=None)

        async def delete_thread_item(self, thread_id: str, item_id: str, context) -> None:
            return None

        async def add_thread_item(self, thread_id: str, item, context) -> None:  # type: ignore[no-untyped-def]
            if item.id in self.items:
                raise AssertionError("L'item ne devrait être inséré qu'une seule fois")
            self.items[item.id] = item

        async def save_thread(self, thread, context) -> None:  # type: ignore[no-untyped-def]
            return None

        async def save_item(self, thread_id: str, item, context) -> None:  # type: ignore[no-untyped-def]
            self.items[item.id] = item

        def generate_item_id(self, prefix: str, thread, context) -> str:  # type: ignore[no-untyped-def]
            self.generated += 1
            return f"{prefix}-{self.generated}"

    fake_store = _FakeStore()
    server.store = fake_store  # type: ignore[assignment]

    monkeypatch.setattr(
        server,
        "_resolve_auto_start_configuration",
        lambda: AutoStartConfiguration(
            True,
            "Bonjour",
            "Bienvenue dans cet espace.",
        ),
    )

    async def _fake_execute_workflow(**kwargs):  # type: ignore[no-untyped-def]
        await kwargs["event_queue"].put(_STREAM_DONE)

    monkeypatch.setattr(server, "_execute_workflow", _fake_execute_workflow)

    thread = ThreadMetadata(
        id="thread-1",
        created_at=datetime.now(),
        status=ActiveStatus(),
        metadata={},
    )
    context = ChatKitRequestContext(user_id="user-1", email="user@example.com")

    async def _stream():
        async for event in server.respond(thread, None, context):
            yield event

    events: list[Any] = []
    async for event in server._process_events(thread, context, _stream):
        events.append(event)

    assert len(fake_store.items) == 1, "Un seul message auto-start doit être persisté"
    user_ids = {
        event.item.id
        for event in events
        if isinstance(event, ThreadItemDoneEvent)
        and isinstance(event.item, (UserMessageItem, AssistantMessageItem))
    }
    assert len(user_ids) == 1, "Chaque message auto-start doit posséder un identifiant unique"


@pytest.mark.asyncio
async def test_auto_start_assistant_message_is_persisted_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        allowed_origins=["*"],
        openai_api_key="sk-test",
        chatkit_workflow_id=None,
        chatkit_api_base="https://api.openai.com",
        chatkit_agent_model="gpt-5",
        chatkit_agent_instructions="Assistant",
        chatkit_realtime_model="gpt-realtime",
        chatkit_realtime_instructions="Assistant vocal",
        chatkit_realtime_voice="verse",
        database_url="sqlite://",
        auth_secret_key="secret",
        access_token_expire_minutes=60,
        admin_email=None,
        admin_password=None,
        database_connect_retries=1,
        database_connect_delay=0.1,
    )
    server = DemoChatKitServer(settings)

    class _FakeStore:
        def __init__(self) -> None:
            self.items: dict[str, Any] = {}
            self.generated = 0

        async def load_thread_items(
            self, thread_id: str, after: str | None, limit: int, order: str, context
        ) -> Page[UserMessageItem]:
            return Page(data=[], has_more=False, after=None)

        async def delete_thread_item(self, thread_id: str, item_id: str, context) -> None:
            return None

        async def add_thread_item(self, thread_id: str, item, context) -> None:  # type: ignore[no-untyped-def]
            if item.id in self.items:
                raise AssertionError("L'item ne devrait être inséré qu'une seule fois")
            self.items[item.id] = item

        async def save_thread(self, thread, context) -> None:  # type: ignore[no-untyped-def]
            return None

        async def save_item(self, thread_id: str, item, context) -> None:  # type: ignore[no-untyped-def]
            self.items[item.id] = item

        def generate_item_id(self, prefix: str, thread, context) -> str:  # type: ignore[no-untyped-def]
            self.generated += 1
            return f"{prefix}-{self.generated}"

    fake_store = _FakeStore()
    server.store = fake_store  # type: ignore[assignment]

    monkeypatch.setattr(
        server,
        "_resolve_auto_start_configuration",
        lambda: AutoStartConfiguration(True, "", "Bienvenue dans cet espace."),
    )

    async def _fake_execute_workflow(**kwargs):  # type: ignore[no-untyped-def]
        await kwargs["event_queue"].put(_STREAM_DONE)

    monkeypatch.setattr(server, "_execute_workflow", _fake_execute_workflow)

    thread = ThreadMetadata(
        id="thread-1",
        created_at=datetime.now(),
        status=ActiveStatus(),
        metadata={},
    )
    context = ChatKitRequestContext(user_id="user-1", email="user@example.com")

    async def _stream():
        async for event in server.respond(thread, None, context):
            yield event

    events: list[Any] = []
    async for event in server._process_events(thread, context, _stream):
        events.append(event)

    assert len(fake_store.items) == 1, "Le message assistant auto-start doit être persisté une seule fois"
    assistant_ids = {
        event.item.id
        for event in events
        if isinstance(event, ThreadItemDoneEvent)
        and isinstance(event.item, AssistantMessageItem)
    }
    assert len(assistant_ids) == 1, "Le message assistant auto-start doit posséder un identifiant unique"
