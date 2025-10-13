from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, AsyncIterator, Coroutine, Sequence

from chatkit.agents import AgentContext, simple_to_agent_input
from chatkit.server import ChatKitServer
from chatkit.store import NotFoundError
from chatkit.types import (
    EndOfTurnItem,
    ErrorCode,
    ErrorEvent,
    ProgressUpdateEvent,
    ThreadItem,
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
    WorkflowStepStreamUpdate,
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

        agent_context = AgentContext(
            thread=thread,
            store=self.store,
            request_context=context,
        )

        converted_input = (
            await simple_to_agent_input(input_user_message)
            if input_user_message
            else []
        )

        event_queue: asyncio.Queue[Any] = asyncio.Queue()

        workflow_result = _WorkflowStreamResult(
            runner=self._execute_workflow(
                thread=thread,
                agent_context=agent_context,
                workflow_input=WorkflowInput(input_as_text=user_text),
                event_queue=event_queue,
            ),
            input_items=converted_input,
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

        try:
            logger.info("Démarrage du workflow pour le fil %s", thread.id)

            async def on_step(
                step_summary: WorkflowStepSummary, index: int
            ) -> None:
                streamed_step_keys.add(step_summary.key)
                step_progress_text.pop(step_summary.key, None)

            async def on_stream_event(event: ThreadStreamEvent) -> None:
                await event_queue.put(event)

            async def on_step_stream(
                update: WorkflowStepStreamUpdate,
            ) -> None:
                header = f"Étape {update.index} – {update.title}"

                if update.key not in step_progress_text:
                    waiting_text = f"{header}\n\nGénération en cours..."
                    step_progress_text[update.key] = waiting_text
                    await on_stream_event(ProgressUpdateEvent(text=waiting_text))

                aggregated_text = update.text
                if not aggregated_text.strip():
                    return

                progress_text = f"{header}\n\n{aggregated_text}"
                if step_progress_text.get(update.key) == progress_text:
                    return

                step_progress_text[update.key] = progress_text
                await on_stream_event(ProgressUpdateEvent(text=progress_text))

            workflow_run = await run_workflow(
                workflow_input,
                agent_context=agent_context,
                on_step=on_step,
                on_step_stream=on_step_stream,
                on_stream_event=on_stream_event,
            )

            await on_stream_event(
                EndOfTurnItem(
                    id=self.store.generate_item_id(
                        "message", thread, agent_context.request_context
                    ),
                    thread_id=thread.id,
                    created_at=datetime.now(),
                )
            )
            logger.info("Workflow terminé avec succès pour le fil %s", thread.id)
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
    """Résultat minimal compatible avec stream_agent_response."""

    def __init__(
        self,
        *,
        runner: Coroutine[Any, Any, None],
        input_items: Sequence[Any],
        event_queue: asyncio.Queue[Any],
    ) -> None:
        self.input = list(input_items)
        self.new_items: list[Any] = []
        self.raw_responses: list[Any] = []
        self.final_output: Any = None
        self.input_guardrail_results: list[Any] = []
        self.output_guardrail_results: list[Any] = []
        self.tool_input_guardrail_results: list[Any] = []
        self.tool_output_guardrail_results: list[Any] = []
        self.current_agent = None
        self.current_turn = 0
        self.max_turn = 0
        self._event_queue = event_queue
        self._task = asyncio.create_task(runner)
        self._task.add_done_callback(_log_background_exceptions)

    @property
    def is_complete(self) -> bool:
        return self._task.done()

    def cancel(self) -> None:
        self._task.cancel()

    async def stream_events(self) -> AsyncIterator[Any]:
        while True:
            event = await self._event_queue.get()
            if event is _STREAM_DONE:
                break
            yield event

        await self._task

    
_server: DemoChatKitServer | None = None


def get_chatkit_server() -> DemoChatKitServer:
    """Retourne l'instance unique du serveur ChatKit."""
    global _server
    if _server is None:
        _server = DemoChatKitServer(get_settings())
    return _server
