import asyncio
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
from backend.app.workflows.service import WorkflowService
from chatkit.types import (
    ActiveStatus,
    AssistantMessageContent,
    AssistantMessageItem,
    Page,
    ThreadItemDoneEvent,
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

    assert user_events, "Le message utilisateur automatique doit être diffusé"
    assert not assistant_events, "Aucun message assistant ne doit être diffusé lorsqu'un message utilisateur est configuré"


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
