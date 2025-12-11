"""Serveur ChatKit et convertisseurs associés."""

from __future__ import annotations

import asyncio
import base64
import logging
import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from datetime import datetime
from pathlib import Path
from typing import Any

from agents import Agent, RunConfig, Runner
from chatkit.actions import Action
from chatkit.agents import (
    AgentContext,
    ThreadItemConverter,
    TResponseInputItem,
    simple_to_agent_input,
)
from chatkit.server import ChatKitServer
from chatkit.store import NotFoundError
from chatkit.types import (
    ActiveStatus,
    AssistantMessageContent,
    AssistantMessageItem,
    Attachment,
    ClosedStatus,
    ComputerUseScreenshot,
    ComputerUseTask,
    DurationSummary,
    EndOfTurnItem,
    ErrorCode,
    ErrorEvent,
    GeneratedImage,
    ImageTask,
    InferenceOptions,
    LockedStatus,
    Page,
    ProgressUpdateEvent,
    StreamingReq,
    TaskItem,
    Thread,
    ThreadCreatedEvent,
    ThreadItem,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    ThreadItemRemovedEvent,
    ThreadItemReplacedEvent,
    ThreadItemUpdated,
    ThreadMetadata,
    ThreadsCreateReq,
    ThreadStreamEvent,
    ThreadUpdatedEvent,
    UserMessageInput,
    UserMessageItem,
    UserMessageTextContent,
    WidgetItem,
    WidgetRootUpdated,
    Workflow,
    WorkflowItem,
    WorkflowTaskAdded,
    WorkflowTaskUpdated,
    AssistantMessageContentPartAdded,
    AssistantMessageContentPartTextDelta,
)
from openai.types.responses import (
    ResponseInputContentParam,
    ResponseInputFileParam,
    ResponseInputImageParam,
    ResponseInputTextParam,
)
from openai.types.responses.response_input_item_param import Message

from ..attachment_store import LocalAttachmentStore
from ..chatkit_store import PostgresChatKitStore
from ..config import Settings
from ..database import SessionLocal
from ..models import WorkflowStep
from ..widgets import WidgetLibraryService
from ..workflows import (
    WorkflowService,
    resolve_start_auto_start,
    resolve_start_auto_start_assistant_message,
    resolve_start_auto_start_message,
)
from .actions import (
    _UNSET,
    _apply_widget_variable_values,
    _clone_widget_definition,
    _collect_widget_bindings,
    _json_safe_copy,
    _load_widget_definition,
    _resolve_widget_action_payload,
    _ResponseWidgetConfig,
)
from .ags import (
    AGSClientProtocol,
    NullAGSClient,
    process_workflow_end_state_ags,
)
from .context import (
    AutoStartConfiguration,
    ChatKitRequestContext,
    _get_wait_state_metadata,
    _resolve_user_input_text,
    _set_wait_state_metadata,
)
from ..workflows.utils import _normalize_user_text
from .widget_waiters import WidgetWaiterRegistry
from .workflow_runner import (
    _STREAM_DONE,
    _WorkflowStreamResult,
)

try:
    from ..chatkit import (
        WorkflowExecutionError,
        WorkflowInput,
        WorkflowStepStreamUpdate,
        WorkflowStepSummary,
    )
except Exception:  # pragma: no cover - module non initialisé
    WorkflowExecutionError = RuntimeError  # type: ignore[assignment]
    WorkflowInput = Any  # type: ignore[assignment]
    WorkflowStepStreamUpdate = Any  # type: ignore[assignment]
    WorkflowStepSummary = Any  # type: ignore[assignment]


logger = logging.getLogger("chatkit.server")


def _log_async_exception(task: asyncio.Task[Any]) -> None:
    try:
        task.result()
    except asyncio.CancelledError:  # pragma: no cover - annulation attendue
        pass
    except Exception:  # pragma: no cover - robustesse best effort
        logger.warning("Tâche asynchrone échouée", exc_info=True)


def _get_thread_title_agent() -> Agent:
    from ..chatkit.agent_registry import _build_thread_title_agent

    return _build_thread_title_agent()


def _get_run_workflow():
    from .. import chatkit as chatkit_module

    return chatkit_module.run_workflow


_stream_registry: dict[str, StreamProcessor] = {}


class StreamProcessor:
    """Manages an active stream, persistence, and multiple listeners."""

    def __init__(self, thread: ThreadMetadata, store: Any):
        self.thread = thread
        self.store = store
        self.event_queue: asyncio.Queue[Any] = asyncio.Queue()
        self.active_items: dict[str, Any] = {}
        self.listeners: list[asyncio.Queue[Any]] = []
        self._task: asyncio.Task[None] | None = None
        self._workflow_task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        self._context: ChatKitRequestContext | None = None
        logger.debug("StreamProcessor initialized for thread %s", thread.id)

    def update_context(self, context: ChatKitRequestContext) -> None:
        self._context = context

    def start(self, workflow_task: asyncio.Task[None]) -> None:
        if self._task is not None:
            logger.debug("StreamProcessor already started for thread %s", self.thread.id)
            return
        logger.info("Starting StreamProcessor loop for thread %s", self.thread.id)
        self._workflow_task = workflow_task
        self._task = asyncio.create_task(self._run_loop())
        self._task.add_done_callback(_log_async_exception)

    async def add_listener(self) -> asyncio.Queue[Any]:
        logger.info("Adding listener to StreamProcessor for thread %s", self.thread.id)
        queue: asyncio.Queue[Any] = asyncio.Queue()
        async with self._lock:
            # Send current state snapshot
            count = 0
            for item in self.active_items.values():
                await queue.put(ThreadItemReplacedEvent(item=item))
                count += 1
            self.listeners.append(queue)
        logger.debug("Listener added. Replayed %d active items.", count)
        return queue

    async def remove_listener(self, queue: asyncio.Queue[Any]) -> None:
        logger.info("Removing listener from StreamProcessor for thread %s", self.thread.id)
        async with self._lock:
            if queue in self.listeners:
                self.listeners.remove(queue)

    async def _run_loop(self) -> None:
        import time

        last_save_time: dict[str, float] = {}
        SAVE_INTERVAL = 1.0  # seconds
        logger.debug("StreamProcessor loop running for thread %s", self.thread.id)

        try:
            while True:
                event = await self.event_queue.get()

                if event is _STREAM_DONE:
                    logger.info("StreamProcessor received _STREAM_DONE for thread %s", self.thread.id)
                    # Broadcast done to all listeners
                    async with self._lock:
                        for listener in self.listeners:
                            await listener.put(_STREAM_DONE)
                    break

                # Update active state
                if isinstance(event, ThreadItemAddedEvent):
                    # Keep a deep copy of the item
                    if hasattr(event.item, "model_copy"):
                        self.active_items[event.item.id] = event.item.model_copy(
                            deep=True
                        )
                    else:
                        self.active_items[event.item.id] = event.item

                    # Always persist new items to ensure they exist in DB (upsert)
                    if self._context:
                        try:
                            logger.debug("Persistence: Adding item %s", event.item.id)
                            await self.store.add_thread_item(
                                self.thread.id, event.item, context=self._context
                            )
                        except Exception:
                            logger.warning(
                                "Failed to persist new item %s during stream",
                                event.item.id,
                                exc_info=True,
                            )

                elif isinstance(event, ThreadItemUpdated):
                    item = self.active_items.get(event.item_id)
                    if item:
                        # Update the in-memory item
                        if isinstance(item, AssistantMessageItem):
                            if isinstance(event.update, AssistantMessageContentPartTextDelta):
                                content_index = event.update.content_index
                                delta = event.update.delta
                                if 0 <= content_index < len(item.content):
                                    content = item.content[content_index]
                                    if hasattr(content, "text"):
                                        content.text += delta
                            elif hasattr(event.update, "type") and event.update.type == "assistant_message.content_part.added":
                                # Handle new content part
                                content_index = getattr(event.update, "content_index", -1)
                                new_content = getattr(event.update, "content", None)
                                if new_content and content_index >= 0:
                                    if content_index >= len(item.content):
                                        item.content.append(new_content)
                                    else:
                                        item.content.insert(content_index, new_content)

                        elif (
                            hasattr(event.update, "type")
                            and event.update.type == "widget.root.updated"
                        ):
                             if hasattr(item, "widget") and hasattr(event.update, "widget"):
                                 item.widget = event.update.widget

                        elif (
                            hasattr(event.update, "type")
                            and event.update.type in ("workflow.task.added", "workflow.task.updated")
                        ):
                            # Handle workflow task updates
                            if hasattr(item, "workflow") and item.workflow:
                                tasks = item.workflow.tasks
                                if event.update.type == "workflow.task.added":
                                    # Ensure we don't duplicate if replaying
                                    if event.update.task_index >= len(tasks):
                                        tasks.append(event.update.task)
                                elif event.update.type == "workflow.task.updated":
                                    if 0 <= event.update.task_index < len(tasks):
                                        tasks[event.update.task_index] = event.update.task

                        # Persist updates periodically (ALWAYS)
                        now = time.time()
                        if (
                            now - last_save_time.get(event.item_id, 0)
                            > SAVE_INTERVAL
                        ) and self._context:
                            try:
                                logger.debug("Persistence: Saving item update %s", event.item_id)
                                await self.store.save_item(
                                    self.thread.id, item, context=self._context
                                )
                                last_save_time[event.item_id] = now
                            except Exception:
                                logger.warning(
                                    "Failed to persist item %s during stream",
                                    event.item_id,
                                    exc_info=True,
                                )

                elif isinstance(event, ThreadItemDoneEvent):
                    self.active_items.pop(event.item.id, None)
                    last_save_time.pop(event.item.id, None)
                    # Always persist final state
                    if self._context:
                        try:
                            # Replace temporary IDs before final save
                            item = event.item
                            if item.id.startswith("__"):
                                # This logic duplicates server.py _process_events but is needed here
                                pass

                            logger.debug("Persistence: Final save for item %s", item.id)
                            await self.store.add_thread_item(
                                self.thread.id, item, context=self._context
                            )
                        except Exception:
                            logger.warning(
                                "Failed to persist final item %s",
                                event.item.id,
                                exc_info=True,
                            )

                # Broadcast event
                async with self._lock:
                    for listener in self.listeners:
                        await listener.put(event)

        finally:
            logger.info("StreamProcessor loop finished for thread %s", self.thread.id)
            # Cleanup registry
            if _stream_registry.get(self.thread.id) == self:
                _stream_registry.pop(self.thread.id, None)


class ImageAwareThreadItemConverter(ThreadItemConverter):
    """
    Converter personnalisé qui intercepte les ImageTask pour retourner
    les URLs des images générées à l'agent dans l'historique de conversation.
    """

    def __init__(
        self,
        backend_public_base_url: str | None = None,
        *,
        open_attachment: (
            Callable[[str, ChatKitRequestContext], Awaitable[tuple[Path, str, str]]]
            | None
        ) = None,
    ):
        super().__init__()
        self.backend_public_base_url = backend_public_base_url
        self._open_attachment = open_attachment
        self._request_context: ChatKitRequestContext | None = None

    def for_context(
        self, context: ChatKitRequestContext | None
    ) -> ImageAwareThreadItemConverter:
        """Créer un convertisseur initialisé pour le contexte fourni."""

        clone = ImageAwareThreadItemConverter(
            backend_public_base_url=self.backend_public_base_url,
            open_attachment=self._open_attachment,
        )
        clone._request_context = context
        return clone

    async def attachment_to_message_content(
        self, attachment: Attachment
    ) -> ResponseInputContentParam:
        """Convertir une pièce jointe en contenu compatible avec le modèle."""

        logger.info(
            "📎 attachment_to_message_content called: attachment_id=%s, "
            "attachment_name=%s, mime_type=%s, open_attachment=%s, request_context=%s",
            attachment.id,
            getattr(attachment, "name", None),
            getattr(attachment, "mime_type", None),
            self._open_attachment is not None,
            self._request_context is not None,
        )

        if self._open_attachment is None or self._request_context is None:
            logger.warning(
                "📎 Falling back to text description for attachment %s: "
                "open_attachment=%s, request_context=%s",
                attachment.id,
                self._open_attachment is not None,
                self._request_context is not None,
            )
            return self._describe_attachment_as_text(attachment)

        try:
            path, mime_type, filename = await self._open_attachment(
                attachment.id, self._request_context
            )
            data = path.read_bytes()
        except Exception as exc:  # pragma: no cover - robustesse vis-à-vis des I/O
            logger.warning(
                "Impossible de charger la pièce jointe %s pour la conversion",  # noqa: TRY400
                attachment.id,
                exc_info=exc,
            )
            return self._describe_attachment_as_text(
                attachment,
                error_reason="lecture impossible",
            )

        resolved_mime = (mime_type or getattr(attachment, "mime_type", None)) or (
            "application/octet-stream"
        )
        resolved_name = filename or getattr(attachment, "name", None) or attachment.id
        b64_payload = base64.b64encode(data).decode("ascii")
        data_url = f"data:{resolved_mime};base64,{b64_payload}"

        if resolved_mime.startswith("image/"):
            logger.info(
                "📎 Attachment %s converted to input_image: mime=%s, data_size=%d",
                attachment.id,
                resolved_mime,
                len(data),
            )
            return ResponseInputImageParam(
                type="input_image",
                detail="auto",
                image_url=data_url,
            )

        logger.info(
            "📎 Attachment %s converted to input_file: mime=%s, filename=%s, data_size=%d",
            attachment.id,
            resolved_mime,
            resolved_name,
            len(data),
        )
        return ResponseInputFileParam(
            type="input_file",
            file_data=data_url,
            filename=resolved_name,
        )

    def task_to_input(
        self, item: TaskItem
    ) -> TResponseInputItem | list[TResponseInputItem] | None:
        """
        Convertit un TaskItem en input pour l'agent.
        Pour les ImageTask, retourne l'URL de l'image générée.
        """
        # Si ce n'est pas une tâche d'image, utiliser la conversion par défaut
        if not isinstance(item.task, ImageTask):
            return super().task_to_input(item)

        task = item.task

        # Extraire l'URL de l'image générée
        # IMPORTANT: Préférer data_url (base64) qui fonctionne partout
        # au lieu de image_url (HTTP avec token qui peut expirer)
        image_urls = []
        if task.images:
            for image in task.images:
                # Ordre de préférence:
                # 1. data_url (base64) - fonctionne toujours, pas d'expiration
                # 2. image_url (HTTP) - peut expirer si tokenisé
                image_url = None

                # Essayer d'abord le data_url (base64)
                if hasattr(image, "data_url"):
                    data_url = getattr(image, "data_url", None)
                    if data_url and data_url.startswith("data:"):
                        image_url = data_url

                # Si pas de data_url, utiliser image_url
                if not image_url:
                    image_url = getattr(image, "image_url", None)

                if image_url:
                    image_urls.append(image_url)

        # Si on n'a pas d'URL, utiliser la conversion par défaut
        if not image_urls:
            return super().task_to_input(item)

        # Construire le contenu du message avec les images

        content = []

        # Ajouter un texte descriptif
        content.append(
            ResponseInputTextParam(
                type="input_text",
                text="Image(s) générée(s) avec succès :",
            )
        )

        # Ajouter chaque image comme input visuel
        for image_url in image_urls:
            content.append(
                ResponseInputImageParam(
                    type="input_image",
                    image_url=image_url,
                    detail="auto",
                )
            )

        return Message(
            type="message",
            content=content,
            role="user",
        )

    def workflow_to_input(
        self, item: WorkflowItem
    ) -> TResponseInputItem | list[TResponseInputItem] | None:
        """
        Convertit un WorkflowItem en input pour l'agent.
        Extrait les ImageTask et retourne les URLs des images.
        """
        messages = []

        for task in item.workflow.tasks:
            # Si c'est une ImageTask, utiliser notre conversion personnalisée
            if isinstance(task, ImageTask):
                # Créer un TaskItem temporaire pour utiliser task_to_input
                temp_task_item = TaskItem(
                    id=item.id,
                    created_at=item.created_at,
                    task=task,
                    thread_id=item.thread_id,
                )
                converted = self.task_to_input(temp_task_item)
                if converted:
                    if isinstance(converted, list):
                        messages.extend(converted)
                    else:
                        messages.append(converted)
            # Pour les autres tâches, utiliser la conversion par défaut
            elif task.type == "custom" and (task.title or task.content):
                title = f"{task.title}" if task.title else ""
                content = f"{task.content}" if task.content else ""
                task_text = (
                    f"{title}: {content}" if title and content else title or content
                )
                text = (
                    "A message was displayed to the user that the following task "
                    f"was performed:\n<Task>\n{task_text}\n</Task>"
                )

                from openai.types.responses.response_input_item_param import Message

                messages.append(
                    Message(
                        type="message",
                        content=[
                            ResponseInputTextParam(
                                type="input_text",
                                text=text,
                            )
                        ],
                        role="user",
                    )
                )

        return messages if messages else None

    def _describe_attachment_as_text(
        self,
        attachment: Attachment,
        *,
        error_reason: str | None = None,
    ) -> ResponseInputTextParam:
        """Construit un message textuel décrivant la pièce jointe."""

        mime = getattr(attachment, "mime_type", None) or "inconnu"
        display_name = getattr(attachment, "name", None) or attachment.id
        parts = [
            f"L'utilisateur a envoyé la pièce jointe « {display_name} » (type {mime})."
        ]
        if self.backend_public_base_url:
            base = self.backend_public_base_url.rstrip("/")
            parts.append(
                "Téléchargement possible : "
                f"{base}/api/chatkit/attachments/{attachment.id}"
            )
        if error_reason:
            parts.append(f"Impossible de la charger automatiquement ({error_reason}).")
        description = "\n".join(parts)
        return ResponseInputTextParam(type="input_text", text=description)


class DemoChatKitServer(ChatKitServer[ChatKitRequestContext]):
    """Serveur ChatKit piloté par un workflow local."""

    def __init__(
        self,
        settings: Settings,
        *,
        ags_client: AGSClientProtocol | None = None,
    ) -> None:
        workflow_service = WorkflowService(settings=settings)
        store = PostgresChatKitStore(SessionLocal, workflow_service=workflow_service)
        attachment_store = LocalAttachmentStore(
            store, default_base_url=settings.backend_public_base_url
        )
        super().__init__(store, attachment_store=attachment_store)
        self._settings = settings
        self._workflow_service = workflow_service
        self._widget_waiters = WidgetWaiterRegistry()
        self._run_workflow = _get_run_workflow()
        self._title_agent = _get_thread_title_agent()
        self._thread_item_converter = ImageAwareThreadItemConverter(
            backend_public_base_url=settings.backend_public_base_url,
            open_attachment=attachment_store.open_attachment,
        )
        self.attachment_store = attachment_store
        self._ags_client: AGSClientProtocol = ags_client or NullAGSClient()

    async def _process_streaming_impl(
        self,
        request: StreamingReq,
        context: ChatKitRequestContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        if isinstance(request, ThreadsCreateReq):
            definition = self._workflow_service.get_current()
            workflow = getattr(definition, "workflow", None)
            workflow_id = getattr(workflow, "id", None)
            if workflow_id is None:
                workflow_id = getattr(definition, "workflow_id", None)
            workflow_slug = getattr(workflow, "slug", None)
            workflow_display_name = getattr(workflow, "display_name", None)
            if workflow_slug is None:
                raise RuntimeError("Aucun slug de workflow actif n'est disponible")
            workflow_metadata = {
                "id": workflow_id,
                "slug": workflow_slug,
                "definition_id": definition.id,
                "display_name": workflow_display_name,
            }

            thread = Thread(
                id=self.store.generate_thread_id(context),
                created_at=datetime.now(),
                metadata={"workflow": workflow_metadata},
                items=Page(),
            )

            await self.store.save_thread(
                ThreadMetadata(**thread.model_dump()),
                context=context,
            )
            yield ThreadCreatedEvent(thread=self._to_thread_response(thread))

            user_message = await self._build_user_message_item(
                request.params.input,
                thread,
                context,
            )
            async for event in self._process_new_thread_item_respond(
                thread,
                user_message,
                context,
            ):
                yield event
            return

        try:
            async for event in super()._process_streaming_impl(request, context):
                yield event
        except NotFoundError as exc:
            thread_id = getattr(request, "thread_id", None)
            logger.warning(
                "Thread introuvable pour la requête en streaming : %s", thread_id, exc_info=exc
            )
            yield ErrorEvent(
                code=ErrorCode.STREAM_ERROR,
                message=str(exc),
                allow_retry=False,
            )
            return

    async def _wait_for_widget_action(
        self,
        *,
        thread: ThreadMetadata,
        step_slug: str,
        widget_item_id: str | None,
    ) -> Mapping[str, Any] | None:
        return await self._widget_waiters.wait_for_action(
            thread,
            step_slug=step_slug,
            widget_item_id=widget_item_id,
        )

    async def _signal_widget_action(
        self,
        thread_id: str,
        *,
        widget_item_id: str | None,
        widget_slug: str | None,
        payload: Mapping[str, Any] | None = None,
    ) -> bool:
        sanitized = _json_safe_copy(payload) if payload is not None else None
        return await self._widget_waiters.signal(
            thread_id,
            widget_item_id=widget_item_id,
            widget_slug=widget_slug,
            payload=sanitized,
        )

    def _resolve_auto_start_configuration(self) -> AutoStartConfiguration:
        try:
            definition = self._workflow_service.get_current()
        except Exception as exc:  # pragma: no cover - devrait rester exceptionnel
            logger.exception(
                "Impossible de vérifier l'option de démarrage automatique du workflow.",
                exc_info=exc,
            )
            return AutoStartConfiguration.disabled()

        should_auto_start = resolve_start_auto_start(definition)
        if not should_auto_start:
            return AutoStartConfiguration.disabled()

        message = resolve_start_auto_start_message(definition)
        assistant_message = resolve_start_auto_start_assistant_message(definition)
        user_text = _normalize_user_text(message) if isinstance(message, str) else ""
        assistant_text = (
            _normalize_user_text(assistant_message)
            if isinstance(assistant_message, str)
            else ""
        )

        if user_text and assistant_text:
            logger.warning(
                "Le bloc début contient simultanément un message utilisateur et un "
                "message assistant. Seul le message utilisateur sera pris en compte.",
            )
            assistant_text = ""

        return AutoStartConfiguration(True, user_text, assistant_text)

    def _ensure_stream_processor(self, thread: ThreadMetadata) -> StreamProcessor:
        """Get or create a stream processor for the given thread."""
        processor = _stream_registry.get(thread.id)
        if processor is None:
            processor = StreamProcessor(
                thread=thread,
                store=self.store,
            )
            _stream_registry[thread.id] = processor
            logger.info("Created new StreamProcessor for thread %s", thread.id)
        return processor

    async def resume_stream(
        self,
        thread: ThreadMetadata,
        context: ChatKitRequestContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        logger.info("Resuming stream for thread %s", thread.id)
        processor = _stream_registry.get(thread.id)
        if processor is None:
            logger.warning("No active stream found for thread %s", thread.id)
            return

        # Ensure processor has the latest request context for saving
        processor.update_context(context)

        queue = await processor.add_listener()
        logger.info("Attached to StreamProcessor for thread %s", thread.id)
        try:
            while True:
                event = await queue.get()
                if event is _STREAM_DONE:
                    logger.info("Resume stream done for thread %s", thread.id)
                    break
                yield event
        finally:
            await processor.remove_listener(queue)
            logger.info("Detached from StreamProcessor for thread %s", thread.id)

    async def respond(
        self,
        thread: ThreadMetadata,
        input_user_message: UserMessageItem | None,
        context: ChatKitRequestContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        logger.debug(
            "🔄 respond() called for thread %s, has_user_message: %s",
            thread.id,
            input_user_message is not None,
        )
        # Validate thread status - block messages if conversation is closed or locked
        if isinstance(thread.status, (ClosedStatus, LockedStatus)):
            status_type = getattr(thread.status, "type", "unknown")
            status_reason = getattr(thread.status, "reason", None)
            error_message = (
                f"Cette conversation est {status_type}."
                if not status_reason
                else f"Cette conversation est {status_type} : {status_reason}"
            )
            logger.info(
                "Message refusé pour le thread %s : statut=%s, raison=%s",
                thread.id,
                status_type,
                status_reason,
            )
            yield ErrorEvent(
                code=ErrorCode.STREAM_ERROR,
                message=error_message,
                allow_retry=False,
            )
            return

        thread_item_converter = self._thread_item_converter.for_context(context)

        # Start title generation in background, but keep a reference to ensure it runs
        title_task: asyncio.Task[None] | None = None
        if input_user_message is not None:
            title_task = asyncio.create_task(
                self._maybe_update_thread_title(
                    thread,
                    input_user_message,
                    context,
                    converter=thread_item_converter,
                )
            )
            title_task.add_done_callback(_log_async_exception)
        try:
            history = await self.store.load_thread_items(
                thread.id,
                after=None,
                limit=1000,
                order="asc",
                context=context,
            )
        except NotFoundError as exc:  # Should not happen in normal flow
            logger.exception("Unable to load thread %s", thread.id, exc_info=exc)
            yield ErrorEvent(
                code=ErrorCode.STREAM_ERROR,
                message=f"Thread introuvable : {thread.id}",
                allow_retry=False,
            )
            return

        user_text = _resolve_user_input_text(input_user_message, history.data)
        workflow_input: WorkflowInput | None = None
        assistant_stream_text = ""

        source_item_id = getattr(input_user_message, "id", None)

        if not user_text:
            config = self._resolve_auto_start_configuration()
            if not config.enabled:
                yield ErrorEvent(
                    code=ErrorCode.STREAM_ERROR,
                    message=(
                        "Impossible de déterminer le message utilisateur à traiter."
                    ),
                    allow_retry=False,
                )
                return

            if input_user_message is not None:
                try:
                    await self.store.delete_thread_item(
                        thread.id, input_user_message.id, context=context
                    )
                    yield ThreadItemRemovedEvent(item_id=input_user_message.id)
                except Exception as exc:  # pragma: no cover - suppression best effort
                    logger.warning(
                        "Impossible de retirer le message utilisateur initial pour le "
                        "fil %s",
                        thread.id,
                        exc_info=exc,
                    )

            logger.info("Démarrage automatique du workflow pour le fil %s", thread.id)
            user_text = _normalize_user_text(config.user_message)
            assistant_stream_text = (
                "" if user_text else _normalize_user_text(config.assistant_message)
            )

            # Allow auto-start even without configured messages
            # The workflow will simply start without displaying an initial message
            if user_text:
                workflow_input = WorkflowInput(
                    input_as_text=user_text,
                    auto_start_was_triggered=True,
                    auto_start_assistant_message=assistant_stream_text,
                    source_item_id=source_item_id,
                )
            elif assistant_stream_text:
                workflow_input = WorkflowInput(
                    input_as_text="",
                    auto_start_was_triggered=True,
                    auto_start_assistant_message=assistant_stream_text,
                    source_item_id=source_item_id,
                )
            else:
                # No message configured - start workflow silently
                workflow_input = WorkflowInput(
                    input_as_text="",
                    auto_start_was_triggered=True,
                    auto_start_assistant_message="",
                    source_item_id=source_item_id,
                )

            pre_stream_events = await self._prepare_auto_start_thread_items(
                thread=thread,
                context=context,
                user_text=user_text,
                assistant_text=assistant_stream_text,
            )
        else:
            # Capturer le model override depuis les inference_options
            model_override: str | None = None
            if input_user_message is not None:
                inference_opts = getattr(input_user_message, "inference_options", None)
                if inference_opts is not None:
                    model_override = getattr(inference_opts, "model", None)
                    if model_override:
                        logger.debug("Model override from inference_options: %s", model_override)

            workflow_input = WorkflowInput(
                input_as_text=user_text,
                auto_start_was_triggered=False,
                auto_start_assistant_message=None,
                source_item_id=source_item_id,
                model_override=model_override,
            )
            pre_stream_events = []

        agent_context = AgentContext(
            thread=thread,
            store=self.store,
            request_context=context,
        )
        thread_metadata = (
            thread.metadata if isinstance(thread.metadata, Mapping) else {}
        )
        previous_response_id = thread_metadata.get("previous_response_id")
        if isinstance(previous_response_id, str):
            agent_context.previous_response_id = previous_response_id

        # Use StreamProcessor instead of direct execution
        processor = self._ensure_stream_processor(thread)
        processor.update_context(context)

        # Start workflow within processor
        workflow_task = asyncio.create_task(
            self._execute_workflow(
                thread=thread,
                agent_context=agent_context,
                workflow_input=workflow_input,
                event_queue=processor.event_queue,
                thread_items_history=history.data,
                thread_item_converter=thread_item_converter,
                input_user_message=input_user_message,
            )
        )
        workflow_task.add_done_callback(_log_async_exception)

        # Start processor loop
        processor.start(workflow_task)

        # Send initial events
        for event in pre_stream_events:
            yield event

        if workflow_input is None:
            return

        # Attach listener to processor
        queue = await processor.add_listener()

        # Store original title to detect changes
        original_title = thread.title

        async def _stream_source():
            try:
                while True:
                    event = await queue.get()
                    if event is _STREAM_DONE:
                        break
                    yield event
            finally:
                await processor.remove_listener(queue)

        try:
            # Consume queue via _process_events to ensure persistence
            async for event in self._process_events(
                thread,
                context,
                _stream_source,
            ):
                yield event

            # Wait for title generation to complete and emit update event if title changed
            if title_task is not None:
                try:
                    await title_task
                except Exception:
                    pass  # Title generation failure is logged in _maybe_update_thread_title

                if thread.title and thread.title != original_title:
                    logger.info(
                        "🔤 Emitting ThreadUpdatedEvent for thread %s with title: %r",
                        thread.id,
                        thread.title,
                    )
                    yield ThreadUpdatedEvent(thread=self._to_thread_response(thread))
        finally:
            # _stream_source already removes listener, but just in case
            await processor.remove_listener(queue)

    def _simplify_input_for_title(
        self,
        agent_input: list[Any],
        input_item: UserMessageItem,
    ) -> str:
        """Convert file/image content to text descriptions for title generation.

        Some LLMs (like Groq) don't support input_file or input_image content types.
        Also, the agents SDK's LiteLLM model converter doesn't support the
        ResponseInputTextParam format (type="input_text").

        This method extracts text content and returns a plain string that is
        universally compatible with all model providers.
        """
        text_parts = []

        def extract_text_from_content(content: Any) -> None:
            """Extract text from content items (handles nested structures)."""
            if isinstance(content, list):
                for content_item in content:
                    extract_text_from_content(content_item)
            elif isinstance(content, dict):
                content_type = content.get("type", "")
                if content_type == "input_text":
                    text_content = content.get("text", "")
                    if text_content:
                        text_parts.append(text_content)
            elif hasattr(content, "type"):
                if getattr(content, "type", "") == "input_text":
                    text_content = getattr(content, "text", "")
                    if text_content:
                        text_parts.append(text_content)

        for item in agent_input:
            if isinstance(item, dict):
                item_type = item.get("type", "")
                if item_type == "input_text":
                    # Direct input_text at root level
                    text_content = item.get("text", "")
                    if text_content:
                        text_parts.append(text_content)
                elif "content" in item:
                    # Message with nested content (e.g., from to_agent_input)
                    extract_text_from_content(item.get("content"))
                # Skip input_file, input_image, and other binary content types
                # We'll add attachment descriptions separately
            elif hasattr(item, "type"):
                if getattr(item, "type", "") == "input_text":
                    text_content = getattr(item, "text", "")
                    if text_content:
                        text_parts.append(text_content)
                elif hasattr(item, "content"):
                    extract_text_from_content(getattr(item, "content", None))

        # Build attachment descriptions from the original message
        if hasattr(input_item, "attachments") and input_item.attachments:
            for att in input_item.attachments:
                att_name = getattr(att, "name", "fichier")
                att_type = getattr(att, "type", "file")
                mime_type = getattr(att, "mime_type", "")
                if mime_type:
                    text_parts.append(f"[Pièce jointe: {att_name} ({mime_type})]")
                else:
                    text_parts.append(f"[Pièce jointe: {att_name} ({att_type})]")

        # If no content at all, provide a fallback
        if not text_parts:
            return "Nouvelle conversation"

        return " ".join(text_parts)

    async def _maybe_update_thread_title(
        self,
        thread: ThreadMetadata,
        input_item: UserMessageItem,
        context: ChatKitRequestContext,
        *,
        converter: ThreadItemConverter | None = None,
    ) -> None:
        logger.debug(
            "🔤 _maybe_update_thread_title called for thread %s, current title: %r",
            thread.id,
            thread.title,
        )
        if thread.title:
            logger.debug("🔤 Thread %s already has a title, skipping generation", thread.id)
            return

        try:
            if converter is not None:
                agent_input = await converter.to_agent_input(input_item)
            else:
                agent_input = await simple_to_agent_input(input_item)
        except Exception as exc:  # pragma: no cover - dépend des conversions SDK
            logger.warning(
                "Impossible de convertir le message utilisateur en entrée agent "
                "pour titrage (thread=%s)",
                thread.id,
                exc_info=exc,
            )
            return

        if not agent_input:
            logger.debug("🔤 Thread %s: agent_input is empty, skipping title generation", thread.id)
            return

        # For title generation, convert to a plain string because:
        # 1. Some LLMs (like Groq) don't support input_file/input_image
        # 2. The agents SDK's LiteLLM converter doesn't handle ResponseInputTextParam
        title_input = self._simplify_input_for_title(agent_input, input_item)
        logger.debug("🔤 Thread %s: Starting title generation with input: %r", thread.id, title_input)

        metadata = {"__trace_source__": "thread-title", "thread_id": thread.id}
        try:
            metadata.update(context.trace_metadata())
        except Exception:  # pragma: no cover - robustesse best effort
            pass

        run_config_kwargs: dict[str, Any] = {"trace_metadata": metadata}
        provider_binding = getattr(
            self._title_agent, "_chatkit_provider_binding", None
        )
        if provider_binding is not None:
            run_config_kwargs["model_provider"] = provider_binding.provider

        try:
            run_config = RunConfig(**run_config_kwargs)
        except TypeError:  # pragma: no cover - compatibilité SDK
            run_config_kwargs.pop("model_provider", None)
            run_config = RunConfig(**run_config_kwargs)

        try:
            # Log for debugging
            agent_model = getattr(self._title_agent, "model", None)
            logger.info(
                "🔤 Thread %s: Title generation LLM call | model=%s | user_message=%r",
                thread.id,
                agent_model,
                title_input,
            )
            run = await Runner.run(
                self._title_agent,
                input=title_input,
                run_config=run_config,
            )
        except (
            Exception
        ) as exc:  # pragma: no cover - la génération de titre ne doit pas bloquer
            logger.warning(
                "Échec de la génération automatique du titre pour le fil %s",
                thread.id,
                exc_info=exc,
            )
            return

        raw_title = getattr(run, "final_output", "")
        if isinstance(raw_title, str):
            normalized_title = re.sub(r"\s+", " ", raw_title).strip().strip('''"'`"'"«»''')
        else:
            try:
                normalized_title = str(raw_title).strip()
            except Exception:  # pragma: no cover - conversion sécuritaire
                normalized_title = ""

        if not normalized_title:
            normalized_title = "Nouvelle conversation"

        if len(normalized_title) > 120:
            normalized_title = normalized_title[:117].rstrip() + "..."

        thread.title = normalized_title
        logger.info("🔤 Thread %s: Generated title: %r", thread.id, normalized_title)

        # Persist the thread title to the store
        try:
            await self.store.save_thread(thread, context=context)
            logger.info("🔤 Thread %s: Title saved to store successfully", thread.id)
        except Exception as exc:  # pragma: no cover - persistence best effort
            logger.warning(
                "Échec de la sauvegarde du titre pour le fil %s",
                thread.id,
                exc_info=exc,
            )

    async def action(
        self,
        thread: ThreadMetadata,
        action: Action[str, Any],
        sender: WidgetItem | None,
        context: ChatKitRequestContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        # Validate thread status - block actions if conversation is closed or locked
        if isinstance(thread.status, (ClosedStatus, LockedStatus)):
            status_type = getattr(thread.status, "type", "unknown")
            status_reason = getattr(thread.status, "reason", None)
            error_message = (
                f"Cette conversation est {status_type}."
                if not status_reason
                else f"Cette conversation est {status_type} : {status_reason}"
            )
            logger.info(
                "Action refusée pour le thread %s : statut=%s, raison=%s",
                thread.id,
                status_type,
                status_reason,
            )
            yield ErrorEvent(
                code=ErrorCode.STREAM_ERROR,
                message=error_message,
                allow_retry=False,
            )
            return

        # Handle continue_workflow action - continue workflow from wait state
        if action.type == "continue_workflow":
            async for event in self._process_events(
                thread,
                context,
                lambda: self._handle_continue_workflow(thread, context),
            ):
                yield event
            return

        payload = action.payload if isinstance(action.payload, Mapping) else None
        if payload is None:
            logger.warning(
                "Action %s ignorée pour le fil %s : charge utile invalide.",
                action.type,
                thread.id,
            )
            if False:  # pragma: no cover - satisfait l'interface AsyncIterator
                yield None
            return

        logger.info(
            "Action de widget reçue : type=%s, thread=%s, sender=%s, payload_keys=%s",
            action.type,
            thread.id,
            sender.id if sender else None,
            list(payload.keys()) if payload else [],
        )

        def _build_widget_item(data: Mapping[str, Any]) -> WidgetItem:
            validator = getattr(WidgetItem, "model_validate", None)
            if callable(validator):
                return validator(data)
            return WidgetItem.parse_obj(data)  # type: ignore[attr-defined]

        slug, definition_override, values, manual_bindings, copy_text_update = (
            _resolve_widget_action_payload(payload)
        )

        logger.debug(
            "Payload résolu : slug=%s, values=%s, bindings=%s, has_definition=%s",
            slug,
            values,
            list(manual_bindings.keys()) if manual_bindings else [],
            definition_override is not None,
        )

        definition = definition_override
        if definition is None and slug:
            definition = _load_widget_definition(slug, context=f"action {action.type}")

        if definition is None and sender is not None:
            try:
                sender_widget_payload = WidgetLibraryService._dump_widget(sender.widget)
            except Exception as exc:  # pragma: no cover - protection supplémentaire
                logger.debug(
                    "Impossible d'utiliser le widget émetteur %s pour l'action %s : %s",
                    sender.id,
                    action.type,
                    exc,
                )
            else:
                definition = _clone_widget_definition(sender_widget_payload)

        if definition is None:
            logger.warning(
                "Impossible de traiter l'action %s : aucun widget spécifié.",
                action.type,
            )
            if False:  # pragma: no cover - satisfait l'interface AsyncIterator
                yield None
            return

        bindings = _collect_widget_bindings(definition)
        if manual_bindings:
            bindings.update(manual_bindings)

        matched_identifiers: set[str] = set()

        if values:
            matched = _apply_widget_variable_values(
                definition, values, bindings=bindings
            )
            missing = set(values) - matched
            if missing:
                logger.warning(
                    "Variables de widget non appliquées après l'action %s : %s",
                    action.type,
                    ", ".join(sorted(missing)),
                )
            matched_identifiers = matched
            logger.debug(
                "Variables appliquées : matched=%s, missing=%s",
                sorted(matched),
                sorted(missing) if missing else [],
            )

        try:
            widget_root = WidgetLibraryService._validate_widget(definition)
        except Exception as exc:  # pragma: no cover - dépend du SDK installé
            logger.exception(
                "Widget invalide après traitement de l'action %s",
                action.type,
                exc_info=exc,
            )
            if False:  # pragma: no cover - satisfait l'interface AsyncIterator
                yield None
            return

        copy_text_value = copy_text_update

        action_context: dict[str, Any] = {"type": action.type}
        if slug:
            action_context["widget"] = slug
        if payload is not None:
            action_context["raw_payload"] = _json_safe_copy(payload)
        if values:
            action_context["values"] = _json_safe_copy(values)
        if matched_identifiers:
            action_context["applied_variables"] = sorted(matched_identifiers)
        if manual_bindings:
            action_context["bindings"] = {
                identifier: {
                    "path": list(binding.path),
                    "component_type": binding.component_type,
                    "sample": binding.sample,
                }
                for identifier, binding in manual_bindings.items()
            }
        if copy_text_value is not _UNSET:
            action_context["copy_text"] = copy_text_value

        if sender is not None:
            if hasattr(sender, "model_dump"):
                sender_payload = sender.model_dump()
            else:  # pragma: no cover - compatibilité Pydantic v1
                sender_payload = sender.dict()  # type: ignore[attr-defined]
            sender_payload["widget"] = widget_root
            if copy_text_value is not _UNSET:
                sender_payload["copy_text"] = copy_text_value
            else:
                sender_payload.setdefault("copy_text", sender_payload.get("copy_text"))

            updated_item = _build_widget_item(sender_payload)
            action_context["widget_item_id"] = updated_item.id
            try:
                await self.store.save_item(thread.id, updated_item, context=context)
            except Exception as exc:  # pragma: no cover - dépend du stockage
                logger.exception(
                    "Impossible d'enregistrer le widget %s après l'action %s",
                    sender.id,
                    action.type,
                    exc_info=exc,
                )
                if False:  # pragma: no cover - satisfait l'interface AsyncIterator
                    yield None
                return

            logger.debug(
                "Signalement de l'action au workflow : action_context=%s",
                action_context,
            )

            await self._signal_widget_action(
                thread.id,
                widget_item_id=updated_item.id,
                widget_slug=slug,
                payload=action_context,
            )

            logger.info(
                "Action de widget traitée avec succès : type=%s, widget_id=%s, slug=%s",
                action.type,
                updated_item.id,
                slug,
            )

            yield ThreadItemUpdated(
                item_id=updated_item.id,
                update=WidgetRootUpdated(widget=widget_root),
            )
            return

        item_id = self.store.generate_item_id("widget", thread, context)
        created_at = datetime.now()
        widget_kwargs: dict[str, Any] = {
            "id": item_id,
            "thread_id": thread.id,
            "created_at": created_at,
            "widget": widget_root,
        }
        if copy_text_value is not _UNSET:
            widget_kwargs["copy_text"] = copy_text_value

        new_item = _build_widget_item(widget_kwargs)
        action_context["widget_item_id"] = new_item.id

        try:
            await self.store.add_thread_item(thread.id, new_item, context=context)
        except Exception as exc:  # pragma: no cover - dépend du stockage
            logger.exception(
                "Impossible d'ajouter un widget suite à l'action %s",
                action.type,
                exc_info=exc,
            )
            if False:  # pragma: no cover - satisfait l'interface AsyncIterator
                yield None
            return

        logger.debug(
            "Signalement de l'action au workflow : action_context=%s",
            action_context,
        )

        await self._signal_widget_action(
            thread.id,
            widget_item_id=new_item.id,
            widget_slug=slug,
            payload=action_context,
        )

        logger.info(
            "Action de widget traitée avec succès (nouveau widget) : type=%s, widget_id=%s, slug=%s",
            action.type,
            new_item.id,
            slug,
        )

        yield ThreadItemDoneEvent(item=new_item)

    async def _handle_continue_workflow(
        self,
        thread: ThreadMetadata,
        context: ChatKitRequestContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        """Handle continue_workflow action - capture screenshot, close browser, continue workflow.

        This is called when the user clicks "Terminer la session" on a computer_use step.
        It performs the cleanup that would normally happen when resuming from a wait state,
        then continues the workflow to the next step.
        """
        from ..tool_builders.computer_use import get_thread_browsers, cleanup_browser_cache
        from chatkit.agents import AgentContext

        logger.info("Handling continue_workflow action for thread %s", thread.id)

        # Get wait state (may be None for agent mode)
        wait_state = _get_wait_state_metadata(thread)
        next_step_slug = None

        if wait_state:
            wait_type = wait_state.get("wait_type")
            if wait_type != "computer_use":
                logger.warning(
                    "Wait state type is %s, not computer_use for thread %s",
                    wait_type,
                    thread.id,
                )
                return

            next_step_slug = wait_state.get("next_step_slug")
            logger.info(
                "Continue workflow: wait_type=%s, next_step_slug=%s",
                wait_type,
                next_step_slug,
            )
        else:
            # No wait state (agent mode) - just capture screenshot and clean up
            logger.info("No wait state (agent mode) - capturing screenshot and cleaning up")

        # Get cached browsers for this thread
        browsers = get_thread_browsers(thread.id)
        data_url: str | None = None

        if browsers:
            # Capture screenshot from first browser and close all
            for cache_key, browser in list(browsers.items()):
                try:
                    if data_url is None:
                        logger.info("Capturing final screenshot from browser %s", cache_key)
                        data_url = await browser.screenshot()
                        logger.info(
                            "Screenshot captured, length: %d",
                            len(data_url) if data_url else 0,
                        )

                    logger.info("Closing browser %s", cache_key)
                    try:
                        # Add timeout to browser.close() to prevent hanging
                        await asyncio.wait_for(browser.close(), timeout=5.0)
                        logger.info("Browser %s closed successfully", cache_key)
                    except asyncio.TimeoutError:
                        logger.warning("Browser %s close timed out after 5s, continuing anyway", cache_key)
                    except Exception as close_error:
                        logger.warning("Browser %s close failed: %s, continuing anyway", cache_key, close_error)
                except Exception as e:
                    logger.error("Error with browser %s: %s", cache_key, e)

            # Clean up browser cache for this thread
            logger.info("Cleaning up browser cache for thread %s", thread.id)
            cleanup_browser_cache(thread.id)
            logger.info("Browser cache cleaned up")

        # Create agent context for generating IDs
        agent_context = AgentContext(
            thread=thread,
            store=self.store,
            request_context=context,
        )

        # Find the existing workflow and add screenshot as ImageTask
        if data_url:
            logger.info("Adding screenshot ImageTask to existing workflow")
            from datetime import datetime

            # Load thread items to find the ComputerUseTask workflow
            thread_items = await self.store.load_thread_items(
                thread.id, after=None, limit=100, order="desc", context=context
            )

            # Find the workflow item with a ComputerUseTask
            computer_use_item: WorkflowItem | None = None
            computer_use_task_index: int = -1

            for item in thread_items.data:
                if item.type == "workflow":
                    workflow_item = item
                    for idx, task in enumerate(workflow_item.workflow.tasks):
                        if isinstance(task, ComputerUseTask) or (hasattr(task, "type") and task.type == "computer_use"):
                            computer_use_item = workflow_item
                            computer_use_task_index = idx
                            break
                    if computer_use_item:
                        break

            if computer_use_item and computer_use_task_index >= 0:
                # Get the existing ComputerUseTask
                existing_task = computer_use_item.workflow.tasks[computer_use_task_index]

                # Check if this is an SSH session (no screenshot needed)
                is_ssh_session = hasattr(existing_task, "ssh_token") and existing_task.ssh_token

                # 1. Update ComputerUseTask to complete status
                updated_computer_task = ComputerUseTask(
                    type="computer_use",
                    title=existing_task.title if hasattr(existing_task, "title") else "Session Computer Use",
                    status_indicator="complete",
                    debug_url_token=None,  # Clear the token
                    ssh_token=None,  # Clear SSH token too
                    vnc_token=None,  # Clear VNC token too
                    current_action="Session terminée",
                )
                computer_use_item.workflow.tasks[computer_use_task_index] = updated_computer_task
                logger.info("ComputerUseTask marked as complete")

                # 2. Create and add ImageTask with the screenshot (skip for SSH sessions)
                if not is_ssh_session and data_url:
                    image_id = f"img_{uuid.uuid4().hex[:8]}"

                    # Keep data_url as-is - the store will extract it automatically
                    generated_image = GeneratedImage(
                        id=image_id,
                        data_url=data_url,
                    )

                    image_task = ImageTask(
                        type="image",
                        title="Screenshot finale",
                        images=[generated_image],
                        status_indicator="complete",
                    )

                    # Add to workflow tasks
                    computer_use_item.workflow.tasks.append(image_task)
                    logger.info("ImageTask added to workflow")
                else:
                    logger.info("Skipping screenshot - SSH session or no data_url")

                # Set duration summary and collapse workflow
                try:
                    if isinstance(computer_use_item.created_at, str):
                        from dateutil import parser
                        created_at = parser.parse(computer_use_item.created_at)
                    else:
                        created_at = computer_use_item.created_at

                    # Make both datetimes timezone-naive for comparison
                    now = datetime.now()
                    if hasattr(created_at, 'tzinfo') and created_at.tzinfo is not None:
                        created_at = created_at.replace(tzinfo=None)

                    delta = now - created_at
                    duration = max(1, int(delta.total_seconds()))
                except Exception as e:
                    logger.warning("Could not calculate duration: %s, using default", e)
                    duration = 1

                computer_use_item.workflow.summary = DurationSummary(duration=duration)
                computer_use_item.workflow.expanded = False
                logger.info("Setting workflow summary: duration=%ds, expanded=%s", duration, computer_use_item.workflow.expanded)

                # Save to store
                await self.store.add_thread_item(thread.id, computer_use_item, context=context)

                # Emit done event with full updated item
                logger.info("Emitting ThreadItemDoneEvent with summary=%s", computer_use_item.workflow.summary)
                yield ThreadItemDoneEvent(item=computer_use_item)
                # Allow event loop to flush the event before continuing
                await asyncio.sleep(0)
                logger.info("Workflow completed with screenshot, duration=%ds", duration)
            else:
                logger.warning("Could not find ComputerUseTask workflow to add screenshot")

        # Clear wait state (only if it exists - manual mode)
        if wait_state:
            logger.info(">>> Clearing wait state for thread %s", thread.id)
            _set_wait_state_metadata(thread, None)
            await self.store.save_thread(thread, context=context)

        # Continue workflow to next step if there is one (manual mode only)
        if not next_step_slug:
            logger.info("No next step or agent mode, workflow complete for thread %s", thread.id)
            return

        logger.info(">>> Continuing workflow to: %s", next_step_slug)

        # Reload thread history in ascending order for workflow execution
        history_asc = await self.store.load_thread_items(
            thread.id,
            after=None,
            limit=1000,
            order="asc",
            context=context,
        )

        # Create workflow input for continuation
        from ..workflows.executor import WorkflowInput, WorkflowRuntimeSnapshot

        # Get saved state from wait_state
        saved_state = wait_state.get("state", {})
        conversation_history = wait_state.get("conversation_history", [])

        # Create runtime snapshot with explicit current_slug
        runtime_snapshot = WorkflowRuntimeSnapshot(
            state=saved_state if isinstance(saved_state, dict) else {},
            conversation_history=conversation_history,
            last_step_context={"computer_use_completed": True},
            steps=[],
            current_slug=next_step_slug,
        )
        logger.info(">>> Created runtime_snapshot with current_slug=%s", next_step_slug)

        workflow_input = WorkflowInput(
            input_as_text="",
            auto_start_was_triggered=False,
            auto_start_assistant_message=None,
            source_item_id=None,
            model_override=None,
        )

        event_queue: asyncio.Queue[Any] = asyncio.Queue()

        # Execute workflow continuation
        workflow_task = asyncio.create_task(
            self._execute_workflow(
                thread=thread,
                agent_context=agent_context,
                workflow_input=workflow_input,
                event_queue=event_queue,
                thread_items_history=history_asc.data,
                thread_item_converter=self._thread_item_converter,
                input_user_message=None,
                runtime_snapshot=runtime_snapshot,
            )
        )

        # Stream events from the workflow
        while True:
            try:
                event = await asyncio.wait_for(event_queue.get(), timeout=0.1)
                if event is _STREAM_DONE:
                    break
                yield event
            except asyncio.TimeoutError:
                if workflow_task.done():
                    # Drain remaining events
                    while not event_queue.empty():
                        event = event_queue.get_nowait()
                        if event is _STREAM_DONE:
                            break
                        yield event
                    break

        # Wait for workflow task to complete
        try:
            await workflow_task
        except Exception as e:
            logger.error("Workflow execution failed: %s", e)

        logger.info("Continue workflow completed for thread %s", thread.id)

    async def _execute_workflow(
        self,
        *,
        thread: ThreadMetadata,
        agent_context: AgentContext[ChatKitRequestContext],
        workflow_input: WorkflowInput,
        event_queue: asyncio.Queue[Any],
        thread_items_history: list[ThreadItem] | None = None,
        thread_item_converter: ThreadItemConverter | None = None,
        input_user_message: UserMessageItem | None = None,
        runtime_snapshot: Any = None,
    ) -> None:
        streamed_step_keys: set[str] = set()
        step_progress_text: dict[str, str] = {}
        step_progress_headers: dict[str, str] = {}
        most_recent_widget_item_id: str | None = None

        # Set thread_id in context for browser caching
        from ..tool_builders.computer_use import set_current_thread_id
        import asyncio
        current_task = asyncio.current_task()
        logger.info(
            f"🎯 DÉBUT WORKFLOW: thread_id={thread.id}, task_id={id(current_task) if current_task else 'N/A'}"
        )
        set_current_thread_id(thread.id)

        # Generate thread title if needed (for new threads in workflows)
        if input_user_message is not None:
            title_task = asyncio.create_task(
                self._maybe_update_thread_title(
                    thread,
                    input_user_message,
                    agent_context.request_context,
                    converter=thread_item_converter,
                )
            )
            title_task.add_done_callback(_log_async_exception)

        try:
            logger.info("Démarrage du workflow pour le fil %s", thread.id)

            async def on_step(step_summary: WorkflowStepSummary, index: int) -> None:
                streamed_step_keys.add(step_summary.key)
                step_progress_text.pop(step_summary.key, None)
                header = step_progress_headers.pop(step_summary.key, None)
                if header:
                    await on_stream_event(
                        ProgressUpdateEvent(text=f"{header}\n\nTerminé.")
                    )
                    await on_stream_event(ProgressUpdateEvent(text=""))

            async def on_stream_event(event: ThreadStreamEvent) -> None:
                nonlocal most_recent_widget_item_id
                if isinstance(event, ThreadItemDoneEvent) and isinstance(
                    getattr(event, "item", None), WidgetItem
                ):
                    most_recent_widget_item_id = event.item.id
                elif isinstance(event, ThreadItemUpdated) and isinstance(
                    event.update, WidgetRootUpdated
                ):
                    most_recent_widget_item_id = event.item_id
                await event_queue.put(event)

            async def on_step_stream(
                update: WorkflowStepStreamUpdate,
            ) -> None:
                header = f"{update.title}"

                # Persist current step to metadata if it changed
                current_step_slug = update.key
                current_step_title = update.title

                # IMPORTANT: Read current metadata from thread each time to avoid
                # overwriting changes made by other code (e.g., wait state clearing).
                # We only update the workflow.current_step field, not the entire metadata.
                current_metadata = (
                    thread.metadata if isinstance(thread.metadata, Mapping) else {}
                )

                # Check if we need to update metadata
                workflow_meta = current_metadata.get("workflow", {})
                stored_step = workflow_meta.get("current_step", {})
                stored_slug = stored_step.get("slug")

                if stored_slug != current_step_slug:
                    # Update workflow.current_step in the current metadata
                    if "workflow" not in current_metadata:
                        if isinstance(thread.metadata, dict):
                            thread.metadata["workflow"] = {}
                        else:
                            thread.metadata = {"workflow": {}}

                    # Ensure workflow metadata has basic info if missing
                    if not thread.metadata.get("workflow", {}).get("id") and workflow_slug:
                         thread.metadata["workflow"]["slug"] = workflow_slug

                    thread.metadata["workflow"]["current_step"] = {
                        "slug": current_step_slug,
                        "title": current_step_title,
                        "started_at": datetime.now().isoformat(),
                    }

                    # Persist thread
                    try:
                        await self.store.save_thread(thread, context=agent_context.request_context)
                    except Exception:
                        logger.warning(
                            "Failed to persist current step %s for thread %s",
                            current_step_slug,
                            thread.id,
                            exc_info=True
                        )

                waiting_text = step_progress_text.get(update.key)
                if waiting_text is None:
                    waiting_text = f"{header}\n\n..."
                    step_progress_text[update.key] = waiting_text
                    step_progress_headers[update.key] = header
                    await on_stream_event(ProgressUpdateEvent(text=waiting_text))

                if not update.text.strip():
                    return

            async def on_widget_step(
                step: WorkflowStep,
                config: _ResponseWidgetConfig,
            ) -> Mapping[str, Any] | None:
                return await self._wait_for_widget_action(
                    thread=thread,
                    step_slug=step.slug,
                    widget_item_id=most_recent_widget_item_id,
                )

            converter = thread_item_converter or self._thread_item_converter

            workflow_slug: str | None = None
            workflow_definition = None
            thread_metadata = (
                thread.metadata if isinstance(thread.metadata, Mapping) else {}
            )
            if isinstance(thread_metadata, Mapping):
                workflow_info = thread_metadata.get("workflow")
                if isinstance(workflow_info, Mapping):
                    raw_slug = workflow_info.get("slug")
                    if isinstance(raw_slug, str):
                        candidate = raw_slug.strip()
                        if candidate:
                            workflow_slug = candidate

            if workflow_slug is None:
                workflow_definition = self._workflow_service.get_current()

            summary = await self._run_workflow(
                workflow_input,
                agent_context=agent_context,
                on_step=on_step,
                on_step_stream=on_step_stream,
                on_stream_event=on_stream_event,
                on_widget_step=on_widget_step,
                workflow_service=self._workflow_service,
                workflow_definition=workflow_definition,
                workflow_slug=workflow_slug,
                thread_item_converter=converter,
                thread_items_history=thread_items_history,
                current_user_message=input_user_message,
                runtime_snapshot=runtime_snapshot,
            )

            end_state = summary.end_state
            applied_status = False
            cleaned_reason: str | None = None
            waiting_state = False
            if end_state is not None:
                await process_workflow_end_state_ags(
                    client=self._ags_client,
                    end_state=end_state,
                    context=getattr(agent_context, "request_context", None),
                )
                status_type_raw = (end_state.status_type or "closed").strip().lower()
                cleaned_reason = (
                    (end_state.status_reason or end_state.message) or ""
                ).strip() or None
                status_reason = cleaned_reason

                if status_type_raw in {"", "closed"}:
                    thread.status = ClosedStatus(reason=status_reason)
                    applied_status = True
                elif status_type_raw == "locked":
                    thread.status = LockedStatus(reason=status_reason)
                    applied_status = True
                elif status_type_raw == "waiting":
                    thread.status = ActiveStatus()
                    waiting_state = True
                    applied_status = True
                elif status_type_raw == "active":
                    thread.status = ActiveStatus()
                    applied_status = True
                else:
                    logger.warning(
                        "Type de statut inconnu '%s' pour le nœud de fin %s, "
                        "fermeture par défaut.",
                        status_type_raw,
                        end_state.slug,
                    )
                    thread.status = ClosedStatus(reason=status_reason)
                    applied_status = True

            await on_stream_event(
                EndOfTurnItem(
                    id=self.store.generate_item_id(
                        "message", thread, agent_context.request_context
                    ),
                    thread_id=thread.id,
                    created_at=datetime.now(),
                )
            )
            if end_state is not None:
                if waiting_state:
                    logger.info(
                        "Workflow en attente pour le fil %s via le nœud %s "
                        "(statut=%s, raison=%s)",
                        thread.id,
                        end_state.slug,
                        (
                            getattr(thread.status, "type", "inconnu")
                            if applied_status
                            else "inconnu"
                        ),
                        cleaned_reason or "<aucune>",
                    )
                else:
                    logger.info(
                        "Workflow terminé pour le fil %s via le nœud %s (statut=%s, "
                        "raison=%s)",
                        thread.id,
                        end_state.slug,
                        (
                            getattr(thread.status, "type", "inconnu")
                            if applied_status
                            else "inconnu"
                        ),
                        cleaned_reason or "<aucune>",
                    )
            else:
                logger.info(
                    "Workflow terminé pour le fil %s sans bloc de fin (nœud final: %s)",
                    thread.id,
                    summary.final_node_slug,
                )
        except (
            WorkflowExecutionError
        ) as exc:  # pragma: no cover - erreurs connues du workflow
            logger.exception("Workflow execution failed")
            error_message = (
                f"Le workflow a échoué pendant l'étape « {exc.title} » ({exc.step}). "
                f"Détails techniques : {exc.original_error}"
            )
            await on_stream_event(
                ErrorEvent(
                    code=ErrorCode.STREAM_ERROR,
                    message=error_message,
                    allow_retry=True,
                )
            )
            logger.info(
                "Workflow en erreur pour le fil %s pendant %s", thread.id, exc.step
            )
        except Exception as exc:  # pragma: no cover - autres erreurs runtime
            logger.exception("Workflow execution failed")
            detailed_message = f"Erreur inattendue ({exc.__class__.__name__}) : {exc}"
            await on_stream_event(
                ErrorEvent(
                    code=ErrorCode.STREAM_ERROR,
                    message=detailed_message,
                    allow_retry=True,
                )
            )
            logger.info("Workflow en erreur inattendue pour le fil %s", thread.id)
        finally:
            event_queue.put_nowait(_STREAM_DONE)

    async def _prepare_auto_start_thread_items(
        self,
        *,
        thread: ThreadMetadata,
        context: ChatKitRequestContext,
        user_text: str,
        assistant_text: str,
    ) -> list[ThreadStreamEvent]:
        """Ajoute les messages auto-initialisés au fil et prépare les événements."""

        events: list[ThreadStreamEvent] = []

        if user_text:
            user_input = UserMessageInput(
                content=[UserMessageTextContent(text=user_text)],
                attachments=[],
                quoted_text=None,
                inference_options=InferenceOptions(),
            )
            user_item = await self._build_user_message_item(user_input, thread, context)
            events.append(ThreadItemAddedEvent(item=user_item))
            events.append(ThreadItemDoneEvent(item=user_item))

        if assistant_text:
            assistant_item = AssistantMessageItem(
                id=self.store.generate_item_id("message", thread, context),
                thread_id=thread.id,
                created_at=datetime.now(),
                content=[AssistantMessageContent(text=assistant_text)],
            )
            events.append(ThreadItemAddedEvent(item=assistant_item))
            events.append(ThreadItemDoneEvent(item=assistant_item))

        return events
