import asyncio
import datetime as dt
from types import SimpleNamespace

import pytest
from backend.app.chatkit_store import PostgresChatKitStore
from backend.app.models import Base, ChatThread
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from chatkit.store import NotFoundError
from chatkit.types import (
    InferenceOptions,
    ThreadMetadata,
    UserMessageItem,
    UserMessageTextContent,
)


class _StubWorkflowService:
    def __init__(
        self,
        *,
        slug: str = "demo-workflow",
        workflow_id: int = 1,
        definition_id: int = 10,
    ) -> None:
        self.slug = slug
        self.workflow_id = workflow_id
        self.definition_id = definition_id
        self.calls = 0

    def get_current(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        self.calls += 1
        workflow = SimpleNamespace(id=self.workflow_id, slug=self.slug)
        return SimpleNamespace(id=self.definition_id, workflow=workflow)


def _build_store(tmp_path: str, workflow_service: _StubWorkflowService) -> tuple[
    PostgresChatKitStore, sessionmaker
]:
    database_path = tmp_path
    engine = create_engine(
        f"sqlite:///{database_path}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    store = PostgresChatKitStore(factory, workflow_service=workflow_service)
    return store, factory


def _insert_thread(
    session_factory: sessionmaker,
    *,
    thread: ThreadMetadata,
    owner_id: str,
) -> None:
    payload = thread.model_dump(mode="json")
    now = dt.datetime.now(dt.UTC)
    with session_factory() as session:
        session.add(
            ChatThread(
                id=thread.id,
                owner_id=owner_id,
                created_at=now,
                updated_at=now,
                payload=payload,
            )
        )
        session.commit()


def test_save_thread_injects_workflow_metadata(tmp_path) -> None:
    async def _run() -> None:
        workflow_service = _StubWorkflowService(slug="active-workflow")
        store, factory = _build_store(tmp_path / "store.db", workflow_service)
        context = SimpleNamespace(user_id="user-1")

        thread = ThreadMetadata(
            id="thread-1",
            created_at=dt.datetime.now(dt.UTC),
        )
        await store.save_thread(thread, context)

        other_thread = ThreadMetadata(
            id="thread-2",
            created_at=dt.datetime.now(dt.UTC),
            metadata={
                "owner_id": context.user_id,
                "workflow": {
                    "id": 2,
                    "slug": "other-workflow",
                    "definition_id": 99,
                },
            },
        )
        _insert_thread(factory, thread=other_thread, owner_id=context.user_id)

        loaded = await store.load_thread("thread-1", context)
        workflow_metadata = loaded.metadata.get("workflow") or {}
        assert workflow_metadata.get("slug") == "active-workflow"
        assert workflow_metadata.get("definition_id") == workflow_service.definition_id
        assert workflow_service.calls >= 1

        page = await store.load_threads(10, None, "asc", context)
        assert [t.id for t in page.data] == ["thread-1"]

    asyncio.run(_run())


def test_store_rejects_threads_from_other_workflows(tmp_path) -> None:
    async def _run() -> None:
        workflow_service = _StubWorkflowService(slug="active-workflow")
        store, factory = _build_store(tmp_path / "store-other.db", workflow_service)
        context = SimpleNamespace(user_id="user-1")

        other_thread = ThreadMetadata(
            id="thread-2",
            created_at=dt.datetime.now(dt.UTC),
            metadata={
                "owner_id": context.user_id,
                "workflow": {
                    "id": 2,
                    "slug": "other-workflow",
                    "definition_id": 99,
                },
            },
        )
        _insert_thread(factory, thread=other_thread, owner_id=context.user_id)

        with pytest.raises(NotFoundError):
            await store.load_thread("thread-2", context)

        with pytest.raises(NotFoundError):
            await store.load_thread_items("thread-2", None, 10, "asc", context)

        item = UserMessageItem(
            id="item-1",
            thread_id="thread-2",
            created_at=dt.datetime.now(dt.UTC),
            content=[UserMessageTextContent(text="Bonjour")],
            attachments=[],
            inference_options=InferenceOptions(),
        )

        with pytest.raises(NotFoundError):
            await store.add_thread_item("thread-2", item, context)

        forbidden_thread = ThreadMetadata(
            id="thread-2",
            created_at=dt.datetime.now(dt.UTC),
            metadata={
                "owner_id": context.user_id,
                "workflow": {
                    "id": 2,
                    "slug": "other-workflow",
                    "definition_id": 99,
                },
            },
        )
        with pytest.raises(NotFoundError):
            await store.save_thread(forbidden_thread, context)

    asyncio.run(_run())
