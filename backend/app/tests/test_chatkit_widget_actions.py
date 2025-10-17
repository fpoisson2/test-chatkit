from __future__ import annotations

import json
from datetime import datetime

import pytest

from backend.app.chatkit import (
    ChatKitRequestContext,
    DemoChatKitServer,
)
from backend.app.config import Settings
from chatkit.actions import Action
from chatkit.types import ActiveStatus, ThreadItemUpdated, ThreadMetadata, WidgetItem


@pytest.mark.asyncio
async def test_action_updates_existing_widget(monkeypatch: pytest.MonkeyPatch) -> None:
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

    class _Store:
        def __init__(self) -> None:
            self.saved: list[WidgetItem] = []
            self.added: list[WidgetItem] = []

        async def save_item(self, thread_id: str, item: WidgetItem, context) -> None:  # type: ignore[override]
            self.saved.append(item)

        async def add_thread_item(self, thread_id: str, item: WidgetItem, context) -> None:  # type: ignore[override]
            self.added.append(item)

        def generate_item_id(self, prefix: str, thread, context) -> str:  # type: ignore[no-untyped-def]
            return f"{prefix}-1"

    store = _Store()
    server.store = store  # type: ignore[assignment]

    import backend.app.chatkit as chatkit_module

    base_definition = {
        "type": "Card",
        "children": [
            {"type": "Text", "id": "title", "value": ""},
            {"type": "Text", "id": "details", "value": ""},
        ],
    }

    monkeypatch.setattr(
        chatkit_module,
        "_load_widget_definition",
        lambda slug, *, context: json.loads(json.dumps(base_definition)) if slug == "resume" else None,
    )

    initial_widget = chatkit_module.WidgetLibraryService._validate_widget(
        {
            "type": "Card",
            "children": [
                {"type": "Text", "id": "title", "value": "Ancien titre"},
                {"type": "Text", "id": "details", "value": "Anciennes informations"},
            ],
        }
    )

    thread = ThreadMetadata(
        id="thread-1",
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
                "copyText": "Copier ce résumé",
            }
        },
    )

    context = ChatKitRequestContext(user_id="user-1", email="user@example.com")

    events = [
        event async for event in server.action(thread, action, sender, context)
    ]

    assert len(events) == 1
    assert isinstance(events[0], ThreadItemUpdated)
    updated_widget = events[0].update.widget
    assert updated_widget.children[0].value == "Nouveau titre"
    assert store.saved and not store.added
    saved_item = store.saved[0]
    assert saved_item.copy_text == "Copier ce résumé"
    assert saved_item.widget.children[0].value == "Nouveau titre"


@pytest.mark.asyncio
async def test_action_falls_back_to_sender_widget(monkeypatch: pytest.MonkeyPatch) -> None:
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

    class _Store:
        def __init__(self) -> None:
            self.saved: list[WidgetItem] = []
            self.added: list[WidgetItem] = []

        async def save_item(self, thread_id: str, item: WidgetItem, context) -> None:  # type: ignore[override]
            self.saved.append(item)

        async def add_thread_item(self, thread_id: str, item: WidgetItem, context) -> None:  # type: ignore[override]
            self.added.append(item)

        def generate_item_id(self, prefix: str, thread, context) -> str:  # type: ignore[no-untyped-def]
            return f"{prefix}-1"

    store = _Store()
    server.store = store  # type: ignore[assignment]

    import backend.app.chatkit as chatkit_module

    base_definition = {
        "type": "Card",
        "children": [
            {"type": "Text", "id": "title", "value": ""},
            {"type": "Text", "id": "details", "value": ""},
        ],
    }

    monkeypatch.setattr(
        chatkit_module,
        "_load_widget_definition",
        lambda slug, *, context: json.loads(json.dumps(base_definition)) if slug == "resume" else None,
    )

    initial_widget = chatkit_module.WidgetLibraryService._validate_widget(
        {
            "type": "Card",
            "children": [
                {"type": "Text", "id": "title", "value": "Ancien titre"},
                {"type": "Text", "id": "details", "value": "Anciennes informations"},
            ],
        }
    )

    thread = ThreadMetadata(
        id="thread-1",
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
        type="menu.select",
        payload={"variables": {"title": "Choix utilisateur"}},
    )

    context = ChatKitRequestContext(user_id="user-1", email="user@example.com")

    events = [
        event async for event in server.action(thread, action, sender, context)
    ]

    assert len(events) == 1
    assert isinstance(events[0], ThreadItemUpdated)
    updated_widget = events[0].update.widget
    assert updated_widget.children[0].value == "Choix utilisateur"
    assert store.saved and not store.added

