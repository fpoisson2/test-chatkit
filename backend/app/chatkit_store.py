from __future__ import annotations

import asyncio
import datetime as dt
from collections.abc import Callable
from typing import TYPE_CHECKING, Any, TypeVar

from pydantic import TypeAdapter
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from chatkit.store import NotFoundError, Store, StoreItemType, default_generate_id
from chatkit.types import Attachment, Page, ThreadItem, ThreadMetadata

from .models import ChatAttachment, ChatThread, ChatThreadItem

if TYPE_CHECKING:
    from .chatkit import ChatKitRequestContext
else:  # pragma: no cover - utilisé uniquement pour éviter les imports circulaires
    ChatKitRequestContext = Any

_T = TypeVar("_T")


def _ensure_timezone(value: dt.datetime | None) -> dt.datetime:
    if isinstance(value, dt.datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=dt.UTC)
        return value.astimezone(dt.UTC)
    return dt.datetime.now(dt.UTC)


class PostgresChatKitStore(Store[ChatKitRequestContext]):
    """Implémentation du store ChatKit reposant sur PostgreSQL."""

    # Les outils distants (ex. web search) renvoient parfois leurs propres IDs `wf_*`
    # qui entrent en collision avec ceux générés localement par le store. On force
    # donc un suffixe stable pour distinguer nos éléments persistés.
    _LOCAL_SUFFIX = "local"

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory
        self._attachment_adapter = TypeAdapter(Attachment)
        self._thread_item_adapter = TypeAdapter(ThreadItem)

    def generate_item_id(
        self,
        item_type: StoreItemType,
        thread: ThreadMetadata,
        context: ChatKitRequestContext,
    ) -> str:
        """Ajoute un suffixe local pour éviter les collisions avec les IDs d'outils."""

        base_id = default_generate_id(item_type)
        return f"{base_id}_{self._LOCAL_SUFFIX}"

    def _require_user_id(self, context: ChatKitRequestContext) -> str:
        if not context.user_id:
            raise NotFoundError("Thread introuvable")
        return context.user_id

    async def _run(self, func: Callable[[Session], _T]) -> _T:
        return await asyncio.to_thread(self._run_sync, func)

    def _run_sync(self, func: Callable[[Session], _T]) -> _T:
        with self._session_factory() as session:
            return func(session)

    async def load_thread(self, thread_id: str, context: ChatKitRequestContext) -> ThreadMetadata:
        owner_id = self._require_user_id(context)

        def _load(session: Session) -> ThreadMetadata:
            stmt = select(ChatThread).where(
                ChatThread.id == thread_id, ChatThread.owner_id == owner_id
            )
            result = session.execute(stmt).scalar_one_or_none()
            if result is None:
                raise NotFoundError(f"Thread {thread_id} introuvable")
            return ThreadMetadata.model_validate(result.payload)

        return await self._run(_load)

    async def save_thread(self, thread: ThreadMetadata, context: ChatKitRequestContext) -> None:
        owner_id = self._require_user_id(context)

        def _save(session: Session) -> None:
            payload = thread.model_dump(mode="json")
            metadata = dict(payload.get("metadata") or {})
            metadata.setdefault("owner_id", owner_id)
            payload["metadata"] = metadata
            now = dt.datetime.now(dt.UTC)
            created_at = _ensure_timezone(thread.created_at)
            stmt = select(ChatThread).where(ChatThread.id == thread.id)
            existing = session.execute(stmt).scalar_one_or_none()
            if existing is None:
                session.add(
                    ChatThread(
                        id=thread.id,
                        owner_id=owner_id,
                        created_at=created_at,
                        updated_at=now,
                        payload=payload,
                    )
                )
            else:
                if existing.owner_id != owner_id:
                    raise NotFoundError(f"Thread {thread.id} introuvable")
                existing.payload = payload
                existing.created_at = created_at
                existing.updated_at = now
            session.commit()

        await self._run(_save)

    async def load_thread_items(
        self,
        thread_id: str,
        after: str | None,
        limit: int,
        order: str,
        context: ChatKitRequestContext,
    ) -> Page[ThreadItem]:
        owner_id = self._require_user_id(context)

        def _load(session: Session) -> Page[ThreadItem]:
            stmt = select(ChatThreadItem).where(
                ChatThreadItem.thread_id == thread_id,
                ChatThreadItem.owner_id == owner_id,
            )
            if order == "desc":
                stmt = stmt.order_by(ChatThreadItem.created_at.desc(), ChatThreadItem.id.desc())
            else:
                stmt = stmt.order_by(ChatThreadItem.created_at.asc(), ChatThreadItem.id.asc())
            records = session.execute(stmt).scalars().all()

            start_index = 0
            if after:
                for idx, record in enumerate(records):
                    if record.id == after:
                        start_index = idx + 1
                        break

            effective_limit = limit or max(len(records) - start_index, 0)
            sliced = records[start_index : start_index + effective_limit]
            has_more = start_index + effective_limit < len(records)
            next_after = sliced[-1].id if has_more and sliced else None
            items = [
                self._thread_item_adapter.validate_python(record.payload)
                for record in sliced
            ]
            return Page(data=items, has_more=has_more, after=next_after)

        return await self._run(_load)

    async def save_attachment(self, attachment: Attachment, context: ChatKitRequestContext) -> None:
        owner_id = self._require_user_id(context)

        def _save(session: Session) -> None:
            payload = attachment.model_dump(mode="json")
            now = dt.datetime.now(dt.UTC)
            stmt = select(ChatAttachment).where(ChatAttachment.id == attachment.id)
            existing = session.execute(stmt).scalar_one_or_none()
            if existing is None:
                session.add(
                    ChatAttachment(
                        id=attachment.id,
                        owner_id=owner_id,
                        created_at=now,
                        payload=payload,
                    )
                )
            else:
                if existing.owner_id != owner_id:
                    raise NotFoundError(f"Pièce jointe {attachment.id} introuvable")
                existing.payload = payload
            session.commit()

        await self._run(_save)

    async def load_attachment(self, attachment_id: str, context: ChatKitRequestContext) -> Attachment:
        owner_id = self._require_user_id(context)

        def _load(session: Session) -> Attachment:
            stmt = select(ChatAttachment).where(
                ChatAttachment.id == attachment_id,
                ChatAttachment.owner_id == owner_id,
            )
            record = session.execute(stmt).scalar_one_or_none()
            if record is None:
                raise NotFoundError(f"Pièce jointe {attachment_id} introuvable")
            return self._attachment_adapter.validate_python(record.payload)

        return await self._run(_load)

    async def delete_attachment(self, attachment_id: str, context: ChatKitRequestContext) -> None:
        owner_id = self._require_user_id(context)

        def _delete(session: Session) -> None:
            stmt = delete(ChatAttachment).where(
                ChatAttachment.id == attachment_id,
                ChatAttachment.owner_id == owner_id,
            )
            session.execute(stmt)
            session.commit()

        await self._run(_delete)

    async def load_threads(
        self,
        limit: int,
        after: str | None,
        order: str,
        context: ChatKitRequestContext,
    ) -> Page[ThreadMetadata]:
        owner_id = self._require_user_id(context)

        def _load(session: Session) -> Page[ThreadMetadata]:
            stmt = select(ChatThread).where(ChatThread.owner_id == owner_id)
            if order == "desc":
                stmt = stmt.order_by(ChatThread.created_at.desc(), ChatThread.id.desc())
            else:
                stmt = stmt.order_by(ChatThread.created_at.asc(), ChatThread.id.asc())
            records = session.execute(stmt).scalars().all()

            start_index = 0
            if after:
                for idx, record in enumerate(records):
                    if record.id == after:
                        start_index = idx + 1
                        break
            effective_limit = limit or max(len(records) - start_index, 0)
            sliced = records[start_index : start_index + effective_limit]
            has_more = start_index + effective_limit < len(records)
            next_after = sliced[-1].id if has_more and sliced else None
            data = [ThreadMetadata.model_validate(record.payload) for record in sliced]
            return Page(data=data, has_more=has_more, after=next_after)

        return await self._run(_load)

    async def add_thread_item(
        self, thread_id: str, item: ThreadItem, context: ChatKitRequestContext
    ) -> None:
        owner_id = self._require_user_id(context)

        def _add(session: Session) -> None:
            thread_stmt = select(ChatThread).where(
                ChatThread.id == thread_id, ChatThread.owner_id == owner_id
            )
            thread = session.execute(thread_stmt).scalar_one_or_none()
            if thread is None:
                raise NotFoundError(f"Thread {thread_id} introuvable")
            payload = item.model_dump(mode="json")
            created_at = _ensure_timezone(getattr(item, "created_at", None))
            session.add(
                ChatThreadItem(
                    id=item.id,
                    thread_id=thread_id,
                    owner_id=owner_id,
                    created_at=created_at,
                    payload=payload,
                )
            )
            session.commit()

        await self._run(_add)

    async def save_item(
        self, thread_id: str, item: ThreadItem, context: ChatKitRequestContext
    ) -> None:
        owner_id = self._require_user_id(context)

        def _save(session: Session) -> None:
            stmt = select(ChatThreadItem).where(
                ChatThreadItem.id == item.id,
                ChatThreadItem.thread_id == thread_id,
                ChatThreadItem.owner_id == owner_id,
            )
            record = session.execute(stmt).scalar_one_or_none()
            if record is None:
                raise NotFoundError(f"Élément {item.id} introuvable dans le fil {thread_id}")
            record.payload = item.model_dump(mode="json")
            record.created_at = _ensure_timezone(getattr(item, "created_at", None))
            session.commit()

        await self._run(_save)

    async def load_item(
        self, thread_id: str, item_id: str, context: ChatKitRequestContext
    ) -> ThreadItem:
        owner_id = self._require_user_id(context)

        def _load(session: Session) -> ThreadItem:
            stmt = select(ChatThreadItem).where(
                ChatThreadItem.id == item_id,
                ChatThreadItem.thread_id == thread_id,
                ChatThreadItem.owner_id == owner_id,
            )
            record = session.execute(stmt).scalar_one_or_none()
            if record is None:
                raise NotFoundError(f"Élément {item_id} introuvable dans le fil {thread_id}")
            return self._thread_item_adapter.validate_python(record.payload)

        return await self._run(_load)

    async def delete_thread(self, thread_id: str, context: ChatKitRequestContext) -> None:
        owner_id = self._require_user_id(context)

        def _delete(session: Session) -> None:
            stmt = delete(ChatThread).where(
                ChatThread.id == thread_id,
                ChatThread.owner_id == owner_id,
            )
            session.execute(stmt)
            session.commit()

        await self._run(_delete)

    async def delete_thread_item(
        self, thread_id: str, item_id: str, context: ChatKitRequestContext
    ) -> None:
        owner_id = self._require_user_id(context)

        def _delete(session: Session) -> None:
            stmt = delete(ChatThreadItem).where(
                ChatThreadItem.id == item_id,
                ChatThreadItem.thread_id == thread_id,
                ChatThreadItem.owner_id == owner_id,
            )
            session.execute(stmt)
            session.commit()

        await self._run(_delete)
