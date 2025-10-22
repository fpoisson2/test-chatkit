from __future__ import annotations

import datetime
import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ..models import JsonDocument
from ..vector_store import JsonVectorStoreService

logger = logging.getLogger("chatkit.docs")

DOC_VECTOR_STORE_SLUG = "chatkit-docs"
DOC_VECTOR_STORE_TITLE = "Documentation ChatKit"
DOC_VECTOR_STORE_METADATA = {"scope": "docs"}

_UNSET = object()


@dataclass(slots=True)
class DocumentationEntry:
    """Représente un article de documentation stocké dans le vector store."""

    slug: str
    title: str | None
    summary: str | None
    language: str | None
    content_markdown: str | None
    metadata: dict[str, Any]
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def as_response(self) -> dict[str, Any]:
        payload = {
            "slug": self.slug,
            "title": self.title,
            "summary": self.summary,
            "language": self.language,
            "content_markdown": self.content_markdown,
            "metadata": dict(self.metadata),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
        return payload

    def as_summary(self) -> dict[str, Any]:
        return {
            "slug": self.slug,
            "title": self.title,
            "summary": self.summary,
            "language": self.language,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class DocumentationService:
    """Service d'accès aux documents de la base de connaissances."""

    def __init__(
        self,
        session: Session,
        *,
        vector_store_slug: str | None = DOC_VECTOR_STORE_SLUG,
    ) -> None:
        self.session = session
        self._vector_store_slug = (vector_store_slug or "").strip()
        if not self._vector_store_slug:
            raise RuntimeError(
                "Le vector store utilisé pour la documentation doit être configuré."
            )

    # -- Opérations CRUD -----------------------------------------------------

    def list_documents(
        self, *, language: str | None = None
    ) -> list[DocumentationEntry]:
        normalized_language = self._normalize_language(language)
        service = self._vector_service()
        try:
            documents = service.list_documents(self._vector_store_slug)
        except LookupError:
            return []

        entries: list[DocumentationEntry] = []
        for document, _chunk_count in documents:
            try:
                entries.append(self._from_document(document))
            except ValueError as exc:
                logger.warning(
                    "Document de documentation ignoré (%s): %s",
                    document.doc_id,
                    exc,
                )
        if normalized_language is None:
            return entries
        return [entry for entry in entries if entry.language == normalized_language]

    def get_document(self, slug: str) -> DocumentationEntry | None:
        normalized = slug.strip()
        if not normalized:
            return None
        document = self._vector_service().get_document(
            self._vector_store_slug, normalized
        )
        if document is None:
            return None
        return self._from_document(document)

    def create_document(
        self,
        slug: str,
        *,
        title: str | None = None,
        summary: str | None = None,
        language: str | None = None,
        content_markdown: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> DocumentationEntry:
        normalized_slug = slug.strip()
        if not normalized_slug:
            raise ValueError("Le slug du document ne peut pas être vide")

        existing = self.get_document(normalized_slug)
        if existing is not None:
            raise ValueError("Un document avec ce slug existe déjà")

        normalized_title = self._normalize_text(title)
        normalized_summary = self._normalize_text(summary)
        normalized_language = self._normalize_language(language)
        normalized_content = self._normalize_markdown(content_markdown)
        normalized_metadata = self._normalize_metadata(metadata)

        payload = self._build_payload(
            normalized_slug,
            normalized_title,
            normalized_summary,
            normalized_language,
            normalized_content,
            normalized_metadata,
        )

        document = self._vector_service().ingest(
            self._vector_store_slug,
            normalized_slug,
            payload,
            store_title=DOC_VECTOR_STORE_TITLE,
            store_metadata=DOC_VECTOR_STORE_METADATA,
            document_metadata=self._document_metadata(payload),
        )
        return self._from_document(document)

    def update_document(
        self,
        slug: str,
        *,
        title: str | None | object = _UNSET,
        summary: str | None | object = _UNSET,
        language: str | None | object = _UNSET,
        content_markdown: str | None | object = _UNSET,
        metadata: dict[str, Any] | None | object = _UNSET,
    ) -> DocumentationEntry:
        existing = self.get_document(slug)
        if existing is None:
            raise LookupError("Document introuvable")

        updated_title = existing.title
        if title is not _UNSET:
            updated_title = self._normalize_text(title)

        updated_summary = existing.summary
        if summary is not _UNSET:
            updated_summary = self._normalize_text(summary)

        updated_language = existing.language
        if language is not _UNSET:
            updated_language = self._normalize_language(language)

        updated_content = existing.content_markdown
        if content_markdown is not _UNSET:
            updated_content = self._normalize_markdown(content_markdown)

        updated_metadata = dict(existing.metadata)
        if metadata is not _UNSET:
            updated_metadata = self._normalize_metadata(metadata)

        payload = self._build_payload(
            existing.slug,
            updated_title,
            updated_summary,
            updated_language,
            updated_content,
            updated_metadata,
        )

        document = self._vector_service().ingest(
            self._vector_store_slug,
            existing.slug,
            payload,
            store_title=DOC_VECTOR_STORE_TITLE,
            store_metadata=DOC_VECTOR_STORE_METADATA,
            document_metadata=self._document_metadata(payload),
        )
        return self._from_document(document)

    def delete_document(self, slug: str) -> None:
        existing = self.get_document(slug)
        if existing is None:
            raise LookupError("Document introuvable")
        self._vector_service().delete_document(
            self._vector_store_slug, existing.slug
        )

    # -- Utilitaires internes ------------------------------------------------

    def _vector_service(self) -> JsonVectorStoreService:
        return JsonVectorStoreService(self.session)

    @staticmethod
    def _normalize_text(value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _normalize_markdown(value: Any) -> str | None:
        if value is None:
            return None
        return str(value)

    @staticmethod
    def _normalize_language(value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip().lower()
        if not text:
            return None
        if len(text) > 32:
            raise ValueError("Le code langue ne doit pas dépasser 32 caractères")
        for char in text:
            if not (char.isalnum() or char == "-"):
                raise ValueError(
                    "Le code langue ne doit contenir que des "
                    "lettres, chiffres ou tirets"
                )
        return text

    @staticmethod
    def _normalize_metadata(metadata: Any) -> dict[str, Any]:
        if metadata is None:
            return {}
        if isinstance(metadata, Mapping):
            candidate = dict(metadata)
        elif isinstance(metadata, list):
            raise ValueError("Les métadonnées doivent être un objet JSON")
        else:
            try:
                candidate = dict(metadata)
            except TypeError as exc:
                raise ValueError(
                    "Les métadonnées doivent être un objet JSON (mapping)"
                ) from exc
        return json.loads(json.dumps(candidate, ensure_ascii=False))

    @staticmethod
    def _build_payload(
        slug: str,
        title: str | None,
        summary: str | None,
        language: str | None,
        content_markdown: str | None,
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"slug": slug}
        if title is not None:
            payload["title"] = title
        if summary is not None:
            payload["summary"] = summary
        if language is not None:
            payload["language"] = language
        if content_markdown is not None:
            payload["content_markdown"] = content_markdown
        for key, value in metadata.items():
            if key in {"slug", "title", "summary", "language", "content_markdown"}:
                continue
            payload[key] = value
        return payload

    @staticmethod
    def _document_metadata(payload: dict[str, Any]) -> dict[str, Any]:
        return {
            key: value
            for key, value in payload.items()
            if key in {"slug", "title", "summary", "language"} and value is not None
        }

    @staticmethod
    def _from_document(document: JsonDocument) -> DocumentationEntry:
        raw = document.raw_document or {}
        if not isinstance(raw, dict):
            raise ValueError(
                "Le document stocké doit être un objet JSON.",
            )
        sanitized = json.loads(json.dumps(raw, ensure_ascii=False))

        slug = str(sanitized.get("slug") or document.doc_id).strip()
        if not slug:
            slug = document.doc_id

        title = DocumentationService._normalize_text(sanitized.get("title"))
        summary = DocumentationService._normalize_text(sanitized.get("summary"))
        language = DocumentationService._normalize_language(sanitized.get("language"))

        content_raw = sanitized.get("content_markdown")
        content_markdown = (
            DocumentationService._normalize_markdown(content_raw)
            if content_raw is not None
            else None
        )

        metadata = {
            key: value
            for key, value in sanitized.items()
            if key
            not in {"slug", "title", "summary", "language", "content_markdown"}
        }

        return DocumentationEntry(
            slug=slug,
            title=title,
            summary=summary,
            language=language,
            content_markdown=content_markdown,
            metadata=metadata,
            created_at=document.created_at,
            updated_at=document.updated_at,
        )
