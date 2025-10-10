from __future__ import annotations

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
    Page,
    ThreadItem,
    ThreadItemDoneEvent,
    ThreadMetadata,
    ThreadStreamEvent,
    UserMessageItem,
)

from agents import Runner
from chatkit.agents import stream_agent_response, AgentContext, simple_to_agent_input

from .config import Settings, get_settings
from .chatkit_store import PostgresChatKitStore
from .database import SessionLocal
from workflows.agents import triage, get_data_from_user, GetDataFromUserContext, run_workflow, WorkflowInput

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

        # Créer le contexte pour l'agent
        agent_context = AgentContext(
            thread=thread,
            store=self.store,
            request_context=context,
        )

        try:
            # Exécuter le workflow complet avec streaming simulé via des progress updates
            workflow_input = WorkflowInput(input_as_text=user_text)

            # Note: Le workflow n'est pas nativement streamé, donc nous allons
            # afficher des messages de progression et attendre le résultat
            from chatkit.types import ProgressUpdateEvent

            yield ProgressUpdateEvent(text="Analyse de votre demande en cours...")

            # Exécuter le workflow de manière asynchrone
            result = await run_workflow(workflow_input)

            # Le résultat contient le plan-cadre généré ou une demande d'infos
            # Convertir le résultat en message assistant
            if result:
                output_text = result.get("output_text", "")
                if output_text:
                    # Créer un message assistant avec le résultat
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

                    # Sauvegarder le message
                    await self.store.add_thread_item(thread.id, assistant_message, context)

                    # Yielder l'événement de fin
                    yield ThreadItemDoneEvent(item=assistant_message)
                    yield EndOfTurnItem(
                        id=self.store.generate_item_id("message", thread, context),
                        thread_id=thread.id,
                        created_at=datetime.now(),
                    )

        except Exception as exc:  # pragma: no cover - erreurs runtime workflow
            logger.exception("Workflow execution failed")
            yield ErrorEvent(
                code=ErrorCode.STREAM_ERROR,
                message=str(exc),
                allow_retry=True,
            )
            return


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


_server: DemoChatKitServer | None = None


def get_chatkit_server() -> DemoChatKitServer:
    """Retourne l'instance unique du serveur ChatKit."""
    global _server
    if _server is None:
        _server = DemoChatKitServer(get_settings())
    return _server
