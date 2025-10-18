from __future__ import annotations

import asyncio
import inspect
import json
import logging
import re
import uuid
from collections.abc import Collection, Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import (
    Any,
    AsyncIterator,
    Awaitable,
    Callable,
    Coroutine,
    Sequence,
    Literal,
)

from agents import (
    Agent,
    FunctionTool,
    ModelSettings,
    RunConfig,
    RunContextWrapper,
    Runner,
    TResponseInputItem,
    WebSearchTool,
    function_tool,
)
from openai.types.shared.reasoning import Reasoning

try:  # pragma: no cover - certaines versions du client OpenAI n'exposent pas encore ImageGeneration
    from openai.types.responses.tool import ImageGeneration
except ImportError:  # pragma: no cover - compatibilité rétro
    ImageGeneration = None  # type: ignore[assignment]
from pydantic import BaseModel, Field, create_model

from chatkit.actions import Action
from chatkit.agents import AgentContext, stream_agent_response

try:  # pragma: no cover - dépend de la version du SDK Agents installée
    from chatkit.agents import stream_widget as _sdk_stream_widget
except ImportError:  # pragma: no cover - compatibilité avec les anciennes versions
    _sdk_stream_widget = None  # type: ignore[assignment]
from chatkit.server import ChatKitServer
from chatkit.store import NotFoundError
from chatkit.types import (
    ActiveStatus,
    AssistantMessageContent,
    AssistantMessageContentPartTextDelta,
    AssistantMessageItem,
    ClosedStatus,
    EndOfTurnItem,
    ErrorCode,
    ErrorEvent,
    InferenceOptions,
    LockedStatus,
    ProgressUpdateEvent,
    ThreadItem,
    ThreadItemDoneEvent,
    ThreadItemRemovedEvent,
    ThreadItemUpdated,
    ThreadMetadata,
    ThreadStreamEvent,
    WidgetItem,
    WidgetRootUpdated,
    UserMessageInput,
    UserMessageItem,
    UserMessageTextContent,
)

from .config import Settings, get_settings
from .chatkit_store import PostgresChatKitStore
from .database import SessionLocal
from .models import WorkflowStep, WorkflowTransition
from .token_sanitizer import sanitize_model_like
from .workflows import (
    DEFAULT_END_MESSAGE,
    WorkflowService,
    resolve_start_auto_start,
    resolve_start_auto_start_message,
    resolve_start_auto_start_assistant_message,
)
from .vector_store import JsonVectorStoreService, SearchResult
from .weather import fetch_weather
from .widgets import WidgetLibraryService

logger = logging.getLogger("chatkit.server")

_ZERO_WIDTH_CHARACTERS = frozenset({"\u200b", "\u200c", "\u200d", "\ufeff"})


def _normalize_user_text(value: str | None) -> str:
    """Supprime les caractères invisibles et normalise les messages utilisateurs."""

    if not value:
        return ""

    sanitized = "".join(ch for ch in value if ch not in _ZERO_WIDTH_CHARACTERS)
    return sanitized.strip()


@dataclass(frozen=True)
class ChatKitRequestContext:
    """Contexte minimal passé au serveur ChatKit pour loguer l'utilisateur."""

    user_id: str | None
    email: str | None
    authorization: str | None = None

    def trace_metadata(self) -> dict[str, str]:
        """Retourne des métadonnées de trace compatibles avec l'Agents SDK."""
        metadata: dict[str, str] = {}
        if self.user_id:
            metadata["user_id"] = self.user_id
        if self.email:
            metadata["user_email"] = self.email
        return metadata


@dataclass(frozen=True)
class AutoStartConfiguration:
    """Configuration extraite du bloc début pour le démarrage automatique."""

    enabled: bool
    user_message: str
    assistant_message: str

    @classmethod
    def disabled(cls) -> "AutoStartConfiguration":
        return cls(False, "", "")


@dataclass
class _WidgetActionWaiter:
    slug: str | None
    widget_item_id: str | None
    event: asyncio.Event
    payload: Mapping[str, Any] | None = None


class DemoChatKitServer(ChatKitServer[ChatKitRequestContext]):
    """Serveur ChatKit piloté par un workflow local."""

    def __init__(self, settings: Settings) -> None:
        super().__init__(PostgresChatKitStore(SessionLocal))
        self._settings = settings
        self._workflow_service = WorkflowService()
        self._widget_action_waiters: dict[str, _WidgetActionWaiter] = {}
        self._widget_waiters_lock = asyncio.Lock()

    async def _wait_for_widget_action(
        self,
        *,
        thread: ThreadMetadata,
        step_slug: str,
        widget_item_id: str | None,
    ) -> Mapping[str, Any] | None:
        waiter = _WidgetActionWaiter(
            slug=step_slug,
            widget_item_id=widget_item_id,
            event=asyncio.Event(),
        )
        async with self._widget_waiters_lock:
            self._widget_action_waiters[thread.id] = waiter

        logger.info(
            "En attente d'une action utilisateur pour le widget %s (item=%s)",
            step_slug,
            widget_item_id,
        )

        try:
            await waiter.event.wait()
            payload = waiter.payload
        finally:
            async with self._widget_waiters_lock:
                existing = self._widget_action_waiters.get(thread.id)
                if existing is waiter:
                    self._widget_action_waiters.pop(thread.id, None)

        logger.info(
            "Action utilisateur détectée pour le widget %s, poursuite du workflow.",
            step_slug,
        )

        return payload

    async def _signal_widget_action(
        self,
        thread_id: str,
        *,
        widget_item_id: str | None,
        widget_slug: str | None,
        payload: Mapping[str, Any] | None = None,
    ) -> bool:
        async with self._widget_waiters_lock:
            waiter = self._widget_action_waiters.get(thread_id)
            if waiter is None:
                return False

            id_matches = (
                waiter.widget_item_id is None
                or widget_item_id is None
                or waiter.widget_item_id == widget_item_id
            )
            slug_matches = (
                waiter.slug is None
                or widget_slug is None
                or waiter.slug == widget_slug
            )

            if not id_matches and not slug_matches:
                logger.debug(
                    "Action reçue pour le widget %s (item=%s) alors que %s est attendu (item=%s).",
                    widget_slug,
                    widget_item_id,
                    waiter.slug,
                    waiter.widget_item_id,
                )
                return False

            if payload is not None:
                waiter.payload = _json_safe_copy(payload)
            waiter.event.set()
            return True

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
                )
            elif assistant_stream_text:
                workflow_input = WorkflowInput(
                    input_as_text="",
                    auto_start_was_triggered=True,
                    auto_start_assistant_message=assistant_stream_text,
                )

            pre_stream_events = await self._prepare_auto_start_thread_items(
                thread=thread,
                context=context,
                user_text=user_text,
                assistant_text=assistant_stream_text,
            )
        else:
            workflow_input = WorkflowInput(input_as_text=user_text)
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

            summary = await run_workflow(
                workflow_input,
                agent_context=agent_context,
                on_step=on_step,
                on_step_stream=on_step_stream,
                on_stream_event=on_stream_event,
                on_widget_step=on_widget_step,
                workflow_service=self._workflow_service,
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
            events.append(ThreadItemDoneEvent(item=user_item))

        if assistant_text:
            assistant_item = AssistantMessageItem(
                id=self.store.generate_item_id("message", thread, context),
                thread_id=thread.id,
                created_at=datetime.now(),
                content=[AssistantMessageContent(text=assistant_text)],
            )
            events.append(ThreadItemDoneEvent(item=assistant_item))

        return events


def _collect_user_text(message: UserMessageItem | None) -> str:
    """Concatène le texte d'un message utilisateur après normalisation."""

    if not message or not getattr(message, "content", None):
        return ""

    parts: list[str] = []
    for content_item in message.content:
        text = getattr(content_item, "text", None)
        normalized = _normalize_user_text(text) if text else ""
        if normalized:
            parts.append(normalized)

    return "\n".join(parts)


def _resolve_user_input_text(
    input_user_message: UserMessageItem | None,
    history: Sequence[ThreadItem],
) -> str:
    """Détermine le texte du message utilisateur à traiter."""
    candidate = _collect_user_text(input_user_message)
    if candidate:
        return candidate

    for item in reversed(history):
        if isinstance(item, UserMessageItem):
            candidate = _collect_user_text(item)
            if candidate:
                return candidate

    return ""


def _log_background_exceptions(task: asyncio.Task[None]) -> None:
    try:
        exception = task.exception()
    except asyncio.CancelledError:  # pragma: no cover - annulation explicite
        logger.info("Traitement du workflow annulé")
        return
    except Exception:  # pragma: no cover - erreur lors de l'inspection
        logger.exception("Erreur lors de la récupération de l'exception de la tâche")
        return

    if exception:
        logger.exception("Erreur dans la tâche de workflow", exc_info=exception)


_STREAM_DONE = object()


class _WorkflowStreamResult:
    """Adaptateur minimal pour exposer les événements du workflow."""

    def __init__(
        self,
        *,
        runner: Coroutine[Any, Any, None],
        event_queue: asyncio.Queue[Any],
    ) -> None:
        self._event_queue = event_queue
        self._task = asyncio.create_task(runner)
        self._task.add_done_callback(_log_background_exceptions)

    async def stream_events(self) -> AsyncIterator[Any]:
        while True:
            event = await self._event_queue.get()
            if event is _STREAM_DONE:
                break
            yield event

        await self._task


# ---------------------------------------------------------------------------
# Définition du workflow local exécuté par DemoChatKitServer
# ---------------------------------------------------------------------------


class TriageSchema(BaseModel):
    has_all_details: bool
    details_manquants: str


class RDacteurSchemaIntroPlaceCours(BaseModel):
    texte: str


class RDacteurSchemaObjectifTerminal(BaseModel):
    texte: str


class RDacteurSchemaStructureIntro(BaseModel):
    texte: str


class RDacteurSchemaActivitesTheoriques(BaseModel):
    texte: str


class RDacteurSchemaActivitesPratiques(BaseModel):
    texte: str


class RDacteurSchemaActivitesPrevuesItem(BaseModel):
    phase: str
    description: str


class RDacteurSchemaEvaluationSommative(BaseModel):
    texte: str


class RDacteurSchemaNatureEvaluationsSommatives(BaseModel):
    texte: str


class RDacteurSchemaEvaluationLangue(BaseModel):
    texte: str


class RDacteurSchemaEvaluationFormative(BaseModel):
    texte: str


class RDacteurSchemaCompetencesDeveloppeesItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaCompetencesCertifieesItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaCoursCorequisItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaObjetsCiblesItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaCoursReliesItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaCoursPrealablesItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaSavoirsFaireCapaciteItem(BaseModel):
    savoir_faire: str
    cible_100: str
    seuil_60: str


class RDacteurSchemaCapaciteItem(BaseModel):
    capacite: str
    pond_min: float
    pond_max: float
    savoirs_necessaires_capacite: list[str]
    savoirs_faire_capacite: list[RDacteurSchemaSavoirsFaireCapaciteItem]
    moyens_evaluation_capacite: list[str]


class RDacteurSchema(BaseModel):
    intro_place_cours: RDacteurSchemaIntroPlaceCours
    objectif_terminal: RDacteurSchemaObjectifTerminal
    structure_intro: RDacteurSchemaStructureIntro
    activites_theoriques: RDacteurSchemaActivitesTheoriques
    activites_pratiques: RDacteurSchemaActivitesPratiques
    activites_prevues: list[RDacteurSchemaActivitesPrevuesItem]
    evaluation_sommative: RDacteurSchemaEvaluationSommative
    nature_evaluations_sommatives: RDacteurSchemaNatureEvaluationsSommatives
    evaluation_langue: RDacteurSchemaEvaluationLangue
    evaluation_formative: RDacteurSchemaEvaluationFormative
    competences_developpees: list[RDacteurSchemaCompetencesDeveloppeesItem]
    competences_certifiees: list[RDacteurSchemaCompetencesCertifieesItem]
    cours_corequis: list[RDacteurSchemaCoursCorequisItem]
    objets_cibles: list[RDacteurSchemaObjetsCiblesItem]
    cours_relies: list[RDacteurSchemaCoursReliesItem]
    cours_prealables: list[RDacteurSchemaCoursPrealablesItem]
    savoir_etre: list[str]
    capacite: list[RDacteurSchemaCapaciteItem]


class Triage2Schema(BaseModel):
    has_all_details: bool
    details_manquants: str


def _model_settings(**kwargs: Any) -> ModelSettings:
    return sanitize_model_like(ModelSettings(**kwargs))


def _coerce_model_settings(value: Any) -> Any:
    if isinstance(value, dict):
        return _model_settings(**value)
    return sanitize_model_like(value)


def _sanitize_web_search_user_location(payload: Any) -> dict[str, str] | None:
    """Nettoie un dictionnaire de localisation envoyé depuis l'UI."""

    if not isinstance(payload, dict):
        return None

    sanitized: dict[str, str] = {}
    for key, value in payload.items():
        if not isinstance(key, str):
            continue
        if not isinstance(value, str):
            continue
        trimmed = value.strip()
        if trimmed:
            sanitized[key] = trimmed

    return sanitized or None


def _build_web_search_tool(payload: Any) -> WebSearchTool | None:
    """Construit un outil de recherche web à partir des paramètres sérialisés."""

    if isinstance(payload, WebSearchTool):
        return payload

    config: dict[str, Any] = {}
    if isinstance(payload, dict):
        search_context_size = payload.get("search_context_size")
        if isinstance(search_context_size, str) and search_context_size.strip():
            config["search_context_size"] = search_context_size.strip()

        user_location = _sanitize_web_search_user_location(payload.get("user_location"))
        if user_location:
            config["user_location"] = user_location

    try:
        return WebSearchTool(**config)
    except Exception:  # pragma: no cover - dépend des versions du SDK
        logger.warning(
            "Impossible d'instancier WebSearchTool avec la configuration %s", config
        )
        return None


def _build_image_generation_tool(payload: Any) -> ImageGeneration | None:
    """Construit un outil de génération d'image pour l'Agents SDK."""

    if ImageGeneration is None:
        return None

    if isinstance(payload, ImageGeneration):
        return payload

    config: Any = payload
    if isinstance(payload, dict):
        candidate = payload.get("image_generation")
        if isinstance(candidate, dict):
            config = candidate

    if not isinstance(config, dict):
        return None

    field_names: set[str]
    if hasattr(ImageGeneration, "model_fields"):
        field_names = set(ImageGeneration.model_fields)
    else:  # pragma: no cover - compatibilité Pydantic v1
        field_names = set(ImageGeneration.__fields__)  # type: ignore[attr-defined]

    tool_kwargs: dict[str, Any] = {"type": "image_generation"}
    for key in field_names:
        if key == "type":
            continue
        value = config.get(key)
        if value is not None:
            tool_kwargs[key] = value

    try:
        return ImageGeneration(**tool_kwargs)
    except Exception:  # pragma: no cover - dépend de la version du client
        logger.warning(
            "Impossible de construire ImageGeneration avec la configuration %s", config
        )
        return None


def _extract_vector_store_ids(config: dict[str, Any]) -> list[str]:
    """Récupère la liste des identifiants de vector store à partir du payload."""

    result: list[str] = []

    raw_ids = config.get("vector_store_ids")
    if isinstance(raw_ids, (list, tuple, set)):
        for entry in raw_ids:
            if isinstance(entry, str) and entry.strip():
                normalized = entry.strip()
                if normalized not in result:
                    result.append(normalized)

    candidate = config.get("vector_store_id")
    if isinstance(candidate, str) and candidate.strip():
        normalized = candidate.strip()
        if normalized not in result:
            result.append(normalized)

    slug = config.get("vector_store_slug")
    if isinstance(slug, str) and slug.strip():
        normalized = slug.strip()
        if normalized not in result:
            result.append(normalized)

    store = config.get("store")
    if isinstance(store, dict):
        nested_slug = store.get("slug")
        if isinstance(nested_slug, str) and nested_slug.strip():
            normalized = nested_slug.strip()
            if normalized not in result:
                result.append(normalized)

    return result


def _coerce_max_num_results(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.isdigit():
            return int(stripped)
    return None


def _coerce_include_search_results(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if not normalized:
            return False
        return normalized in {"full", "true", "1", "yes", "y"}
    return False


def _coerce_ranking_options(value: Any) -> dict[str, Any] | None:
    """Nettoie les options de ranking attendues par l'outil de recherche locale."""

    if value is None:
        return None

    if isinstance(value, dict):
        data: dict[str, Any] = {}
        ranker = value.get("ranker")
        if isinstance(ranker, str) and ranker.strip():
            data["ranker"] = ranker.strip()

        threshold = value.get("score_threshold")
        if isinstance(threshold, (int, float)):
            data["score_threshold"] = float(threshold)
        elif isinstance(threshold, str):
            try:
                data["score_threshold"] = float(threshold.strip())
            except ValueError:
                pass

        return data or None

    return None


def _format_vector_store_results(
    matches: list[tuple[str, list[SearchResult]]],
    *,
    include_text: bool,
) -> list[dict[str, Any]]:
    formatted: list[dict[str, Any]] = []
    for slug, entries in matches:
        formatted_matches: list[dict[str, Any]] = []
        for entry in entries:
            item: dict[str, Any] = {
                "doc_id": entry.doc_id,
                "chunk_index": entry.chunk_index,
                "score": entry.score,
                "dense_score": entry.dense_score,
                "bm25_score": entry.bm25_score,
                "metadata": entry.metadata,
                "document_metadata": entry.document_metadata,
            }
            if include_text:
                item["text"] = entry.text
            formatted_matches.append(item)

        formatted.append(
            {
                "vector_store_slug": slug,
                "matches": formatted_matches,
            }
        )

    return formatted


def _build_file_search_tool(payload: Any) -> FunctionTool | None:
    """Construit un FunctionTool effectuant une recherche sur nos magasins locaux."""

    if isinstance(payload, FunctionTool):
        return payload

    config: dict[str, Any] = payload if isinstance(payload, dict) else {}
    vector_store_ids = _extract_vector_store_ids(config)
    if not vector_store_ids:
        return None

    max_num_results = _coerce_max_num_results(config.get("max_num_results"))
    include_search_results = _coerce_include_search_results(
        config.get("return_documents")
    )
    ranking_options = _coerce_ranking_options(config.get("ranking_options"))
    default_top_k = max_num_results if max_num_results else 5

    async def _search_vector_stores(
        query: str,
        top_k: int | None = None,
    ) -> dict[str, Any]:
        """Recherche des extraits pertinents dans les magasins configurés."""

        normalized_query = query.strip() if isinstance(query, str) else ""
        if not normalized_query:
            return {
                "query": "",
                "vector_stores": [],
                "errors": ["La requête de recherche est vide."],
            }

        limit: int = default_top_k
        if isinstance(top_k, int) and top_k > 0:
            limit = top_k

        def _search_sync() -> tuple[
            list[tuple[str, list[SearchResult]]], list[dict[str, Any]]
        ]:
            matches: list[tuple[str, list[SearchResult]]] = []
            errors: list[dict[str, Any]] = []
            with SessionLocal() as session:
                service = JsonVectorStoreService(session)
                for slug in vector_store_ids:
                    try:
                        results = service.search(
                            slug,
                            normalized_query,
                            top_k=limit,
                        )
                    except LookupError:
                        errors.append(
                            {
                                "vector_store_slug": slug,
                                "message": "Magasin introuvable.",
                            }
                        )
                        continue
                    except Exception as exc:  # pragma: no cover - dépend du runtime
                        logger.exception(
                            "Erreur lors de la recherche dans le magasin %s", slug,
                            exc_info=exc,
                        )
                        errors.append(
                            {
                                "vector_store_slug": slug,
                                "message": "Recherche impossible : erreur interne.",
                            }
                        )
                        continue

                    matches.append((slug, list(results)))

            return matches, errors

        store_matches, store_errors = await asyncio.to_thread(_search_sync)

        response: dict[str, Any] = {
            "query": normalized_query,
            "vector_stores": _format_vector_store_results(
                store_matches,
                include_text=include_search_results,
            ),
        }
        if ranking_options:
            response["ranking_options"] = ranking_options
        if store_errors:
            response["errors"] = store_errors

        return response

    tool_name = "file_search"
    if len(vector_store_ids) == 1:
        tool_name = f"file_search_{vector_store_ids[0].replace('-', '_')}"

    search_tool = function_tool(name_override=tool_name)(_search_vector_stores)
    if include_search_results:
        search_tool.description = (
            "Recherche dans les documents locaux et renvoie le texte des extraits pertinents."
        )
    else:
        search_tool.description = (
            "Recherche dans les documents locaux et renvoie les métadonnées des extraits pertinents."
        )

    return search_tool


_WEATHER_FUNCTION_TOOL_ALIASES = {"fetch_weather", "get_weather"}
_WEATHER_FUNCTION_TOOL_DEFAULT_DESCRIPTION = (
    "Récupère les conditions météorologiques actuelles via le service Python interne."
)


def _build_weather_function_tool(payload: Any) -> FunctionTool | None:
    """Construit un FunctionTool pointant vers la fonction Python fetch_weather."""

    if isinstance(payload, FunctionTool):
        return payload

    name_override = "fetch_weather"
    description = _WEATHER_FUNCTION_TOOL_DEFAULT_DESCRIPTION

    if isinstance(payload, dict):
        raw_name = payload.get("name") or payload.get("id") or payload.get("function_name")
        if isinstance(raw_name, str) and raw_name.strip():
            candidate = raw_name.strip()
            if candidate.lower() in _WEATHER_FUNCTION_TOOL_ALIASES:
                name_override = candidate
            else:
                return None
        raw_description = payload.get("description")
        if isinstance(raw_description, str) and raw_description.strip():
            description = raw_description.strip()
    elif isinstance(payload, str) and payload.strip():
        candidate = payload.strip()
        if candidate.lower() in _WEATHER_FUNCTION_TOOL_ALIASES:
            name_override = candidate
        else:
            return None

    tool = function_tool(name_override=name_override)(fetch_weather)
    tool.description = description
    return tool


def _clone_tools(value: Sequence[Any] | None) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return list(value)
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return list(value)
    # Si la valeur n'est pas séquentielle (ex. un objet unique), on la
    # encapsule tout de même dans une liste pour respecter le contrat du SDK.
    return [value]


_JSON_TYPE_MAPPING: dict[str, Any] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
}


def _sanitize_model_name(name: str | None) -> str:
    candidate = (name or "workflow_output").strip()
    sanitized = re.sub(r"[^0-9a-zA-Z_]", "_", candidate) or "workflow_output"
    if sanitized[0].isdigit():
        sanitized = f"model_{sanitized}"
    return sanitized


def _lookup_known_output_type(name: str) -> type[BaseModel] | None:
    obj = globals().get(name)
    if isinstance(obj, type) and issubclass(obj, BaseModel):
        return obj
    return None


class _JsonSchemaOutputBuilder:
    """Convertit un schéma JSON simple en type Python compatible Pydantic."""

    def __init__(self) -> None:
        self._models: dict[str, type[BaseModel]] = {}

    def build_type(self, schema: Any, *, name: str) -> Any | None:
        if not isinstance(schema, dict):
            return None
        py_type, _nullable = self._resolve(schema, _sanitize_model_name(name))
        return py_type

    def _resolve(self, schema: dict[str, Any], name: str) -> tuple[Any, bool]:
        nullable = False
        schema_type = schema.get("type")

        if isinstance(schema_type, list):
            normalized = [value for value in schema_type if isinstance(value, str)]
            if "null" in normalized:
                nullable = True
                normalized = [value for value in normalized if value != "null"]
            if len(normalized) == 1:
                schema_type = normalized[0]
            elif not normalized:
                schema_type = None
            else:
                return Any, nullable
        elif isinstance(schema_type, str):
            if schema_type == "null":
                return type(None), True
        else:
            schema_type = None

        if schema.get("nullable") is True:
            nullable = True

        if "enum" in schema and isinstance(schema["enum"], list) and schema["enum"]:
            enum_values = tuple(schema["enum"])
            try:
                literal_type = Literal.__getitem__(enum_values)
            except TypeError:
                return Any, nullable
            return literal_type, nullable

        if "const" in schema:
            try:
                literal_type = Literal.__getitem__((schema["const"],))
            except TypeError:
                return Any, nullable
            return literal_type, nullable

        if schema_type == "array":
            items_schema = schema.get("items")
            items_type, _ = self._resolve(items_schema if isinstance(items_schema, dict) else {}, f"{name}Item")
            if items_type is None:
                items_type = Any
            return list[items_type], nullable

        if schema_type == "object" or "properties" in schema or "additionalProperties" in schema:
            return self._build_object(schema, name), nullable

        if isinstance(schema_type, str):
            primitive = _JSON_TYPE_MAPPING.get(schema_type)
            if primitive is not None:
                return primitive, nullable

        return Any, nullable

    def _build_object(self, schema: dict[str, Any], name: str) -> Any:
        sanitized = _sanitize_model_name(name)
        cached = self._models.get(sanitized)
        if cached is not None:
            return cached

        properties = schema.get("properties")
        if not isinstance(properties, dict):
            additional = schema.get("additionalProperties")
            if isinstance(additional, dict):
                value_type, _ = self._resolve(additional, f"{sanitized}Value")
                value_type = value_type if value_type is not None else Any
                return dict[str, value_type]
            if additional:
                return dict[str, Any]
            model = create_model(sanitized, __module__=__name__)
            self._models[sanitized] = model
            return model

        if not properties:
            model = create_model(sanitized, __module__=__name__)
            self._models[sanitized] = model
            return model

        if any((not isinstance(prop, str) or not prop.isidentifier()) for prop in properties):
            return dict[str, Any]

        required_raw = schema.get("required")
        required: set[str] = set()
        if isinstance(required_raw, list):
            for item in required_raw:
                if isinstance(item, str):
                    required.add(item)

        field_definitions: dict[str, tuple[Any, Any]] = {}
        for prop_name, prop_schema in properties.items():
            nested_schema = prop_schema if isinstance(prop_schema, dict) else {}
            prop_type, prop_nullable = self._resolve(
                nested_schema,
                f"{sanitized}_{prop_name}",
            )
            if prop_type is None:
                prop_type = Any
            field_type = prop_type
            is_required = prop_name in required
            if prop_nullable:
                field_type = field_type | None
            if not is_required:
                if not prop_nullable:
                    field_type = field_type | None if field_type is not Any else Any
                field_definitions[prop_name] = (field_type, Field(default=None))
            else:
                field_definitions[prop_name] = (field_type, Field(...))

        model = create_model(sanitized, __module__=__name__, **field_definitions)
        self._models[sanitized] = model
        return model


def _build_output_type_from_response_format(response_format: Any, *, fallback: Any | None) -> Any | None:
    if not isinstance(response_format, dict):
        logger.warning(
            "Format de réponse agent invalide (type inattendu) : %s. Utilisation du type existant.",
            response_format,
        )
        return fallback

    fmt_type = response_format.get("type")
    if fmt_type != "json_schema":
        logger.warning(
            "Format de réponse %s non pris en charge, utilisation du type existant.",
            fmt_type,
        )
        return fallback

    json_schema = response_format.get("json_schema")
    if not isinstance(json_schema, dict):
        logger.warning(
            "Format JSON Schema invalide pour la configuration agent : %s. Utilisation du type existant.",
            response_format,
        )
        return fallback

    schema_name_raw = json_schema.get("name")
    original_name = schema_name_raw if isinstance(schema_name_raw, str) and schema_name_raw.strip() else None
    schema_name = _sanitize_model_name(original_name)
    schema_payload = json_schema.get("schema")
    if not isinstance(schema_payload, dict):
        logger.warning(
            "Format JSON Schema sans contenu pour %s, utilisation du type existant.",
            schema_name,
        )
        return fallback

    known = None
    if original_name:
        known = _lookup_known_output_type(original_name)
    if known is None:
        known = _lookup_known_output_type(schema_name)
    if known is not None:
        return known

    builder = _JsonSchemaOutputBuilder()
    built = builder.build_type(schema_payload, name=schema_name)
    if built is None:
        logger.warning(
            "Impossible de construire un output_type depuis le schéma %s, utilisation du type existant.",
            schema_name,
        )
        return fallback

    return built


def _coerce_agent_tools(
    value: Any, fallback: Sequence[Any] | None = None
) -> Sequence[Any] | None:
    """Convertit les outils sérialisés en instances compatibles avec le SDK Agents."""

    if value is None:
        return _clone_tools(fallback)

    if not isinstance(value, list):
        return value

    coerced: list[Any] = []
    for entry in value:
        if isinstance(entry, WebSearchTool):
            coerced.append(entry)
            continue

        if isinstance(entry, dict):
            tool_type = entry.get("type") or entry.get("tool") or entry.get("name")
            normalized_type = tool_type.strip().lower() if isinstance(tool_type, str) else ""

            if normalized_type == "web_search":
                tool = _build_web_search_tool(entry.get("web_search"))
                if tool is not None:
                    coerced.append(tool)
                continue

            if normalized_type == "file_search":
                tool = _build_file_search_tool(entry.get("file_search"))
                if tool is not None:
                    coerced.append(tool)
                continue

            if normalized_type == "image_generation":
                tool = _build_image_generation_tool(entry)
                if tool is not None:
                    coerced.append(tool)
                continue

            if normalized_type == "function":
                tool = _build_weather_function_tool(entry.get("function"))
                if tool is not None:
                    coerced.append(tool)
                continue

    if coerced:
        return coerced

    if value:
        logger.warning(
            "Outils agent non reconnus (%s), utilisation de la configuration par défaut.",
            value,
        )
        return _clone_tools(fallback)

    return []


def _build_agent_kwargs(
    base_kwargs: dict[str, Any], overrides: dict[str, Any] | None
) -> dict[str, Any]:
    merged = {**base_kwargs}
    if overrides:
        for key, value in overrides.items():
            merged[key] = value

    # Les paramètres orientés interface utilisateur ne sont pas reconnus par
    # l'Agents SDK. Ils proviennent du concepteur de workflow et doivent être
    # retirés avant l'instanciation de l'agent afin d'éviter les erreurs de
    # type lors de la création du modèle (ex. response_widget).
    merged.pop("response_widget", None)
    if "model_settings" in merged:
        merged["model_settings"] = _coerce_model_settings(merged["model_settings"])
    if "tools" in merged:
        merged["tools"] = _coerce_agent_tools(
            merged["tools"], base_kwargs.get("tools") if base_kwargs else None
        )
    if "response_format" in merged:
        response_format = merged.pop("response_format")
        output_type = merged.get("output_type")
        resolved = _build_output_type_from_response_format(
            response_format,
            fallback=output_type,
        )
        if resolved is not None:
            merged["output_type"] = resolved
        elif "output_type" not in base_kwargs and "output_type" in merged:
            # Aucun type exploitable fourni, on retire la clé pour éviter les incohérences.
            merged.pop("output_type", None)
    return merged


web_search_preview = WebSearchTool(
    search_context_size="medium",
    user_location={
        "city": "Québec",
        "country": "CA",
        "region": "QC",
        "type": "approximate",
    },
)


def _build_triage_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "Triage",
        "instructions": (
            """Ton rôle : Vérifier si toutes les informations nécessaires sont présentes pour générer un plan-cadre.
Si oui → has_all_details: true
Sinon → has_all_details: false + lister uniquement les éléments manquants

Ne génère pas encore le plan-cadre.

Informations attendues
Le plan-cadre pourra être généré seulement si les champs suivants sont fournis :
code_cours:
nom_cours:
programme:
fil_conducteur:
session:
cours_prealables: []       # Codes + titres
cours_requis: []           # (optionnel)
cours_reliés: []           # (optionnel)
heures_theorie:
heures_lab:
heures_maison:
competences_developpees: []   # Codes + titres
competences_atteintes: []     # Codes + titres
competence_nom:               # Pour la section Description des compétences développées
cours_developpant_une_meme_competence: [] # Pour les activités pratiques
Une idée générale de ce qui devrait se retrouver dans le cours."""
        ),
        "model": "gpt-5",
        "output_type": TriageSchema,
        "model_settings": _model_settings(
            store=True,
            reasoning=Reasoning(
                effort="minimal",
                summary="auto",
            ),
        ),
    }
    return Agent(**_build_agent_kwargs(base_kwargs, overrides))


R_DACTEUR_INSTRUCTIONS = (
    """Tu es un assistant pédagogique qui génère, en français, des contenus de plan-cadre selon le ton institutionnel : clairs, concis, rigoureux, rédigés au vouvoiement. Tu ne t’appuies que sur les informations fournies dans le prompt utilisateur, sans inventer de contenu. Si une information manque et qu’aucune directive de repli n’est donnée, omets l’élément manquant.

**CONTRAINTE SPÉCIALE – SAVOIR ET SAVOIR-FAIRE PAR CAPACITÉ**
Pour chaque capacité identifiée dans le cours, tu dois générer explicitement :
- La liste des savoirs nécessaires à la maîtrise de cette capacité (minimum 10 par capacité)
- La liste des savoir-faire associés à cette même capacité (minimum 10 par capacité, chacun avec niveau cible et seuil)

Ton rôle est de récupérer les informations manquantes pour rédiger le plan-cadre.
Demande à l'utilisateur les informations manquantes.

SECTIONS ET RÈGLES DE GÉNÉRATION

## Intro et place du cours
Génère une description détaillée pour le cours «{{code_cours}} – {{nom_cours}}» qui s’inscrit dans le fil conducteur «{{fil_conducteur}}» du programme de {{programme}} et se donne en session {{session}} de la grille de cours.

La description devra comporter :

Une introduction qui situe le cours dans son contexte (code, nom, fil conducteur, programme et session).

Une explication sur l’importance des connaissances préalables pour réussir ce cours.

Pour chaque cours préalable listé dans {{cours_prealables}}, détaillez les connaissances et compétences essentielles acquises et expliquez en quoi ces acquis sont indispensables pour aborder les notions spécifiques du cours actuel.

Le texte final devra adopter un style clair et pédagogique, similaire à l’exemple suivant, mais adapté au contenu du présent cours :

"Le cours «243-4Q4 – Communication radio» s’inscrit dans le fil conducteur «Sans-fil et fibre optique» du programme de Technologie du génie électrique : Réseaux et télécommunications et se donne en session 4. Afin de bien réussir ce cours, il est essentiel de maîtriser les connaissances préalables acquises dans «nom du cours», particulièrement [connaissances et compétences]. Ces acquis permettront aux personnes étudiantes de saisir plus aisément les notions [ de ... ]abordées dans le présent cours."

---

## Objectif terminal
Écrire un objectif terminal pour le cours {{nom_cours}} qui devrait commencer par: "Au terme de ce cours, les personnes étudiantes seront capables de" et qui termine par un objectif terminal qui correspond aux compétences à développer ou atteinte({{competences_developpees}}{{competences_atteintes}}). Celui-ci devrait clair, mais ne comprendre que 2 ou 3 actes. Le e nom du cours donne de bonnes explications sur les technologies utilisés dans le cours, à intégrer dans l'objectif terminal.

---

## Introduction Structure du Cours
Le cours «{{nom_cours}}» prévoit {{heures_theorie}} heures de théorie, {{heures_lab}} heures d’application en travaux pratiques ou en laboratoire et {{heures_maison}} heures de travail personnel sur une base hebdomadaire.

---

## Activités Théoriques
Écrire un texte sous cette forme adapté à la nature du cours ({{nom_cours}}), celui-ci devrait être similaire en longueur et en style:

"Les séances théoriques du cours visent à préparer les personnes étudiantes en vue de la mise en pratique de leurs connaissances au laboratoire. Ces séances seront axées sur plusieurs aspects, notamment les éléments constitutifs des systèmes électroniques analogiques utilisés en télécommunications. Les personnes étudiantes auront l'opportunité d'approfondir leur compréhension par le biais de discussions interactives, des exercices et des analyses de cas liés à l’installation et au fonctionnement des systèmes électroniques analogiques. "

---

## Activités Pratiques
Écrire un texte sous cette forme adapté à la nature du cours {{nom_cours}}, celui-ci devrait être similaire en longueur et en style.  Le premier chiffre après 243 indique la session sur 6 et le nom du cours donne de bonnes explications sur le matériel ou la technologie utilisé dans le cours

Voici les cours reliés:
{{cours_developpant_une_meme_competence}}

Voici un exemple provenant d'un autre cours de mes attentes:
"La structure des activités pratiques sur les 15 semaines du cours se déroulera de manière progressive et devrait se dérouler en 4 phases. La première phrase devrait s’inspirer du quotidien des personnes étudiantes qui, généralement, ont simplement utilisé des systèmes électroniques. Son objectif serait donc de favoriser la compréhension des composants essentiels des systèmes électroniques analogiques. Cela devrait conduire à une compréhension d’un système d’alimentation basé sur des panneaux solaires photovoltaïques, offrant ainsi une introduction pertinente aux systèmes d’alimentation en courant continu, utilisés dans les télécommunications. La seconde phase devrait mener l’a personne à comprendre la nature des signaux alternatifs dans le cadre de systèmes d’alimentation en courant alternatif et sur des signaux audios. La troisième phase viserait une exploration des systèmes de communication radio. Finalement, la dernière phase viserait à réaliser un projet final combinant les apprentissages réalisés, en partenariat avec les cours 243-1N5-LI - Systèmes numériques et 243-1P4-LI – Travaux d’atelier."

---

## Activités Prévues
Décrire les différentes phases de manière succincte en utilisant cette forme. Ne pas oublier que la session dure 15 semaines.

**Phase X - titre de la phase (Semaines Y à 4Z)**
  - Description de la phase

---

## Évaluation Sommative des Apprentissages
Pour la réussite du cours, la personne étudiante doit obtenir la note de 60% lorsque l'on fait la somme pondérée des capacités.

La note attribuée à une capacité ne sera pas nécessairement la moyenne cumulative des résultats des évaluations pour cette capacité, mais bien le reflet des observations constatées en cours de session, par la personne enseignante et le jugement global de cette dernière.

---

## Nature des Évaluations Sommatives
Inclure un texte similaire à celui-ci:

L’évaluation sommative devrait surtout être réalisée à partir de travaux pratiques effectués en laboratoire, alignés avec le savoir-faire évalué. Les travaux pratiques pourraient prendre la forme de...

Pour certains savoirs, il est possible que de courts examens théoriques soient le moyen à privilégier, par exemple pour les savoirs suivants:
...

---

## Évaluation de la Langue
Utiliser ce modèle:

Dans un souci de valorisation de la langue, l’évaluation de l’expression et de la communication en français se fera de façon constante par l’enseignant(e) sur une base formative, à l’oral ou à l’écrit. Son évaluation se fera sur une base sommative pour les savoir-faire reliés à la documentation. Les critères d’évaluation se trouvent au plan général d’évaluation sommative présenté à la page suivante. Les dispositions pour la valorisation de l’expression et de la communication en français sont encadrées par les modalités particulières d’application de l’article 6.6 de la PIEA (Politique institutionnelle d’évaluation des apprentissages) et sont précisées dans le plan de cours.

---

## Évaluation formative des apprentissages
Sur une base régulière, la personne enseignante proposera des évaluations formatives à réaliser en classe, en équipe ou individuellement. Elle pourrait offrir des mises en situation authentiques de même que des travaux pratiques et des simulations. Des lectures dirigées pourraient également être proposées. L’évaluation formative est continue et intégrée aux activités d’apprentissage et d’enseignement et poursuit les fins suivantes :

...
Définir le concept de superposition d’ondes.
Expliquer la différence entre interférence constructive et destructive.
Décrire les causes possibles de réflexion dans un système de transmission.
Comprendre l’effet de la longueur électrique sur les ondes stationnaires.
… (jusqu’à au moins 10)
Comment adapter à ce cours
Identifier les notions clés propres au présent cours (ex. décrire les types de risques financiers, expliquer les mécanismes d’authentification en sécurité informatique, etc.).
Veiller à ce que la liste couvre l’essentiel de la base théorique nécessaire pour développer les savoir-faire ultérieurement.
Rester cohérent avec la complexité de la capacité. Pas de verbes trop avancés si on vise la simple compréhension.

---

## Savoirs faire d'une capacité
Objectif général
Définir ce que les apprenants doivent être capables de faire (actions concrètes) pour démontrer qu’ils atteignent la capacité. Chaque savoir-faire est accompagné de deux niveaux de performance : cible (100 %) et seuil de réussite (60 %).

Instructions détaillées
Lister au moins 10 savoir-faire.
Chaque savoir-faire doit commencer par un verbe à l’infinitif (ex. Mesurer, Calculer, Configurer, Vérifier, etc.).
Il doit représenter une action observable et évaluable.
Pour chaque savoir-faire, préciser :
Cible (niveau optimal, 100 %) : Formulée à l’infinitif, décrivant la maîtrise complète ou la performance idéale.
Seuil de réussite (niveau minimal, 60 %) : Aussi formulée à l’infinitif, décrivant la version minimale acceptable du même savoir-faire.
Éviter :
Les notions de quantité ou répétition (ex. « faire X fois »).
Les noms d’outils ou de technologies précises.
Exemple d’attendu
Savoir-faire : Analyser l’effet des réflexions sur une ligne de transmission

Cible (100 %) : Analyser avec précision les variations de signal en identifiant clairement l’origine des désadaptations.
Seuil (60 %) : Analyser les variations de manière suffisante pour repérer les principales anomalies et causes de désadaptation.
Savoir-faire : Mesurer l’impédance caractéristique d’un support

Cible (100 %) : Mesurer avec exactitude l’impédance en appliquant la bonne méthode et en interprétant correctement les résultats.
Seuil (60 %) : Mesurer l’impédance de base et reconnaître les écarts majeurs par rapport à la valeur attendue.
(jusqu’à avoir 10 savoir-faire minimum)

Comment adapter au présent cours
Transformer les actions en fonction du domaine (ex. Configurer un serveur Web, Concevoir une base de données, Effectuer une analyse de rentabilité, etc.).
Ajuster le langage et la précision selon le niveau visé (Bloom). Par exemple, Appliquer ou Mettre en œuvre pour un niveau intermédiaire, Concevoir ou Évaluer pour un niveau avancé.
Adapter les niveaux cible et seuil pour refléter les attendus concrets dans la pratique de votre discipline.

---

## Moyen d'évaluation d'une capacité
Trouve 3 ou 4 moyens d'évaluations adaptés pour cette capacité.

# Remarques

- Respecter la logique explicite : lier savoirs, savoir-faire et évaluation à chaque capacité (ne pas globaliser).
- S’assurer que chaque tableau “capacités” contient systématiquement la triple structure : savoirs, savoir-faire, moyens d’évaluation.
- Reproduire fidèlement la langue et le degré de précision montré dans les exemples.
- Pour toutes les listes longues (ex : savoirs, savoir-faire), fournir la longueur requise (même si exemples ci-dessous sont abrégés).
- Pour les exemples, utiliser des placeholders réalistes : (ex : “Décrire les principes de base du [concept central du cours]”).

---

**Résumé importante** :
Pour chaque capacité, générez immédiatement après son texte et sa pondération :
- La liste complète de ses savoirs nécessaires ;
- La liste complète de ses savoir-faire associés (avec cible et seuil) ;
- Les moyens d’évaluation pertinents pour cette capacité.

Générez les autres sections exactement comme décrit, sans ajout ni omission spontanée.
"""
)


def _build_r_dacteur_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "Rédacteur",
        "instructions": R_DACTEUR_INSTRUCTIONS,
        "model": "gpt-4.1-mini",
        "output_type": RDacteurSchema,
        "model_settings": _model_settings(
            temperature=1,
            top_p=1,
            store=True,
        ),
    }
    return Agent(**_build_agent_kwargs(base_kwargs, overrides))


class GetDataFromWebContext:
    def __init__(self, state_infos_manquantes: str) -> None:
        self.state_infos_manquantes = state_infos_manquantes


def get_data_from_web_instructions(
    run_context: RunContextWrapper[GetDataFromWebContext],
    _agent: Agent[GetDataFromWebContext],
) -> str:
    state_infos_manquantes = run_context.context.state_infos_manquantes
    return f"""Ton rôle est de récupérer les informations manquantes pour rédiger le plan-cadre.
Va chercher sur le web pour les informations manquantes.

Voici les informations manquantes:
 {state_infos_manquantes}

code_cours:
nom_cours:
programme:
fil_conducteur:
session:
cours_prealables: []       # Codes + titres
cours_requis: []           # (optionnel)
cours_reliés: []           # (optionnel)
heures_theorie:
heures_lab:
heures_maison:
competences_developpees: []   # Codes + titres
competences_atteintes: []     # Codes + titres
competence_nom:               # Pour la section Description des compétences développées
cours_developpant_une_meme_competence: [] # Pour les activités pratiques
Une idée générale de ce qui devrait se retrouver dans le cours"""


def _build_get_data_from_web_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "Get data from web",
        "instructions": get_data_from_web_instructions,
        "model": "gpt-5-mini",
        "tools": [web_search_preview],
        "model_settings": _model_settings(
            store=True,
            reasoning=Reasoning(
                effort="medium",
                summary="auto",
            ),
        ),
    }
    return Agent(**_build_agent_kwargs(base_kwargs, overrides))


class Triage2Context:
    def __init__(self, input_output_text: str) -> None:
        self.input_output_text = input_output_text


def triage_2_instructions(
    run_context: RunContextWrapper[Triage2Context],
    _agent: Agent[Triage2Context],
) -> str:
    input_output_text = run_context.context.input_output_text
    return f"""Ton rôle : Vérifier si toutes les informations nécessaires sont présentes pour générer un plan-cadre.
Si oui → has_all_details: true
Sinon → has_all_details: false + lister uniquement les éléments manquants

Ne génère pas encore le plan-cadre.

Informations attendues
Le plan-cadre pourra être généré seulement si les champs suivants sont fournis :
code_cours:
nom_cours:
programme:
fil_conducteur:
session:
cours_prealables: []       # Codes + titres cours_requis: []           # (optionnel)
cours_reliés: []           # (optionnel)
heures_theorie:
heures_lab:
heures_maison:
competences_developpees: []   # Codes + titres
competences_atteintes: []     # Codes + titres
competence_nom:               # Pour la section Description des compétences développées cours_developpant_une_meme_competence: [] # Pour les activités pratiques
Une idée générale de ce qui devrait se retrouver dans le cours.

Voici les informations connues {input_output_text}"""


def _build_triage_2_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "Triage 2",
        "instructions": triage_2_instructions,
        "model": "gpt-5",
        "output_type": Triage2Schema,
        "model_settings": _model_settings(
            store=True,
            reasoning=Reasoning(
                effort="minimal",
                summary="auto",
            ),
        ),
    }
    return Agent(**_build_agent_kwargs(base_kwargs, overrides))


class GetDataFromUserContext:
    def __init__(self, state_infos_manquantes: str) -> None:
        self.state_infos_manquantes = state_infos_manquantes


def get_data_from_user_instructions(
    run_context: RunContextWrapper[GetDataFromUserContext],
    _agent: Agent[GetDataFromUserContext],
) -> str:
    state_infos_manquantes = run_context.context.state_infos_manquantes
    return f"""Ton rôle est de récupérer les informations manquantes pour rédiger le plan-cadre.

Arrête-toi et demande à l'utilisateur les informations manquantes.
infos manquantes:
 {state_infos_manquantes}
"""


def _build_get_data_from_user_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "Get data from user",
        "instructions": get_data_from_user_instructions,
        "model": "gpt-5-nano",
        "model_settings": _model_settings(
            store=True,
            reasoning=Reasoning(
                effort="medium",
                summary="auto",
            ),
        ),
    }
    return Agent(**_build_agent_kwargs(base_kwargs, overrides))


_CUSTOM_AGENT_FALLBACK_NAME = "Agent personnalisé"


def _build_custom_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {"name": _CUSTOM_AGENT_FALLBACK_NAME}
    merged = _build_agent_kwargs(base_kwargs, overrides or {})
    name = merged.get("name")
    if not isinstance(name, str) or not name.strip():
        merged["name"] = _CUSTOM_AGENT_FALLBACK_NAME
    return Agent(**merged)


_AGENT_BUILDERS: dict[str, Callable[[dict[str, Any] | None], Agent]] = {
    "triage": _build_triage_agent,
    "r_dacteur": _build_r_dacteur_agent,
    "get_data_from_web": _build_get_data_from_web_agent,
    "triage_2": _build_triage_2_agent,
    "get_data_from_user": _build_get_data_from_user_agent,
}


_STEP_TITLES: dict[str, str] = {
    "triage": "Analyse des informations fournies",
    "r_dacteur": "Rédaction du plan-cadre",
    "get_data_from_web": "Collecte d'exemples externes",
    "triage_2": "Validation après collecte",
    "get_data_from_user": "Demande d'informations supplémentaires",
}


class WorkflowInput(BaseModel):
    input_as_text: str


@dataclass
class WorkflowStepSummary:
    key: str
    title: str
    output: str


@dataclass
class WorkflowEndState:
    slug: str
    status_type: str | None
    status_reason: str | None
    message: str | None


@dataclass
class WorkflowRunSummary:
    steps: list[WorkflowStepSummary]
    final_output: dict[str, Any] | None
    final_node_slug: str | None = None
    end_state: "WorkflowEndState | None" = None


@dataclass
class WorkflowStepStreamUpdate:
    key: str
    title: str
    index: int
    delta: str
    text: str


@dataclass(frozen=True)
class _WidgetBinding:
    path: tuple[str | int, ...]
    component_type: str | None = None
    sample: str | list[str] | None = None


@dataclass(frozen=True)
class _ResponseWidgetConfig:
    source: Literal["library", "variable"]
    slug: str | None
    variables: dict[str, str]
    definition_expression: str | None = None
    await_action: bool | None = None
    output_model: type[BaseModel] | None = None
    bindings: dict[str, _WidgetBinding] = field(default_factory=dict)


def _coerce_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on", "oui"}:
            return True
        if normalized in {"false", "0", "no", "off", "non"}:
            return False
    return None


def _parse_response_widget_config(
    parameters: dict[str, Any] | None,
) -> _ResponseWidgetConfig | None:
    """Extrait la configuration de widget depuis les paramètres d'étape."""

    if not parameters or not isinstance(parameters, dict):
        return None

    candidate = parameters.get("response_widget")
    if candidate is None:
        candidate = parameters.get("widget")
    if isinstance(candidate, str):
        slug = candidate.strip()
        if not slug:
            return None
        return _ResponseWidgetConfig(source="library", slug=slug, variables={})

    if not isinstance(candidate, dict):
        return None

    raw_source = candidate.get("source")
    source = raw_source.strip().lower() if isinstance(raw_source, str) else ""
    definition_expression_raw = candidate.get("definition_expression")
    if not isinstance(definition_expression_raw, str):
        definition_expression_raw = candidate.get("definitionExpression")
    definition_expression = (
        definition_expression_raw.strip() if isinstance(definition_expression_raw, str) else ""
    )
    slug_raw = candidate.get("slug")
    slug = slug_raw.strip() if isinstance(slug_raw, str) else ""

    variables: dict[str, str] = {}
    raw_variables = candidate.get("variables")
    if isinstance(raw_variables, dict):
        for key, expression in raw_variables.items():
            if not isinstance(key, str) or not isinstance(expression, str):
                continue
            trimmed_key = key.strip()
            trimmed_expression = expression.strip()
            if trimmed_key and trimmed_expression:
                variables[trimmed_key] = trimmed_expression

    await_action_value = (
        _coerce_bool(candidate.get("await_action"))
        if "await_action" in candidate
        else _coerce_bool(candidate.get("wait_for_action"))
    )

    if source == "variable" or (not slug and definition_expression):
        if not definition_expression:
            return None
        return _ResponseWidgetConfig(
            source="variable",
            slug=None,
            variables={},
            definition_expression=definition_expression,
            await_action=await_action_value,
        )

    if not slug:
        return None

    return _ResponseWidgetConfig(
        source="library",
        slug=slug,
        variables=variables,
        await_action=await_action_value,
    )


def _sanitize_widget_field_name(candidate: str, *, fallback: str = "value") -> str:
    """Transforme un identifiant de variable en nom de champ valide."""

    normalized = re.sub(r"[^0-9a-zA-Z_]+", "_", candidate).strip("_")
    if not normalized:
        normalized = fallback
    if normalized[0].isdigit():
        normalized = f"_{normalized}"
    return normalized


def _build_widget_output_model(
    slug: str,
    variable_ids: Sequence[str],
    *,
    bindings: Mapping[str, _WidgetBinding] | None = None,
) -> type[BaseModel] | None:
    """Construit un modèle Pydantic correspondant aux variables attendues."""

    unique_variables = [var for var in dict.fromkeys(variable_ids) if var]
    if not unique_variables:
        return None

    field_definitions: dict[str, tuple[Any, Any]] = {}
    used_names: set[str] = set()
    for index, variable_id in enumerate(unique_variables, start=1):
        field_name = _sanitize_widget_field_name(variable_id, fallback=f"field_{index}")
        if field_name in used_names:
            suffix = 1
            base_name = field_name
            while f"{base_name}_{suffix}" in used_names:
                suffix += 1
            field_name = f"{base_name}_{suffix}"
        used_names.add(field_name)
        binding = bindings.get(variable_id) if bindings else None
        description = None
        if binding:
            parts: list[str] = []
            if binding.component_type:
                parts.append(f"Composant : {binding.component_type}")
            sample = binding.sample
            if isinstance(sample, list):
                sample_text = ", ".join(str(item) for item in sample if item is not None)
            elif sample is not None:
                sample_text = str(sample)
            else:
                sample_text = None
            if sample_text:
                parts.append(f"Valeur initiale : {sample_text}")
            if parts:
                description = " | ".join(parts)
        try:
            field = Field(
                default=None,
                alias=variable_id,
                serialization_alias=variable_id,
                description=description,
            )
        except TypeError:
            # Compatibilité avec Pydantic v1 qui n'accepte pas serialization_alias.
            field = Field(default=None, alias=variable_id, description=description)
            if hasattr(field, "serialization_alias"):
                try:
                    setattr(field, "serialization_alias", variable_id)
                except Exception:  # pragma: no cover - dépend des versions de Pydantic
                    pass
        annotation = str | list[str] | None
        field_definitions[field_name] = (annotation, field)

    model_name_parts = [part.capitalize() for part in re.split(r"[^0-9a-zA-Z]+", slug) if part]
    model_name = "".join(model_name_parts) or "Widget"
    model_name = f"{model_name}Response"

    try:
        widget_model = create_model(
            model_name,
            __base__=BaseModel,
            __module__=__name__,
            **field_definitions,
        )
    except Exception as exc:  # pragma: no cover - dépend des versions de Pydantic
        logger.warning(
            "Impossible de créer le modèle structuré pour le widget %s: %s", slug, exc
        )
        return None

    if hasattr(widget_model, "model_config"):
        widget_model.model_config["populate_by_name"] = True
    else:  # pragma: no cover - compatibilité Pydantic v1
        config = getattr(widget_model, "Config", None)
        if config is None:
            class Config:
                allow_population_by_field_name = True
                allow_population_by_alias = True

            widget_model.Config = Config
        else:
            setattr(config, "allow_population_by_field_name", True)
            setattr(config, "allow_population_by_alias", True)

    return widget_model


def _load_widget_definition(slug: str, *, context: str) -> Any | None:
    """Charge la définition JSON d'un widget depuis la bibliothèque."""

    try:
        with SessionLocal() as session:
            service = WidgetLibraryService(session)
            template = service.get_widget(slug)
    except Exception as exc:  # pragma: no cover - dépend du stockage
        logger.exception(
            "Impossible de charger le widget %s dans le contexte %s",
            slug,
            context,
            exc_info=exc,
        )
        return None

    if template is None:
        return None

    try:
        return json.loads(json.dumps(template.definition, ensure_ascii=False))
    except Exception as exc:  # pragma: no cover - dépend du SDK installé
        logger.exception(
            "Impossible de sérialiser le widget %s dans le contexte %s",
            slug,
            context,
            exc_info=exc,
        )
        return None


def _collect_widget_bindings(definition: Any) -> dict[str, _WidgetBinding]:
    """Recense les identifiants dynamiques d'un widget et leur position."""

    bindings: dict[str, _WidgetBinding] = {}

    value_keys = {
        "value",
        "text",
        "title",
        "label",
        "caption",
        "description",
        "body",
        "content",
        "heading",
        "subtitle",
        "icon",
        "iconStart",
        "iconEnd",
    }

    manual_paths: set[tuple[str | int, ...]] = set()

    def _format_component_identifier(
        node: Mapping[str, Any],
        value_key: str,
        *,
        existing: Collection[str],
    ) -> str | None:
        component_type = node.get("type")
        if isinstance(component_type, str):
            component_type = component_type.strip()
        else:
            component_type = None

        def _ensure_unique(base: str) -> str:
            if base not in existing:
                return base
            index = 2
            candidate = f"{base}_{index}"
            while candidate in existing:
                index += 1
                candidate = f"{base}_{index}"
            return candidate

        def _from_button() -> str | None:
            if component_type is None or component_type.lower() != "button":
                return None
            key_attr = node.get("key")
            if isinstance(key_attr, str) and key_attr.strip():
                base = key_attr.strip()
            else:
                action = node.get("onClickAction")
                action_id: str | None = None
                if isinstance(action, Mapping):
                    payload = action.get("payload")
                    if isinstance(payload, Mapping):
                        candidate = payload.get("id")
                        if isinstance(candidate, str) and candidate.strip():
                            action_id = candidate.strip()
                base = action_id
            if not base:
                return None
            normalized_base = base
            if value_key in {"label", "text", "title", "value"}:
                return _ensure_unique(normalized_base)
            if value_key in {"icon", "iconStart", "iconEnd"}:
                suffix = "icon" if value_key != "iconEnd" else "icon_end"
                return _ensure_unique(f"{normalized_base}.{suffix}")
            return _ensure_unique(f"{normalized_base}.{value_key}")

        button_identifier = _from_button()
        if button_identifier:
            return button_identifier

        if component_type:
            normalized_type = component_type.lower()
            alias_map = {
                "title": "title",
                "subtitle": "subtitle",
                "heading": "heading",
                "text": "text",
                "caption": "caption",
                "markdown": "markdown",
                "badge": "badge",
            }
            alias = alias_map.get(normalized_type)
            if alias and value_key in {"value", "text", "title", "label", "content", "body"}:
                return _ensure_unique(alias)

        name_attr = node.get("name")
        if isinstance(name_attr, str) and name_attr.strip():
            return _ensure_unique(name_attr.strip())

        return None

    def _register(
        identifier: str | None,
        path: tuple[str | int, ...],
        node: dict[str, Any],
        *,
        is_manual: bool,
        value_key: str | None = None,
    ) -> None:
        if not identifier:
            return
        if identifier in bindings:
            return
        if not is_manual and path in manual_paths:
            return
        component_type = node.get("type") if isinstance(node.get("type"), str) else None
        sample: str | list[str] | None = None
        candidate_keys: tuple[str, ...]
        if value_key:
            candidate_keys = (
                value_key,
                "value",
                "text",
                "label",
                "src",
                "url",
                "href",
                "icon",
                "iconStart",
                "iconEnd",
            )
        else:
            candidate_keys = (
                "value",
                "text",
                "label",
                "src",
                "url",
                "href",
                "icon",
                "iconStart",
                "iconEnd",
            )
        for candidate_key in candidate_keys:
            if candidate_key not in node:
                continue
            raw_value = node.get(candidate_key)
            if isinstance(raw_value, list):
                sample = [str(item) for item in raw_value]
                break
            if isinstance(raw_value, (str, int, float, bool)):
                sample = str(raw_value)
                break
        bindings[identifier] = _WidgetBinding(
            path=path,
            component_type=component_type,
            sample=sample,
        )
        if is_manual:
            manual_paths.add(path)

    def _walk(node: Any, path: tuple[str | int, ...]) -> None:
        if isinstance(node, dict):
            identifier = node.get("id")
            if isinstance(identifier, str):
                _register(identifier, path, node, is_manual=True)

            editable = node.get("editable")
            if isinstance(editable, dict):
                editable_name = editable.get("name")
                if isinstance(editable_name, str):
                    _register(editable_name, path, node, is_manual=True)
                editable_names = editable.get("names")
                if isinstance(editable_names, (list, tuple)):
                    for entry in editable_names:
                        if isinstance(entry, str):
                            _register(entry, path, node, is_manual=True)

            name_attr = node.get("name")
            if isinstance(name_attr, str):
                _register(name_attr, path, node, is_manual=True)

            for key in value_keys:
                if key not in node:
                    continue
                raw_value = node[key]
                identifier = _format_component_identifier(
                    node, key, existing=bindings.keys()
                )
                if not identifier:
                    identifier_parts = [
                        str(part) for part in (*path, key) if str(part)
                    ]
                    if not identifier_parts:
                        continue
                    identifier = ".".join(identifier_parts)
                if isinstance(raw_value, (str, int, float, bool)):
                    _register(identifier, path, node, is_manual=False, value_key=key)
                elif isinstance(raw_value, list):
                    simple_values = [
                        str(item)
                        for item in raw_value
                        if isinstance(item, (str, int, float, bool))
                    ]
                    if simple_values:
                        _register(
                            identifier,
                            path,
                            node,
                            is_manual=False,
                            value_key=key,
                        )

            for key, child in node.items():
                if isinstance(child, (dict, list)):
                    _walk(child, (*path, key))
        elif isinstance(node, list):
            for index, entry in enumerate(node):
                if isinstance(entry, (dict, list)):
                    _walk(entry, (*path, index))

    _walk(definition, ())
    return bindings


_UNSET = object()
"""Sentinelle interne pour différencier absence et mise à jour explicite."""


def _as_mapping(value: Any) -> Mapping[str, Any] | None:
    if isinstance(value, Mapping):
        return value
    return None


def _clone_widget_definition(definition: Any) -> Any | None:
    if definition is None:
        return None
    try:
        return json.loads(json.dumps(definition, ensure_ascii=False))
    except Exception:
        return None


def _json_safe_copy(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _json_safe_copy(item) for key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_json_safe_copy(entry) for entry in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _extract_widget_slug(data: Mapping[str, Any]) -> str | None:
    for key in ("slug", "widget_slug", "widgetSlug"):
        raw = data.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
    raw_widget = data.get("widget")
    if isinstance(raw_widget, str) and raw_widget.strip():
        return raw_widget.strip()
    return None


def _extract_widget_values(data: Mapping[str, Any]) -> dict[str, Any]:
    values: dict[str, Any] = {}

    def _merge(candidate: Mapping[str, Any]) -> None:
        for key, value in candidate.items():
            if isinstance(key, str):
                trimmed = key.strip()
                if trimmed:
                    values[trimmed] = value

    for value_key in ("values", "variables"):
        candidate = _as_mapping(data.get(value_key))
        if candidate:
            _merge(candidate)

    updates = data.get("updates")
    if isinstance(updates, Sequence):
        for entry in updates:
            candidate = _as_mapping(entry)
            if not candidate:
                continue
            identifier = candidate.get("id")
            if not isinstance(identifier, str) or not identifier.strip():
                identifier = candidate.get("identifier")
            if not isinstance(identifier, str) or not identifier.strip():
                identifier = candidate.get("binding")
            if not isinstance(identifier, str) or not identifier.strip():
                identifier = candidate.get("target")
            if not isinstance(identifier, str) or not identifier.strip():
                identifier = candidate.get("name")
            if isinstance(identifier, str) and identifier.strip():
                values[identifier.strip()] = candidate.get("value")

    return values


def _extract_widget_bindings_from_payload(
    data: Mapping[str, Any]
) -> dict[str, _WidgetBinding]:
    bindings: dict[str, _WidgetBinding] = {}
    raw_bindings = _as_mapping(data.get("bindings"))
    if not raw_bindings:
        return bindings

    for identifier, raw_binding in raw_bindings.items():
        if not isinstance(identifier, str):
            continue
        trimmed = identifier.strip()
        if not trimmed:
            continue
        binding_mapping = _as_mapping(raw_binding)
        if not binding_mapping:
            continue
        path_value = binding_mapping.get("path")
        if not isinstance(path_value, Sequence):
            continue
        normalized_path: list[str | int] = []
        valid_path = True
        for step in path_value:
            if isinstance(step, str):
                normalized_path.append(step)
            elif isinstance(step, int):
                normalized_path.append(step)
            else:
                valid_path = False
                break
        if not valid_path:
            continue
        component_type = binding_mapping.get("component_type")
        if not isinstance(component_type, str):
            component_type = binding_mapping.get("componentType")
            if not isinstance(component_type, str):
                component_type = None
        sample_value = binding_mapping.get("sample")
        sample: str | list[str] | None
        if isinstance(sample_value, Sequence) and not isinstance(
            sample_value, (str, bytes, bytearray)
        ):
            sample = [
                str(entry)
                for entry in sample_value
                if isinstance(entry, (str, int, float, bool))
            ]
        elif sample_value is None:
            sample = None
        else:
            sample = str(sample_value)
        bindings[trimmed] = _WidgetBinding(
            path=tuple(normalized_path),
            component_type=component_type,
            sample=sample,
        )
    return bindings


def _extract_copy_text_update(data: Mapping[str, Any]) -> object:
    for key in ("copy_text", "copyText"):
        if key in data:
            value = data[key]
            if value is None:
                return None
            if isinstance(value, (str, int, float)):
                return str(value)
            return _UNSET
    return _UNSET


def _resolve_widget_action_payload(
    payload: Mapping[str, Any]
) -> tuple[str | None, Any | None, dict[str, Any], dict[str, _WidgetBinding], object]:
    container = _as_mapping(payload.get("widget")) or payload

    slug = _extract_widget_slug(container) or _extract_widget_slug(payload)

    definition = (
        _clone_widget_definition(
            container.get("definition")
            or container.get("widget_definition")
            or container.get("widgetDefinition")
        )
        or _clone_widget_definition(
            payload.get("definition")
            or payload.get("widget_definition")
            or payload.get("widgetDefinition")
        )
    )

    values = _extract_widget_values(payload)
    if container is not payload:
        values.update(_extract_widget_values(container))

    bindings = _extract_widget_bindings_from_payload(payload)
    if container is not payload:
        bindings.update(_extract_widget_bindings_from_payload(container))

    copy_text = _extract_copy_text_update(container)
    if copy_text is _UNSET:
        copy_text = _extract_copy_text_update(payload)

    return slug, definition, values, bindings, copy_text


def _ensure_widget_output_model(
    config: _ResponseWidgetConfig,
) -> _ResponseWidgetConfig:
    if config.source != "library" or not config.slug:
        return config

    if config.output_model is not None:
        return config

    variable_ids = list(config.variables.keys())
    definition = _load_widget_definition(config.slug, context="configuration")
    if definition is None:
        logger.warning(
            "Widget %s introuvable lors de la préparation du schéma de sortie",
            config.slug,
        )
    else:
        bindings = _collect_widget_bindings(definition)
        for identifier in bindings:
            if identifier not in variable_ids:
                variable_ids.append(identifier)
        config = replace(config, bindings=bindings)

    if config.bindings and not variable_ids:
        variable_ids.extend(config.bindings.keys())

    model = _build_widget_output_model(
        config.slug, variable_ids, bindings=config.bindings
    )
    if model is None:
        return config
    return replace(config, output_model=model)


def _should_wait_for_widget_action(
    step_kind: str,
    config: _ResponseWidgetConfig | None,
) -> bool:
    if config is None:
        return False
    if config.await_action is not None:
        return config.await_action
    return step_kind == "widget"


class WorkflowExecutionError(RuntimeError):
    def __init__(
        self,
        step: str,
        title: str,
        original_error: Exception,
        steps: list[WorkflowStepSummary],
    ) -> None:
        super().__init__(str(original_error))
        self.step = step
        self.title = title
        self.original_error = original_error
        self.steps = steps

    def __str__(self) -> str:
        return f"{self.title} ({self.step}) : {self.original_error}"


def _format_step_output(payload: Any) -> str:
    if payload is None:
        return "(aucune sortie)"

    if isinstance(payload, BaseModel):
        payload = payload.model_dump()

    if isinstance(payload, (dict, list)):
        try:
            return json.dumps(payload, ensure_ascii=False, indent=2)
        except TypeError:
            return str(payload)

    if isinstance(payload, str):
        text_value = payload.strip()
        if not text_value:
            return "(aucune sortie)"

        try:
            parsed = json.loads(text_value)
        except json.JSONDecodeError:
            return text_value

        if isinstance(parsed, (dict, list)):
            try:
                return json.dumps(parsed, ensure_ascii=False, indent=2)
            except TypeError:
                return str(parsed)
        return str(parsed)

    return str(payload)


def _resolve_watch_payload(
    context: Any, steps: Sequence["WorkflowStepSummary"]
) -> Any:
    if isinstance(context, Mapping):
        for key in ("output_parsed", "output_text", "output", "assistant_message"):
            candidate = context.get(key)
            if candidate not in (None, "", {}):
                return candidate
    if context is not None:
        return context
    if steps:
        return steps[-1].output
    return None


async def run_workflow(
    workflow_input: WorkflowInput,
    *,
    agent_context: AgentContext[Any],
    on_step: Callable[[WorkflowStepSummary, int], Awaitable[None]] | None = None,
    on_step_stream: Callable[[WorkflowStepStreamUpdate], Awaitable[None]] | None = None,
    on_stream_event: Callable[[ThreadStreamEvent], Awaitable[None]] | None = None,
    on_widget_step: Callable[
        [WorkflowStep, _ResponseWidgetConfig], Awaitable[Mapping[str, Any] | None]
    ]
    | None = None,
    workflow_service: WorkflowService | None = None,
) -> WorkflowRunSummary:
    workflow_payload = workflow_input.model_dump()
    steps: list[WorkflowStepSummary] = []
    auto_started = bool(workflow_payload.get("auto_start_was_triggered"))
    initial_user_text = _normalize_user_text(workflow_payload["input_as_text"])
    workflow_payload["input_as_text"] = initial_user_text
    conversation_history: list[TResponseInputItem] = []
    if initial_user_text.strip():
        conversation_history.append(
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": initial_user_text,
                    }
                ],
            }
        )
    state: dict[str, Any] = {
        "has_all_details": False,
        "infos_manquantes": initial_user_text,
        "should_finalize": False,
    }
    final_output: dict[str, Any] | None = None
    last_step_context: dict[str, Any] | None = None

    service = workflow_service or WorkflowService()
    definition = service.get_current()

    should_auto_start = resolve_start_auto_start(definition)
    if not auto_started and not initial_user_text.strip() and should_auto_start:
        configured_message = _normalize_user_text(
            resolve_start_auto_start_message(definition)
        )
        if configured_message:
            auto_started = True
            initial_user_text = configured_message
            workflow_payload["input_as_text"] = initial_user_text
            conversation_history.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": configured_message,
                        }
                    ],
                }
            )
            state["infos_manquantes"] = configured_message

    assistant_message_payload = workflow_payload.get("auto_start_assistant_message")
    if not isinstance(assistant_message_payload, str):
        assistant_message_payload = resolve_start_auto_start_assistant_message(definition)

    assistant_message = _normalize_user_text(assistant_message_payload)
    if auto_started and assistant_message and not initial_user_text.strip():
        conversation_history.append(
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": assistant_message,
                    }
                ],
            }
        )

    nodes_by_slug: dict[str, WorkflowStep] = {
        step.slug: step for step in definition.steps if step.is_enabled
    }
    if not nodes_by_slug:
        raise WorkflowExecutionError(
            "configuration",
            "Configuration du workflow invalide",
            RuntimeError("Aucun nœud actif disponible"),
            [],
        )

    transitions = [
        transition
        for transition in definition.transitions
        if transition.source_step.slug in nodes_by_slug
        and transition.target_step.slug in nodes_by_slug
    ]

    start_step = next(
        (step for step in nodes_by_slug.values() if step.kind == "start"),
        None,
    )
    if start_step is None:
        raise WorkflowExecutionError(
            "configuration",
            "Configuration du workflow invalide",
            RuntimeError("Nœud de début introuvable"),
            [],
        )

    agent_steps_ordered = [
        step
        for step in sorted(definition.steps, key=lambda s: s.position)
        if step.kind == "agent" and step.is_enabled and step.slug in nodes_by_slug
    ]

    agent_positions = {
        step.slug: index for index, step in enumerate(agent_steps_ordered, start=1)
    }
    total_runtime_steps = len(agent_steps_ordered)

    widget_configs_by_step: dict[str, _ResponseWidgetConfig] = {}

    def _register_widget_config(step: WorkflowStep) -> _ResponseWidgetConfig | None:
        widget_config = _parse_response_widget_config(step.parameters)
        if widget_config is None:
            return None
        widget_config = _ensure_widget_output_model(widget_config)
        widget_configs_by_step[step.slug] = widget_config
        return widget_config

    for step in nodes_by_slug.values():
        if step.kind == "widget":
            _register_widget_config(step)

    agent_instances: dict[str, Agent] = {}
    for step in agent_steps_ordered:
        widget_config = _register_widget_config(step)

        agent_key = (step.agent_key or "").strip()
        builder = _AGENT_BUILDERS.get(agent_key)
        overrides_raw = step.parameters or {}
        overrides = dict(overrides_raw)

        if widget_config is not None and widget_config.output_model is not None:
            overrides.pop("response_format", None)
            overrides["output_type"] = widget_config.output_model

        if builder is None:
            if agent_key:
                raise WorkflowExecutionError(
                    "configuration",
                    "Configuration du workflow invalide",
                    RuntimeError(f"Agent inconnu : {agent_key}"),
                    [],
                )
            agent_instances[step.slug] = _build_custom_agent(overrides)
        else:
            agent_instances[step.slug] = builder(overrides)

    if agent_steps_ordered and all(
        (step.agent_key == "r_dacteur") for step in agent_steps_ordered
    ):
        state["should_finalize"] = True

    edges_by_source: dict[str, list[WorkflowTransition]] = {}
    for transition in transitions:
        edges_by_source.setdefault(transition.source_step.slug, []).append(transition)
    for edge_list in edges_by_source.values():
        edge_list.sort(key=lambda tr: tr.id or 0)

    def _sanitize_end_value(value: Any) -> str | None:
        if isinstance(value, str):
            cleaned = value.strip()
            if cleaned:
                return cleaned
        return None

    def _parse_end_state(step: WorkflowStep) -> WorkflowEndState:
        raw_params = step.parameters or {}
        params = raw_params if isinstance(raw_params, Mapping) else {}

        status_raw = params.get("status")
        status_type = None
        status_reason = None
        if isinstance(status_raw, Mapping):
            status_type = _sanitize_end_value(status_raw.get("type"))
            status_reason = _sanitize_end_value(status_raw.get("reason")) or status_reason

        for key in ("status_reason", "reason"):
            fallback = _sanitize_end_value(params.get(key))
            if fallback:
                status_reason = status_reason or fallback
                break

        message = _sanitize_end_value(params.get("message"))

        return WorkflowEndState(
            slug=step.slug,
            status_type=status_type,
            status_reason=status_reason,
            message=message,
        )

    def _resolve_assistant_message(step: WorkflowStep) -> str:
        raw_params = step.parameters or {}
        params = raw_params if isinstance(raw_params, Mapping) else {}
        message = params.get("message")
        if isinstance(message, str):
            return message
        fallback_text = params.get("text")
        if isinstance(fallback_text, str):
            return fallback_text
        status = params.get("status")
        if isinstance(status, Mapping):
            reason = status.get("reason")
            if isinstance(reason, str):
                return reason
        return ""

    def _workflow_run_config() -> RunConfig:
        metadata: dict[str, str] = {"__trace_source__": "agent-builder"}
        if definition.workflow_id is not None:
            metadata["workflow_db_id"] = str(definition.workflow_id)
        if definition.workflow and definition.workflow.slug:
            metadata["workflow_slug"] = definition.workflow.slug
        if definition.workflow and definition.workflow.display_name:
            metadata["workflow_name"] = definition.workflow.display_name
        return RunConfig(trace_metadata=metadata)

    async def record_step(step_key: str, title: str, payload: Any) -> None:
        formatted_output = _format_step_output(payload)
        print(
            f"[Workflow] Payload envoyé pour l'étape {step_key} ({title}) :\n{formatted_output}"
        )
        summary = WorkflowStepSummary(
            key=step_key,
            title=title,
            output=formatted_output,
        )
        steps.append(summary)
        if on_step is not None:
            await on_step(summary, len(steps))

    def raise_step_error(step_key: str, title: str, error: Exception) -> None:
        raise WorkflowExecutionError(step_key, title, error, list(steps)) from error

    def _structured_output_as_json(output: Any) -> tuple[Any, str]:
        if hasattr(output, "model_dump"):
            try:
                parsed = output.model_dump(by_alias=True)
            except TypeError:
                parsed = output.model_dump()
            return parsed, json.dumps(parsed, ensure_ascii=False)
        if hasattr(output, "dict"):
            try:
                parsed = output.dict(by_alias=True)
            except TypeError:
                parsed = output.dict()
            return parsed, json.dumps(parsed, ensure_ascii=False)
        if isinstance(output, (dict, list)):
            return output, json.dumps(output, ensure_ascii=False)
        return output, str(output)

    def _resolve_from_container(value: Any, path: str) -> Any:
        """Récupère une valeur imbriquée en gérant les alias Pydantic."""

        def _as_mapping(candidate: Any) -> dict[str, Any] | None:
            if isinstance(candidate, dict):
                return candidate
            if hasattr(candidate, "model_dump"):
                try:
                    dumped = candidate.model_dump(by_alias=True)
                except TypeError:
                    dumped = candidate.model_dump()
                if isinstance(dumped, dict):
                    return dumped
            if hasattr(candidate, "dict"):
                try:
                    dumped = candidate.dict(by_alias=True)
                except TypeError:
                    dumped = candidate.dict()
                if isinstance(dumped, dict):
                    return dumped
            return None

        def _resolve(current: Any, parts: list[str]) -> Any:
            if not parts:
                return current

            if isinstance(current, (list, tuple)):
                head, *tail = parts
                try:
                    index = int(head)
                except ValueError:
                    return None
                if 0 <= index < len(current):
                    return _resolve(current[index], tail)
                return None

            mapping = _as_mapping(current)
            if mapping is not None:
                head, *tail = parts
                if head in mapping:
                    return _resolve(mapping[head], tail)
                if tail:
                    for join_index in range(len(parts), 1, -1):
                        candidate_key = ".".join(parts[:join_index])
                        if candidate_key in mapping:
                            return _resolve(
                                mapping[candidate_key],
                                parts[join_index:],
                            )
                return None

            head, *tail = parts
            if hasattr(current, head):
                return _resolve(getattr(current, head), tail)

            return None

        parts = [segment for segment in path.split(".") if segment]
        return _resolve(value, parts)

    def _assign_state_value(target_path: str, value: Any) -> None:
        path_parts = [part for part in target_path.split(".") if part]
        if not path_parts:
            raise ValueError("Chemin de mise à jour d'état manquant.")
        if path_parts[0] != "state":
            raise ValueError("Les mises à jour doivent commencer par 'state.'")
        cursor: Any = state
        for part in path_parts[1:-1]:
            next_value = cursor.get(part)
            if next_value is None:
                next_value = {}
                cursor[part] = next_value
            elif not isinstance(next_value, dict):
                raise ValueError(
                    f"Impossible d'écrire dans state.{part} : valeur existante incompatible."
                )
            cursor = next_value
        cursor[path_parts[-1]] = value

    def _evaluate_state_expression(
        expression: Any, *, input_context: dict[str, Any] | None = None
    ) -> Any:
        if expression is None:
            return None
        if isinstance(expression, (bool, int, float, dict, list)):
            return expression
        if isinstance(expression, str):
            expr = expression.strip()
            if not expr:
                return None
            if expr == "state":
                return state
            if expr == "input":
                context = last_step_context if input_context is None else input_context
                if context is None:
                    raise RuntimeError(
                        "Aucun résultat précédent disponible pour l'expression 'input'."
                    )
                return context
            if expr.startswith("state."):
                return _resolve_from_container(state, expr[len("state.") :])
            if expr.startswith("input."):
                context = last_step_context if input_context is None else input_context
                if context is None:
                    raise RuntimeError(
                        "Aucun résultat précédent disponible pour les expressions basées sur 'input'."
                    )
                return _resolve_from_container(context, expr[len("input.") :])
            try:
                return json.loads(expr)
            except json.JSONDecodeError:
                return expr
        return expression

    def _apply_state_node(step: WorkflowStep) -> None:
        params = step.parameters or {}
        operations = params.get("state")
        if operations is None:
            return
        if not isinstance(operations, list):
            raise ValueError(
                "Le paramètre 'state' doit être une liste d'opérations."
            )
        for entry in operations:
            if not isinstance(entry, dict):
                raise ValueError(
                    "Chaque opération de mise à jour d'état doit être un objet."
                )
            target_raw = entry.get("target")
            target = str(target_raw).strip() if target_raw is not None else ""
            if not target:
                raise ValueError(
                    "Chaque opération doit préciser une cible 'target'."
                )
            value = _evaluate_state_expression(entry.get("expression"))
            _assign_state_value(target, value)

    def _extract_delta(event: ThreadStreamEvent) -> str:
        if isinstance(event, ThreadItemUpdated):
            update = event.update
            if isinstance(update, AssistantMessageContentPartTextDelta):
                return update.delta or ""
        return ""

    def _stringify_widget_value(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, BaseModel):
            try:
                value = value.model_dump(by_alias=True)
            except TypeError:
                value = value.model_dump()
        if isinstance(value, (dict, list)):
            try:
                return json.dumps(value, ensure_ascii=False)
            except TypeError:
                return str(value)
        return str(value)

    def _collect_widget_values_from_output(
        output: Any,
        *,
        bindings: Mapping[str, _WidgetBinding] | None = None,
    ) -> dict[str, str | list[str]]:
        """Aplati les sorties structurées en valeurs consommables par un widget."""

        collected: dict[str, str | list[str]] = {}

        def _normalize(candidate: Any) -> Any:
            if isinstance(candidate, BaseModel):
                try:
                    return candidate.model_dump(by_alias=True)
                except TypeError:
                    return candidate.model_dump()
            return candidate

        def _walk(current: Any, path: str) -> None:
            current = _normalize(current)
            if isinstance(current, dict):
                for key, value in current.items():
                    if not isinstance(key, str):
                        continue
                    next_path = f"{path}.{key}" if path else key
                    _walk(value, next_path)
                return
            if isinstance(current, list):
                simple_values: list[str] = []
                has_complex_items = False
                for item in current:
                    normalized = _normalize(item)
                    if isinstance(normalized, (dict, list)):
                        has_complex_items = True
                        break
                    simple_values.append(_stringify_widget_value(normalized))
                if simple_values and not has_complex_items and path:
                    collected[path] = simple_values
                    return
                for index, item in enumerate(current):
                    next_path = f"{path}.{index}" if path else str(index)
                    _walk(item, next_path)
                return
            if path:
                collected[path] = _stringify_widget_value(current)

        _walk(output, "")

        if not bindings:
            return collected

        enriched = dict(collected)
        consumed_keys: set[str] = set()
        for identifier, binding in bindings.items():
            path_parts: list[str] = []
            for step in binding.path:
                if isinstance(step, str):
                    path_parts.append(step)
                else:
                    path_parts.append(str(step))
            base_path = ".".join(path_parts)
            for suffix in ("value", "text", "src", "url", "href"):
                key = f"{base_path}.{suffix}" if base_path else suffix
                if key in collected:
                    enriched[identifier] = collected[key]
                    if identifier != key:
                        consumed_keys.add(key)
                    break

        for key in consumed_keys:
            enriched.pop(key, None)

        return enriched

    async def _ingest_vector_store_document(
        slug: str,
        doc_id: str,
        document: dict[str, Any],
        metadata: dict[str, Any],
    ) -> None:
        def _ingest_sync() -> None:
            with SessionLocal() as session:
                service = JsonVectorStoreService(session)
                try:
                    service.ingest(
                        slug,
                        doc_id,
                        document,
                        document_metadata=metadata,
                    )
                    session.commit()
                except Exception:
                    session.rollback()
                    raise

        try:
            await asyncio.to_thread(_ingest_sync)
        except LookupError:
            logger.warning(
                "Vector store %s introuvable : impossible d'enregistrer le document %s",
                slug,
                doc_id,
            )
        except Exception as exc:  # pragma: no cover - dépend du runtime
            logger.exception(
                "Erreur lors de l'ingestion du document %s dans %s",
                doc_id,
                slug,
                exc_info=exc,
            )

    async def _apply_vector_store_ingestion(
        *,
        config: dict[str, Any] | None,
        step_slug: str,
        step_title: str,
        step_context: dict[str, Any] | None,
    ) -> None:
        if not isinstance(config, dict):
            return

        slug_raw = config.get("vector_store_slug")
        slug = str(slug_raw).strip() if isinstance(slug_raw, str) else ""
        if not slug:
            logger.debug(
                "Configuration vector_store_ingestion ignorée pour %s : slug absent.",
                step_slug,
            )
            return

        if not isinstance(step_context, dict):
            logger.warning(
                "Impossible d'ingérer le document JSON pour %s : aucun contexte disponible.",
                step_slug,
            )
            return

        def _to_mapping(candidate: Any, *, purpose: str) -> dict[str, Any] | None:
            if hasattr(candidate, "model_dump"):
                try:
                    return candidate.model_dump(by_alias=True)
                except TypeError:
                    return candidate.model_dump()
            if hasattr(candidate, "dict"):
                try:
                    return candidate.dict(by_alias=True)
                except TypeError:
                    return candidate.dict()
            if isinstance(candidate, str):
                trimmed = candidate.strip()
                if not trimmed:
                    return None
                try:
                    decoded = json.loads(trimmed)
                except json.JSONDecodeError:
                    if purpose == "document":
                        logger.warning(
                            "Le document produit par %s n'est pas un JSON valide pour l'ingestion.",
                            step_slug,
                        )
                    else:
                        logger.warning(
                            "Les métadonnées calculées pour %s ne sont pas un JSON valide.",
                            step_slug,
                        )
                    return None
                if isinstance(decoded, dict):
                    return decoded
                if purpose == "document":
                    logger.warning(
                        "Le document généré par %s doit être un objet JSON pour être indexé (type %s).",
                        step_slug,
                        type(decoded).__name__,
                    )
                else:
                    logger.warning(
                        "Les métadonnées calculées pour %s doivent être un objet JSON (type %s).",
                        step_slug,
                        type(decoded).__name__,
                    )
                return None
            if isinstance(candidate, dict):
                return candidate
            return None

        doc_id_expression_raw = config.get("doc_id_expression") or config.get("doc_id")
        doc_id_expression = (
            doc_id_expression_raw.strip()
            if isinstance(doc_id_expression_raw, str)
            else ""
        )
        doc_id_value: Any = None
        if doc_id_expression:
            try:
                doc_id_value = _evaluate_state_expression(
                    doc_id_expression, input_context=step_context
                )
            except Exception as exc:  # pragma: no cover - dépend des expressions fournies
                logger.exception(
                    "Impossible d'évaluer l'expression d'identifiant '%s' pour %s",
                    doc_id_expression,
                    step_slug,
                    exc_info=exc,
                )

        doc_id = str(doc_id_value).strip() if doc_id_value is not None else ""
        if not doc_id:
            parsed_context = step_context.get("output_parsed")
            if isinstance(parsed_context, dict):
                for key in ("doc_id", "id", "slug", "reference", "uid"):
                    candidate = parsed_context.get(key)
                    if candidate is None:
                        continue
                    candidate_str = str(candidate).strip()
                    if candidate_str:
                        doc_id = candidate_str
                        break
            if not doc_id:
                generated = uuid.uuid4().hex
                doc_id = f"{step_slug}-{generated}" if step_slug else generated
                logger.info(
                    "Identifiant de document généré automatiquement pour %s : %s",
                    step_slug,
                    doc_id,
                )

        document_expression_raw = (
            config.get("document_expression") or config.get("document")
        )
        document_expression = (
            document_expression_raw.strip()
            if isinstance(document_expression_raw, str)
            else ""
        )
        document_value: Any = None
        if document_expression:
            try:
                document_value = _evaluate_state_expression(
                    document_expression, input_context=step_context
                )
            except Exception as exc:  # pragma: no cover - dépend des expressions fournies
                logger.exception(
                    "Impossible d'évaluer l'expression de document '%s' pour %s",
                    document_expression,
                    step_slug,
                    exc_info=exc,
                )

        if document_value is None:
            for candidate_key in ("output_parsed", "output", "output_text"):
                candidate_value = step_context.get(candidate_key)
                mapping = _to_mapping(candidate_value, purpose="document")
                if mapping is not None:
                    document_value = mapping
                    break

        document_mapping = _to_mapping(document_value, purpose="document")
        if document_mapping is None:
            logger.warning(
                "Le document généré par %s doit être un objet JSON pour être indexé (type %s).",
                step_slug,
                type(document_value).__name__ if document_value is not None else "None",
            )
            return

        metadata: dict[str, Any] = {
            "workflow_step": step_slug,
            "workflow_step_title": step_title,
        }

        metadata_expression_raw = config.get("metadata_expression")
        metadata_expression = (
            metadata_expression_raw.strip()
            if isinstance(metadata_expression_raw, str)
            else ""
        )

        if metadata_expression:
            try:
                metadata_value = _evaluate_state_expression(
                    metadata_expression, input_context=step_context
                )
            except Exception as exc:  # pragma: no cover - dépend des expressions fournies
                logger.exception(
                    "Impossible d'évaluer l'expression de métadonnées '%s' pour %s",
                    metadata_expression,
                    step_slug,
                    exc_info=exc,
                )
            else:
                metadata_mapping = _to_mapping(metadata_value, purpose="metadata")
                if metadata_mapping is not None:
                    metadata.update(metadata_mapping)
                elif metadata_value is not None:
                    logger.warning(
                        "Les métadonnées calculées pour %s doivent être un objet JSON.",
                        step_slug,
                    )

        logger.info(
            "Ingestion du résultat JSON de %s dans le vector store %s (doc_id=%s)",
            step_slug,
            slug,
            doc_id,
        )
        await _ingest_vector_store_document(slug, doc_id, document_mapping, metadata)

    def _evaluate_widget_variable_expression(
        expression: str, *, input_context: dict[str, Any] | None
    ) -> str | None:
        if not expression.strip():
            return None
        try:
            raw_value = _evaluate_state_expression(
                expression, input_context=input_context
            )
        except Exception as exc:  # pragma: no cover - dépend du contenu utilisateur
            logger.warning(
                "Impossible d'évaluer l'expression %s pour un widget : %s",
                expression,
                exc,
            )
            return None
        if raw_value is None:
            return None
        return _stringify_widget_value(raw_value)

    def _update_widget_node_value(
        node: dict[str, Any],
        value: str | list[str],
    ) -> None:
        if isinstance(value, list):
            node["value"] = value
            return
        text = value
        if "value" in node:
            node["value"] = text
        elif "text" in node:
            node["text"] = text
        else:
            node["value"] = text

    def _apply_widget_variable_values(
        definition: Any,
        values: dict[str, str | list[str]],
        *,
        bindings: Mapping[str, _WidgetBinding] | None = None,
    ) -> set[str]:
        matched: set[str] = set()

        def _walk(node: Any) -> None:
            if isinstance(node, dict):
                identifier = node.get("id")
                if isinstance(identifier, str) and identifier in values:
                    _update_widget_node_value(node, values[identifier])
                    matched.add(identifier)
                editable = node.get("editable")
                if isinstance(editable, dict):
                    editable_name = editable.get("name")
                    if (
                        isinstance(editable_name, str)
                        and editable_name in values
                        and editable_name not in matched
                    ):
                        _update_widget_node_value(node, values[editable_name])
                        matched.add(editable_name)
                    editable_names = editable.get("names")
                    if isinstance(editable_names, list):
                        collected = [
                            values[name]
                            for name in editable_names
                            if isinstance(name, str) and name in values
                        ]
                        if collected:
                            _update_widget_node_value(node, collected)
                            matched.update(
                                name
                                for name in editable_names
                                if isinstance(name, str) and name in values
                            )
                    elif (
                        isinstance(editable_names, str)
                        and editable_names in values
                        and editable_names not in matched
                    ):
                        _update_widget_node_value(node, values[editable_names])
                        matched.add(editable_names)
                for child in node.values():
                    if isinstance(child, (dict, list)):
                        _walk(child)
            elif isinstance(node, list):
                for entry in node:
                    _walk(entry)

        _walk(definition)

        if bindings:
            for identifier, binding in bindings.items():
                if identifier in matched:
                    continue
                if identifier not in values:
                    continue

                target: Any = definition
                valid_path = True
                for step in binding.path:
                    if isinstance(step, str):
                        if not isinstance(target, dict) or step not in target:
                            valid_path = False
                            break
                        target = target[step]
                    else:
                        if not isinstance(target, list):
                            valid_path = False
                            break
                        if step < 0 or step >= len(target):
                            valid_path = False
                            break
                        target = target[step]

                if not valid_path or not isinstance(target, dict):
                    continue

                _update_widget_node_value(target, values[identifier])
                matched.add(identifier)

        return matched

    async def _stream_response_widget(
        config: _ResponseWidgetConfig,
        *,
        step_slug: str,
        step_title: str,
        step_context: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        widget_label = config.slug or config.definition_expression or step_slug

        definition: Any
        bindings = config.bindings

        if config.source == "variable":
            expression = config.definition_expression or ""
            if not expression:
                logger.warning(
                    "Expression de widget manquante pour l'étape %s", step_slug
                )
                return None
            try:
                definition_candidate = _evaluate_state_expression(
                    expression, input_context=step_context
                )
            except Exception as exc:  # pragma: no cover - dépend du contenu utilisateur
                logger.warning(
                    "Impossible d'évaluer l'expression %s pour l'étape %s : %s",
                    expression,
                    step_slug,
                    exc,
                )
                return None

            definition = definition_candidate
            if isinstance(definition, BaseModel):
                try:
                    definition = definition.model_dump(by_alias=True)
                except TypeError:
                    definition = definition.model_dump()
            if isinstance(definition, str):
                try:
                    definition = json.loads(definition)
                except json.JSONDecodeError as exc:  # pragma: no cover - dépend du contenu
                    logger.warning(
                        "Le JSON renvoyé par %s est invalide pour l'étape %s : %s",
                        expression,
                        step_slug,
                        exc,
                    )
                    return None
            if not isinstance(definition, (dict, list)):
                logger.warning(
                    "L'expression %s doit renvoyer un objet JSON utilisable pour le widget de l'étape %s",
                    expression,
                    step_slug,
                )
                return None
            if not bindings:
                bindings = _collect_widget_bindings(definition)
        else:
            if not config.slug:
                logger.warning(
                    "Slug de widget manquant pour l'étape %s", step_slug
                )
                return None
            definition = _load_widget_definition(
                config.slug, context=f"étape {step_slug}"
            )
            if definition is None:
                logger.warning(
                    "Widget %s introuvable pour l'étape %s",
                    config.slug,
                    step_slug,
                )
                return None

        resolved: dict[str, str | list[str]] = {}
        for variable_id, expression in config.variables.items():
            value = _evaluate_widget_variable_expression(
                expression, input_context=step_context
            )
            if value is None:
                continue
            resolved[variable_id] = value

        if step_context:
            for key in ("output_parsed", "output"):
                if key not in step_context:
                    continue
                auto_values = _collect_widget_values_from_output(
                    step_context[key], bindings=bindings
                )
                for identifier, value in auto_values.items():
                    resolved.setdefault(identifier, value)

        if resolved:
            matched = _apply_widget_variable_values(
                definition, resolved, bindings=bindings
            )
            missing = set(resolved) - matched
            if missing:
                logger.warning(
                    "Variables de widget non appliquées (%s) pour %s",
                    ", ".join(sorted(missing)),
                    widget_label,
                )

        try:
            widget = WidgetLibraryService._validate_widget(definition)
        except Exception as exc:  # pragma: no cover - dépend du SDK installé
            logger.exception(
                "Le widget %s est invalide après interpolation", widget_label, exc_info=exc
            )
            return None

        if _sdk_stream_widget is None:
            logger.warning(
                "Le SDK Agents installé ne supporte pas stream_widget : impossible de diffuser %s",
                widget_label,
            )
            return None

        store = getattr(agent_context, "store", None)
        thread_metadata = getattr(agent_context, "thread", None)
        if store is None or thread_metadata is None:
            logger.warning(
                "Contexte Agent incomplet : impossible de diffuser le widget %s",
                widget_label,
            )
            return

        request_context = getattr(agent_context, "request_context", None)

        def _generate_item_id(item_type: str) -> str:
            try:
                return store.generate_item_id(
                    item_type,
                    thread_metadata,
                    request_context,
                )
            except Exception as exc:  # pragma: no cover - dépend du stockage sous-jacent
                logger.exception(
                    "Impossible de générer un identifiant pour le widget %s",
                    widget_label,
                    exc_info=exc,
                )
                raise

        try:
            async for event in _sdk_stream_widget(
                thread_metadata,
                widget,
                generate_id=_generate_item_id,
            ):
                await on_stream_event(event)
        except Exception as exc:  # pragma: no cover - dépend du SDK Agents
            logger.exception(
                "Impossible de diffuser le widget %s pour %s",
                widget_label,
                step_title,
                exc_info=exc,
            )
            return None

        return widget
    def _should_forward_agent_event(
        event: ThreadStreamEvent, *, suppress: bool
    ) -> bool:
        if not suppress:
            return True
        return isinstance(event, EndOfTurnItem)

    async def run_agent_step(
        step_key: str,
        title: str,
        agent: Agent,
        *,
        agent_context: AgentContext[Any],
        run_context: Any | None = None,
        suppress_stream_events: bool = False,
    ) -> _WorkflowStreamResult:
        step_index = len(steps) + 1
        if on_step_stream is not None:
            await on_step_stream(
                WorkflowStepStreamUpdate(
                    key=step_key,
                    title=title,
                    index=step_index,
                    delta="",
                    text="",
                )
            )
        accumulated_text = ""
        result = Runner.run_streamed(
            agent,
            input=[*conversation_history],
            run_config=_workflow_run_config(),
            context=run_context,
        )
        try:
            async for event in stream_agent_response(agent_context, result):
                if (
                    on_stream_event is not None
                    and _should_forward_agent_event(
                        event, suppress=suppress_stream_events
                    )
                ):
                    await on_stream_event(event)
                if on_step_stream is not None:
                    delta_text = _extract_delta(event)
                    if not delta_text:
                        continue
                    accumulated_text += delta_text
                    await on_step_stream(
                        WorkflowStepStreamUpdate(
                            key=step_key,
                            title=title,
                            index=step_index,
                            delta=delta_text,
                            text=accumulated_text,
                        )
                    )
        except Exception as exc:  # pragma: no cover
            raise_step_error(step_key, title, exc)

        conversation_history.extend([item.to_input_item() for item in result.new_items])
        return result

    def _node_title(step: WorkflowStep) -> str:
        if getattr(step, "display_name", None):
            return str(step.display_name)
        agent_key = getattr(step, "agent_key", None)
        if agent_key:
            return _STEP_TITLES.get(agent_key, agent_key)
        return step.slug

    def _resolve_state_path(path: str) -> Any:
        value: Any = state
        for part in path.split("."):
            if isinstance(value, dict):
                value = value.get(part)
            else:
                return None
        return value

    def _stringify_branch_value(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (int, float)):
            return str(value)
        if isinstance(value, str):
            trimmed = value.strip()
            return trimmed or None
        return None

    def _evaluate_condition_node(step: WorkflowStep) -> str | None:
        params = step.parameters or {}
        mode = str(params.get("mode", "truthy")).strip().lower()
        path = str(params.get("path", "")).strip()
        value = _resolve_state_path(path) if path else None

        if mode == "value":
            return _stringify_branch_value(value)

        if mode in {"equals", "not_equals"}:
            expected = _stringify_branch_value(params.get("value"))
            candidate = _stringify_branch_value(value)
            if expected is None:
                return "false" if mode == "equals" else "true"
            comparison = (candidate or "").lower() == expected.lower()
            if mode == "equals":
                return "true" if comparison else "false"
            return "false" if comparison else "true"

        if mode == "falsy":
            return "true" if not bool(value) else "false"

        return "true" if bool(value) else "false"

    def _next_edge(source_slug: str, branch: str | None = None) -> WorkflowTransition | None:
        candidates = edges_by_source.get(source_slug, [])
        if not candidates:
            return None
        if branch is None:
            for edge in candidates:
                condition = (edge.condition or "default").lower()
                if condition in {"", "default"}:
                    return edge
            return candidates[0]
        branch_lower = branch.lower()
        for edge in candidates:
            if (edge.condition or "").lower() == branch_lower:
                return edge
        for edge in candidates:
            condition = (edge.condition or "default").lower()
            if condition in {"", "default"}:
                return edge
        return candidates[0]

    current_slug = start_step.slug
    final_node_slug: str | None = None
    final_end_state: WorkflowEndState | None = None
    guard = 0
    while guard < 1000:
        guard += 1
        current_node = nodes_by_slug.get(current_slug)
        if current_node is None:
            raise WorkflowExecutionError(
                "configuration",
                "Configuration du workflow invalide",
                RuntimeError(f"Nœud introuvable : {current_slug}"),
                list(steps),
            )

        final_node_slug = current_node.slug

        if current_node.kind == "end":
            final_end_state = _parse_end_state(current_node)
            break

        if current_node.kind == "start":
            transition = _next_edge(current_slug)
            if transition is None:
                raise WorkflowExecutionError(
                    "configuration",
                    "Configuration du workflow invalide",
                    RuntimeError("Aucune transition depuis le nœud de début"),
                    list(steps),
                )
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "condition":
            branch = _evaluate_condition_node(current_node)
            transition = _next_edge(current_slug, branch)
            if transition is None:
                branch_label = branch if branch is not None else "par défaut"
                raise WorkflowExecutionError(
                    "configuration",
                    "Configuration du workflow invalide",
                    RuntimeError(
                        f"Transition manquante pour la branche {branch_label} du nœud {current_slug}"
                    ),
                    list(steps),
                )
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "state":
            try:
                _apply_state_node(current_node)
            except Exception as exc:  # pragma: no cover - validation runtime
                raise_step_error(current_node.slug, _node_title(current_node), exc)

            transition = _next_edge(current_slug)
            if transition is None:
                if not agent_steps_ordered:
                    break
                raise WorkflowExecutionError(
                    "configuration",
                    "Configuration du workflow invalide",
                    RuntimeError(
                        f"Aucune transition disponible après le nœud d'état {current_node.slug}"
                    ),
                    list(steps),
                )
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "watch":
            title = _node_title(current_node)
            payload_to_display = _resolve_watch_payload(last_step_context, steps)
            step_payload: Any = (
                payload_to_display
                if payload_to_display is not None
                else "Aucun payload disponible pour ce bloc."
            )

            await record_step(current_node.slug, title, step_payload)

            if on_stream_event is not None:
                if payload_to_display is None:
                    formatted_payload = "Aucune donnée issue du bloc précédent."
                else:
                    formatted_payload = _format_step_output(payload_to_display)
                    stripped = formatted_payload.strip()
                    if stripped.startswith("{") or stripped.startswith("["):
                        formatted_payload = f"```json\n{formatted_payload}\n```"
                notice_title = f"Bloc watch « {title or current_node.slug} »"
                assistant_message = AssistantMessageItem(
                    id=agent_context.generate_id("message"),
                    thread_id=agent_context.thread.id,
                    created_at=datetime.now(),
                    content=[
                        AssistantMessageContent(
                            text=f"{notice_title}\n\n{formatted_payload}"
                        )
                    ],
                )
                await on_stream_event(ThreadItemDoneEvent(item=assistant_message))

            transition = _next_edge(current_slug)
            if transition is None:
                if not agent_steps_ordered:
                    break
                raise WorkflowExecutionError(
                    "configuration",
                    "Configuration du workflow invalide",
                    RuntimeError(
                        f"Aucune transition disponible après le nœud watch {current_node.slug}"
                    ),
                    list(steps),
                )
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "assistant_message":
            title = _node_title(current_node)
            raw_message = _resolve_assistant_message(current_node)
            sanitized_message = _normalize_user_text(raw_message)

            await record_step(current_node.slug, title, sanitized_message or "")
            last_step_context = {"assistant_message": sanitized_message}

            if sanitized_message and on_stream_event is not None:
                assistant_message = AssistantMessageItem(
                    id=agent_context.generate_id("message"),
                    thread_id=agent_context.thread.id,
                    created_at=datetime.now(),
                    content=[AssistantMessageContent(text=sanitized_message)],
                )
                await on_stream_event(ThreadItemDoneEvent(item=assistant_message))

            transition = _next_edge(current_slug)
            if transition is None:
                if not agent_steps_ordered:
                    break
                raise WorkflowExecutionError(
                    "configuration",
                    "Configuration du workflow invalide",
                    RuntimeError(
                        "Aucune transition disponible après le bloc message assistant "
                        f"{current_node.slug}"
                    ),
                    list(steps),
                )
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "json_vector_store":
            title = _node_title(current_node)
            await _apply_vector_store_ingestion(
                config=current_node.parameters or {},
                step_slug=current_node.slug,
                step_title=title,
                step_context=last_step_context,
            )
            transition = _next_edge(current_slug)
            if transition is None:
                if not agent_steps_ordered:
                    break
                raise WorkflowExecutionError(
                    "configuration",
                    "Configuration du workflow invalide",
                    RuntimeError(
                        f"Aucune transition disponible après le nœud {current_node.slug}"
                    ),
                    list(steps),
                )
            current_slug = transition.target_step.slug
            continue

        if current_node.kind == "widget":
            title = _node_title(current_node)
            widget_config = widget_configs_by_step.get(current_node.slug)
            if widget_config is None:
                logger.warning(
                    "Widget non configuré pour le nœud %s : aucune diffusion réalisée",
                    current_node.slug,
                )
            else:
                rendered_widget = await _stream_response_widget(
                    widget_config,
                    step_slug=current_node.slug,
                    step_title=title,
                    step_context=last_step_context,
                )
                action_payload: dict[str, Any] | None = None
                if (
                    on_widget_step is not None
                    and _should_wait_for_widget_action(current_node.kind, widget_config)
                ):
                    result = await on_widget_step(current_node, widget_config)
                    if result is not None:
                        action_payload = dict(result)

                widget_identifier = (
                    widget_config.slug
                    if widget_config.source == "library"
                    else widget_config.definition_expression
                ) or current_node.slug
                step_payload: dict[str, Any] = {"widget": widget_identifier}
                if widget_config.source == "library" and widget_config.slug:
                    step_payload["widget_slug"] = widget_config.slug
                elif (
                    widget_config.source == "variable"
                    and widget_config.definition_expression
                ):
                    step_payload["widget_expression"] = widget_config.definition_expression
                if (
                    widget_config.source == "variable"
                    and rendered_widget is not None
                ):
                    step_payload["widget_definition"] = rendered_widget
                if action_payload is not None:
                    step_payload["action"] = action_payload

                await record_step(
                    current_node.slug,
                    title,
                    step_payload,
                )

                context_payload: dict[str, Any] = {"widget": widget_identifier}
                if widget_config.source == "library" and widget_config.slug:
                    context_payload["widget_slug"] = widget_config.slug
                elif (
                    widget_config.source == "variable"
                    and widget_config.definition_expression
                ):
                    context_payload["widget_expression"] = (
                        widget_config.definition_expression
                    )
                if rendered_widget is not None:
                    context_payload["widget_definition"] = rendered_widget
                if action_payload is not None:
                    context_payload["action"] = action_payload
                last_step_context = context_payload
            transition = _next_edge(current_slug)
            if transition is None:
                if not agent_steps_ordered:
                    break
                raise WorkflowExecutionError(
                    "configuration",
                    "Configuration du workflow invalide",
                    RuntimeError(
                        f"Aucune transition disponible après le nœud {current_node.slug}"
                    ),
                    list(steps),
                )
            current_slug = transition.target_step.slug
            continue

        if current_node.kind != "agent":
            raise WorkflowExecutionError(
                "configuration",
                "Configuration du workflow invalide",
                RuntimeError(f"Type de nœud non géré : {current_node.kind}"),
                list(steps),
            )

        agent_key = current_node.agent_key or current_node.slug
        position = agent_positions.get(current_slug, total_runtime_steps)
        step_identifier = f"{agent_key}_{position}"
        agent = agent_instances[current_slug]
        title = _node_title(current_node)
        widget_config = widget_configs_by_step.get(current_node.slug)

        if (
            agent_key in {"get_data_from_web", "triage_2", "get_data_from_user"}
            and state["has_all_details"]
        ):
            transition = _next_edge(current_slug)
            if transition is None:
                raise WorkflowExecutionError(
                    "configuration",
                    "Configuration du workflow invalide",
                    RuntimeError(f"Aucune transition disponible après {current_slug}"),
                    list(steps),
                )
            current_slug = transition.target_step.slug
            continue

        if agent_key == "r_dacteur":
            should_run = state["should_finalize"] or position == total_runtime_steps
            if not should_run:
                transition = _next_edge(current_slug)
                if transition is None:
                    raise WorkflowExecutionError(
                        "configuration",
                        "Configuration du workflow invalide",
                        RuntimeError(
                            "Impossible de continuer : aucune transition depuis r_dacteur"
                        ),
                        list(steps),
                    )
                current_slug = transition.target_step.slug
                continue

        run_context: Any | None = None
        if agent_key == "get_data_from_web":
            run_context = GetDataFromWebContext(state["infos_manquantes"])
        elif agent_key == "triage_2":
            run_context = Triage2Context(input_output_text=state["infos_manquantes"])
        elif agent_key == "get_data_from_user":
            run_context = GetDataFromUserContext(state_infos_manquantes=state["infos_manquantes"])

        result_stream = await run_agent_step(
            step_identifier,
            title,
            agent,
            agent_context=agent_context,
            run_context=run_context,
            suppress_stream_events=widget_config is not None,
        )

        if agent_key == "triage":
            parsed, text = _structured_output_as_json(result_stream.final_output)
            state["has_all_details"] = bool(parsed.get("has_all_details")) if isinstance(parsed, dict) else False
            state["infos_manquantes"] = text
            state["should_finalize"] = state["has_all_details"]
            await record_step(step_identifier, title, parsed)
            last_step_context = {
                "agent_key": agent_key,
                "output": result_stream.final_output,
                "output_parsed": parsed,
                "output_text": text,
            }
        elif agent_key == "get_data_from_web":
            text = result_stream.final_output_as(str)
            state["infos_manquantes"] = text
            await record_step(step_identifier, title, text)
            last_step_context = {
                "agent_key": agent_key,
                "output": text,
                "output_text": text,
            }
        elif agent_key == "triage_2":
            parsed, text = _structured_output_as_json(result_stream.final_output)
            state["has_all_details"] = bool(parsed.get("has_all_details")) if isinstance(parsed, dict) else False
            state["infos_manquantes"] = text
            state["should_finalize"] = state["has_all_details"]
            await record_step(step_identifier, title, parsed)
            last_step_context = {
                "agent_key": agent_key,
                "output": result_stream.final_output,
                "output_parsed": parsed,
                "output_text": text,
            }
        elif agent_key == "get_data_from_user":
            text = result_stream.final_output_as(str)
            state["infos_manquantes"] = text
            state["should_finalize"] = True
            await record_step(step_identifier, title, text)
            last_step_context = {
                "agent_key": agent_key,
                "output": text,
                "output_text": text,
            }
        elif agent_key == "r_dacteur":
            parsed, text = _structured_output_as_json(result_stream.final_output)
            final_output = {"output_text": text, "output_parsed": parsed}
            await record_step(step_identifier, title, final_output["output_text"])
            last_step_context = {
                "agent_key": agent_key,
                "output": result_stream.final_output,
                "output_parsed": parsed,
                "output_text": text,
            }
        else:
            parsed, text = _structured_output_as_json(result_stream.final_output)
            await record_step(step_identifier, title, result_stream.final_output)
            last_step_context = {
                "agent_key": agent_key,
                "output": result_stream.final_output,
                "output_parsed": parsed,
                "output_text": text,
            }

        await _apply_vector_store_ingestion(
            config=(current_node.parameters or {}).get("vector_store_ingestion"),
            step_slug=current_node.slug,
            step_title=title,
            step_context=last_step_context,
        )

        if widget_config is not None:
            rendered_widget = await _stream_response_widget(
                widget_config,
                step_slug=current_node.slug,
                step_title=title,
                step_context=last_step_context,
            )
            widget_identifier = (
                widget_config.slug
                if widget_config.source == "library"
                else widget_config.definition_expression
            ) or current_node.slug
            augmented_context = dict(last_step_context or {})
            augmented_context.setdefault("widget", widget_identifier)
            if widget_config.source == "library" and widget_config.slug:
                augmented_context.setdefault("widget_slug", widget_config.slug)
            elif (
                widget_config.source == "variable"
                and widget_config.definition_expression
            ):
                augmented_context.setdefault(
                    "widget_expression", widget_config.definition_expression
                )
            if rendered_widget is not None:
                augmented_context["widget_definition"] = rendered_widget

            if (
                on_widget_step is not None
                and _should_wait_for_widget_action(current_node.kind, widget_config)
            ):
                result = await on_widget_step(current_node, widget_config)
                if result is not None:
                    augmented_context["action"] = dict(result)

            last_step_context = augmented_context

        transition = _next_edge(current_slug)
        if agent_key == "r_dacteur":
            # Après la rédaction finale, on rejoint la fin si disponible
            transition = transition or _next_edge(current_slug, "true")
        if transition is None:
            break
        current_slug = transition.target_step.slug

    if guard >= 1000:
        raise WorkflowExecutionError(
            "configuration",
            "Configuration du workflow invalide",
            RuntimeError("Nombre maximal d'étapes dépassé"),
            list(steps),
        )

    if final_node_slug is None:
        raise WorkflowExecutionError(
            "configuration",
            "Configuration du workflow invalide",
            RuntimeError("Impossible de déterminer le nœud final du workflow"),
            list(steps),
        )

    return WorkflowRunSummary(
        steps=steps,
        final_output=final_output,
        final_node_slug=final_node_slug,
        end_state=final_end_state,
    )
_server: DemoChatKitServer | None = None


def get_chatkit_server() -> DemoChatKitServer:
    """Retourne l'instance unique du serveur ChatKit."""
    global _server
    if _server is None:
        _server = DemoChatKitServer(get_settings())
    return _server
