from __future__ import annotations

import asyncio
import datetime as dt
import html
import re
from copy import deepcopy
from collections.abc import Callable, Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from pydantic import TypeAdapter
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from chatkit.store import NotFoundError, Store
from chatkit.types import Attachment, Page, ThreadItem, ThreadMetadata

from .models import ChatAttachment, ChatThread, ChatThreadItem
from .workflows import WorkflowService

# Taille minimale d'une image base64 pour être remplacée par une URL (en caractères)
# ~10KB en base64 = ~13KB en caractères
_IMAGE_BASE64_THRESHOLD = 10000

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

    @staticmethod
    def _normalize_text_block(text: str) -> str:
        if not isinstance(text, str):
            return ""

        normalized = text.strip()
        if not normalized:
            return ""

        # Convert legacy HTML-formatted responses back to raw text/markdown.
        if "<" in normalized and ">" in normalized:
            normalized = normalized.replace("<br />", "\n").replace("<br/>", "\n").replace("<br>", "\n")

            def _replace_code_block(match: re.Match[str]) -> str:
                language = match.group(1) or ""
                code_content = html.unescape(match.group(2))
                return f"\n```{language}\n{code_content}\n```\n"

            normalized = re.sub(
                r"<pre><code(?: class=\"language-([^\"]+)\")?>(.*?)</code></pre>",
                _replace_code_block,
                normalized,
                flags=re.DOTALL | re.IGNORECASE,
            )
            normalized = re.sub(
                r"<code(?: class=\"language-([^\"]+)\")?>(.*?)</code>",
                _replace_code_block,
                normalized,
                flags=re.DOTALL | re.IGNORECASE,
            )
            normalized = re.sub(r"</p>\s*<p>", "\n\n", normalized, flags=re.IGNORECASE)
            normalized = normalized.replace("<p>", "").replace("</p>", "")
            normalized = html.unescape(re.sub(r"<[^>]+>", "", normalized))

        return normalized

    def _normalize_thread_item_payload(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        updated = False
        normalized_payload = deepcopy(payload)
        content_blocks = normalized_payload.get("content")
        if isinstance(content_blocks, list):
            normalized_content: list[Any] = []
            for block in content_blocks:
                if not isinstance(block, dict):
                    normalized_content.append(block)
                    continue

                block_copy = dict(block)
                if block_copy.get("type") in {"input_text", "output_text", "text"}:
                    text_value = block_copy.get("text")
                    normalized_text = self._normalize_text_block(text_value)
                    if normalized_text != (text_value or ""):
                        updated = True
                    block_copy["text"] = normalized_text

                normalized_content.append(block_copy)

            if normalized_content != content_blocks:
                updated = True
            normalized_payload["content"] = normalized_content

        return normalized_payload if updated else dict(payload)

    def _strip_image_data_for_response(
        self,
        payload: dict[str, Any],
        thread_id: str,
        item_id: str,
    ) -> dict[str, Any]:
        """
        Transforme les données d'image base64 volumineuses en références d'URL
        pour réduire la taille du payload envoyé au frontend.

        Les données originales restent en base de données et sont servies
        via l'endpoint /api/chatkit/thread-images/{thread_id}/{item_id}/{image_id}

        Marque également les workflows comme terminés (completed: true) car
        les items chargés depuis la base de données sont forcément terminés.
        """
        # Traiter les items de type workflow qui contiennent des ImageTask
        if payload.get("type") != "workflow":
            return payload

        workflow = payload.get("workflow")
        if not isinstance(workflow, dict):
            return payload

        tasks = workflow.get("tasks")
        if not isinstance(tasks, list):
            return payload

        modified = False
        new_tasks = []

        for task in tasks:
            if not isinstance(task, dict):
                new_tasks.append(task)
                continue

            task_type = task.get("type")

            # Traiter les ImageTask
            if task_type == "image":
                images = task.get("images")
                if isinstance(images, list):
                    new_images = []
                    images_modified = False
                    for image in images:
                        if not isinstance(image, dict):
                            new_images.append(image)
                            continue

                        image_id = image.get("id")
                        if not image_id:
                            new_images.append(image)
                            continue

                        # Vérifier si l'image a des données base64 volumineuses
                        data_url = image.get("data_url") or ""
                        b64_json = image.get("b64_json") or ""

                        has_large_data = (
                            len(data_url) > _IMAGE_BASE64_THRESHOLD or
                            len(b64_json) > _IMAGE_BASE64_THRESHOLD
                        )

                        if has_large_data:
                            # Créer une copie sans les données volumineuses
                            new_image = dict(image)
                            new_image.pop("data_url", None)
                            new_image.pop("b64_json", None)
                            new_image.pop("partials", None)
                            # Ajouter l'URL de référence
                            new_image["image_url"] = (
                                f"/api/chatkit/thread-images/{thread_id}/{item_id}/{image_id}"
                            )
                            new_images.append(new_image)
                            images_modified = True
                            modified = True
                        else:
                            new_images.append(image)

                    if images_modified:
                        task = dict(task)
                        task["images"] = new_images

            # Traiter les ComputerUseTask (screenshots)
            elif task_type == "computer_use":
                screenshots = task.get("screenshots")
                if isinstance(screenshots, list):
                    new_screenshots = []
                    screenshots_modified = False
                    for idx, screenshot in enumerate(screenshots):
                        if not isinstance(screenshot, dict):
                            new_screenshots.append(screenshot)
                            continue

                        # Vérifier si le screenshot a des données volumineuses
                        data_url = screenshot.get("data_url") or ""
                        b64_image = screenshot.get("b64_image") or ""

                        has_large_data = (
                            len(data_url) > _IMAGE_BASE64_THRESHOLD or
                            len(b64_image) > _IMAGE_BASE64_THRESHOLD
                        )

                        if has_large_data:
                            new_screenshot = dict(screenshot)
                            new_screenshot.pop("data_url", None)
                            new_screenshot.pop("b64_image", None)
                            # Utiliser l'index comme ID pour les screenshots
                            screenshot_id = f"screenshot_{idx}"
                            new_screenshot["image_url"] = (
                                f"/api/chatkit/thread-images/{thread_id}/{item_id}/{screenshot_id}"
                            )
                            new_screenshots.append(new_screenshot)
                            screenshots_modified = True
                            modified = True
                        else:
                            new_screenshots.append(screenshot)

                    if screenshots_modified:
                        task = dict(task)
                        task["screenshots"] = new_screenshots

            new_tasks.append(task)

        # Toujours marquer le workflow comme terminé car les items chargés
        # depuis la base de données sont forcément terminés
        result = dict(payload)
        result["workflow"] = dict(workflow)
        result["workflow"]["completed"] = True
        if modified:
            result["workflow"]["tasks"] = new_tasks
        return result

    async def get_thread_image_data(
        self,
        thread_id: str,
        item_id: str,
        image_id: str,
        context: ChatKitRequestContext,
    ) -> tuple[bytes, str] | None:
        """
        Récupère les données binaires d'une image stockée dans un item.

        Retourne un tuple (données, mime_type) ou None si non trouvé.
        """
        owner_id = self._require_user_id(context)

        def _load(session: Session) -> tuple[bytes, str] | None:
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
                return None

            payload = record.payload
            if not isinstance(payload, dict):
                return None

            # Chercher dans les workflows
            if payload.get("type") == "workflow":
                workflow = payload.get("workflow")
                if isinstance(workflow, dict):
                    tasks = workflow.get("tasks")
                    if isinstance(tasks, list):
                        for task in tasks:
                            if not isinstance(task, dict):
                                continue

                            task_type = task.get("type")

                            # Chercher dans ImageTask
                            if task_type == "image":
                                images = task.get("images")
                                if isinstance(images, list):
                                    for image in images:
                                        if not isinstance(image, dict):
                                            continue
                                        if image.get("id") == image_id:
                                            return self._extract_image_bytes(image)

                            # Chercher dans ComputerUseTask screenshots
                            elif task_type == "computer_use":
                                screenshots = task.get("screenshots")
                                if isinstance(screenshots, list):
                                    for idx, screenshot in enumerate(screenshots):
                                        if not isinstance(screenshot, dict):
                                            continue
                                        expected_id = f"screenshot_{idx}"
                                        if expected_id == image_id:
                                            return self._extract_image_bytes(screenshot)

            return None

        return await self._run(_load)

    @staticmethod
    def _extract_image_bytes(image_data: dict[str, Any]) -> tuple[bytes, str] | None:
        """Extrait les données binaires et le type MIME d'une image."""
        import base64

        # Essayer data_url d'abord
        data_url = image_data.get("data_url")
        if isinstance(data_url, str) and data_url.startswith("data:"):
            try:
                # Format: data:image/png;base64,xxxxx
                header, data = data_url.split(",", 1)
                mime_type = header.split(":")[1].split(";")[0]
                return base64.b64decode(data), mime_type
            except (ValueError, IndexError):
                pass

        def _guess_mime() -> str:
            fmt = (image_data.get("output_format") or "").lower()
            if fmt in {"jpg", "jpeg"}:
                return "image/jpeg"
            if fmt == "webp":
                return "image/webp"
            return "image/png"

        if isinstance(data_url, str) and data_url and not data_url.startswith("data:"):
            try:
                raw_bytes = base64.b64decode(data_url)
                return raw_bytes, _guess_mime()
            except Exception:
                pass

        # Essayer b64_json ou b64_image
        b64_data = image_data.get("b64_json") or image_data.get("b64_image")
        if isinstance(b64_data, str) and b64_data:
            try:
                # Déterminer le format à partir des premiers octets
                raw_bytes = base64.b64decode(b64_data)
                mime_type = "image/png"  # Par défaut
                if raw_bytes.startswith(b"\xff\xd8\xff"):
                    mime_type = "image/jpeg"
                elif raw_bytes.startswith(b"RIFF") and b"WEBP" in raw_bytes[:12]:
                    mime_type = "image/webp"
                return raw_bytes, mime_type
            except Exception:
                pass

        return None

    def _current_workflow_metadata(self) -> dict[str, Any]:
        definition = self._workflow_service.get_current()
        workflow = getattr(definition, "workflow", None)
        workflow_id = getattr(workflow, "id", getattr(definition, "workflow_id", None))
        workflow_slug = getattr(workflow, "slug", None)
        workflow_display_name = getattr(workflow, "display_name", None)
        if workflow_slug is None:
            raise RuntimeError("Le workflow actif n'a pas de slug défini")
        return {
            "id": workflow_id,
            "slug": workflow_slug,
            "definition_id": definition.id,
            "display_name": workflow_display_name,
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
        if not matches:
            if (
                isinstance(workflow_metadata, Mapping)
                and workflow_metadata.get("slug") == expected_workflow.get("slug")
            ):
                # Le workflow a été mis à jour (nouveau definition_id) mais le slug
                # reste le même : conserver le fil en l'alignant sur la version active
                metadata["workflow"] = dict(expected_workflow)
                matches = True
                changed = True
            elif self._has_complete_workflow_metadata(workflow_metadata):
                # Le thread appartient à un workflow différent mais a des métadonnées
                # complètes : autoriser le chargement pour permettre de voir les
                # conversations d'autres workflows
                matches = True
            elif not self._has_complete_workflow_metadata(workflow_metadata):
                metadata["workflow"] = dict(expected_workflow)
                matches = True
                changed = True

        payload["metadata"] = metadata

        if changed:
            record.payload = payload
            # Ne pas mettre à jour updated_at lors de la synchronisation des métadonnées
            # internes (definition_id, owner_id) pour éviter de modifier l'ordre de tri
            # des conversations dans la sidebar
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
            items: list[ThreadItem] = []
            changed_records: list[ChatThreadItem] = []

            for record in sliced:
                payload = self._normalize_thread_item_payload(record.payload)
                if payload != record.payload:
                    record.payload = payload
                    changed_records.append(record)

                # Transformer les données d'image volumineuses en URLs de référence
                # (sans modifier les données stockées en base)
                response_payload = self._strip_image_data_for_response(
                    payload, thread_id, record.id
                )
                items.append(self._thread_item_adapter.validate_python(response_payload))

            if changed_records:
                session.add_all(changed_records)
                session.commit()
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
        all_workflows: bool = True,
    ) -> Page[ThreadMetadata]:
        owner_id = self._require_user_id(context)

        def _load(session: Session) -> Page[ThreadMetadata]:
            expected = self._current_workflow_metadata()

            stmt = select(ChatThread).where(ChatThread.owner_id == owner_id)
            if order == "desc":
                stmt = stmt.order_by(ChatThread.updated_at.desc(), ChatThread.id.desc())
            else:
                stmt = stmt.order_by(ChatThread.updated_at.asc(), ChatThread.id.asc())
            records = session.execute(stmt).scalars().all()

            matching: list[tuple[ChatThread, dict[str, Any]]] = []
            for record in records:
                payload, matches = self._normalize_thread_record(
                    record,
                    owner_id=owner_id,
                    session=session,
                    expected_workflow=expected,
                )
                # When all_workflows is True, include all threads regardless of workflow match
                if all_workflows or matches:
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
            # Ne PAS normaliser lors de la sauvegarde pour préserver les données d'image
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
            # Ne PAS normaliser lors de la sauvegarde pour préserver les données d'image
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
            payload = self._normalize_thread_item_payload(record.payload)
            if payload != record.payload:
                record.payload = payload
                session.add(record)
                session.commit()
            # Transformer les données d'image volumineuses en URLs de référence
            # et marquer les workflows comme terminés
            response_payload = self._strip_image_data_for_response(
                payload, thread_id, record.id
            )
            return self._thread_item_adapter.validate_python(response_payload)

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
