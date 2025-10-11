from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, AsyncIterator, Sequence

from chatkit.store import NotFoundError
from chatkit.server import ChatKitServer
from chatkit.types import (
    AssistantMessageContent,
    AssistantMessageItem,
    EndOfTurnItem,
    ErrorCode,
    ErrorEvent,
    ThreadItem,
    ThreadItemDoneEvent,
    ThreadMetadata,
    ThreadStreamEvent,
    UserMessageItem,
)

from .config import Settings, get_settings
from .chatkit_store import PostgresChatKitStore
from .database import SessionLocal
from workflows.agents import (
    WorkflowExecutionError,
    WorkflowInput,
    WorkflowStepSummary,
    run_workflow,
)

logger = logging.getLogger("chatkit.server")


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


class DemoChatKitServer(ChatKitServer[ChatKitRequestContext]):
    """Serveur ChatKit piloté par un workflow local."""

    def __init__(self, settings: Settings) -> None:
        super().__init__(PostgresChatKitStore(SessionLocal))
        self._settings = settings
        _apply_agent_overrides(settings)

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
        if not user_text:
            yield ErrorEvent(
                code=ErrorCode.STREAM_ERROR,
                message="Impossible de déterminer le message utilisateur à traiter.",
                allow_retry=False,
            )
            return

        event_queue: asyncio.Queue[ThreadStreamEvent | None] = asyncio.Queue()

        background = asyncio.create_task(
            self._run_workflow_and_queue_events(
                thread=thread,
                context=context,
                workflow_input=WorkflowInput(input_as_text=user_text),
                event_queue=event_queue,
            )
        )
        background.add_done_callback(_log_background_exceptions)

        try:
            while True:
                event = await event_queue.get()
                if event is None:
                    break
                yield event

            await background
        except asyncio.CancelledError:  # pragma: no cover - déconnexion client
            logger.info(
                "Streaming interrompu pour le fil %s, poursuite du workflow en tâche de fond",
                thread.id,
            )
            return

    async def _run_workflow_and_queue_events(
        self,
        *,
        thread: ThreadMetadata,
        context: ChatKitRequestContext,
        workflow_input: WorkflowInput,
        event_queue: asyncio.Queue[ThreadStreamEvent | None],
    ) -> None:
        streamed_step_keys: set[str] = set()

        try:
            logger.info("Démarrage du workflow pour le fil %s", thread.id)
            start_message = await self._store_assistant_message(
                thread=thread,
                context=context,
                text="Analyse de votre demande en cours...",
            )
            await _enqueue_event(
                event_queue, ThreadItemDoneEvent(item=start_message)
            )

            async def on_step(
                step_summary: WorkflowStepSummary, index: int
            ) -> None:
                await self._persist_step_summary(
                    step=step_summary,
                    index=index,
                    thread=thread,
                    context=context,
                    event_queue=event_queue,
                )
                streamed_step_keys.add(step_summary.key)

            workflow_run = await run_workflow(
                workflow_input, on_step=on_step
            )

            result = workflow_run.final_output or {}
            output_text = _format_output_text(
                result.get("output_text"), result.get("output_parsed")
            )
            if not output_text:
                output_text = (
                    "Le workflow a été exécuté mais n'a produit aucun contenu textuel."
                )

            final_message = await self._store_assistant_message(
                thread=thread,
                context=context,
                text=output_text,
            )

            await _enqueue_event(event_queue, ThreadItemDoneEvent(item=final_message))
            await _enqueue_event(
                event_queue,
                EndOfTurnItem(
                    id=self.store.generate_item_id("message", thread, context),
                    thread_id=thread.id,
                    created_at=datetime.now(),
                ),
            )
            logger.info("Workflow terminé avec succès pour le fil %s", thread.id)
        except WorkflowExecutionError as exc:  # pragma: no cover - erreurs connues du workflow
            logger.exception("Workflow execution failed")
            await self._persist_step_summaries(
                steps=[
                    step
                    for step in exc.steps
                    if step.key not in streamed_step_keys
                ],
                thread=thread,
                context=context,
                event_queue=event_queue,
                start_index=len(streamed_step_keys) + 1,
            )

            error_message = (
                f"Le workflow a échoué pendant l'étape « {exc.title} » ({exc.step}). "
                f"Détails techniques : {exc.original_error}"
            )
            error_item = await self._store_assistant_message(
                thread=thread,
                context=context,
                text=error_message,
            )
            await _enqueue_event(event_queue, ThreadItemDoneEvent(item=error_item))
            await _enqueue_event(
                event_queue,
                ErrorEvent(
                    code=ErrorCode.STREAM_ERROR,
                    message=error_message,
                    allow_retry=True,
                ),
            )
            logger.info(
                "Workflow en erreur pour le fil %s pendant %s", thread.id, exc.step
            )
        except Exception as exc:  # pragma: no cover - autres erreurs runtime
            logger.exception("Workflow execution failed")
            detailed_message = (
                f"Erreur inattendue ({exc.__class__.__name__}) : {exc}"
            )
            error_item = await self._store_assistant_message(
                thread=thread,
                context=context,
                text=detailed_message,
            )
            await _enqueue_event(event_queue, ThreadItemDoneEvent(item=error_item))
            await _enqueue_event(
                event_queue,
                ErrorEvent(
                    code=ErrorCode.STREAM_ERROR,
                    message=detailed_message,
                    allow_retry=True,
                ),
            )
            logger.info(
                "Workflow en erreur inattendue pour le fil %s", thread.id
            )
        finally:
            await event_queue.put(None)

    async def _persist_step_summaries(
        self,
        *,
        steps: Sequence[WorkflowStepSummary],
        thread: ThreadMetadata,
        context: ChatKitRequestContext,
        event_queue: asyncio.Queue[ThreadStreamEvent | None],
        start_index: int = 1,
    ) -> None:
        for index, step in enumerate(steps, start=start_index):
            await self._persist_step_summary(
                step=step,
                index=index,
                thread=thread,
                context=context,
                event_queue=event_queue,
            )

    async def _persist_step_summary(
        self,
        *,
        step: WorkflowStepSummary,
        index: int,
        thread: ThreadMetadata,
        context: ChatKitRequestContext,
        event_queue: asyncio.Queue[ThreadStreamEvent | None],
    ) -> None:
        details = step.output.strip() or "(aucune sortie)"
        header = f"Étape {index} – {step.title}"
        text = f"{header}\n\n{details}"
        message = await self._store_assistant_message(
            thread=thread,
            context=context,
            text=text,
        )
        logger.info(
            "Progression du workflow %s : %s", thread.id, header
        )
        await _enqueue_event(event_queue, ThreadItemDoneEvent(item=message))

    async def _store_assistant_message(
        self,
        *,
        thread: ThreadMetadata,
        context: ChatKitRequestContext,
        text: str,
    ) -> AssistantMessageItem:
        message = AssistantMessageItem(
            id=self.store.generate_item_id("message", thread, context),
            thread_id=thread.id,
            created_at=datetime.now(),
            content=[
                AssistantMessageContent(
                    type="output_text",
                    text=text,
                )
            ],
        )
        await self.store.add_thread_item(thread.id, message, context)
        return message


def _collect_user_text(message: UserMessageItem | None) -> str:
    """Concatène le texte d'un message utilisateur."""
    if not message or not getattr(message, "content", None):
        return ""
    parts: list[str] = []
    for content_item in message.content:
        text = getattr(content_item, "text", None)
        if text:
            parts.append(text)
    return "\n".join(part.strip() for part in parts if part.strip())


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


def _apply_agent_overrides(settings: Settings) -> None:
    """Applique les surcharges d'environnement sur l'agent global du workflow."""
    # Le workflow dans agents.py gère sa propre configuration
    # Les overrides ne sont plus nécessaires car run_workflow utilise le workflow complet
    pass


async def _enqueue_event(
    queue: asyncio.Queue[ThreadStreamEvent | None], event: ThreadStreamEvent
) -> None:
    """Ajoute un événement dans la file sans interrompre le workflow."""
    await queue.put(event)


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

    
_server: DemoChatKitServer | None = None


def get_chatkit_server() -> DemoChatKitServer:
    """Retourne l'instance unique du serveur ChatKit."""
    global _server
    if _server is None:
        _server = DemoChatKitServer(get_settings())
    return _server


def _format_output_text(output_text: str | None, fallback: Any | None) -> str:
    """Normalise le texte final renvoyé à l'utilisateur."""
    if output_text:
        candidate = output_text.strip()
        if candidate:
            try:
                parsed = json.loads(candidate)
            except json.JSONDecodeError:
                return candidate

            if isinstance(parsed, str):
                return parsed.strip()
            if isinstance(parsed, (dict, list)):
                try:
                    return json.dumps(parsed, ensure_ascii=False, indent=2)
                except TypeError:
                    return str(parsed)
            return str(parsed)

    if fallback is not None:
        if isinstance(fallback, (dict, list)):
            try:
                return json.dumps(fallback, ensure_ascii=False, indent=2)
            except TypeError:
                return str(fallback)
        text = str(fallback).strip()
        if text:
            return text

    return ""
