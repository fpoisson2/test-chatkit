from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, AsyncIterator, Coroutine, Sequence

from chatkit.agents import AgentContext, simple_to_agent_input, stream_agent_response
from chatkit.server import ChatKitServer
from chatkit.store import NotFoundError
from chatkit.types import (
    AssistantMessageContent,
    AssistantMessageItem,
    EndOfTurnItem,
    ErrorCode,
    ErrorEvent,
    ProgressUpdateEvent,
    ThreadItem,
    ThreadItemAddedEvent,
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

        workflow_result = _WorkflowStreamResult(
            runner=self._execute_workflow(
                thread=thread,
                agent_context=agent_context,
                workflow_input=WorkflowInput(input_as_text=user_text),
            ),
            input_items=converted_input,
        )

        try:
            async for event in stream_agent_response(agent_context, workflow_result):
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
    ) -> None:
        streamed_step_keys: set[str] = set()
        step_progress_text: dict[str, str] = {}

        try:
            logger.info("Démarrage du workflow pour le fil %s", thread.id)
            await self._publish_assistant_message(
                thread=thread,
                agent_context=agent_context,
                text="Analyse de votre demande en cours...",
            )

            async def on_step(
                step_summary: WorkflowStepSummary, index: int
            ) -> None:
                await self._persist_step_summary(
                    step=step_summary,
                    index=index,
                    thread=thread,
                    agent_context=agent_context,
                )
                streamed_step_keys.add(step_summary.key)
                step_progress_text.pop(step_summary.key, None)

            async def on_step_stream(
                update: WorkflowStepStreamUpdate,
            ) -> None:
                header = f"Étape {update.index} – {update.title}"

                if update.key not in step_progress_text:
                    waiting_text = f"{header}\n\nGénération en cours..."
                    step_progress_text[update.key] = waiting_text
                    await agent_context.stream(
                        ProgressUpdateEvent(text=waiting_text)
                    )

                aggregated_text = update.text
                if not aggregated_text.strip():
                    return

                progress_text = f"{header}\n\n{aggregated_text}"
                if step_progress_text.get(update.key) == progress_text:
                    return

                step_progress_text[update.key] = progress_text
                await agent_context.stream(
                    ProgressUpdateEvent(text=progress_text)
                )

            workflow_run = await run_workflow(
                workflow_input,
                on_step=on_step,
                on_step_stream=on_step_stream,
            )

            result = workflow_run.final_output or {}
            output_text = _format_output_text(
                result.get("output_text"), result.get("output_parsed")
            )
            if not output_text:
                output_text = (
                    "Le workflow a été exécuté mais n'a produit aucun contenu textuel."
                )

            await self._publish_assistant_message(
                thread=thread,
                agent_context=agent_context,
                text=output_text,
            )
            await agent_context.stream(
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
            await self._persist_step_summaries(
                steps=[
                    step
                    for step in exc.steps
                    if step.key not in streamed_step_keys
                ],
                thread=thread,
                agent_context=agent_context,
                start_index=len(streamed_step_keys) + 1,
            )

            error_message = (
                f"Le workflow a échoué pendant l'étape « {exc.title} » ({exc.step}). "
                f"Détails techniques : {exc.original_error}"
            )
            await self._publish_assistant_message(
                thread=thread,
                agent_context=agent_context,
                text=error_message,
            )
            await agent_context.stream(
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
            detailed_message = (
                f"Erreur inattendue ({exc.__class__.__name__}) : {exc}"
            )
            await self._publish_assistant_message(
                thread=thread,
                agent_context=agent_context,
                text=detailed_message,
            )
            await agent_context.stream(
                ErrorEvent(
                    code=ErrorCode.STREAM_ERROR,
                    message=detailed_message,
                    allow_retry=True,
                )
            )
            logger.info(
                "Workflow en erreur inattendue pour le fil %s", thread.id
            )

    async def _persist_step_summaries(
        self,
        *,
        steps: Sequence[WorkflowStepSummary],
        thread: ThreadMetadata,
        agent_context: AgentContext[ChatKitRequestContext],
        start_index: int = 1,
    ) -> None:
        for index, step in enumerate(steps, start=start_index):
            await self._persist_step_summary(
                step=step,
                index=index,
                thread=thread,
                agent_context=agent_context,
            )

    async def _persist_step_summary(
        self,
        *,
        step: WorkflowStepSummary,
        index: int,
        thread: ThreadMetadata,
        agent_context: AgentContext[ChatKitRequestContext],
    ) -> None:
        details = step.output.strip() or "(aucune sortie)"
        header = f"Étape {index} – {step.title}"
        text = f"{header}\n\n{details}"
        message = await self._publish_assistant_message(
            thread=thread,
            agent_context=agent_context,
            text=text,
        )
        logger.info(
            "Progression du workflow %s : %s", thread.id, header
        )

    async def _publish_assistant_message(
        self,
        *,
        thread: ThreadMetadata,
        agent_context: AgentContext[ChatKitRequestContext],
        text: str,
    ) -> AssistantMessageItem:
        message = AssistantMessageItem(
            id=agent_context.generate_id("message", thread),
            thread_id=thread.id,
            created_at=datetime.now(),
            content=[
                AssistantMessageContent(
                    type="output_text",
                    text=text,
                )
            ],
        )
        await agent_context.stream(ThreadItemAddedEvent(item=message))
        await agent_context.stream(ThreadItemDoneEvent(item=message))
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


class _WorkflowStreamResult:
    """Résultat minimal compatible avec stream_agent_response."""

    def __init__(
        self,
        *,
        runner: Coroutine[Any, Any, None],
        input_items: Sequence[Any],
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
        self._task = asyncio.create_task(runner)
        self._task.add_done_callback(_log_background_exceptions)

    @property
    def is_complete(self) -> bool:
        return self._task.done()

    def cancel(self) -> None:
        self._task.cancel()

    async def stream_events(self) -> AsyncIterator[Any]:
        try:
            await self._task
        except Exception:
            raise
        if False:  # pragma: no cover - nécessaire pour déclarer un générateur
            yield None

    
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
