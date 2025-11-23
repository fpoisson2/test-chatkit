"""Tests pour vérifier que les conversations fermées bloquent les nouveaux messages."""

import asyncio
import os
import sys
from datetime import datetime
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest


def test_closed_thread_blocks_new_messages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Vérifie qu'un thread avec statut ClosedStatus rejette les nouveaux messages."""

    async def _run() -> None:
        root_dir = Path(__file__).resolve().parents[3]
        if str(root_dir) not in sys.path:
            sys.path.insert(0, str(root_dir))

        chatkit_root = root_dir / "chatkit-python"
        if str(chatkit_root) not in sys.path:
            sys.path.insert(0, str(chatkit_root))

        os.environ.setdefault("DATABASE_URL", "sqlite:///./chatkit-tests.db")
        os.environ.setdefault("OPENAI_API_KEY", "sk-test")
        os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")

        server_module = import_module("backend.app.chatkit_server.server")
        context_module = import_module("backend.app.chatkit_server.context")

        from chatkit.store import NotFoundError
        from chatkit.types import (
            ClosedStatus,
            ErrorCode,
            ErrorEvent,
            InferenceOptions,
            Page,
            ThreadItem,
            ThreadMetadata,
            UserMessageItem,
            UserMessageTextContent,
        )

        ChatKitRequestContext = context_module.ChatKitRequestContext

        class _MemoryStore:
            def __init__(
                self,
                _session_factory: Any | None = None,
                workflow_service: Any | None = None,
            ) -> None:
                self._workflow_service = workflow_service
                self._threads: dict[str, ThreadMetadata] = {}
                self._items: dict[str, list[ThreadItem]] = {}
                self._attachments: dict[str, Any] = {}
                self._counters: dict[str, int] = {}

            def generate_thread_id(self, context: Any) -> str:
                del context
                return f"thread-{len(self._threads) + 1}"

            def generate_item_id(
                self,
                item_type: str,
                thread: ThreadMetadata,
                context: Any,
            ) -> str:
                del context
                counter = self._counters.get(thread.id, 0) + 1
                self._counters[thread.id] = counter
                return f"{item_type}-{counter}"

            async def save_thread(
                self, thread: ThreadMetadata, context: Any
            ) -> None:
                del context
                self._threads[thread.id] = thread.model_copy(deep=True)

            async def load_thread(
                self, thread_id: str, context: Any
            ) -> ThreadMetadata:
                del context
                try:
                    stored = self._threads[thread_id]
                except KeyError as exc:
                    raise NotFoundError(f"Thread {thread_id} introuvable") from exc
                return stored.model_copy(deep=True)

            async def load_thread_items(
                self,
                thread_id: str,
                after: str | None,
                limit: int,
                order: str,
                context: Any,
            ) -> Page[ThreadItem]:
                del after
                del limit
                del order
                del context
                items = [
                    item.model_copy(deep=True)
                    for item in self._items.get(thread_id, [])
                ]
                return Page(has_more=False, after=None, data=items)

            async def add_thread_item(
                self, thread_id: str, item: ThreadItem, context: Any
            ) -> None:
                del context
                self._items.setdefault(thread_id, []).append(item.model_copy(deep=True))

            async def delete_thread_item(
                self, thread_id: str, item_id: str, context: Any
            ) -> None:
                del context
                items = self._items.get(thread_id, [])
                self._items[thread_id] = [
                    item for item in items if getattr(item, "id", None) != item_id
                ]

            async def save_item(
                self, thread_id: str, item: ThreadItem, context: Any
            ) -> None:
                del context
                items = self._items.setdefault(thread_id, [])
                for index, existing in enumerate(items):
                    if getattr(existing, "id", None) == getattr(item, "id", None):
                        items[index] = item.model_copy(deep=True)
                        break
                else:
                    items.append(item.model_copy(deep=True))

            async def save_attachment(self, attachment: Any, context: Any) -> None:
                del context
                self._attachments[attachment.id] = attachment

            async def load_attachment(self, attachment_id: str, context: Any) -> Any:
                del context
                try:
                    return self._attachments[attachment_id]
                except KeyError as exc:  # pragma: no cover - usage inattendue
                    raise NotFoundError(
                        f"Attachment {attachment_id} introuvable"
                    ) from exc

            async def delete_attachment(
                self, attachment_id: str, context: Any
            ) -> None:
                del context
                self._attachments.pop(attachment_id, None)

        class _StubWorkflowService:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

            def get_current(self, *args: Any, **kwargs: Any) -> Any:
                workflow = SimpleNamespace(id=99, slug="test-workflow")
                return SimpleNamespace(id=42, workflow=workflow, steps=[])

        monkeypatch.setattr(server_module, "PostgresChatKitStore", _MemoryStore)
        monkeypatch.setattr(server_module, "WorkflowService", _StubWorkflowService)
        monkeypatch.setattr(
            server_module, "_get_thread_title_agent", lambda: SimpleNamespace()
        )

        settings = SimpleNamespace(
            backend_public_base_url="https://public.example",
            workflow_defaults=SimpleNamespace(default_end_message="Fin du workflow"),
        )

        server = server_module.DemoChatKitServer(settings)
        store: _MemoryStore = server.store  # type: ignore[assignment]

        context = ChatKitRequestContext(
            user_id="user-123",
            email="demo@example.com",
            authorization=None,
            public_base_url="https://public.example",
        )

        # Créer un thread avec un statut ClosedStatus
        thread = ThreadMetadata(
            id="thread-1",
            created_at=datetime.now(),
            status=ClosedStatus(reason="Conversation terminée"),
        )
        await store.save_thread(thread, context)

        # Créer un message utilisateur
        user_message = UserMessageItem(
            id="user-1",
            thread_id=thread.id,
            created_at=datetime.now(),
            content=[UserMessageTextContent(text="Nouveau message après fermeture")],
            attachments=[],
            inference_options=InferenceOptions(),
        )

        # Tenter d'envoyer le message et vérifier qu'il est rejeté
        events: list[Any] = []
        async for event in server.respond(thread, user_message, context):
            events.append(event)

        # Vérifier qu'on a reçu un ErrorEvent
        assert len(events) == 1, f"Expected 1 event, got {len(events)}"
        assert isinstance(events[0], ErrorEvent), f"Expected ErrorEvent, got {type(events[0])}"
        assert events[0].code == ErrorCode.STREAM_ERROR
        assert events[0].allow_retry is False
        assert "closed" in events[0].message.lower()

    asyncio.run(_run())


def test_locked_thread_blocks_new_messages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Vérifie qu'un thread avec statut LockedStatus rejette les nouveaux messages."""

    async def _run() -> None:
        root_dir = Path(__file__).resolve().parents[3]
        if str(root_dir) not in sys.path:
            sys.path.insert(0, str(root_dir))

        chatkit_root = root_dir / "chatkit-python"
        if str(chatkit_root) not in sys.path:
            sys.path.insert(0, str(chatkit_root))

        os.environ.setdefault("DATABASE_URL", "sqlite:///./chatkit-tests.db")
        os.environ.setdefault("OPENAI_API_KEY", "sk-test")
        os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")

        server_module = import_module("backend.app.chatkit_server.server")
        context_module = import_module("backend.app.chatkit_server.context")

        from chatkit.store import NotFoundError
        from chatkit.types import (
            ErrorCode,
            ErrorEvent,
            InferenceOptions,
            LockedStatus,
            Page,
            ThreadItem,
            ThreadMetadata,
            UserMessageItem,
            UserMessageTextContent,
        )

        ChatKitRequestContext = context_module.ChatKitRequestContext

        class _MemoryStore:
            def __init__(
                self,
                _session_factory: Any | None = None,
                workflow_service: Any | None = None,
            ) -> None:
                self._workflow_service = workflow_service
                self._threads: dict[str, ThreadMetadata] = {}
                self._items: dict[str, list[ThreadItem]] = {}
                self._attachments: dict[str, Any] = {}
                self._counters: dict[str, int] = {}

            def generate_thread_id(self, context: Any) -> str:
                del context
                return f"thread-{len(self._threads) + 1}"

            def generate_item_id(
                self,
                item_type: str,
                thread: ThreadMetadata,
                context: Any,
            ) -> str:
                del context
                counter = self._counters.get(thread.id, 0) + 1
                self._counters[thread.id] = counter
                return f"{item_type}-{counter}"

            async def save_thread(
                self, thread: ThreadMetadata, context: Any
            ) -> None:
                del context
                self._threads[thread.id] = thread.model_copy(deep=True)

            async def load_thread(
                self, thread_id: str, context: Any
            ) -> ThreadMetadata:
                del context
                try:
                    stored = self._threads[thread_id]
                except KeyError as exc:
                    raise NotFoundError(f"Thread {thread_id} introuvable") from exc
                return stored.model_copy(deep=True)

            async def load_thread_items(
                self,
                thread_id: str,
                after: str | None,
                limit: int,
                order: str,
                context: Any,
            ) -> Page[ThreadItem]:
                del after
                del limit
                del order
                del context
                items = [
                    item.model_copy(deep=True)
                    for item in self._items.get(thread_id, [])
                ]
                return Page(has_more=False, after=None, data=items)

            async def add_thread_item(
                self, thread_id: str, item: ThreadItem, context: Any
            ) -> None:
                del context
                self._items.setdefault(thread_id, []).append(item.model_copy(deep=True))

            async def delete_thread_item(
                self, thread_id: str, item_id: str, context: Any
            ) -> None:
                del context
                items = self._items.get(thread_id, [])
                self._items[thread_id] = [
                    item for item in items if getattr(item, "id", None) != item_id
                ]

            async def save_item(
                self, thread_id: str, item: ThreadItem, context: Any
            ) -> None:
                del context
                items = self._items.setdefault(thread_id, [])
                for index, existing in enumerate(items):
                    if getattr(existing, "id", None) == getattr(item, "id", None):
                        items[index] = item.model_copy(deep=True)
                        break
                else:
                    items.append(item.model_copy(deep=True))

            async def save_attachment(self, attachment: Any, context: Any) -> None:
                del context
                self._attachments[attachment.id] = attachment

            async def load_attachment(self, attachment_id: str, context: Any) -> Any:
                del context
                try:
                    return self._attachments[attachment_id]
                except KeyError as exc:  # pragma: no cover - usage inattendue
                    raise NotFoundError(
                        f"Attachment {attachment_id} introuvable"
                    ) from exc

            async def delete_attachment(
                self, attachment_id: str, context: Any
            ) -> None:
                del context
                self._attachments.pop(attachment_id, None)

        class _StubWorkflowService:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

            def get_current(self, *args: Any, **kwargs: Any) -> Any:
                workflow = SimpleNamespace(id=99, slug="test-workflow")
                return SimpleNamespace(id=42, workflow=workflow, steps=[])

        monkeypatch.setattr(server_module, "PostgresChatKitStore", _MemoryStore)
        monkeypatch.setattr(server_module, "WorkflowService", _StubWorkflowService)
        monkeypatch.setattr(
            server_module, "_get_thread_title_agent", lambda: SimpleNamespace()
        )

        settings = SimpleNamespace(
            backend_public_base_url="https://public.example",
            workflow_defaults=SimpleNamespace(default_end_message="Fin du workflow"),
        )

        server = server_module.DemoChatKitServer(settings)
        store: _MemoryStore = server.store  # type: ignore[assignment]

        context = ChatKitRequestContext(
            user_id="user-123",
            email="demo@example.com",
            authorization=None,
            public_base_url="https://public.example",
        )

        # Créer un thread avec un statut LockedStatus
        thread = ThreadMetadata(
            id="thread-1",
            created_at=datetime.now(),
            status=LockedStatus(reason="Conversation verrouillée"),
        )
        await store.save_thread(thread, context)

        # Créer un message utilisateur
        user_message = UserMessageItem(
            id="user-1",
            thread_id=thread.id,
            created_at=datetime.now(),
            content=[UserMessageTextContent(text="Nouveau message après verrouillage")],
            attachments=[],
            inference_options=InferenceOptions(),
        )

        # Tenter d'envoyer le message et vérifier qu'il est rejeté
        events: list[Any] = []
        async for event in server.respond(thread, user_message, context):
            events.append(event)

        # Vérifier qu'on a reçu un ErrorEvent
        assert len(events) == 1, f"Expected 1 event, got {len(events)}"
        assert isinstance(events[0], ErrorEvent), f"Expected ErrorEvent, got {type(events[0])}"
        assert events[0].code == ErrorCode.STREAM_ERROR
        assert events[0].allow_retry is False
        assert "locked" in events[0].message.lower()

    asyncio.run(_run())
