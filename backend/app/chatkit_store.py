from __future__ import annotations

import asyncio
import datetime as dt
from collections.abc import Callable, Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from pydantic import TypeAdapter
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from chatkit.store import NotFoundError, Store
from chatkit.types import Attachment, Page, ThreadItem, ThreadMetadata

from .models import ChatAttachment, ChatThread, ChatThreadItem
from .workflows import WorkflowService

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

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        workflow_service: WorkflowService | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._attachment_adapter = TypeAdapter(Attachment)
        self._thread_item_adapter = TypeAdapter(ThreadItem)
        self._workflow_service = workflow_service or WorkflowService()

    def _require_user_id(self, context: ChatKitRequestContext) -> str:
        if not context.user_id:
            raise NotFoundError("Thread introuvable")
        return context.user_id

    async def _run(self, func: Callable[[Session], _T]) -> _T:
        return await asyncio.to_thread(self._run_sync, func)

    def _run_sync(self, func: Callable[[Session], _T]) -> _T:
        with self._session_factory() as session:
            return func(session)

    def _current_workflow_metadata(self) -> dict[str, Any]:
        definition = self._workflow_service.get_current()
        workflow = getattr(definition, "workflow", None)
        workflow_id = getattr(workflow, "id", getattr(definition, "workflow_id", None))
        workflow_slug = getattr(workflow, "slug", None)
        if workflow_slug is None:
            raise RuntimeError("Le workflow actif n'a pas de slug défini")
        return {
            "id": workflow_id,
            "slug": workflow_slug,
            "definition_id": definition.id,
        }

    @staticmethod
    def _has_complete_workflow_metadata(metadata: Any) -> bool:
        return (
            isinstance(metadata, Mapping)
            and "id" in metadata
            and "slug" in metadata
            and "definition_id" in metadata
        )

    @staticmethod
    def _workflow_matches(
        metadata: Any, expected: Mapping[str, Any]
    ) -> bool:
        return (
            isinstance(metadata, Mapping)
            and metadata.get("slug") == expected.get("slug")
            and metadata.get("definition_id") == expected.get("definition_id")
        )

    def _normalize_thread_record(
        self,
        record: ChatThread,
        *,
        owner_id: str,
        session: Session,
        expected_workflow: Mapping[str, Any],
    ) -> tuple[dict[str, Any], bool]:
        payload = dict(record.payload)
        metadata = dict(payload.get("metadata") or {})
        changed = False

        if metadata.get("owner_id") != owner_id:
            metadata["owner_id"] = owner_id
            changed = True

        workflow_metadata = metadata.get("workflow")
        matches = self._workflow_matches(workflow_metadata, expected_workflow)
        if not matches and not self._has_complete_workflow_metadata(workflow_metadata):
            metadata["workflow"] = dict(expected_workflow)
            matches = True
            changed = True

        payload["metadata"] = metadata

        if changed:
            record.payload = payload
            record.updated_at = dt.datetime.now(dt.UTC)
            session.add(record)
            session.commit()

        return payload, matches

    def _require_thread_record(
        self,
        session: Session,
        thread_id: str,
        owner_id: str,
        expected_workflow: Mapping[str, Any],
    ) -> tuple[ChatThread, dict[str, Any]]:
        stmt = select(ChatThread).where(
            ChatThread.id == thread_id, ChatThread.owner_id == owner_id
        )
        record = session.execute(stmt).scalar_one_or_none()
        if record is None:
            raise NotFoundError(f"Thread {thread_id} introuvable")
        payload, matches = self._normalize_thread_record(
            record,
            owner_id=owner_id,
            session=session,
            expected_workflow=expected_workflow,
        )
        if not matches:
            raise NotFoundError(f"Thread {thread_id} introuvable")
        return record, payload

    async def load_thread(
        self, thread_id: str, context: ChatKitRequestContext
    ) -> ThreadMetadata:
        owner_id = self._require_user_id(context)

        def _load(session: Session) -> ThreadMetadata:
            expected = self._current_workflow_metadata()
            _record, payload = self._require_thread_record(
                session,
                thread_id,
                owner_id,
                expected,
            )
            return ThreadMetadata.model_validate(payload)

        return await self._run(_load)

    async def save_thread(
        self, thread: ThreadMetadata, context: ChatKitRequestContext
    ) -> None:
        owner_id = self._require_user_id(context)

        def _save(session: Session) -> None:
            payload = thread.model_dump(mode="json")
            # Utiliser thread.metadata si disponible (peut contenir des mises à jour récentes),
            # sinon utiliser les métadonnées du payload
            if isinstance(thread.metadata, dict):
                metadata = dict(thread.metadata)
            else:
                metadata = dict(payload.get("metadata") or {})
            metadata.setdefault("owner_id", owner_id)
            expected_workflow = self._current_workflow_metadata()
            workflow_metadata = metadata.get("workflow")
            if self._has_complete_workflow_metadata(workflow_metadata):
                # Garder les métadonnées de workflow existantes
                # Permet aux threads de différents workflows de coexister (cache frontend)
                pass
            else:
                # Assigner le workflow actuel si pas de métadonnées complètes
                metadata["workflow"] = dict(expected_workflow)
            thread.metadata = metadata
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
            expected = self._current_workflow_metadata()
            self._require_thread_record(
                session,
                thread_id,
                owner_id,
                expected,
            )

            stmt = select(ChatThreadItem).where(
                ChatThreadItem.thread_id == thread_id,
                ChatThreadItem.owner_id == owner_id,
            )
            if order == "desc":
                stmt = stmt.order_by(
                    ChatThreadItem.created_at.desc(), ChatThreadItem.id.desc()
                )
            else:
                stmt = stmt.order_by(
                    ChatThreadItem.created_at.asc(), ChatThreadItem.id.asc()
                )
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

    async def save_attachment(
        self, attachment: Attachment, context: ChatKitRequestContext
    ) -> None:
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

    async def load_attachment(
        self, attachment_id: str, context: ChatKitRequestContext
    ) -> Attachment:
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

    async def delete_attachment(
        self, attachment_id: str, context: ChatKitRequestContext
    ) -> None:
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
            expected = self._current_workflow_metadata()

            stmt = select(ChatThread).where(ChatThread.owner_id == owner_id)
            if order == "desc":
                stmt = stmt.order_by(ChatThread.created_at.desc(), ChatThread.id.desc())
            else:
                stmt = stmt.order_by(ChatThread.created_at.asc(), ChatThread.id.asc())
            records = session.execute(stmt).scalars().all()

            matching: list[tuple[ChatThread, dict[str, Any]]] = []
            for record in records:
                payload, matches = self._normalize_thread_record(
                    record,
                    owner_id=owner_id,
                    session=session,
                    expected_workflow=expected,
                )
                if matches:
                    matching.append((record, payload))

            filtered_records = [record for record, _payload in matching]

            start_index = 0
            if after:
                for idx, record in enumerate(filtered_records):
                    if record.id == after:
                        start_index = idx + 1
                        break

            effective_limit = limit or max(len(filtered_records) - start_index, 0)
            sliced_pairs = matching[start_index : start_index + effective_limit]
            has_more = start_index + effective_limit < len(filtered_records)
            next_after = (
                sliced_pairs[-1][0].id if has_more and sliced_pairs else None
            )
            data = [
                ThreadMetadata.model_validate(payload)
                for _record, payload in sliced_pairs
            ]
            return Page(data=data, has_more=has_more, after=next_after)

        return await self._run(_load)

    async def add_thread_item(
        self, thread_id: str, item: ThreadItem, context: ChatKitRequestContext
    ) -> None:
        owner_id = self._require_user_id(context)

        def _add(session: Session) -> None:
            expected = self._current_workflow_metadata()
            self._require_thread_record(
                session,
                thread_id,
                owner_id,
                expected,
            )
            payload = item.model_dump(mode="json")
            created_at = _ensure_timezone(getattr(item, "created_at", None))
            existing = session.get(ChatThreadItem, item.id)
            if existing is None:
                session.add(
                    ChatThreadItem(
                        id=item.id,
                        thread_id=thread_id,
                        owner_id=owner_id,
                        created_at=created_at,
                        payload=payload,
                    )
                )
            else:
                if existing.owner_id != owner_id or existing.thread_id != thread_id:
                    raise NotFoundError(
                        f"Élément {item.id} introuvable dans le fil {thread_id}"
                    )
                existing.payload = payload
                existing.created_at = created_at
            session.commit()

        await self._run(_add)

    async def save_item(
        self, thread_id: str, item: ThreadItem, context: ChatKitRequestContext
    ) -> None:
        owner_id = self._require_user_id(context)

        def _save(session: Session) -> None:
            expected = self._current_workflow_metadata()
            self._require_thread_record(
                session,
                thread_id,
                owner_id,
                expected,
            )
            stmt = select(ChatThreadItem).where(
                ChatThreadItem.id == item.id,
                ChatThreadItem.thread_id == thread_id,
                ChatThreadItem.owner_id == owner_id,
            )
            record = session.execute(stmt).scalar_one_or_none()
            if record is None:
                raise NotFoundError(
                    f"Élément {item.id} introuvable dans le fil {thread_id}"
                )
            record.payload = item.model_dump(mode="json")
            record.created_at = _ensure_timezone(getattr(item, "created_at", None))
            session.commit()

        await self._run(_save)

    async def load_item(
        self, thread_id: str, item_id: str, context: ChatKitRequestContext
    ) -> ThreadItem:
        owner_id = self._require_user_id(context)

        def _load(session: Session) -> ThreadItem:
            expected = self._current_workflow_metadata()
            self._require_thread_record(
                session,
                thread_id,
                owner_id,
                expected,
            )
            stmt = select(ChatThreadItem).where(
                ChatThreadItem.id == item_id,
                ChatThreadItem.thread_id == thread_id,
                ChatThreadItem.owner_id == owner_id,
            )
            record = session.execute(stmt).scalar_one_or_none()
            if record is None:
                raise NotFoundError(
                    f"Élément {item_id} introuvable dans le fil {thread_id}"
                )
            return self._thread_item_adapter.validate_python(record.payload)

        return await self._run(_load)

    async def delete_thread(
        self, thread_id: str, context: ChatKitRequestContext
    ) -> None:
        owner_id = self._require_user_id(context)

        def _delete(session: Session) -> None:
            expected = self._current_workflow_metadata()
            self._require_thread_record(
                session,
                thread_id,
                owner_id,
                expected,
            )
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
            expected = self._current_workflow_metadata()
            self._require_thread_record(
                session,
                thread_id,
                owner_id,
                expected,
            )
            stmt = delete(ChatThreadItem).where(
                ChatThreadItem.id == item_id,
                ChatThreadItem.thread_id == thread_id,
                ChatThreadItem.owner_id == owner_id,
            )
            session.execute(stmt)
            session.commit()

        await self._run(_delete)
