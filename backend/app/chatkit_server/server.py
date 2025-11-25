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
    ComputerUseTask,
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
    ThreadItemUpdated,
    ThreadMetadata,
    ThreadsCreateReq,
    ThreadStreamEvent,
    UserMessageInput,
    UserMessageItem,
    UserMessageTextContent,
    WidgetItem,
    WidgetRootUpdated,
    Workflow,
    WorkflowItem,
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

        if self._open_attachment is None or self._request_context is None:
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
            return ResponseInputImageParam(
                type="input_image",
                detail="auto",
                image_url=data_url,
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
            if workflow_slug is None:
                raise RuntimeError("Aucun slug de workflow actif n'est disponible")
            workflow_metadata = {
                "id": workflow_id,
                "slug": workflow_slug,
                "definition_id": definition.id,
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

    async def respond(
        self,
        thread: ThreadMetadata,
        input_user_message: UserMessageItem | None,
        context: ChatKitRequestContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
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

        event_queue: asyncio.Queue[Any] = asyncio.Queue()

        for event in pre_stream_events:
            yield event

        if workflow_input is None:
            return

        workflow_result = _WorkflowStreamResult(
            runner=self._execute_workflow(
                thread=thread,
                agent_context=agent_context,
                workflow_input=workflow_input,
                event_queue=event_queue,
                thread_items_history=history.data,
                thread_item_converter=thread_item_converter,
                input_user_message=input_user_message,
            ),
            event_queue=event_queue,
        )

        async def _workflow_stream() -> AsyncIterator[ThreadStreamEvent]:
            async for event in workflow_result.stream_events():
                yield event

        drain_started = False

        async def _drain_remaining_events() -> None:
            try:
                logger.debug(
                    "Poursuite du flux du workflow %s après annulation", thread.id
                )
                async for _ in self._process_events(
                    thread,
                    context,
                    lambda: _workflow_stream(),
                ):
                    pass
                try:
                    await self.store.save_thread(thread, context=context)
                except Exception:  # pragma: no cover - best effort persistence
                    logger.warning(
                        "Impossible d'enregistrer l'état final du fil %s (annulation)",
                        thread.id,
                        exc_info=True,
                    )
                logger.debug(
                    "Flux du workflow %s terminé en arrière-plan (statut=%s)",
                    thread.id,
                    getattr(getattr(thread, "status", None), "type", None),
                )
            except Exception:  # pragma: no cover - robustesse best effort
                logger.warning(
                    "Échec lors de la poursuite du workflow en tâche de fond",
                    exc_info=True,
                )

        def _schedule_background_drain() -> None:
            nonlocal drain_started
            if drain_started:
                return
            drain_started = True
            background_task = asyncio.create_task(_drain_remaining_events())
            background_task.add_done_callback(_log_async_exception)

        stream_completed = False
        try:
            async for event in _workflow_stream():
                yield event
            stream_completed = True
        finally:
            if not stream_completed:
                _schedule_background_drain()

    async def _maybe_update_thread_title(
        self,
        thread: ThreadMetadata,
        input_item: UserMessageItem,
        context: ChatKitRequestContext,
        *,
        converter: ThreadItemConverter | None = None,
    ) -> None:
        if thread.title:
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
            return

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
            run = await Runner.run(
                self._title_agent,
                input=agent_input,
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
            normalized_title = re.sub(r"\s+", " ", raw_title).strip().strip("\"'`”’“«»")
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
            async for event in self._handle_continue_workflow(thread, context):
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

        # Get wait state
        wait_state = _get_wait_state_metadata(thread)
        if not wait_state:
            logger.warning("No wait state found for thread %s", thread.id)
            return

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

        # Load thread history to find the existing ComputerUseTask
        history = await self.store.load_thread_items(
            thread.id,
            after=None,
            limit=1000,
            order="desc",  # Most recent first
            context=context,
        )

        # Find the WorkflowItem with the ComputerUseTask in "loading" state
        existing_workflow_item: WorkflowItem | None = None
        existing_task_index: int | None = None
        for item in history.data:
            if isinstance(item, WorkflowItem) and item.workflow and item.workflow.tasks:
                for idx, task in enumerate(item.workflow.tasks):
                    if hasattr(task, 'type') and task.type == 'computer_use':
                        if hasattr(task, 'status_indicator') and task.status_indicator == 'loading':
                            existing_workflow_item = item
                            existing_task_index = idx
                            logger.info(
                                "Found existing ComputerUseTask in WorkflowItem %s at index %d",
                                item.id,
                                existing_task_index,
                            )
                            break
                if existing_workflow_item:
                    break

        if existing_workflow_item is not None and existing_task_index is not None:
            # Build updated tasks list
            updated_tasks = list(existing_workflow_item.workflow.tasks) if existing_workflow_item.workflow else []

            # Get the original task and update only status_indicator
            if existing_task_index < len(updated_tasks):
                original_task = updated_tasks[existing_task_index]
                # Create updated task preserving original content but changing status
                if hasattr(original_task, 'model_dump'):
                    task_data = original_task.model_dump()
                    task_data['status_indicator'] = 'complete'
                    task_data['debug_url_token'] = None  # Clear debug URL since browser is closed
                    completed_computer_task = ComputerUseTask(**task_data)
                else:
                    completed_computer_task = ComputerUseTask(
                        type="computer_use",
                        status_indicator="complete",
                        debug_url_token=None,
                        title="Session Computer Use terminée",
                    )
                updated_tasks[existing_task_index] = completed_computer_task
            else:
                completed_computer_task = ComputerUseTask(
                    type="computer_use",
                    status_indicator="complete",
                    debug_url_token=None,
                    title="Session Computer Use terminée",
                )
                updated_tasks.append(completed_computer_task)

            # Add ImageTask if screenshot available
            image_task = None
            if data_url:
                logger.info(">>> Adding ImageTask with screenshot")
                image_id = f"img_{uuid.uuid4().hex[:8]}"
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
                updated_tasks.append(image_task)

            # Create updated workflow with new tasks
            updated_workflow = Workflow(
                type=existing_workflow_item.workflow.type if existing_workflow_item.workflow else "custom",
                tasks=updated_tasks,
                expanded=True,
            )

            # Create updated WorkflowItem
            updated_workflow_item = WorkflowItem(
                id=existing_workflow_item.id,
                thread_id=existing_workflow_item.thread_id,
                created_at=existing_workflow_item.created_at,
                workflow=updated_workflow,
            )

            # Emit as ThreadItemAddedEvent (replaces existing) and ThreadItemDoneEvent
            logger.info(">>> Emitting updated WorkflowItem with completed task and screenshot")
            yield ThreadItemAddedEvent(item=updated_workflow_item)
            yield ThreadItemDoneEvent(item=updated_workflow_item)
            logger.info(">>> Updated WorkflowItem emitted")
        else:
            # Create a new WorkflowItem if not found (fallback)
            logger.info("Creating new ComputerUseTask with status=complete (no existing task found)")

            fallback_computer_task = ComputerUseTask(
                type="computer_use",
                status_indicator="complete",
                debug_url_token=None,
                title="Session Computer Use terminée",
            )
            tasks_list = [fallback_computer_task]

            # Add screenshot if available
            if data_url:
                image_id = f"img_{uuid.uuid4().hex[:8]}"
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
                tasks_list.append(image_task)

            completed_workflow = Workflow(
                type="custom",
                tasks=tasks_list,
                expanded=True,
            )

            completed_workflow_item = WorkflowItem(
                id=agent_context.generate_id("workflow"),
                thread_id=thread.id,
                created_at=datetime.now(),
                workflow=completed_workflow,
            )

            yield ThreadItemAddedEvent(item=completed_workflow_item)
            yield ThreadItemDoneEvent(item=completed_workflow_item)

        # Clear wait state
        logger.info(">>> Clearing wait state for thread %s", thread.id)
        _set_wait_state_metadata(thread, None)
        await self.store.save_thread(thread, context=context)

        # Verify wait state is cleared
        verify_wait_state = _get_wait_state_metadata(thread)
        logger.info(">>> Wait state after clearing: %s", verify_wait_state)

        # Continue workflow to next step (or start node if no next_step_slug)
        logger.info(">>> Starting workflow continuation to: %s", next_step_slug or "(start node)")

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

        # Find the target slug - either next_step_slug or the start node
        target_slug = next_step_slug
        if not target_slug:
            # Find the start node
            try:
                definition = self._workflow_service.get_current()
                for step in definition.steps:
                    if step.kind == "start" and step.is_enabled:
                        target_slug = step.slug
                        logger.info(">>> Found start node: %s", target_slug)
                        break
            except Exception as e:
                logger.warning("Could not find start node: %s", e)

        if not target_slug:
            logger.error("No target slug found for workflow continuation")
            return

        # Create runtime snapshot with explicit current_slug
        runtime_snapshot = WorkflowRuntimeSnapshot(
            state=saved_state if isinstance(saved_state, dict) else {},
            conversation_history=conversation_history,
            last_step_context={"computer_use_completed": True},
            steps=[],
            current_slug=target_slug,
        )
        logger.info(">>> Created runtime_snapshot with current_slug=%s", target_slug)

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
                
                # Check if we need to update metadata
                workflow_meta = thread_metadata.get("workflow", {})
                stored_step = workflow_meta.get("current_step", {})
                stored_slug = stored_step.get("slug")
                
                if stored_slug != current_step_slug:
                    # Update metadata
                    if "workflow" not in thread_metadata:
                        thread_metadata["workflow"] = {}
                    
                    # Ensure workflow metadata has basic info if missing
                    if not thread_metadata["workflow"].get("id") and workflow_slug:
                         thread_metadata["workflow"]["slug"] = workflow_slug

                    thread_metadata["workflow"]["current_step"] = {
                        "slug": current_step_slug,
                        "title": current_step_title,
                        "started_at": datetime.now().isoformat(),
                    }
                    
                    # Persist thread
                    try:
                        # We need to update the thread object's metadata field
                        thread.metadata = thread_metadata
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
