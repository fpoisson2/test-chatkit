from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import AsyncIterator, Sequence

from chatkit.store import NotFoundError, Store
from chatkit.server import ChatKitServer
from chatkit.types import (
    Attachment,
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
from workflows.agents import triage, get_data_from_user, GetDataFromUserContext

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


class InMemoryChatKitStore(Store[ChatKitRequestContext]):
    """Implémentation en mémoire du Store ChatKit.

    Elle conserve les fils, messages et pièces jointes pour la durée de vie du
    processus FastAPI. En production, remplacez-la par une persistance durable.
    """

    def __init__(self) -> None:
        self._threads: dict[str, ThreadMetadata] = {}
        self._items: dict[str, list[ThreadItem]] = {}
        self._attachments: dict[str, Attachment] = {}
        self._lock = asyncio.Lock()

    async def load_thread(self, thread_id: str, context: ChatKitRequestContext) -> ThreadMetadata:
        async with self._lock:
            if thread_id not in self._threads:
                raise NotFoundError(f"Thread {thread_id} not found")
            return self._threads[thread_id].model_copy(deep=True)

    async def save_thread(self, thread: ThreadMetadata, context: ChatKitRequestContext) -> None:
        async with self._lock:
            payload = thread.model_dump()
            payload.pop("items", None)
            metadata = ThreadMetadata(**payload)
            self._threads[thread.id] = metadata
            self._items.setdefault(thread.id, [])

    async def load_thread_items(
        self,
        thread_id: str,
        after: str | None,
        limit: int,
        order: str,
        context: ChatKitRequestContext,
    ) -> Page[ThreadItem]:
        async with self._lock:
            if thread_id not in self._threads:
                raise NotFoundError(f"Thread {thread_id} not found")

            items = list(self._items.get(thread_id, []))
            ordered = list(reversed(items)) if order == "desc" else items[:]

            start_index = 0
            if after:
                for idx, item in enumerate(ordered):
                    if item.id == after:
                        start_index = idx + 1
                        break

            effective_limit = limit or len(ordered) - start_index
            sliced = ordered[start_index : start_index + effective_limit]
            has_more = start_index + effective_limit < len(ordered)
            next_after = sliced[-1].id if has_more and sliced else None

            return Page(
                data=[item.model_copy(deep=True) for item in sliced],
                has_more=has_more,
                after=next_after,
            )

    async def save_attachment(self, attachment: Attachment, context: ChatKitRequestContext) -> None:
        async with self._lock:
            self._attachments[attachment.id] = attachment.model_copy(deep=True)

    async def load_attachment(self, attachment_id: str, context: ChatKitRequestContext) -> Attachment:
        async with self._lock:
            attachment = self._attachments.get(attachment_id)
            if attachment is None:
                raise NotFoundError(f"Attachment {attachment_id} not found")
            return attachment.model_copy(deep=True)

    async def delete_attachment(self, attachment_id: str, context: ChatKitRequestContext) -> None:
        async with self._lock:
            self._attachments.pop(attachment_id, None)

    async def load_threads(
        self,
        limit: int,
        after: str | None,
        order: str,
        context: ChatKitRequestContext,
    ) -> Page[ThreadMetadata]:
        async with self._lock:
            threads = list(self._threads.values())
            threads.sort(key=lambda item: item.created_at, reverse=order == "desc")

            start_index = 0
            if after:
                for idx, thread in enumerate(threads):
                    if thread.id == after:
                        start_index = idx + 1
                        break

            effective_limit = limit or len(threads) - start_index
            sliced = threads[start_index : start_index + effective_limit]
            has_more = start_index + effective_limit < len(threads)
            next_after = sliced[-1].id if has_more and sliced else None

            return Page(
                data=[thread.model_copy(deep=True) for thread in sliced],
                has_more=has_more,
                after=next_after,
            )

    async def add_thread_item(
        self,
        thread_id: str,
        item: ThreadItem,
        context: ChatKitRequestContext,
    ) -> None:
        async with self._lock:
            if thread_id not in self._threads:
                raise NotFoundError(f"Thread {thread_id} not found")
            items = self._items.setdefault(thread_id, [])
            items.append(item.model_copy(deep=True))

    async def save_item(
        self,
        thread_id: str,
        item: ThreadItem,
        context: ChatKitRequestContext,
    ) -> None:
        async with self._lock:
            items = self._items.get(thread_id)
            if not items:
                raise NotFoundError(f"Thread {thread_id} not found")
            for idx, existing in enumerate(items):
                if existing.id == item.id:
                    items[idx] = item.model_copy(deep=True)
                    break
            else:
                raise NotFoundError(f"Item {item.id} not found in thread {thread_id}")

    async def load_item(
        self,
        thread_id: str,
        item_id: str,
        context: ChatKitRequestContext,
    ) -> ThreadItem:
        async with self._lock:
            items = self._items.get(thread_id, [])
            for existing in items:
                if existing.id == item_id:
                    return existing.model_copy(deep=True)
            raise NotFoundError(f"Item {item_id} not found in thread {thread_id}")

    async def delete_thread(self, thread_id: str, context: ChatKitRequestContext) -> None:
        async with self._lock:
            self._threads.pop(thread_id, None)
            self._items.pop(thread_id, None)

    async def delete_thread_item(
        self,
        thread_id: str,
        item_id: str,
        context: ChatKitRequestContext,
    ) -> None:
        async with self._lock:
            items = self._items.get(thread_id)
            if not items:
                return
            self._items[thread_id] = [item for item in items if item.id != item_id]


class DemoChatKitServer(ChatKitServer[ChatKitRequestContext]):
    """Serveur ChatKit piloté par un workflow local."""

    def __init__(self, settings: Settings) -> None:
        super().__init__(InMemoryChatKitStore())
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

        # Convertir le message utilisateur en input pour l'agent
        agent_input = await simple_to_agent_input(input_user_message) if input_user_message else []

        try:
            # Exécuter l'agent de triage avec streaming
            result = Runner.run_streamed(
                triage,
                input=agent_input,
            )

            # Stream les événements de l'agent vers ChatKit
            async for event in stream_agent_response(agent_context, result):
                yield event

        except Exception as exc:  # pragma: no cover - erreurs runtime workflow
            logger.exception("Agent execution failed")
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
