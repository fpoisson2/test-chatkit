"""Serveur ChatKit et convertisseurs associés."""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime
from typing import Any, AsyncIterator, Mapping, Sequence

from agents import Agent, RunConfig, Runner
from chatkit.actions import Action
from chatkit.agents import (
    AgentContext,
    ThreadItemConverter,
    TResponseInputItem,
    simple_to_agent_input,
    stream_agent_response,
)
from chatkit.server import ChatKitServer
from chatkit.store import NotFoundError
from chatkit.types import (
    ActiveStatus,
    AssistantMessageContent,
    AssistantMessageItem,
    ClosedStatus,
    EndOfTurnItem,
    ErrorCode,
    ErrorEvent,
    GeneratedImage,
    ImageTask,
    InferenceOptions,
    LockedStatus,
    ProgressUpdateEvent,
    TaskItem,
    ThreadItem,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    ThreadItemRemovedEvent,
    ThreadItemUpdated,
    ThreadMetadata,
    ThreadStreamEvent,
    WidgetItem,
    WidgetRootUpdated,
    WorkflowItem,
    WorkflowTaskAdded,
    WorkflowTaskUpdated,
    UserMessageInput,
    UserMessageItem,
    UserMessageTextContent,
)
from openai.types.responses import ResponseInputImageParam, ResponseInputTextParam
from openai.types.responses.response_input_item_param import Message

from backend.app.attachment_store import LocalAttachmentStore
from backend.app.chatkit_store import PostgresChatKitStore
from backend.app.config import Settings
from backend.app.database import SessionLocal
from backend.app.workflows import (
    DEFAULT_END_MESSAGE,
    WorkflowService,
    resolve_start_auto_start,
    resolve_start_auto_start_assistant_message,
    resolve_start_auto_start_message,
)
from backend.app.widgets import WidgetLibraryService

from backend.app.chatkit_server.actions import (
    _UNSET,
    _apply_widget_variable_values,
    _clone_widget_definition,
    _collect_widget_bindings,
    _ensure_widget_output_model,
    _json_safe_copy,
    _load_widget_definition,
    _resolve_widget_action_payload,
)
from backend.app.chatkit_server.context import (
    AutoStartConfiguration,
    ChatKitRequestContext,
    _normalize_user_text,
    _resolve_user_input_text,
)
from backend.app.chatkit_server.widget_waiters import WidgetWaiterRegistry
from backend.app.chatkit_server.workflow_runner import (
    _STREAM_DONE,
    _WorkflowStreamResult,
    _log_background_exceptions,
)

try:
    from backend.app.chatkit import (
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


def _get_thread_title_agent() -> Agent:
    from backend.app import chatkit as chatkit_module

    return chatkit_module._build_thread_title_agent()


def _get_run_workflow():
    from backend.app import chatkit as chatkit_module

    return chatkit_module.run_workflow


class ImageAwareThreadItemConverter(ThreadItemConverter):
    """
    Converter personnalisé qui intercepte les ImageTask pour retourner
    les URLs des images générées à l'agent dans l'historique de conversation.
    """

    def __init__(self, backend_public_base_url: str | None = None):
        super().__init__()
        self.backend_public_base_url = backend_public_base_url

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
        from openai.types.responses.response_input_item_param import Message
        from openai.types.responses import ResponseInputImageParam

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
                task_text = f"{title}: {content}" if title and content else title or content
                text = f"A message was displayed to the user that the following task was performed:\n<Task>\n{task_text}\n</Task>"

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

class DemoChatKitServer(ChatKitServer[ChatKitRequestContext]):
    """Serveur ChatKit piloté par un workflow local."""

    def __init__(self, settings: Settings) -> None:
        store = PostgresChatKitStore(SessionLocal)
        attachment_store = LocalAttachmentStore(
            store, default_base_url=settings.backend_public_base_url
        )
        super().__init__(store, attachment_store=attachment_store)
        self._settings = settings
        self._workflow_service = WorkflowService()
        self._widget_waiters = WidgetWaiterRegistry()
        self._run_workflow = _get_run_workflow()
        self._title_agent = _get_thread_title_agent()
        self._thread_item_converter = ImageAwareThreadItemConverter(
            backend_public_base_url=settings.backend_public_base_url
        )
        self.attachment_store = attachment_store

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
        user_text = (
            _normalize_user_text(message) if isinstance(message, str) else ""
        )
        assistant_text = (
            _normalize_user_text(assistant_message)
            if isinstance(assistant_message, str)
            else ""
        )

        if user_text and assistant_text:
            logger.warning(
                "Le bloc début contient simultanément un message utilisateur et un message assistant. "
                "Seul le message utilisateur sera pris en compte.",
            )
            assistant_text = ""

        return AutoStartConfiguration(True, user_text, assistant_text)

    async def respond(
        self,
        thread: ThreadMetadata,
        input_user_message: UserMessageItem | None,
        context: ChatKitRequestContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        if input_user_message is not None:
            await self._maybe_update_thread_title(
                thread, input_user_message, context
            )
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

        if not user_text:
            config = self._resolve_auto_start_configuration()
            if not config.enabled:
                yield ErrorEvent(
                    code=ErrorCode.STREAM_ERROR,
                    message="Impossible de déterminer le message utilisateur à traiter.",
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
                        "Impossible de retirer le message utilisateur initial pour le fil %s",
                        thread.id,
                        exc_info=exc,
                    )

            logger.info(
                "Démarrage automatique du workflow pour le fil %s", thread.id
            )
            user_text = _normalize_user_text(config.user_message)
            assistant_stream_text = (
                "" if user_text else _normalize_user_text(config.assistant_message)
            )
            if not user_text and not assistant_stream_text:
                yield ErrorEvent(
                    code=ErrorCode.STREAM_ERROR,
                    message="Aucun message automatique n'est configuré pour ce workflow.",
                    allow_retry=False,
                )
                return

            if user_text:
                workflow_input = WorkflowInput(
                    input_as_text=user_text,
                    auto_start_was_triggered=True,
                    auto_start_assistant_message=assistant_stream_text,
                    source_item_id=getattr(input_user_message, "id", None),
                )
            elif assistant_stream_text:
                workflow_input = WorkflowInput(
                    input_as_text="",
                    auto_start_was_triggered=True,
                    auto_start_assistant_message=assistant_stream_text,
                    source_item_id=getattr(input_user_message, "id", None),
                )

            pre_stream_events = await self._prepare_auto_start_thread_items(
                thread=thread,
                context=context,
                user_text=user_text,
                assistant_text=assistant_stream_text,
            )
        else:
            workflow_input = WorkflowInput(
                input_as_text=user_text,
                source_item_id=getattr(input_user_message, "id", None),
            )
            pre_stream_events = []

        agent_context = AgentContext(
            thread=thread,
            store=self.store,
            request_context=context,
        )

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
            ),
            event_queue=event_queue,
        )

        try:
            async for event in workflow_result.stream_events():
                yield event
        except asyncio.CancelledError:  # pragma: no cover - déconnexion client
            logger.info(
                "Streaming interrompu pour le fil %s, poursuite du workflow en tâche de fond",
                thread.id,
            )
            return

    async def _maybe_update_thread_title(
        self,
        thread: ThreadMetadata,
        input_item: UserMessageItem,
        context: ChatKitRequestContext,
    ) -> None:
        if thread.title:
            return

        try:
            agent_input = await simple_to_agent_input(input_item)
        except Exception as exc:  # pragma: no cover - dépend des conversions SDK
            logger.warning(
                "Impossible de convertir le message utilisateur en entrée agent pour titrage (thread=%s)",
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

        try:
            run = await Runner.run(
                self._title_agent,
                input=agent_input,
                run_config=RunConfig(trace_metadata=metadata),
            )
        except Exception as exc:  # pragma: no cover - la génération de titre ne doit pas bloquer
            logger.warning(
                "Échec de la génération automatique du titre pour le fil %s",
                thread.id,
                exc_info=exc,
            )
            return

        raw_title = getattr(run, "final_output", "")
        if isinstance(raw_title, str):
            normalized_title = re.sub(r"\s+", " ", raw_title).strip().strip('\"\'`”’“«»')
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
        payload = action.payload if isinstance(action.payload, Mapping) else None
        if not payload:
            logger.warning(
                "Action %s ignorée pour le fil %s : charge utile invalide.",
                action.type,
                thread.id,
            )
            if False:  # pragma: no cover - satisfait l'interface AsyncIterator
                yield None
            return

        def _build_widget_item(data: Mapping[str, Any]) -> WidgetItem:
            validator = getattr(WidgetItem, "model_validate", None)
            if callable(validator):
                return validator(data)
            return WidgetItem.parse_obj(data)  # type: ignore[attr-defined]

        slug, definition_override, values, manual_bindings, copy_text_update = (
            _resolve_widget_action_payload(payload)
        )

        definition = definition_override
        if definition is None and slug:
            definition = _load_widget_definition(
                slug, context=f"action {action.type}"
            )

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

        try:
            widget_root = WidgetLibraryService._validate_widget(definition)
        except Exception as exc:  # pragma: no cover - dépend du SDK installé
            logger.exception(
                "Widget invalide après traitement de l'action %s", action.type, exc_info=exc
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

            await self._signal_widget_action(
                thread.id,
                widget_item_id=updated_item.id,
                widget_slug=slug,
                payload=action_context,
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
                "Impossible d'ajouter un widget suite à l'action %s", action.type, exc_info=exc
            )
            if False:  # pragma: no cover - satisfait l'interface AsyncIterator
                yield None
            return

        await self._signal_widget_action(
            thread.id,
            widget_item_id=new_item.id,
            widget_slug=slug,
            payload=action_context,
        )

        yield ThreadItemDoneEvent(item=new_item)

    async def _execute_workflow(
        self,
        *,
        thread: ThreadMetadata,
        agent_context: AgentContext[ChatKitRequestContext],
        workflow_input: WorkflowInput,
        event_queue: asyncio.Queue[Any],
        thread_items_history: list[ThreadItem] | None = None,
    ) -> None:
        streamed_step_keys: set[str] = set()
        step_progress_text: dict[str, str] = {}
        step_progress_headers: dict[str, str] = {}
        most_recent_widget_item_id: str | None = None

        try:
            logger.info("Démarrage du workflow pour le fil %s", thread.id)

            async def on_step(
                step_summary: WorkflowStepSummary, index: int
            ) -> None:
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
                config: "_ResponseWidgetConfig",
            ) -> Mapping[str, Any] | None:
                return await self._wait_for_widget_action(
                    thread=thread,
                    step_slug=step.slug,
                    widget_item_id=most_recent_widget_item_id,
                )

            summary = await self._run_workflow(
                workflow_input,
                agent_context=agent_context,
                on_step=on_step,
                on_step_stream=on_step_stream,
                on_stream_event=on_stream_event,
                on_widget_step=on_widget_step,
                workflow_service=self._workflow_service,
                thread_item_converter=self._thread_item_converter,
                thread_items_history=thread_items_history,
            )

            end_state = summary.end_state
            applied_status = False
            cleaned_reason: str | None = None
            if end_state is not None:
                status_type_raw = (end_state.status_type or "closed").strip().lower()
                cleaned_reason = (
                    (end_state.status_reason or end_state.message or DEFAULT_END_MESSAGE)
                    or ""
                ).strip() or None
                status_reason = cleaned_reason or DEFAULT_END_MESSAGE

                if status_type_raw in {"", "closed"}:
                    thread.status = ClosedStatus(reason=status_reason)
                    applied_status = True
                elif status_type_raw == "locked":
                    thread.status = LockedStatus(reason=status_reason)
                    applied_status = True
                elif status_type_raw == "waiting":
                    thread.status = ActiveStatus()
                    applied_status = True
                elif status_type_raw == "active":
                    thread.status = ActiveStatus()
                    applied_status = True
                else:
                    logger.warning(
                        "Type de statut inconnu '%s' pour le nœud de fin %s, fermeture par défaut.",
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
                logger.info(
                    "Workflow terminé pour le fil %s via le nœud %s (statut=%s, raison=%s)",
                    thread.id,
                    end_state.slug,
                    getattr(thread.status, "type", "inconnu") if applied_status else "inconnu",
                    cleaned_reason or DEFAULT_END_MESSAGE,
                )
            else:
                logger.info(
                    "Workflow terminé pour le fil %s sans bloc de fin (nœud final: %s)",
                    thread.id,
                    summary.final_node_slug,
                )
        except WorkflowExecutionError as exc:  # pragma: no cover - erreurs connues du workflow
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
            logger.info(
                "Workflow en erreur inattendue pour le fil %s", thread.id
            )
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
        """Ajoute les messages initialisés automatiquement au fil et prépare les événements."""

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
