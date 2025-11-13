import asyncio
import os
import sys
from datetime import datetime
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest


def test_workflow_continues_after_stream_cancellation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
        workflow_runner = import_module("backend.app.chatkit_server.workflow_runner")

        from chatkit.store import NotFoundError
        from chatkit.types import (
            AssistantMessageContent,
            AssistantMessageItem,
            ClosedStatus,
            EndOfTurnItem,
            InferenceOptions,
            Page,
            ThreadItem,
            ThreadItemDoneEvent,
            ThreadMetadata,
            ThreadStreamEvent,
            UserMessageItem,
            UserMessageTextContent,
        )

        ChatKitRequestContext = context_module.ChatKitRequestContext
        _STREAM_DONE = workflow_runner._STREAM_DONE

        cancel_gate = asyncio.Event()

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
                self._saved_statuses: list[str] = []

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
                status_type = getattr(getattr(thread, "status", None), "type", None)
                if status_type is not None:
                    self._saved_statuses.append(status_type)
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

        async def _noop_title(*_args: Any, **_kwargs: Any) -> None:
            return None

        async def _fake_execute_workflow(
            self,
            *,
            thread: ThreadMetadata,
            agent_context: Any,
            workflow_input: Any,
            event_queue: asyncio.Queue[Any],
            thread_items_history: list[ThreadItem] | None = None,
            thread_item_converter: Any | None = None,
            input_user_message: UserMessageItem | None = None,
        ) -> None:
            del workflow_input
            del thread_items_history
            del thread_item_converter
            del input_user_message

            first_item = AssistantMessageItem(
                id=self.store.generate_item_id(
                    "message", thread, agent_context.request_context
                ),
                thread_id=thread.id,
                created_at=datetime.now(),
                content=[AssistantMessageContent(text="Avant annulation")],
            )
            await event_queue.put(ThreadItemDoneEvent(item=first_item))

            await cancel_gate.wait()

            thread.status = ClosedStatus(reason="Terminé après annulation")
            second_item = AssistantMessageItem(
                id=self.store.generate_item_id(
                    "message", thread, agent_context.request_context
                ),
                thread_id=thread.id,
                created_at=datetime.now(),
                content=[AssistantMessageContent(text="Après annulation")],
            )
            await event_queue.put(ThreadItemDoneEvent(item=second_item))

            await event_queue.put(
                EndOfTurnItem(
                    id=self.store.generate_item_id(
                        "message", thread, agent_context.request_context
                    ),
                    thread_id=thread.id,
                    created_at=datetime.now(),
                )
            )

            event_queue.put_nowait(_STREAM_DONE)

        monkeypatch.setattr(server_module, "PostgresChatKitStore", _MemoryStore)
        monkeypatch.setattr(server_module, "WorkflowService", _StubWorkflowService)
        monkeypatch.setattr(
            server_module, "_get_thread_title_agent", lambda: SimpleNamespace()
        )
        monkeypatch.setattr(
            server_module.DemoChatKitServer,
            "_maybe_update_thread_title",
            _noop_title,
        )
        monkeypatch.setattr(
            server_module.DemoChatKitServer,
            "_execute_workflow",
            _fake_execute_workflow,
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

        thread = ThreadMetadata(id="thread-1", created_at=datetime.now())
        await store.save_thread(thread, context)

        user_message = UserMessageItem(
            id="user-1",
            thread_id=thread.id,
            created_at=datetime.now(),
            content=[UserMessageTextContent(text="Bonjour")],
            attachments=[],
            inference_options=InferenceOptions(),
        )
        await store.add_thread_item(thread.id, user_message, context)

        consumed: list[ThreadStreamEvent] = []
        first_event_received = asyncio.Event()

        async def _consume_stream() -> None:
            try:
                async for event in server._process_events(
                    thread,
                    context,
                    lambda: server.respond(thread, user_message, context),
                ):
                    consumed.append(event)
                    if len(consumed) == 1:
                        first_event_received.set()
                    await asyncio.sleep(0)
            except asyncio.CancelledError:
                raise

        task = asyncio.create_task(_consume_stream())

        await first_event_received.wait()

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        cancel_gate.set()

        async def _load_assistant_texts() -> tuple[list[str], Any]:
            full_thread = await server._load_full_thread(thread.id, context)
            assistant_texts = [
                content.text
                for item in full_thread.items.data
                if isinstance(item, AssistantMessageItem)
                for content in getattr(item, "content", [])
                if isinstance(content, AssistantMessageContent)
            ]
            return assistant_texts, full_thread

        for _ in range(50):
            assistant_texts, full_thread = await _load_assistant_texts()
            if "Après annulation" in assistant_texts:
                break
            await asyncio.sleep(0.1)
        else:
            pytest.fail(
                "Le message assistant émis après l'annulation n'a pas été persisté"
            )

        assert "closed" in store._saved_statuses
        assert isinstance(full_thread.status, ClosedStatus)
        assert full_thread.status.reason == "Terminé après annulation"

    asyncio.run(_run())
