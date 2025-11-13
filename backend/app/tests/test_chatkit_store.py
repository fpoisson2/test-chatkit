import asyncio
import datetime as dt
from types import SimpleNamespace

import pytest
from backend.app.chatkit_store import PostgresChatKitStore
from backend.app.models import Base, ChatThread
from chatkit.store import NotFoundError
from chatkit.types import (
    Annotation,
    AssistantMessageContent,
    AssistantMessageItem,
    CustomTask,
    InferenceOptions,
    SearchTask,
    ThoughtTask,
    ThreadMetadata,
    URLSource,
    UserMessageItem,
    UserMessageTextContent,
    Workflow,
    WorkflowItem,
)
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


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


def test_store_persists_streaming_state(tmp_path) -> None:
    async def _run() -> None:
        workflow_service = _StubWorkflowService(slug="active-workflow")
        store, _factory = _build_store(
            tmp_path / "store-streaming.db", workflow_service
        )
        context = SimpleNamespace(user_id="user-1")

        thread = ThreadMetadata(
            id="thread-stream",
            created_at=dt.datetime.now(dt.UTC),
        )
        await store.save_thread(thread, context)

        assistant_item = AssistantMessageItem(
            id="assistant-1",
            thread_id=thread.id,
            created_at=dt.datetime.now(dt.UTC),
            content=[AssistantMessageContent(text="Bonjour", annotations=[])],
        )
        await store.add_thread_item(thread.id, assistant_item, context)

        loaded_partial = await store.load_item(thread.id, assistant_item.id, context)
        assert isinstance(loaded_partial, AssistantMessageItem)
        assert loaded_partial.content[0].text == "Bonjour"

        annotation = Annotation(
            source=URLSource(title="Doc", url="https://example.com"),
            index=0,
        )
        assistant_final = assistant_item.model_copy(
            update={
                "content": [
                    AssistantMessageContent(
                        text="Bonjour tout le monde!",
                        annotations=[annotation],
                    )
                ]
            }
        )
        await store.save_item(thread.id, assistant_final, context)

        loaded_final = await store.load_item(thread.id, assistant_item.id, context)
        assert isinstance(loaded_final, AssistantMessageItem)
        assert loaded_final.content[0].text == "Bonjour tout le monde!"
        assert loaded_final.content[0].annotations[0].source.url == "https://example.com"

        workflow_partial = WorkflowItem(
            id="workflow-1",
            thread_id=thread.id,
            created_at=dt.datetime.now(dt.UTC),
            workflow=Workflow(
                type="reasoning",
                tasks=[
                    ThoughtTask(
                        content="Réflexion initiale", status_indicator="loading"
                    ),
                    CustomTask(
                        title="Outil XYZ",
                        status_indicator="loading",
                        content="Arguments\n\nfoo = 1",
                    ),
                    SearchTask(
                        status_indicator="loading",
                        queries=["chatgpt"],
                        sources=[],
                    ),
                ],
            ),
        )
        await store.add_thread_item(thread.id, workflow_partial, context)

        loaded_workflow = await store.load_item(thread.id, workflow_partial.id, context)
        assert isinstance(loaded_workflow, WorkflowItem)
        assert loaded_workflow.workflow.tasks[0].content == "Réflexion initiale"
        assert loaded_workflow.workflow.tasks[1].content == "Arguments\n\nfoo = 1"
        assert loaded_workflow.workflow.tasks[2].status_indicator == "loading"

        workflow_final = workflow_partial.model_copy(
            update={
                "workflow": workflow_partial.workflow.model_copy(
                    update={
                        "tasks": [
                            ThoughtTask(
                                content="Réflexion finale",
                                status_indicator="complete",
                            ),
                            CustomTask(
                                title="Outil XYZ",
                                status_indicator="complete",
                                content="Arguments\n\nfoo = 1\n\nRésultat\n\n42",
                            ),
                            SearchTask(
                                status_indicator="complete",
                                queries=["chatgpt", "openai"],
                                sources=[
                                    URLSource(title="Doc", url="https://openai.com")
                                ],
                            ),
                        ]
                    }
                )
            }
        )
        await store.save_item(thread.id, workflow_final, context)

        loaded_workflow_final = await store.load_item(
            thread.id, workflow_partial.id, context
        )
        assert isinstance(loaded_workflow_final, WorkflowItem)
        assert [
            task.status_indicator for task in loaded_workflow_final.workflow.tasks
        ] == ["complete", "complete", "complete"]
        assert loaded_workflow_final.workflow.tasks[1].content.endswith(
            "Résultat\n\n42"
        )
        assert loaded_workflow_final.workflow.tasks[2].sources[0].url == "https://openai.com"

    asyncio.run(_run())
