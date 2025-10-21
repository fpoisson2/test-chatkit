import asyncio
from datetime import datetime
from types import SimpleNamespace
from typing import Any, Mapping

import pytest

import backend.app.chatkit as chatkit_module
from backend.app.config import Settings
from backend.app.chatkit_server import server as chatkit_server_module
from chatkit.actions import Action
from chatkit.types import (
    ActiveStatus,
    ClosedStatus,
    ErrorEvent,
    ProgressUpdateEvent,
    ThreadItem,
    ThreadItemDoneEvent,
    ThreadItemUpdated,
    ThreadMetadata,
    ThreadStreamEvent,
    WidgetItem,
)


def _build_settings() -> Settings:
    return Settings(
        allowed_origins=["*"],
        openai_api_key="sk-test",
        chatkit_workflow_id=None,
        chatkit_api_base="https://api.openai.com",
        chatkit_agent_model="gpt-5",
        chatkit_agent_instructions="Assistant",
        chatkit_realtime_model="gpt-realtime",
        chatkit_realtime_instructions="Assistant vocal",
        chatkit_realtime_voice="verse",
        backend_public_base_url="http://localhost:8000",
        backend_public_base_url_from_env=False,
        database_url="sqlite://",
        auth_secret_key="secret",
        access_token_expire_minutes=60,
        admin_email=None,
        admin_password=None,
        database_connect_retries=1,
        database_connect_delay=0.1,
        agent_image_token_ttl_seconds=3600,
    )


def test_respond_returns_error_when_thread_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FailingStore:
        async def load_thread_items(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            raise chatkit_module.NotFoundError("missing")

        def generate_item_id(self, prefix, thread, context):  # type: ignore[no-untyped-def]
            return f"{prefix}-id"

    monkeypatch.setattr(
        chatkit_server_module,
        "PostgresChatKitStore",
        lambda *args, **kwargs: _FailingStore(),
    )
    server = chatkit_module.DemoChatKitServer(_build_settings())

    thread = ThreadMetadata(
        id="thread-1",
        created_at=datetime.now(),
        status=ActiveStatus(),
        metadata={},
    )
    context = chatkit_module.ChatKitRequestContext(
        user_id="user-1", email="user@example.com"
    )

    async def _collect() -> list[ThreadStreamEvent]:
        return [event async for event in server.respond(thread, None, context)]

    events = asyncio.run(_collect())

    assert events and isinstance(events[0], ErrorEvent)
    assert "Thread introuvable" in events[0].message


def test_execute_workflow_updates_thread_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Store:
        def __init__(self) -> None:
            self.saved: list[ThreadItem] = []
            self.added: list[ThreadItem] = []

        async def load_thread_items(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            return SimpleNamespace(data=[])

        def generate_item_id(self, prefix, thread, context):  # type: ignore[no-untyped-def]
            return f"{prefix}-generated"

        async def save_item(self, *args, **kwargs) -> None:  # type: ignore[no-untyped-def]
            self.saved.append(args[1])

        async def add_thread_item(self, *args, **kwargs) -> None:  # type: ignore[no-untyped-def]
            self.added.append(args[1])

    store = _Store()
    monkeypatch.setattr(
        chatkit_server_module, "PostgresChatKitStore", lambda *args, **kwargs: store
    )
    server = chatkit_module.DemoChatKitServer(_build_settings())
    server.store = store  # type: ignore[assignment]

    async def fake_run_workflow(
        workflow_input, *, on_stream_event, **kwargs
    ) -> SimpleNamespace:
        await on_stream_event(ProgressUpdateEvent(text="En cours"))
        end_state = SimpleNamespace(
            slug="fin",
            status_type="closed",
            status_reason="Terminé",
            message=None,
        )
        return SimpleNamespace(
            end_state=end_state,
            final_node_slug="fin",
            steps=[],
            final_output={},
        )

    server._run_workflow = fake_run_workflow  # type: ignore[assignment]

    thread = ThreadMetadata(
        id="thread-2",
        created_at=datetime.now(),
        status=ActiveStatus(),
        metadata={},
    )
    context = chatkit_module.ChatKitRequestContext(
        user_id="user-2", email="demo@example.com"
    )
    agent_context = SimpleNamespace(request_context=context, thread=thread)

    event_queue: asyncio.Queue[ThreadStreamEvent] = asyncio.Queue()

    async def _run_execute() -> None:
        await server._execute_workflow(
        thread=thread,
        agent_context=agent_context,
        workflow_input=chatkit_module.WorkflowInput(input_as_text="Bonjour"),
        event_queue=event_queue,
        thread_items_history=None,
    )

    asyncio.run(_run_execute())

    async def _drain(queue: asyncio.Queue[ThreadStreamEvent]) -> list[ThreadStreamEvent]:
        collected: list[ThreadStreamEvent] = []
        while not queue.empty():
            collected.append(await queue.get())
        return collected

    events = asyncio.run(_drain(event_queue))

    assert isinstance(thread.status, ClosedStatus)
    assert any(isinstance(event, ProgressUpdateEvent) for event in events[:-1])
    assert events[-1] is chatkit_module._STREAM_DONE


def test_action_signals_widget_waiter(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Store:
        def __init__(self) -> None:
            self.saved: list[ThreadItem] = []

        async def save_item(self, *args, **kwargs) -> None:  # type: ignore[no-untyped-def]
            self.saved.append(args[1])

        async def add_thread_item(self, *args, **kwargs) -> None:  # type: ignore[no-untyped-def]
            self.saved.append(args[1])

        def generate_item_id(self, prefix, thread, context) -> str:  # type: ignore[no-untyped-def]
            return f"{prefix}-1"

    store = _Store()
    monkeypatch.setattr(
        chatkit_server_module, "PostgresChatKitStore", lambda *args, **kwargs: store
    )
    server = chatkit_module.DemoChatKitServer(_build_settings())
    server.store = store  # type: ignore[assignment]

    signaled: dict[str, Any] = {}

    async def fake_signal(
        thread_id: str,
        *,
        widget_item_id: str | None,
        widget_slug: str | None,
        payload: Mapping[str, Any] | None = None,
    ) -> bool:
        signaled.update(
            {
                "thread_id": thread_id,
                "widget_item_id": widget_item_id,
                "widget_slug": widget_slug,
                "payload": payload,
            }
        )
        return True

    monkeypatch.setattr(server._widget_waiters, "signal", fake_signal)

    base_definition = {
        "type": "Card",
        "children": [
            {"type": "Text", "id": "title", "value": ""},
        ],
    }

    monkeypatch.setattr(
        chatkit_module,
        "_load_widget_definition",
        lambda slug, *, context: base_definition if slug == "resume" else None,
    )

    initial_widget = chatkit_module.WidgetLibraryService._validate_widget(base_definition)
    thread = ThreadMetadata(
        id="thread-3",
        created_at=datetime.now(),
        status=ActiveStatus(),
        metadata={},
    )
    sender = WidgetItem(
        id="widget-1",
        thread_id=thread.id,
        created_at=datetime.now(),
        widget=initial_widget,
    )

    action = Action(
        type="demo.show_widget",
        payload={
            "widget": {
                "slug": "resume",
                "variables": {"title": "Nouveau titre"},
            }
        },
    )
    context = chatkit_module.ChatKitRequestContext(user_id="user", email=None)

    async def _collect_events() -> list[ThreadStreamEvent]:
        return [event async for event in server.action(thread, action, sender, context)]

    events = asyncio.run(_collect_events())

    assert signaled["thread_id"] == thread.id
    assert signaled["widget_slug"] == "resume"
    assert isinstance(events[0], (ThreadItemUpdated, ThreadItemDoneEvent))
