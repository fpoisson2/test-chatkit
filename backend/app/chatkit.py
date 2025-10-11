from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import AsyncIterator, Sequence

from chatkit.store import NotFoundError
from chatkit.server import ChatKitServer
from chatkit.types import (
    AssistantMessageContent,
    AssistantMessageItem,
    EndOfTurnItem,
    ErrorCode,
    ErrorEvent,
    ProgressUpdateEvent,
    ThreadItem,
    ThreadItemDoneEvent,
    ThreadMetadata,
    ThreadStreamEvent,
    UserMessageItem,
)

from .config import Settings, get_settings
from .chatkit_store import PostgresChatKitStore
from .database import SessionLocal
from workflows.agents import run_workflow, WorkflowExecutionError, WorkflowInput

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
        try:
            await _enqueue_event(
                event_queue,
                ProgressUpdateEvent(text="Analyse de votre demande en cours..."),
            )

            workflow_run = await run_workflow(workflow_input)

            for index, step in enumerate(workflow_run.steps, start=1):
                details = step.output.strip() or "(aucune sortie)"
                header = f"Étape {index} – {step.title}"
                await _enqueue_event(
                    event_queue,
                    ProgressUpdateEvent(text=f"{header}\n\n{details}"),
                )

            result = workflow_run.final_output

            if result:
                output_text = result.get("output_text", "")
                if output_text:
                    message_id = self.store.generate_item_id("message", thread, context)
                    assistant_message = AssistantMessageItem(
                        id=message_id,
                        thread_id=thread.id,
                        created_at=datetime.now(),
                        content=[
                            AssistantMessageContent(
                                type="output_text",
                                text=output_text,
                            )
                        ],
                    )

                    await self.store.add_thread_item(thread.id, assistant_message, context)

                    await _enqueue_event(
                        event_queue, ThreadItemDoneEvent(item=assistant_message)
                    )
                    await _enqueue_event(
                        event_queue,
                        EndOfTurnItem(
                            id=self.store.generate_item_id("message", thread, context),
                            thread_id=thread.id,
                            created_at=datetime.now(),
                        ),
                    )
        except WorkflowExecutionError as exc:  # pragma: no cover - erreurs connues du workflow
            logger.exception("Workflow execution failed")
            for index, step in enumerate(exc.steps, start=1):
                details = step.output.strip() or "(aucune sortie)"
                header = f"Étape {index} – {step.title}"
                await _enqueue_event(
                    event_queue,
                    ProgressUpdateEvent(text=f"{header}\n\n{details}"),
                )

            error_message = (
                f"Le workflow a échoué pendant l'étape « {exc.title} » ({exc.step}). "
                f"Détails techniques : {exc.original_error}"
            )
            await _enqueue_event(
                event_queue,
                ErrorEvent(
                    code=ErrorCode.STREAM_ERROR,
                    message=error_message,
                    allow_retry=True,
                ),
            )
        except Exception as exc:  # pragma: no cover - autres erreurs runtime
            logger.exception("Workflow execution failed")
            detailed_message = (
                f"Erreur inattendue ({exc.__class__.__name__}) : {exc}"
            )
            await _enqueue_event(
                event_queue,
                ErrorEvent(
                    code=ErrorCode.STREAM_ERROR,
                    message=detailed_message,
                    allow_retry=True,
                ),
            )
        finally:
            await event_queue.put(None)


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
