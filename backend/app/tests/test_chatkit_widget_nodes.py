import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

import pytest

sys.path.append(str(Path(__file__).resolve().parents[3]))
sys.path.append(str(Path(__file__).resolve().parents[2]))
sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.chatkit import WorkflowInput, WorkflowRunSummary, run_workflow
from app.workflows.service import WorkflowService

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
    saved_threads: list[dict[str, Any]] = []

    async def _fake_stream_widget(thread_metadata, widget, *, generate_id):  # type: ignore[no-untyped-def]
        events.append(widget)
        _ = generate_id("assistant_message")
        if False:
            yield None
        return

    async def _save_thread(thread, context=None):  # type: ignore[no-untyped-def]
        metadata = getattr(thread, "metadata", None)
        if isinstance(metadata, dict):
            saved_threads.append(dict(metadata))
        else:
            saved_threads.append({})

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
            generate_item_id=lambda item_type, thread, request_context: f"{item_type}_1",
            save_thread=_save_thread,
        ),
        thread=SimpleNamespace(id="thread_1", metadata={}),
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

    return events, agent_context.thread, saved_threads


def test_widget_node_streams_widget_with_input(monkeypatch: pytest.MonkeyPatch) -> None:
    events, _thread, _saved = _execute_widget_workflow(
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


def test_widget_node_registers_thread_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    _events, thread, saved_threads = _execute_widget_workflow(
        monkeypatch,
        widget_parameters={"widget": {"slug": "resume"}},
        runner_payload={"title": "Synthèse"},
    )

    workflow_state = thread.metadata.get("workflow_state") if isinstance(thread.metadata, dict) else None
    assert workflow_state is not None, "Les métadonnées du fil devraient contenir l'état du workflow"
    widgets = workflow_state.get("widgets") if isinstance(workflow_state, dict) else None
    assert widgets, "La cartographie des widgets devrait être renseignée"
    assert any(
        isinstance(details, dict) and details.get("step") == "show-widget"
        for details in widgets.values()
        if isinstance(details, (dict, str))
    ), "Le widget diffusé doit être associé à l'étape correspondante"
    assert saved_threads, "Le fil doit être persisté après l'enregistrement du widget"


def test_auto_start_workflow_runs_without_user_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorded_inputs: list[Any] = []
    runner_payload = {"title": "Synthèse"}

    def _capture_runner(*args, **kwargs):  # type: ignore[no-untyped-def]
        recorded_inputs.append(kwargs.get("input"))
        return _DummyRunnerResult(dict(runner_payload))

    _events, _thread, _saved = _execute_widget_workflow(
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

    _events, _thread, _saved = _execute_widget_workflow(
        monkeypatch,
        widget_parameters={"widget": {"slug": "resume"}},
        runner_payload=runner_payload,
        start_parameters={"auto_start": True},
        workflow_input_text="\u200B",
        runner_callable=_capture_runner,
    )

    assert recorded_inputs, "L'agent devrait être exécuté"
    assert recorded_inputs[0] == [], "Les caractères invisibles doivent être ignorés lors du démarrage automatique"


def test_condition_branch_uses_thread_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_stream_agent_response(*args, **kwargs):  # type: ignore[no-untyped-def]
        if False:
            yield None
        return

    monkeypatch.setattr(chatkit_module, "stream_agent_response", _fake_stream_agent_response)
    monkeypatch.setattr(
        chatkit_module.Runner,
        "run_streamed",
        lambda *args, **kwargs: _DummyRunnerResult({"output": "ok"}),
    )

    saved_threads: list[dict[str, Any]] = []

    async def _save_thread(thread, context=None):  # type: ignore[no-untyped-def]
        metadata = getattr(thread, "metadata", None)
        if isinstance(metadata, dict):
            saved_threads.append(dict(metadata))

    agent_context = SimpleNamespace(
        store=SimpleNamespace(
            generate_item_id=lambda item_type, thread, request_context: f"{item_type}_1",
            save_thread=_save_thread,
        ),
        thread=SimpleNamespace(
            id="thread_condition",
            metadata={"workflow_state": {"conditions": {"decision": "false"}}},
        ),
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
    condition_step = SimpleNamespace(
        slug="decision",
        kind="condition",
        is_enabled=True,
        parameters={},
        agent_key=None,
        position=1,
        id=2,
        display_name="Décision",
    )
    true_agent_step = SimpleNamespace(
        slug="analyse",
        kind="agent",
        is_enabled=True,
        parameters={},
        agent_key="triage",
        position=2,
        id=3,
        display_name="Analyse",
    )
    false_agent_step = SimpleNamespace(
        slug="demande-utilisateur",
        kind="agent",
        is_enabled=True,
        parameters={},
        agent_key="get_data_from_user",
        position=3,
        id=4,
        display_name="Demande utilisateur",
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
        SimpleNamespace(id=1, source_step=start_step, target_step=condition_step, condition=None),
        SimpleNamespace(id=2, source_step=condition_step, target_step=true_agent_step, condition="true"),
        SimpleNamespace(id=3, source_step=condition_step, target_step=false_agent_step, condition="false"),
        SimpleNamespace(id=4, source_step=true_agent_step, target_step=end_step, condition=None),
        SimpleNamespace(id=5, source_step=false_agent_step, target_step=end_step, condition=None),
    ]

    definition = SimpleNamespace(
        steps=[start_step, condition_step, true_agent_step, false_agent_step, end_step],
        transitions=transitions,
        workflow_id=1,
        workflow=SimpleNamespace(slug="demo", display_name="Démo"),
    )

    summary: WorkflowRunSummary | None = None

    async def _run() -> None:
        nonlocal summary
        summary = await run_workflow(
            WorkflowInput(input_as_text=""),
            agent_context=agent_context,
            workflow_service=_DummyWorkflowService(definition),
        )

    asyncio.run(_run())

    assert summary is not None
    titles = [step.title for step in summary.steps]
    assert "Demande d'informations supplémentaires" in titles
    assert "Analyse des informations fournies" not in titles

    workflow_state = agent_context.thread.metadata.get("workflow_state")
    assert isinstance(workflow_state, dict)
    conditions = workflow_state.get("conditions") if isinstance(workflow_state, dict) else None
    assert not conditions or "decision" not in conditions
    assert saved_threads, "La sélection de branche doit être persistée"

