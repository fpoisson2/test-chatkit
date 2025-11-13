import asyncio
import sys
from collections.abc import AsyncIterator, Callable
from datetime import datetime
from types import ModuleType

import pytest


class _DummyContextVar:
    def __init__(self) -> None:
        self._value = None

    def set(self, value):  # type: ignore[no-untyped-def]
        token = self._value
        self._value = value
        return token

    def reset(self, token):  # type: ignore[no-untyped-def]
        self._value = token


_agents = ModuleType("agents")
_agents.__version__ = "0.0"
_agents_models = ModuleType("agents.models")
_agents_chatcmpl = ModuleType("agents.models.chatcmpl_helpers")
_agents_chatcmpl.HEADERS_OVERRIDE = _DummyContextVar()
_agents_responses = ModuleType("agents.models.openai_responses")
_agents_responses._HEADERS_OVERRIDE = _DummyContextVar()
sys.modules.setdefault("agents", _agents)
sys.modules.setdefault("agents.models", _agents_models)
sys.modules.setdefault("agents.models.chatcmpl_helpers", _agents_chatcmpl)
sys.modules.setdefault("agents.models.openai_responses", _agents_responses)

from chatkit.server import ChatKitServer
from chatkit.store import NotFoundError, Store
from chatkit.types import (
    Annotation,
    AssistantMessageContent,
    AssistantMessageContentPartAnnotationAdded,
    AssistantMessageContentPartDone,
    AssistantMessageContentPartTextDelta,
    AssistantMessageItem,
    CustomTask,
    Page,
    SearchTask,
    ThoughtTask,
    ThreadItem,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    ThreadItemUpdated,
    ThreadMetadata,
    ThreadStreamEvent,
    URLSource,
    Workflow,
    WorkflowItem,
    WorkflowTaskAdded,
    WorkflowTaskUpdated,
)


class _MemoryStore(Store[None]):
    def __init__(self) -> None:
        self._threads: dict[str, ThreadMetadata] = {}
        self._items: dict[str, dict[str, ThreadItem]] = {}

    async def load_thread(self, thread_id: str, context: None) -> ThreadMetadata:
        try:
            stored = self._threads[thread_id]
        except KeyError as exc:  # pragma: no cover - defensive
            raise NotFoundError(f"Thread {thread_id} introuvable") from exc
        return stored.model_copy(deep=True)

    async def save_thread(self, thread: ThreadMetadata, context: None) -> None:
        self._threads[thread.id] = thread.model_copy(deep=True)

    async def load_thread_items(
        self,
        thread_id: str,
        after: str | None,
        limit: int,
        order: str,
        context: None,
    ) -> Page[ThreadItem]:
        items: list[ThreadItem] = [
            stored.model_copy(deep=True)
            for stored in self._items.get(thread_id, {}).values()
        ]
        items.sort(key=lambda it: (it.created_at, it.id))
        if order == "desc":
            items.reverse()
        start = 0
        if after:
            for idx, item in enumerate(items):
                if item.id == after:
                    start = idx + 1
                    break
        end = start + (limit or len(items))
        sliced = items[start:end]
        has_more = end < len(items)
        next_after = sliced[-1].id if has_more and sliced else None
        return Page(data=sliced, has_more=has_more, after=next_after)

    async def save_attachment(self, attachment, context):  # pragma: no cover - unused
        raise NotImplementedError

    async def load_attachment(self, attachment_id, context):  # pragma: no cover - unused
        raise NotImplementedError

    async def delete_attachment(self, attachment_id, context):  # pragma: no cover - unused
        raise NotImplementedError

    async def load_threads(
        self,
        limit: int,
        after: str | None,
        order: str,
        context: None,
    ) -> Page[ThreadMetadata]:  # pragma: no cover - unused
        raise NotImplementedError

    async def add_thread_item(
        self, thread_id: str, item: ThreadItem, context: None
    ) -> None:
        self._items.setdefault(thread_id, {})[item.id] = item.model_copy(deep=True)

    async def save_item(
        self, thread_id: str, item: ThreadItem, context: None
    ) -> None:
        try:
            thread_items = self._items[thread_id]
        except KeyError as exc:  # pragma: no cover - defensive
            raise NotFoundError(f"Thread {thread_id} introuvable") from exc
        if item.id not in thread_items:
            raise NotFoundError(
                f"Élément {item.id} introuvable dans le fil {thread_id}"
            )
        thread_items[item.id] = item.model_copy(deep=True)

    async def load_item(
        self, thread_id: str, item_id: str, context: None
    ) -> ThreadItem:
        try:
            stored = self._items[thread_id][item_id]
        except KeyError as exc:
            raise NotFoundError(
                f"Élément {item_id} introuvable dans le fil {thread_id}"
            ) from exc
        return stored.model_copy(deep=True)

    async def delete_thread(self, thread_id: str, context: None) -> None:  # pragma: no cover
        self._threads.pop(thread_id, None)
        self._items.pop(thread_id, None)

    async def delete_thread_item(
        self, thread_id: str, item_id: str, context: None
    ) -> None:  # pragma: no cover - unused
        self._items.get(thread_id, {}).pop(item_id, None)


class _TestServer(ChatKitServer[None]):
    async def respond(
        self,
        thread: ThreadMetadata,
        input_user_message: AssistantMessageItem | None,
        context: None,
    ) -> AsyncIterator[ThreadStreamEvent]:  # pragma: no cover - not used in tests
        async def _empty() -> AsyncIterator[ThreadStreamEvent]:
            if False:
                yield ThreadItemAddedEvent(
                    item=AssistantMessageItem(
                        id="unused",
                        thread_id=thread.id,
                        created_at=datetime.now(),
                        content=[],
                    )
                )
            return

        return _empty()


def _stream_from(events: list[ThreadStreamEvent]) -> Callable[[], AsyncIterator[ThreadStreamEvent]]:
    async def _iterator() -> AsyncIterator[ThreadStreamEvent]:
        for event in events:
            yield event

    return _iterator


@pytest.mark.asyncio
async def test_process_events_persists_streaming_state() -> None:
    store = _MemoryStore()
    server = _TestServer(store)
    thread = ThreadMetadata(id="thr_1", created_at=datetime.now())
    await store.save_thread(thread, None)

    assistant_initial = AssistantMessageItem(
        id="__assistant__",
        thread_id=thread.id,
        created_at=datetime.now(),
        content=[AssistantMessageContent(text="", annotations=[])],
    )

    workflow_initial = WorkflowItem(
        id="__workflow__",
        thread_id=thread.id,
        created_at=datetime.now(),
        workflow=Workflow(type="reasoning", tasks=[]),
    )

    thought_partial = ThoughtTask(content="Réflexion initiale", status_indicator="loading")
    custom_partial = CustomTask(
        title="Outil XYZ",
        status_indicator="loading",
        content="Arguments\n\nfoo = 1",
    )
    search_partial = SearchTask(
        status_indicator="loading",
        queries=["chatgpt"],
        sources=[],
    )

    annotation = Annotation(
        source=URLSource(title="Doc", url="https://example.com"),
        index=0,
    )

    thought_final = thought_partial.model_copy(update={"content": "Réflexion finale", "status_indicator": "complete"})
    custom_final = custom_partial.model_copy(
        update={
            "status_indicator": "complete",
            "content": "Arguments\n\nfoo = 1\n\nRésultat\n\n42",
        }
    )
    search_final = search_partial.model_copy(
        update={
            "status_indicator": "complete",
            "queries": ["chatgpt", "openai"],
            "sources": [URLSource(title="Doc", url="https://openai.com")],
        }
    )

    events: list[ThreadStreamEvent] = [
        ThreadItemAddedEvent(item=assistant_initial),
        ThreadItemUpdated(
            item_id="__assistant__",
            update=AssistantMessageContentPartTextDelta(content_index=0, delta="Bonjour"),
        ),
        ThreadItemAddedEvent(item=workflow_initial),
        ThreadItemUpdated(
            item_id="__workflow__",
            update=WorkflowTaskAdded(task=thought_partial, task_index=0),
        ),
        ThreadItemUpdated(
            item_id="__workflow__",
            update=WorkflowTaskAdded(task=custom_partial, task_index=1),
        ),
        ThreadItemUpdated(
            item_id="__workflow__",
            update=WorkflowTaskAdded(task=search_partial, task_index=2),
        ),
        ThreadItemUpdated(
            item_id="__assistant__",
            update=AssistantMessageContentPartTextDelta(content_index=0, delta=" tout le monde"),
        ),
        ThreadItemUpdated(
            item_id="__assistant__",
            update=AssistantMessageContentPartAnnotationAdded(
                content_index=0,
                annotation_index=0,
                annotation=annotation,
            ),
        ),
        ThreadItemUpdated(
            item_id="__assistant__",
            update=AssistantMessageContentPartDone(
                content_index=0,
                content=AssistantMessageContent(text="Bonjour tout le monde!", annotations=[annotation]),
            ),
        ),
        ThreadItemUpdated(
            item_id="__workflow__",
            update=WorkflowTaskUpdated(task=thought_final, task_index=0),
        ),
        ThreadItemUpdated(
            item_id="__workflow__",
            update=WorkflowTaskUpdated(task=custom_final, task_index=1),
        ),
        ThreadItemUpdated(
            item_id="__workflow__",
            update=WorkflowTaskUpdated(task=search_final, task_index=2),
        ),
        ThreadItemDoneEvent(
            item=AssistantMessageItem(
                id="__assistant__",
                thread_id=thread.id,
                created_at=assistant_initial.created_at,
                content=[
                    AssistantMessageContent(
                        text="Bonjour tout le monde!",
                        annotations=[annotation],
                    )
                ],
            )
        ),
    ]

    emitted: list[ThreadStreamEvent] = []
    event_iter = server._process_events(thread, None, _stream_from(events))

    for _ in range(6):
        emitted.append(await event_iter.__anext__())

    assert isinstance(emitted[0], ThreadItemAddedEvent)
    assistant_id = emitted[0].item.id
    assert not assistant_id.startswith("__")

    assert isinstance(emitted[1], ThreadItemUpdated)
    assert emitted[1].item_id == assistant_id

    assert isinstance(emitted[2], ThreadItemAddedEvent)
    workflow_id = emitted[2].item.id
    assert not workflow_id.startswith("__")

    partial_assistant = await store.load_item(thread.id, assistant_id, None)
    assert isinstance(partial_assistant, AssistantMessageItem)
    assert partial_assistant.content[0].text == "Bonjour"

    partial_workflow = await store.load_item(thread.id, workflow_id, None)
    assert isinstance(partial_workflow, WorkflowItem)
    assert len(partial_workflow.workflow.tasks) == 3
    assert isinstance(partial_workflow.workflow.tasks[0], ThoughtTask)
    assert partial_workflow.workflow.tasks[0].content == "Réflexion initiale"
    assert isinstance(partial_workflow.workflow.tasks[1], CustomTask)
    assert partial_workflow.workflow.tasks[1].content == "Arguments\n\nfoo = 1"
    assert isinstance(partial_workflow.workflow.tasks[2], SearchTask)
    assert partial_workflow.workflow.tasks[2].status_indicator == "loading"

    async for evt in event_iter:
        emitted.append(evt)

    assert isinstance(emitted[-1], ThreadItemDoneEvent)
    assert emitted[-1].item.id == assistant_id

    final_assistant = await store.load_item(thread.id, assistant_id, None)
    assert isinstance(final_assistant, AssistantMessageItem)
    assert final_assistant.content[0].text == "Bonjour tout le monde!"
    assert len(final_assistant.content[0].annotations) == 1
    assert final_assistant.content[0].annotations[0].source.url == "https://example.com"

    final_workflow = await store.load_item(thread.id, workflow_id, None)
    assert isinstance(final_workflow, WorkflowItem)
    assert [task.status_indicator for task in final_workflow.workflow.tasks] == [
        "complete",
        "complete",
        "complete",
    ]
    assert final_workflow.workflow.tasks[1].content.endswith("Résultat\n\n42")
    assert final_workflow.workflow.tasks[2].queries == ["chatgpt", "openai"]
    assert final_workflow.workflow.tasks[2].sources[0].url == "https://openai.com"


@pytest.mark.asyncio
async def test_process_events_replays_pending_events_after_disconnect() -> None:
    store = _MemoryStore()
    server = _TestServer(store)
    thread = ThreadMetadata(id="thr_replay", created_at=datetime.now())
    await store.save_thread(thread, None)

    assistant_initial = AssistantMessageItem(
        id="__assistant__",
        thread_id=thread.id,
        created_at=datetime.now(),
        content=[AssistantMessageContent(text="", annotations=[])],
    )

    events: list[ThreadStreamEvent] = [
        ThreadItemAddedEvent(item=assistant_initial),
        ThreadItemUpdated(
            item_id="__assistant__",
            update=AssistantMessageContentPartTextDelta(
                content_index=0,
                delta="Bonjour",
            ),
        ),
        ThreadItemDoneEvent(
            item=AssistantMessageItem(
                id="__assistant__",
                thread_id=thread.id,
                created_at=assistant_initial.created_at,
                content=[
                    AssistantMessageContent(
                        text="Bonjour",
                        annotations=[],
                    )
                ],
            )
        ),
    ]

    async for _ in server._process_events(
        thread, None, _stream_from(events), capture_only=True
    ):
        pass

    stored_items = await store.load_thread_items(
        thread.id, None, 10, "asc", None
    )
    assert len(stored_items.data) == 1
    stored_assistant = stored_items.data[0]
    assert isinstance(stored_assistant, AssistantMessageItem)
    assert stored_assistant.content[0].text == "Bonjour"

    emitted: list[ThreadStreamEvent] = []
    async for event in server._process_events(
        thread, None, _stream_from([])
    ):
        emitted.append(event)

    assert [type(evt) for evt in emitted] == [
        ThreadItemAddedEvent,
        ThreadItemUpdated,
        ThreadItemDoneEvent,
    ]

    assistant_id = stored_assistant.id
    assert isinstance(emitted[0], ThreadItemAddedEvent)
    assert emitted[0].item.id == assistant_id

    assert isinstance(emitted[1], ThreadItemUpdated)
    assert emitted[1].item_id == assistant_id

    assert isinstance(emitted[2], ThreadItemDoneEvent)
    assert emitted[2].item.id == assistant_id

    replayed_again = [
        evt
        async for evt in server._process_events(
            thread, None, _stream_from([])
        )
    ]
    assert replayed_again == []


@pytest.mark.asyncio
async def test_process_events_resumes_live_stream_after_reconnect() -> None:
    store = _MemoryStore()
    server = _TestServer(store)
    thread = ThreadMetadata(id="thr_resume", created_at=datetime.now())
    await store.save_thread(thread, None)

    assistant_initial = AssistantMessageItem(
        id="__assistant__",
        thread_id=thread.id,
        created_at=datetime.now(),
        content=[AssistantMessageContent(text="", annotations=[])],
    )

    queue: asyncio.Queue[ThreadStreamEvent | None] = asyncio.Queue()

    async def _queue_stream() -> AsyncIterator[ThreadStreamEvent]:
        while True:
            event = await queue.get()
            if event is None:
                break
            yield event

    async def _drain_capture_only() -> None:
        async for _ in server._process_events(
            thread, None, _queue_stream, capture_only=True
        ):
            pass

    capture_task = asyncio.create_task(_drain_capture_only())

    await queue.put(ThreadItemAddedEvent(item=assistant_initial))
    await queue.put(
        ThreadItemUpdated(
            item_id="__assistant__",
            update=AssistantMessageContentPartTextDelta(
                content_index=0,
                delta="Bon",
            ),
        )
    )

    async def _collect_events() -> list[ThreadStreamEvent]:
        emitted: list[ThreadStreamEvent] = []
        async for evt in server._process_events(
            thread, None, _stream_from([])
        ):
            emitted.append(evt)
        return emitted

    collector_task = asyncio.create_task(_collect_events())

    await asyncio.sleep(0)

    await queue.put(
        ThreadItemUpdated(
            item_id="__assistant__",
            update=AssistantMessageContentPartTextDelta(
                content_index=0,
                delta="jour",
            ),
        )
    )
    await queue.put(
        ThreadItemDoneEvent(
            item=AssistantMessageItem(
                id="__assistant__",
                thread_id=thread.id,
                created_at=assistant_initial.created_at,
                content=[
                    AssistantMessageContent(
                        text="Bonjour",
                        annotations=[],
                    )
                ],
            )
        )
    )
    await queue.put(None)

    emitted_events = await collector_task
    await capture_task

    assert [type(evt) for evt in emitted_events] == [
        ThreadItemAddedEvent,
        ThreadItemUpdated,
        ThreadItemUpdated,
        ThreadItemDoneEvent,
    ]

    stored_items = await store.load_thread_items(thread.id, None, 10, "asc", None)
    assert len(stored_items.data) == 1
    stored_assistant = stored_items.data[0]
    assert isinstance(stored_assistant, AssistantMessageItem)
    assert stored_assistant.content[0].text == "Bonjour"
