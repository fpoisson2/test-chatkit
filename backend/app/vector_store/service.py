"""Ingestion de documents JSON dans les tables vectorielles."""

from __future__ import annotations

import json
import logging
import math
from collections.abc import Iterable, Sequence
from functools import lru_cache
from typing import Any

from sentence_transformers import SentenceTransformer
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import EMBEDDING_DIMENSION, JsonChunk, JsonDocument, JsonVectorStore

logger = logging.getLogger("chatkit.vector_store")

DEFAULT_EMBEDDING_MODEL = "intfloat/multilingual-e5-small"
DEFAULT_CHUNK_SIZE = 40
DEFAULT_CHUNK_OVERLAP = 8


@lru_cache(maxsize=2)
def _load_model(model_name: str) -> SentenceTransformer:
    logger.info("Chargement du modèle d'embedding %s", model_name)
    return SentenceTransformer(model_name)


def _format_value(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    if value is None:
        return "null"
    return str(value)


def _flatten_json(document: Any, prefix: str = "") -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []

    if isinstance(document, dict):
        for key, value in document.items():
            key_prefix = f"{prefix}.{key}" if prefix else str(key)
            entries.extend(_flatten_json(value, key_prefix))
        return entries

    if isinstance(document, list):
        for index, value in enumerate(document):
            key_prefix = f"{prefix}[{index}]" if prefix else f"[{index}]"
            entries.extend(_flatten_json(value, key_prefix))
        return entries

    path = prefix or "root"
    entries.append({"path": path, "value": _format_value(document)})
    return entries


def _chunk_entries(
    entries: Sequence[dict[str, str]],
    *,
    chunk_size: int,
    overlap: int,
) -> Iterable[list[dict[str, str]]]:
    if chunk_size <= 0:
        raise ValueError("chunk_size doit être strictement positif")
    if overlap < 0:
        raise ValueError("overlap ne peut pas être négatif")
    adjusted_overlap = min(overlap, chunk_size - 1) if chunk_size > 1 else 0
    total = len(entries)
    if total == 0:
        yield []
        return
    start = 0
    while start < total:
        end = min(total, start + chunk_size)
        chunk = [dict(item) for item in entries[start:end]]
        yield chunk
        if end >= total:
            break
        if adjusted_overlap == 0:
            start = end
        else:
            start = max(end - adjusted_overlap, start + 1)


def _normalize(vector: Sequence[float]) -> list[float]:
    norm = math.sqrt(sum(component * component for component in vector))
    if norm == 0:
        return [float(component) for component in vector]
    return [float(component) / norm for component in vector]


def linearize_json(document: Any) -> str:
    """Retourne le texte linéarisé correspondant au JSON donné."""

    entries = _flatten_json(document)
    if not entries:
        entries = [{"path": "root", "value": _format_value(document)}]
    return "\n".join(f"{entry['path']}: {entry['value']}" for entry in entries)


class JsonVectorStoreService:
    """Gère l'ingestion de documents JSON et leur indexation vectorielle."""

    def __init__(
        self,
        session: Session,
        *,
        model_name: str = DEFAULT_EMBEDDING_MODEL,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
    ) -> None:
        self.session = session
        self.model_name = model_name
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def ingest(
        self,
        store_slug: str,
        doc_id: str,
        payload: dict[str, Any],
        *,
        store_title: str | None = None,
        store_metadata: dict[str, Any] | None = None,
        document_metadata: dict[str, Any] | None = None,
    ) -> JsonDocument:
        store = self._get_or_create_store(
            store_slug,
            title=store_title,
            metadata=store_metadata,
        )
        self._delete_existing_document(store.id, doc_id)

        entries = _flatten_json(payload)
        if not entries:
            entries = [{"path": "root", "value": _format_value(payload)}]

        linearized = "\n".join(f"{entry['path']}: {entry['value']}" for entry in entries)
        merged_metadata = {"line_count": len(entries)}
        if document_metadata:
            merged_metadata.update(document_metadata)

        document = JsonDocument(
            store_id=store.id,
            doc_id=doc_id,
            raw_document=payload,
            linearized_text=linearized,
            metadata_json=merged_metadata,
        )
        self.session.add(document)
        self.session.flush()

        chunk_entries = list(
            _chunk_entries(
                entries,
                chunk_size=self.chunk_size,
                overlap=self.chunk_overlap,
            )
        )
        chunk_texts = [
            "\n".join(f"{entry['path']}: {entry['value']}" for entry in chunk)
            if chunk
            else linearized
            for chunk in chunk_entries
        ]

        model = _load_model(self.model_name)
        embeddings = model.encode(
            [f"passage: {text}" for text in chunk_texts],
            convert_to_numpy=True,
            normalize_embeddings=True,
        )

        json_chunks: list[JsonChunk] = []
        for index, (chunk, text) in enumerate(zip(chunk_entries, chunk_texts)):
            vector = embeddings[index].tolist()
            if len(vector) != EMBEDDING_DIMENSION:
                raise ValueError(
                    "La dimension de l'embedding généré "
                    f"({len(vector)}) ne correspond pas à la configuration "
                    f"attendue ({EMBEDDING_DIMENSION})"
                )
            vector = _normalize(vector)
            chunk_metadata = {
                "doc_id": doc_id,
                "store": store.slug,
                "chunk_index": index,
                "line_count": len(chunk) if chunk else len(entries),
            }
            json_chunks.append(
                JsonChunk(
                    store_id=store.id,
                    document_id=document.id,
                    doc_id=doc_id,
                    chunk_index=index,
                    raw_chunk={"entries": chunk} if chunk else {"entries": entries},
                    linearized_text=text,
                    embedding=vector,
                    metadata_json=chunk_metadata,
                )
            )

        document.chunks = json_chunks
        self.session.flush()
        return document

    def _get_or_create_store(
        self,
        slug: str,
        *,
        title: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> JsonVectorStore:
        normalized_slug = slug.strip()
        existing = self.session.scalar(
            select(JsonVectorStore).where(JsonVectorStore.slug == normalized_slug)
        )
        if existing:
            if title is not None:
                existing.title = title
            if metadata:
                merged = dict(existing.metadata_json or {})
                merged.update(metadata)
                existing.metadata_json = merged
            return existing

        store = JsonVectorStore(
            slug=normalized_slug,
            title=title,
            metadata_json=metadata or {},
        )
        self.session.add(store)
        self.session.flush()
        return store

    def _delete_existing_document(self, store_id: int, doc_id: str) -> None:
        existing = self.session.scalar(
            select(JsonDocument)
            .where(JsonDocument.store_id == store_id)
            .where(JsonDocument.doc_id == doc_id)
        )
        if existing:
            self.session.delete(existing)
            self.session.flush()
