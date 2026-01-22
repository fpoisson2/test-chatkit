"""Supabase Storage implementation for attachments.

This module provides a stateless attachment store using Supabase Storage,
enabling horizontal scaling without local filesystem dependencies.
"""

from __future__ import annotations

import io
import logging
import os
import re
from typing import Any
from urllib.parse import urljoin

from fastapi import UploadFile

from chatkit.store import AttachmentStore, NotFoundError
from chatkit.types import Attachment, AttachmentCreateParams, FileAttachment

from .chatkit_server.context import ChatKitRequestContext
from .chatkit_store import PostgresChatKitStore
from .docx_converter import (
    convert_docx_to_pdf_bytes,
    get_pdf_filename,
    get_pdf_mime_type,
    is_docx_file,
)

logger = logging.getLogger(__name__)

DEFAULT_MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024
_CHUNK_SIZE = 1024 * 1024
DEFAULT_BUCKET_NAME = "attachments"


class SupabaseAttachmentStore(AttachmentStore[ChatKitRequestContext]):
    """Supabase Storage implementation of AttachmentStore.

    Stores files in Supabase Storage for stateless, scalable deployments.
    Files are organized by user_id in the bucket.
    """

    def __init__(
        self,
        store: PostgresChatKitStore,
        *,
        supabase_url: str,
        supabase_key: str,
        bucket_name: str = DEFAULT_BUCKET_NAME,
        max_size: int = DEFAULT_MAX_ATTACHMENT_SIZE,
        default_base_url: str | None = None,
    ) -> None:
        from supabase import create_client

        self._store = store
        self._supabase = create_client(supabase_url, supabase_key)
        self._bucket_name = bucket_name
        self._max_size = max_size
        self._pending: dict[str, int | None] = {}  # attachment_id -> expected_size
        self._default_base_url = (default_base_url or "http://localhost:8000").rstrip("/")

        # Ensure bucket exists
        self._ensure_bucket()

    def _ensure_bucket(self) -> None:
        """Create the storage bucket if it doesn't exist."""
        try:
            buckets = self._supabase.storage.list_buckets()
            bucket_names = [b.name for b in buckets]
            if self._bucket_name not in bucket_names:
                self._supabase.storage.create_bucket(
                    self._bucket_name,
                    options={"public": False}
                )
                logger.info(f"Created Supabase storage bucket: {self._bucket_name}")
        except Exception as e:
            logger.warning(f"Could not ensure bucket exists: {e}")

    @staticmethod
    def _sanitize_segment(value: str, fallback: str) -> str:
        """Sanitize a string for use in a file path."""
        if not value:
            return fallback
        normalized = re.sub(r"[^a-zA-Z0-9._-]", "_", value)
        return normalized or fallback

    def _get_storage_path(self, user_id: str, attachment_id: str, filename: str) -> str:
        """Build the storage path for an attachment."""
        safe_user = self._sanitize_segment(user_id, "anonymous")
        safe_name = self._sanitize_segment(filename, attachment_id)
        return f"{safe_user}/{attachment_id}__{safe_name}"

    async def create_attachment(
        self, params: AttachmentCreateParams, context: ChatKitRequestContext
    ) -> Attachment:
        if not context.user_id:
            raise ValueError("Authentication required to create attachment")

        expected_size = params.size if params.size and params.size > 0 else None
        if expected_size and expected_size > self._max_size:
            raise ValueError("Attachment exceeds maximum allowed size")

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
        self._pending[attachment_id] = expected_size
        return attachment

    async def finalize_upload(
        self,
        attachment_id: str,
        upload: UploadFile,
        context: ChatKitRequestContext,
    ) -> FileAttachment:
        if not context.user_id:
            raise ValueError("Authentication required to upload attachment")

        attachment = self._coerce_file_attachment(
            await self._store.load_attachment(attachment_id, context)
        )

        expected_size = self._pending.get(attachment_id)

        # Read file content
        content = b""
        total = 0
        try:
            while True:
                chunk = await upload.read(_CHUNK_SIZE)
                if not chunk:
                    break
                content += chunk
                total += len(chunk)
                if total > self._max_size:
                    raise ValueError("Attachment exceeds maximum allowed size")

            if expected_size and total != expected_size:
                raise ValueError("Attachment size does not match initial declaration")
        finally:
            await upload.close()
            self._pending.pop(attachment_id, None)

        # Handle DOCX to PDF conversion
        final_name = attachment.name
        final_mime_type = attachment.mime_type
        final_content = content

        if is_docx_file(attachment.name, attachment.mime_type):
            logger.info(f"DOCX conversion detected for: {attachment.name}")
            try:
                pdf_content = await convert_docx_to_pdf_bytes(content)
                final_name = get_pdf_filename(attachment.name)
                final_mime_type = get_pdf_mime_type()
                final_content = pdf_content
                logger.info(f"DOCX converted to PDF: {final_name}")
            except Exception as e:
                logger.warning(
                    f"DOCX to PDF conversion failed for {attachment.name}: {e}. "
                    f"Keeping original DOCX file."
                )

        # Upload to Supabase Storage
        storage_path = self._get_storage_path(context.user_id, attachment_id, final_name)

        try:
            self._supabase.storage.from_(self._bucket_name).upload(
                storage_path,
                final_content,
                file_options={"content-type": final_mime_type or "application/octet-stream"}
            )
        except Exception as e:
            # If file already exists, try to update it
            if "Duplicate" in str(e) or "already exists" in str(e).lower():
                self._supabase.storage.from_(self._bucket_name).update(
                    storage_path,
                    final_content,
                    file_options={"content-type": final_mime_type or "application/octet-stream"}
                )
            else:
                raise

        stored = FileAttachment(
            id=attachment.id,
            name=final_name,
            mime_type=final_mime_type,
            upload_url=None,
        )
        await self._store.save_attachment(stored, context)
        return stored

    async def delete_attachment(
        self, attachment_id: str, context: ChatKitRequestContext
    ) -> None:
        if not context.user_id:
            raise ValueError("Authentication required to delete attachment")

        try:
            attachment = self._coerce_file_attachment(
                await self._store.load_attachment(attachment_id, context)
            )
        except NotFoundError:
            self._pending.pop(attachment_id, None)
            return

        storage_path = self._get_storage_path(context.user_id, attachment_id, attachment.name)

        try:
            self._supabase.storage.from_(self._bucket_name).remove([storage_path])
        except Exception as e:
            logger.warning(f"Failed to delete file from Supabase Storage: {e}")

        self._pending.pop(attachment_id, None)

    async def open_attachment(
        self, attachment_id: str, context: ChatKitRequestContext
    ) -> tuple[bytes, str, str]:
        """Open an attachment and return its content.

        Returns:
            Tuple of (content_bytes, mime_type, filename)

        Note: Unlike LocalAttachmentStore which returns a Path, this returns bytes
        since the file is remote. The caller should handle this appropriately.
        """
        if not context.user_id:
            raise NotFoundError(f"Attachment {attachment_id} not found")

        attachment = self._coerce_file_attachment(
            await self._store.load_attachment(attachment_id, context)
        )

        storage_path = self._get_storage_path(context.user_id, attachment_id, attachment.name)

        try:
            response = self._supabase.storage.from_(self._bucket_name).download(storage_path)
            return (
                response,
                attachment.mime_type or "application/octet-stream",
                attachment.name,
            )
        except Exception as e:
            logger.error(f"Failed to download attachment from Supabase: {e}")
            raise NotFoundError(f"Attachment {attachment_id} not found")

    def get_public_url(self, attachment_id: str, user_id: str, filename: str) -> str:
        """Get a public URL for an attachment (if bucket is public)."""
        storage_path = self._get_storage_path(user_id, attachment_id, filename)
        return self._supabase.storage.from_(self._bucket_name).get_public_url(storage_path)

    def get_signed_url(
        self, attachment_id: str, user_id: str, filename: str, expires_in: int = 3600
    ) -> str:
        """Get a signed URL for temporary access to an attachment."""
        storage_path = self._get_storage_path(user_id, attachment_id, filename)
        response = self._supabase.storage.from_(self._bucket_name).create_signed_url(
            storage_path, expires_in
        )
        return response["signedURL"]

    @staticmethod
    def _coerce_file_attachment(value: Any) -> FileAttachment:
        if isinstance(value, FileAttachment):
            return value
        if hasattr(value, "model_dump"):
            payload = value.model_dump()
        else:
            payload = value
        return FileAttachment.model_validate(payload)


def get_attachment_store(
    store: PostgresChatKitStore,
    default_base_url: str | None = None,
) -> AttachmentStore[ChatKitRequestContext]:
    """Factory function to get the appropriate attachment store.

    Returns SupabaseAttachmentStore if SUPABASE_URL and SUPABASE_SERVICE_KEY
    are configured, otherwise falls back to LocalAttachmentStore.
    """
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_KEY")

    if supabase_url and supabase_key:
        logger.info("Using Supabase Storage for attachments")
        return SupabaseAttachmentStore(
            store,
            supabase_url=supabase_url,
            supabase_key=supabase_key,
            bucket_name=os.getenv("SUPABASE_STORAGE_BUCKET", DEFAULT_BUCKET_NAME),
            default_base_url=default_base_url,
        )
    else:
        logger.info("Using local filesystem for attachments")
        from .attachment_store import LocalAttachmentStore
        return LocalAttachmentStore(store, default_base_url=default_base_url)
