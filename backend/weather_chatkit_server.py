"""Expose l'agent météo via une implémentation minimale du protocole ChatKit."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse

from agents import Runner
from chatkit.agents import AgentContext, simple_to_agent_input, stream_agent_response
from chatkit.server import ChatKitServer, NonStreamingResult, StreamingResult
from chatkit.store import NotFoundError, Store
from chatkit.types import Attachment, Page, ThreadItem, ThreadMetadata, ThreadStreamEvent, UserMessageItem

from weather_agent import create_agent


def _deep_copy_item(item: ThreadItem) -> ThreadItem:
    """Retourne une copie profonde du ThreadItem pour éviter les mutations."""

    copy_method = getattr(item, "model_copy", None)
    if callable(copy_method):  # pydantic >= 2
        return copy_method(deep=True)
    return item


def _deep_copy_attachment(attachment: Attachment) -> Attachment:
    copy_method = getattr(attachment, "model_copy", None)
    if callable(copy_method):
        return copy_method(deep=True)
    return attachment


class InMemoryStore(Store[dict[str, Any]]):
    """Dépôt en mémoire répondant à l'interface `Store` de ChatKit."""

    def __init__(self) -> None:
        super().__init__()
        self._threads: dict[str, ThreadMetadata] = {}
        self._thread_items: dict[str, list[ThreadItem]] = {}
        self._attachments: dict[str, Attachment] = {}
        self._lock = asyncio.Lock()

    async def load_thread(self, thread_id: str, context: dict[str, Any]) -> ThreadMetadata:
        async with self._lock:
            metadata = self._threads.get(thread_id)
            if metadata is None:
                raise NotFoundError(f"Thread {thread_id} introuvable")
            return metadata.model_copy(deep=True)

    async def save_thread(self, thread: ThreadMetadata, context: dict[str, Any]) -> None:
        async with self._lock:
            metadata = thread.model_copy(deep=True)
            self._threads[metadata.id] = metadata
            self._thread_items.setdefault(metadata.id, [])

    async def load_thread_items(
        self,
        thread_id: str,
        after: str | None,
        limit: int,
        order: str,
        context: dict[str, Any],
    ) -> Page[ThreadItem]:
        async with self._lock:
            items = list(self._thread_items.get(thread_id, []))
            items.sort(key=lambda item: item.created_at)
            if order == "desc":
                items.reverse()

            start = 0
            if after:
                for index, candidate in enumerate(items):
                    if candidate.id == after:
                        start = index + 1
                        break
                else:
                    raise NotFoundError(f"Élément {after} introuvable pour le thread {thread_id}")

            slice_ = items[start : start + limit]
            has_more = start + limit < len(items)
            after_token = slice_[-1].id if has_more and slice_ else None
            return Page[ThreadItem](
                data=[_deep_copy_item(item) for item in slice_],
                has_more=has_more,
                after=after_token,
            )

    async def save_attachment(self, attachment: Attachment, context: dict[str, Any]) -> None:
        async with self._lock:
            self._attachments[attachment.id] = _deep_copy_attachment(attachment)

    async def load_attachment(self, attachment_id: str, context: dict[str, Any]) -> Attachment:
        async with self._lock:
            attachment = self._attachments.get(attachment_id)
            if attachment is None:
                raise NotFoundError(f"Pièce jointe {attachment_id} introuvable")
            return _deep_copy_attachment(attachment)

    async def delete_attachment(self, attachment_id: str, context: dict[str, Any]) -> None:
        async with self._lock:
            self._attachments.pop(attachment_id, None)

    async def load_threads(
        self,
        limit: int,
        after: str | None,
        order: str,
        context: dict[str, Any],
    ) -> Page[ThreadMetadata]:
        async with self._lock:
            threads = list(self._threads.values())
            threads.sort(key=lambda metadata: metadata.created_at)
            if order == "desc":
                threads.reverse()

            start = 0
            if after:
                for index, metadata in enumerate(threads):
                    if metadata.id == after:
                        start = index + 1
                        break
                else:
                    raise NotFoundError(f"Thread {after} introuvable")

            slice_ = threads[start : start + limit]
            has_more = start + limit < len(threads)
            after_token = slice_[-1].id if has_more and slice_ else None
            return Page[ThreadMetadata](
                data=[metadata.model_copy(deep=True) for metadata in slice_],
                has_more=has_more,
                after=after_token,
            )

    async def add_thread_item(
        self, thread_id: str, item: ThreadItem, context: dict[str, Any]
    ) -> None:
        async with self._lock:
            if thread_id not in self._threads:
                raise NotFoundError(f"Thread {thread_id} introuvable")
            items = self._thread_items.setdefault(thread_id, [])
            items.append(_deep_copy_item(item))
            items.sort(key=lambda candidate: candidate.created_at)

    async def save_item(
        self, thread_id: str, item: ThreadItem, context: dict[str, Any]
    ) -> None:
        async with self._lock:
            items = self._thread_items.get(thread_id)
            if items is None:
                raise NotFoundError(f"Thread {thread_id} introuvable")
            for index, candidate in enumerate(items):
                if candidate.id == item.id:
                    items[index] = _deep_copy_item(item)
                    break
            else:
                raise NotFoundError(f"Élément {item.id} introuvable dans le thread {thread_id}")

    async def load_item(
        self, thread_id: str, item_id: str, context: dict[str, Any]
    ) -> ThreadItem:
        async with self._lock:
            items = self._thread_items.get(thread_id)
            if items is None:
                raise NotFoundError(f"Thread {thread_id} introuvable")
            for candidate in items:
                if candidate.id == item_id:
                    return _deep_copy_item(candidate)
            raise NotFoundError(f"Élément {item_id} introuvable dans le thread {thread_id}")

    async def delete_thread(self, thread_id: str, context: dict[str, Any]) -> None:
        async with self._lock:
            self._threads.pop(thread_id, None)
            self._thread_items.pop(thread_id, None)

    async def delete_thread_item(
        self, thread_id: str, item_id: str, context: dict[str, Any]
    ) -> None:
        async with self._lock:
            items = self._thread_items.get(thread_id)
            if not items:
                raise NotFoundError(f"Thread {thread_id} introuvable")
            self._thread_items[thread_id] = [
                candidate for candidate in items if candidate.id != item_id
            ]


class WeatherChatKitServer(ChatKitServer[dict[str, Any]]):
    """Serveur ChatKit pilotant l'agent météo."""

    def __init__(self) -> None:
        super().__init__(store=InMemoryStore())
        self._agent = create_agent()

    async def respond(
        self,
        thread: ThreadMetadata,
        input_user_message: UserMessageItem | None,
        context: dict[str, Any],
    ) -> AsyncIterator[ThreadStreamEvent]:
        agent_context = AgentContext(
            thread=thread,
            store=self.store,
            request_context=context,
            previous_response_id=None,
        )

        history = await self.store.load_thread_items(
            thread.id,
            after=None,
            limit=100,
            order="asc",
            context=context,
        )

        agent_input = simple_to_agent_input(history.data)
        result = Runner.run_streamed(
            self._agent,
            agent_input,
            context=agent_context,
        )

        async for event in stream_agent_response(agent_context, result):
            yield event


app = FastAPI(title="ChatKit météo", version="0.1.0")
server = WeatherChatKitServer()


@app.post("/chatkit/weather")
async def chatkit_weather_endpoint(request: Request) -> Response | StreamingResponse:
    """Point d'entrée compatible ChatKit pour l'agent météo."""

    body = await request.body()
    result = await server.process(body, context={})

    if isinstance(result, StreamingResult):
        return StreamingResponse(result, media_type="text/event-stream")
    if isinstance(result, NonStreamingResult):
        return Response(content=result.json, media_type="application/json")

    raise RuntimeError("Type de réponse ChatKit inattendu")

