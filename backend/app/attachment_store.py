from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

from fastapi import UploadFile

from chatkit.store import AttachmentStore, NotFoundError
from chatkit.types import AttachmentCreateParams, FileAttachment

from .chatkit_server.context import ChatKitRequestContext
from .chatkit_store import PostgresChatKitStore

ATTACHMENT_STORAGE_DIR = Path(__file__).resolve().parent / "uploaded_attachments"
ATTACHMENT_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024
_CHUNK_SIZE = 1024 * 1024


class AttachmentUploadError(Exception):
    """Erreur levée lors de l'upload d'une pièce jointe."""


def _sanitize_segment(value: str, fallback: str) -> str:
    """Sanitise une chaîne pour l'utiliser dans un nom de fichier."""

    if not value:
        return fallback
    normalized = re.sub(r"[^a-zA-Z0-9._-]", "_", value)
    return normalized or fallback


def _attachment_filename(attachment_id: str, original_name: str) -> str:
    """Construit un nom de fichier déterministe pour une pièce jointe."""

    safe_name = _sanitize_segment(original_name, attachment_id)
    return f"{attachment_id}__{safe_name}"


def _user_directory(base_dir: Path, user_id: str) -> Path:
    """Retourne (et crée si besoin) le dossier dédié à l'utilisateur."""

    safe_user = _sanitize_segment(user_id, "anonymous")
    directory = base_dir / safe_user
    directory.mkdir(parents=True, exist_ok=True)
    return directory


@dataclass
class _PendingAttachment:
    expected_size: int | None


class LocalAttachmentStore(AttachmentStore[ChatKitRequestContext]):
    """Implémentation locale de l'AttachmentStore."""

    def __init__(
        self,
        store: PostgresChatKitStore,
        *,
        base_dir: Path | None = None,
        max_size: int = DEFAULT_MAX_ATTACHMENT_SIZE,
        default_base_url: str | None = None,
    ) -> None:
        self._store = store
        self._base_dir = Path(base_dir or ATTACHMENT_STORAGE_DIR)
        self._base_dir.mkdir(parents=True, exist_ok=True)
        self._max_size = max_size
        self._pending: dict[str, _PendingAttachment] = {}
        self._default_base_url = (default_base_url or "http://localhost:8000").rstrip("/")

    async def create_attachment(
        self, params: AttachmentCreateParams, context: ChatKitRequestContext
    ) -> Attachment:
        if not context.user_id:
            raise AttachmentUploadError("Authentification requise pour créer une pièce jointe")

        expected_size = params.size if params.size and params.size > 0 else None
        if expected_size and expected_size > self._max_size:
            raise AttachmentUploadError(
                "La pièce jointe dépasse la taille maximale autorisée"
            )

        attachment_id = self.generate_attachment_id(params.mime_type, context)
        safe_name = params.name or attachment_id
        upload_path = f"/api/chatkit/attachments/{attachment_id}/upload"
        base_url = context.public_base_url or self._default_base_url
        upload_url = urljoin(base_url + "/", upload_path.lstrip("/"))
        attachment = FileAttachment(
            id=attachment_id,
            name=safe_name,
            mime_type=params.mime_type,
            upload_url=upload_url,
        )
        await self._store.save_attachment(attachment, context)
        self._pending[attachment_id] = _PendingAttachment(expected_size)
        return attachment

    async def finalize_upload(
        self,
        attachment_id: str,
        upload: UploadFile,
        context: ChatKitRequestContext,
    ) -> FileAttachment:
        if not context.user_id:
            raise AttachmentUploadError("Authentification requise pour téléverser une pièce jointe")

        attachment = self._coerce_file_attachment(
            await self._store.load_attachment(attachment_id, context)
        )

        pending = self._pending.get(attachment_id)
        user_dir = _user_directory(self._base_dir, context.user_id)
        target_name = _attachment_filename(attachment_id, attachment.name)
        destination = user_dir / target_name
        temp_destination = destination.with_suffix(destination.suffix + ".upload")

        total = 0
        try:
            with temp_destination.open("wb") as buffer:
                while True:
                    chunk = await upload.read(_CHUNK_SIZE)
                    if not chunk:
                        break
                    buffer.write(chunk)
                    total += len(chunk)
                    if total > self._max_size:
                        raise AttachmentUploadError(
                            "La pièce jointe dépasse la taille maximale autorisée"
                        )
            if pending and pending.expected_size and total != pending.expected_size:
                raise AttachmentUploadError("La taille de la pièce jointe ne correspond pas à la déclaration initiale")
            os.replace(temp_destination, destination)
        except Exception:
            temp_destination.unlink(missing_ok=True)
            raise
        finally:
            await upload.close()
            self._pending.pop(attachment_id, None)

        stored = FileAttachment(
            id=attachment.id,
            name=attachment.name,
            mime_type=attachment.mime_type,
            upload_url=None,
        )
        await self._store.save_attachment(stored, context)
        return stored

    async def delete_attachment(
        self, attachment_id: str, context: ChatKitRequestContext
    ) -> None:
        if not context.user_id:
            raise AttachmentUploadError("Authentification requise pour supprimer une pièce jointe")

        try:
            attachment = self._coerce_file_attachment(
                await self._store.load_attachment(attachment_id, context)
            )
        except NotFoundError:
            self._pending.pop(attachment_id, None)
            return

        user_dir = _user_directory(self._base_dir, context.user_id)
        file_path = user_dir / _attachment_filename(attachment_id, attachment.name)
        if file_path.is_file():
            file_path.unlink()
        self._pending.pop(attachment_id, None)

    async def open_attachment(
        self, attachment_id: str, context: ChatKitRequestContext
    ) -> tuple[Path, str, str]:
        if not context.user_id:
            raise NotFoundError(f"Pièce jointe {attachment_id} introuvable")

        attachment = self._coerce_file_attachment(
            await self._store.load_attachment(attachment_id, context)
        )

        user_dir = _user_directory(self._base_dir, context.user_id)
        file_path = user_dir / _attachment_filename(attachment_id, attachment.name)
        if not file_path.is_file():
            raise NotFoundError(f"Pièce jointe {attachment_id} introuvable")
        return file_path, attachment.mime_type or "application/octet-stream", attachment.name

    @staticmethod
    def _coerce_file_attachment(value: Any) -> FileAttachment:
        if isinstance(value, FileAttachment):
            return value
        if hasattr(value, "model_dump"):
            payload = value.model_dump()
        else:
            payload = value
        return FileAttachment.model_validate(payload)
