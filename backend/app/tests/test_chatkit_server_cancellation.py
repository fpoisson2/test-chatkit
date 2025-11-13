import asyncio
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from importlib import import_module
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any, Generic, TypeVar

import pytest
from pydantic import BaseModel


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

        agents_module = ModuleType("agents")
        agents_module.Agent = SimpleNamespace
        agents_module.RunConfig = SimpleNamespace
        agents_module.InputGuardrailTripwireTriggered = type(
            "InputGuardrailTripwireTriggered",
            (),
            {},
        )
        agents_module.OutputGuardrailTripwireTriggered = type(
            "OutputGuardrailTripwireTriggered",
            (),
            {},
        )
        agents_module.RunResultStreaming = type("RunResultStreaming", (), {})
        agents_module.StreamEvent = type("StreamEvent", (), {})
        agents_module.TResponseInputItem = type("TResponseInputItem", (), {})
        agents_module.__path__ = []  # type: ignore[attr-defined]
        agents_module.__version__ = "0.0.0"

        class _Runner:
            @staticmethod
            async def run(*_args: Any, **_kwargs: Any) -> Any:
                return SimpleNamespace(final_output="")

        agents_module.Runner = _Runner
        sys.modules.setdefault("agents", agents_module)

        agents_models = ModuleType("agents.models")
        agents_module.models = agents_models
        agents_models.__path__ = []  # type: ignore[attr-defined]
        sys.modules.setdefault("agents.models", agents_models)

        chatcmpl_helpers = ModuleType("agents.models.chatcmpl_helpers")

        class _HeaderOverride:
            def __init__(self) -> None:
                self.value: Any = None

            def set(self, value: Any) -> Any:
                self.value = value

                class _Token:
                    def reset(inner_self) -> None:
                        pass

                return _Token()

            def reset(self, token: Any) -> None:  # noqa: ARG002 - token unused
                self.value = None

        chatcmpl_helpers.HEADERS_OVERRIDE = _HeaderOverride()
        sys.modules.setdefault("agents.models.chatcmpl_helpers", chatcmpl_helpers)

        openai_responses_module = ModuleType("agents.models.openai_responses")

        class _ResponsesOverride:
            def __init__(self) -> None:
                self.value: Any = None

            def set(self, value: Any) -> Any:
                self.value = value

                class _Token:
                    def reset(inner_self) -> None:
                        pass

                return _Token()

            def reset(self, token: Any) -> None:  # noqa: ARG002 - token unused
                self.value = None

        openai_responses_module._HEADERS_OVERRIDE = _ResponsesOverride()
        sys.modules.setdefault(
            "agents.models.openai_responses",
            openai_responses_module,
        )

        openai_module = ModuleType("openai")
        openai_types = ModuleType("openai.types")
        openai_responses = ModuleType("openai.types.responses")
        for attr in [
            "EasyInputMessageParam",
            "ResponseComputerToolCall",
            "ResponseFunctionToolCallParam",
            "ResponseFunctionWebSearch",
            "ResponseInputContentParam",
            "ResponseInputFileParam",
            "ResponseInputImageParam",
            "ResponseInputMessageContentListParam",
            "ResponseInputTextParam",
            "ResponseOutputText",
        ]:
            setattr(openai_responses, attr, type(attr, (), {}))

        openai_types.responses = openai_responses
        openai_module.types = openai_types
        response_item_param = ModuleType(
            "openai.types.responses.response_input_item_param"
        )
        response_item_param.Message = type("Message", (), {})
        response_item_param.FunctionCallOutput = type(
            "FunctionCallOutput",
            (),
            {},
        )
        response_output_message = ModuleType(
            "openai.types.responses.response_output_message"
        )
        response_output_message.Content = type("Content", (), {})
        response_output_text = ModuleType(
            "openai.types.responses.response_output_text"
        )
        response_output_text.Annotation = type("Annotation", (), {})

        sys.modules.setdefault("openai", openai_module)
        sys.modules.setdefault("openai.types", openai_types)
        sys.modules.setdefault("openai.types.responses", openai_responses)
        sys.modules.setdefault(
            "openai.types.responses.response_input_item_param",
            response_item_param,
        )
        sys.modules.setdefault(
            "openai.types.responses.response_output_message",
            response_output_message,
        )
        sys.modules.setdefault(
            "openai.types.responses.response_output_text",
            response_output_text,
        )

        fastapi_module = ModuleType("fastapi")

        class _UploadFile:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

        fastapi_module.UploadFile = _UploadFile
        sys.modules.setdefault("fastapi", fastapi_module)

        sqlalchemy_module = ModuleType("sqlalchemy")

        def _noop(*args: Any, **kwargs: Any) -> Any:
            return SimpleNamespace()

        sqlalchemy_module.delete = _noop
        sqlalchemy_module.select = _noop
        sys.modules.setdefault("sqlalchemy", sqlalchemy_module)

        attachment_store_module = ModuleType("backend.app.attachment_store")

        class _LocalAttachmentStore:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.store = args[0] if args else None

            async def open_attachment(
                self, attachment_id: str, context: Any
            ) -> tuple[Path, str, str]:
                temp_path = Path("/tmp") / attachment_id
                temp_path.write_bytes(b"")
                return temp_path, "text/plain", attachment_id

        attachment_store_module.LocalAttachmentStore = _LocalAttachmentStore
        sys.modules.setdefault("backend.app.attachment_store", attachment_store_module)

        chatkit_store_module = ModuleType("backend.app.chatkit_store")

        class _PostgresChatKitStore:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

        chatkit_store_module.PostgresChatKitStore = _PostgresChatKitStore
        sys.modules.setdefault("backend.app.chatkit_store", chatkit_store_module)

        config_module = ModuleType("backend.app.config")

        @dataclass
        class _Settings:
            backend_public_base_url: str = "https://example.com"
            workflow_defaults: Any = field(
                default_factory=lambda: SimpleNamespace(default_end_message="Fin")
            )

        config_module.Settings = _Settings
        config_module.get_settings = lambda: _Settings()
        sys.modules.setdefault("backend.app.config", config_module)

        database_module = ModuleType("backend.app.database")

        def _session_local() -> None:
            return None

        database_module.SessionLocal = _session_local
        sys.modules.setdefault("backend.app.database", database_module)

        models_module = ModuleType("backend.app.models")

        @dataclass
        class _WorkflowStep:
            slug: str

        models_module.WorkflowStep = _WorkflowStep
        sys.modules.setdefault("backend.app.models", models_module)

        widgets_module = ModuleType("backend.app.widgets")

        class _WidgetLibraryService:
            @staticmethod
            def _dump_widget(widget: Any) -> Any:
                return {}

        widgets_module.WidgetLibraryService = _WidgetLibraryService
        sys.modules.setdefault("backend.app.widgets", widgets_module)

        workflows_module = ModuleType("backend.app.workflows")

        class _WorkflowDefinition(SimpleNamespace):
            pass

        class _WorkflowService:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

            def get_current(self, *args: Any, **kwargs: Any) -> Any:
                workflow = SimpleNamespace(id=1, slug="stub")
                return SimpleNamespace(id=1, workflow=workflow, steps=[])

        workflows_module.WorkflowService = _WorkflowService
        workflows_module.resolve_start_auto_start = lambda *args, **kwargs: False
        workflows_module.resolve_start_auto_start_assistant_message = (
            lambda *args, **kwargs: ""
        )
        workflows_module.resolve_start_auto_start_message = (
            lambda *args, **kwargs: ""
        )
        sys.modules.setdefault("backend.app.workflows", workflows_module)

        workflows_executor_module = ModuleType("backend.app.workflows.executor")

        class _WorkflowExecutionError(Exception):
            pass

        class _WorkflowInput(SimpleNamespace):
            pass

        class _WorkflowRunSummary(SimpleNamespace):
            pass

        class _WorkflowStepStreamUpdate(SimpleNamespace):
            pass

        class _WorkflowStepSummary(SimpleNamespace):
            pass

        async def _run_workflow(*args: Any, **kwargs: Any) -> _WorkflowRunSummary:
            return _WorkflowRunSummary(end_state=None)

        workflows_executor_module.WorkflowExecutionError = _WorkflowExecutionError
        workflows_executor_module.WorkflowInput = _WorkflowInput
        workflows_executor_module.WorkflowRunSummary = _WorkflowRunSummary
        workflows_executor_module.WorkflowStepStreamUpdate = _WorkflowStepStreamUpdate
        workflows_executor_module.WorkflowStepSummary = _WorkflowStepSummary
        workflows_executor_module.run_workflow = _run_workflow

        sys.modules.setdefault(
            "backend.app.workflows.executor", workflows_executor_module
        )

        chatkit_agents = ModuleType("chatkit.agents")

        class _ThreadItemConverter:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

            def for_context(self, context: Any) -> "_ThreadItemConverter":
                return self

            async def to_agent_input(self, item: Any) -> Any:
                return item

            def _describe_attachment_as_text(
                self,
                attachment: Any,
                error_reason: str | None = None,
            ) -> Any:
                text = f"Attachment:{getattr(attachment, 'id', 'unknown')}"
                if error_reason:
                    text += f" ({error_reason})"
                return SimpleNamespace(type="input_text", text=text)

        class _AgentContext(SimpleNamespace):
            def __init__(self, thread: Any, store: Any, request_context: Any) -> None:
                super().__init__(
                    thread=thread,
                    store=store,
                    request_context=request_context,
                )
                self.previous_response_id: str | None = None

        async def _simple_to_agent_input(item: Any) -> Any:
            return item

        chatkit_agents.AgentContext = _AgentContext
        chatkit_agents.ThreadItemConverter = _ThreadItemConverter
        chatkit_agents.TResponseInputItem = Any  # type: ignore[assignment]
        chatkit_agents.simple_to_agent_input = _simple_to_agent_input

        sys.modules.setdefault("chatkit.agents", chatkit_agents)

        chatkit_actions = ModuleType("chatkit.actions")

        _TType = TypeVar("_TType")
        _TPayload = TypeVar("_TPayload")

        @dataclass
        class _Action(Generic[_TType, _TPayload]):
            type: _TType
            payload: _TPayload

        chatkit_actions.Action = _Action

        class _ActionConfig(BaseModel):
            model_config = {"arbitrary_types_allowed": True}

        chatkit_actions.ActionConfig = _ActionConfig
        sys.modules.setdefault("chatkit.actions", chatkit_actions)

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
        resumed: list[ThreadStreamEvent] = []
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

        async def _resume_stream() -> None:
            async for event in server._process_events(
                thread,
                context,
                lambda: server.respond(thread, None, context),
            ):
                resumed.append(event)

        resume_task = asyncio.create_task(_resume_stream())

        cancel_gate.set()

        await asyncio.wait_for(resume_task, timeout=5)

        resumed_texts = [
            content.text
            for event in resumed
            if isinstance(event, ThreadItemDoneEvent)
            and isinstance(getattr(event, "item", None), AssistantMessageItem)
            for content in getattr(event.item, "content", [])
            if isinstance(content, AssistantMessageContent)
        ]

        assert "Après annulation" in resumed_texts

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
