"""Ingestion de documents JSON dans les tables vectorielles et recherche hybride."""

from __future__ import annotations

import json
import logging
import math
import os
import re
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from openai import OpenAI
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import EMBEDDING_DIMENSION, JsonChunk, JsonDocument, JsonVectorStore

logger = logging.getLogger("chatkit.vector_store")

DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_CHUNK_SIZE = 40
DEFAULT_CHUNK_OVERLAP = 8
MAX_LINEARIZED_ENTRY_LENGTH = 60_000
MAX_LINEARIZED_TEXT_LENGTH = 900_000
# Limite stricte pour les textes envoyés au modèle d'embedding afin d'éviter
# les erreurs « context length ». 20 000 caractères représentent environ 5 000
# tokens pour du texte latin, ce qui offre une marge confortable par rapport à
# la limite de 8 192 tokens du modèle `text-embedding-3-small`.
MAX_EMBEDDING_TEXT_LENGTH = 20_000


def _get_openai_client() -> OpenAI:
    """Retourne le client OpenAI configuré."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "La variable d'environnement OPENAI_API_KEY est requise pour générer "
            "des embeddings."
        )
    return OpenAI(api_key=api_key)


def _format_value(value: Any) -> str:
    if isinstance(value, dict | list):
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


def _sanitize_entries_for_indexing(
    entries: Sequence[dict[str, str]], *, max_value_length: int
) -> tuple[list[dict[str, str]], list[str], list[dict[str, Any]]]:
    sanitized: list[dict[str, str]] = []
    lines: list[str] = []
    redactions: list[dict[str, Any]] = []
    total_length = 0

    for entry in entries:
        path = entry.get("path", "")
        value = entry.get("value", "")
        reasons: list[str] = []
        sanitized_value = value

        if len(value) > max_value_length:
            sanitized_value = f"<valeur omise, longueur originale {len(value)}>"
            reasons.append("max_value_length")

        line = f"{path}: {sanitized_value}"
        projected_total = total_length + len(line) + 1
        if projected_total > MAX_LINEARIZED_TEXT_LENGTH:
            sanitized_value = (
                "<valeur omise pour respecter la limite globale de "
                f"{MAX_LINEARIZED_TEXT_LENGTH} caractères "
                f"(longueur originale {len(value)})>"
            )
            line = f"{path}: {sanitized_value}"
            projected_total = total_length + len(line) + 1
            if "max_text_length" not in reasons:
                reasons.append("max_text_length")

        sanitized_entry = {"path": path, "value": sanitized_value}
        sanitized.append(sanitized_entry)

        if reasons:
            redactions.append(
                {
                    "path": path,
                    "original_length": len(value),
                    "strategy": "omitted",
                    "reasons": reasons,
                }
            )

        if projected_total > MAX_LINEARIZED_TEXT_LENGTH:
            # On n'ajoute pas la ligne au texte linéarisé pour rester sous la limite.
            continue

        lines.append(line)
        total_length = projected_total

    return sanitized, lines, redactions


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


def _split_entry_for_max_length(
    entry: dict[str, str], *, max_text_length: int
) -> list[dict[str, str]]:
    """Découpe une entrée si sa ligne dépasse la longueur maximale autorisée."""

    path = entry.get("path", "")
    value = entry.get("value", "")
    line = f"{path}: {value}"
    if len(line) <= max_text_length:
        return [dict(entry)]

    base_prefix = len(f"{path}: ")
    base_available = max(max_text_length - base_prefix, 1)
    if len(value) <= base_available:
        return [dict(entry)]

    parts: list[dict[str, str]] = []
    start = 0
    part_index = 1
    total = len(value)
    while start < total:
        part_path = f"{path} (part {part_index})"
        prefix_length = len(f"{part_path}: ")
        available = max(max_text_length - prefix_length, 1)
        end = min(total, start + available)
        segment_value = value[start:end]
        parts.append({"path": part_path, "value": segment_value})
        start = end
        part_index += 1

    return parts or [dict(entry)]


def _expand_entries_for_embeddings(
    entries: Sequence[dict[str, str]], *, max_text_length: int
) -> list[dict[str, str]]:
    expanded: list[dict[str, str]] = []
    for entry in entries:
        expanded.extend(
            _split_entry_for_max_length(entry, max_text_length=max_text_length)
        )
    return expanded


def _split_chunk_by_text_length(
    chunk: list[dict[str, str]], *, max_text_length: int
) -> list[list[dict[str, str]]]:
    if not chunk:
        return [chunk]

    safe_chunks: list[list[dict[str, str]]] = []
    current_chunk: list[dict[str, str]] = []
    current_length = 0

    for entry in chunk:
        expanded_entries = _split_entry_for_max_length(
            entry, max_text_length=max_text_length
        )
        for expanded in expanded_entries:
            line = f"{expanded['path']}: {expanded['value']}"
            line_length = len(line)
            if line_length > max_text_length:
                # En dernier recours, on force l'entrée à occuper son propre chunk.
                safe_chunks.append([expanded])
                current_chunk = []
                current_length = 0
                continue

            separator = 0 if not current_chunk else 1
            projected_length = current_length + separator + line_length
            if current_chunk and projected_length > max_text_length:
                safe_chunks.append(current_chunk)
                current_chunk = []
                current_length = 0
                separator = 0

            current_chunk.append(expanded)
            current_length += separator + line_length

    if current_chunk:
        safe_chunks.append(current_chunk)

    return safe_chunks if safe_chunks else [chunk]


def _prepare_embedding_chunks(
    chunks: Sequence[list[dict[str, str]]], *, max_text_length: int
) -> list[list[dict[str, str]]]:
    prepared: list[list[dict[str, str]]] = []
    for chunk in chunks:
        prepared.extend(
            _split_chunk_by_text_length(chunk, max_text_length=max_text_length)
        )
    return prepared


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


@dataclass(slots=True)
class SearchResult:
    """Représente un extrait retrouvé par la recherche hybride."""

    doc_id: str
    chunk_index: int
    text: str
    metadata: dict[str, Any]
    document_metadata: dict[str, Any]
    dense_score: float
    bm25_score: float
    score: float


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

    # Gestion des *vector stores* -------------------------------------------------

    def list_stores(self) -> list[tuple[JsonVectorStore, int]]:
        """Retourne la liste des magasins JSON et le nombre de documents associés."""

        stmt = (
            select(JsonVectorStore, func.count(JsonDocument.id))
            .outerjoin(JsonDocument, JsonDocument.store_id == JsonVectorStore.id)
            .group_by(JsonVectorStore.id)
            .order_by(JsonVectorStore.slug.asc())
        )
        rows = self.session.execute(stmt).all()
        return [(row[0], int(row[1])) for row in rows]

    def get_store(self, slug: str) -> JsonVectorStore | None:
        normalized_slug = slug.strip()
        if not normalized_slug:
            return None
        return self.session.scalar(
            select(JsonVectorStore).where(JsonVectorStore.slug == normalized_slug)
        )

    def create_store(
        self,
        slug: str,
        *,
        title: str | None = None,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> JsonVectorStore:
        normalized_slug = slug.strip()
        if not normalized_slug:
            raise ValueError("Le slug du magasin ne peut pas être vide")
        existing = self.get_store(normalized_slug)
        if existing is not None:
            raise ValueError("Un magasin avec ce slug existe déjà")
        store = JsonVectorStore(
            slug=normalized_slug,
            title=title,
            description=description,
            metadata_json=metadata or {},
        )
        self.session.add(store)
        self.session.flush()
        return store

    def update_store(
        self,
        slug: str,
        *,
        title: str | None = None,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> JsonVectorStore:
        store = self.get_store(slug)
        if store is None:
            raise LookupError("Magasin introuvable")
        if title is not None:
            store.title = title
        if description is not None:
            store.description = description
        if metadata is not None:
            store.metadata_json = metadata
        self.session.add(store)
        self.session.flush()
        return store

    def delete_store(self, slug: str) -> None:
        store = self.get_store(slug)
        if store is None:
            raise LookupError("Magasin introuvable")
        self.session.delete(store)
        self.session.flush()

    def list_documents(self, store_slug: str) -> list[tuple[JsonDocument, int]]:
        """Retourne les documents d'un magasin et le nombre de chunks associés."""

        store = self.get_store(store_slug)
        if store is None:
            raise LookupError("Magasin introuvable")

        stmt = (
            select(JsonDocument, func.count(JsonChunk.id))
            .outerjoin(JsonChunk, JsonChunk.document_id == JsonDocument.id)
            .where(JsonDocument.store_id == store.id)
            .group_by(JsonDocument.id)
            .order_by(JsonDocument.doc_id.asc())
        )
        rows = self.session.execute(stmt).all()
        return [(row[0], int(row[1])) for row in rows]

    def delete_document(self, store_slug: str, doc_id: str) -> None:
        """Supprime un document et ses chunks associés d'un magasin donné."""

        store = self.get_store(store_slug)
        if store is None:
            raise LookupError("Magasin introuvable")

        document = self.session.scalar(
            select(JsonDocument)
            .where(JsonDocument.store_id == store.id)
            .where(JsonDocument.doc_id == doc_id)
        )
        if document is None:
            raise LookupError("Document introuvable")

        self.session.delete(document)
        self.session.flush()

    # Ingestion ------------------------------------------------------------------

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

        sanitized_entries, linearized_lines, redactions = (
            _sanitize_entries_for_indexing(
                entries, max_value_length=MAX_LINEARIZED_ENTRY_LENGTH
            )
        )
        if not sanitized_entries:
            fallback_entry = {"path": "root", "value": _format_value(payload)}
            sanitized_entries = [fallback_entry]
            linearized_lines = ["root: " + fallback_entry["value"]]
        elif not linearized_lines:
            linearized_lines = [
                "<contenu linéarisé omis pour respecter les limites de taille>"
            ]

        linearized = "\n".join(linearized_lines)
        merged_metadata = {"line_count": len(entries)}
        if redactions:
            merged_metadata["redactions"] = redactions
            merged_metadata["redactions_count"] = len(redactions)
            logger.info(
                "Certaines valeurs ont été omises lors de l'indexation "
                "(doc_id=%s, chemins=%s)",
                doc_id,
                ", ".join(redaction["path"] for redaction in redactions),
            )
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

        embedding_entries = _expand_entries_for_embeddings(
            sanitized_entries, max_text_length=MAX_EMBEDDING_TEXT_LENGTH
        )

        base_chunks = list(
            _chunk_entries(
                embedding_entries,
                chunk_size=self.chunk_size,
                overlap=self.chunk_overlap,
            )
        )

        prepared_chunks = _prepare_embedding_chunks(
            base_chunks, max_text_length=MAX_EMBEDDING_TEXT_LENGTH
        )
        if not prepared_chunks:
            prepared_chunks = [[{"path": "root", "value": linearized}]]

        chunk_texts: list[str] = []
        for chunk in prepared_chunks:
            if not chunk:
                chunk_texts.append(linearized)
                continue
            text = "\n".join(
                f"{entry['path']}: {entry['value']}" for entry in chunk
            )
            chunk_texts.append(text)

        for text in chunk_texts:
            if len(text) > MAX_EMBEDDING_TEXT_LENGTH:
                raise ValueError(
                    "Un chunk préparé dépasse la taille maximale autorisée pour "
                    "la génération d'embeddings"
                )

        if not chunk_texts:
            raise ValueError("Impossible de préparer des chunks pour l'indexation")

        # Générer les embeddings avec OpenAI
        client = _get_openai_client()
        response = client.embeddings.create(
            input=chunk_texts,
            model=self.model_name,
        )

        json_chunks: list[JsonChunk] = []
        for index, (chunk, text) in enumerate(
            zip(prepared_chunks, chunk_texts, strict=False)
        ):
            vector = response.data[index].embedding
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
                "line_count": len(chunk) if chunk else len(sanitized_entries),
            }
            json_chunks.append(
                JsonChunk(
                    store_id=store.id,
                    document_id=document.id,
                    doc_id=doc_id,
                    chunk_index=index,
                    raw_chunk={"entries": chunk}
                    if chunk
                    else {"entries": sanitized_entries},
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

    # Consultation ----------------------------------------------------------------

    def get_document(self, store_slug: str, doc_id: str) -> JsonDocument | None:
        store = self.get_store(store_slug)
        if store is None:
            return None
        return self.session.scalar(
            select(JsonDocument)
            .where(JsonDocument.store_id == store.id)
            .where(JsonDocument.doc_id == doc_id)
        )

    # Recherche hybride -----------------------------------------------------------

    def search(
        self,
        store_slug: str,
        query: str,
        *,
        top_k: int = 5,
        metadata_filters: dict[str, Any] | None = None,
        dense_weight: float = 0.5,
        sparse_weight: float = 0.5,
    ) -> list[SearchResult]:
        store = self.get_store(store_slug)
        if store is None:
            raise LookupError("Magasin introuvable")

        stmt = (
            select(JsonChunk, JsonDocument)
            .join(JsonDocument, JsonChunk.document_id == JsonDocument.id)
            .where(JsonChunk.store_id == store.id)
            .order_by(JsonChunk.chunk_index.asc())
        )
        rows = self.session.execute(stmt).all()
        chunks: list[tuple[JsonChunk, JsonDocument]] = [
            (row[0], row[1]) for row in rows
        ]

        if metadata_filters:
            filtered: list[tuple[JsonChunk, JsonDocument]] = []
            for chunk, document in chunks:
                combined_metadata: dict[str, Any] = dict(chunk.metadata_json or {})
                doc_metadata = document.metadata_json or {}
                combined_metadata.update(doc_metadata)
                if all(
                    combined_metadata.get(key) == value
                    for key, value in metadata_filters.items()
                ):
                    filtered.append((chunk, document))
            chunks = filtered

        if not chunks:
            return []

        # Générer l'embedding de la requête avec OpenAI
        client = _get_openai_client()
        response = client.embeddings.create(
            input=[query],
            model=self.model_name,
        )
        query_vector = _normalize(response.data[0].embedding)

        token_pattern = re.compile(r"\w+", re.UNICODE)
        query_tokens = [token.lower() for token in token_pattern.findall(query)]

        bm25_scores: list[float] = []
        dense_scores: list[float] = []
        metadata_per_chunk: list[dict[str, Any]] = []
        doc_metadata_per_chunk: list[dict[str, Any]] = []
        texts: list[str] = []

        if query_tokens:
            doc_freq: Counter[str] = Counter()
            tokenized_chunks: list[list[str]] = []
            term_frequencies: list[Counter[str]] = []
            for chunk, _document in chunks:
                tokens = [
                    token.lower()
                    for token in token_pattern.findall(chunk.linearized_text)
                ]
                tokenized_chunks.append(tokens)
                counter = Counter(tokens)
                term_frequencies.append(counter)
                doc_freq.update(set(tokens))
            total_docs = len(tokenized_chunks)
            avg_doc_len = sum(len(tokens) for tokens in tokenized_chunks) / max(
                total_docs, 1
            )
        else:
            tokenized_chunks = []
            term_frequencies = []
            doc_freq = Counter()
            total_docs = 0
            avg_doc_len = 0.0

        k1 = 1.5
        b = 0.75

        for index, (chunk, document) in enumerate(chunks):
            chunk_vector = [float(component) for component in chunk.embedding]
            dense_score = sum(
                q * c for q, c in zip(query_vector, chunk_vector, strict=False)
            )
            dense_scores.append(dense_score)

            if query_tokens:
                bm25 = 0.0
                chunk_tokens = tokenized_chunks[index]
                chunk_tf = term_frequencies[index]
                chunk_len = len(chunk_tokens) or 1
                norm = k1 * (1 - b + b * (chunk_len / max(avg_doc_len, 1e-9)))
                for token in query_tokens:
                    freq = chunk_tf.get(token, 0)
                    if freq == 0:
                        continue
                    df = doc_freq.get(token, 0)
                    idf = math.log(((total_docs - df + 0.5) / (df + 0.5)) + 1)
                    numerator = freq * (k1 + 1)
                    denominator = freq + norm
                    bm25 += idf * (numerator / denominator)
            else:
                bm25 = 0.0

            bm25_scores.append(bm25)
            metadata_per_chunk.append(dict(chunk.metadata_json or {}))
            doc_metadata_per_chunk.append(dict(document.metadata_json or {}))
            texts.append(chunk.linearized_text)

        max_bm25 = max(bm25_scores) if bm25_scores else 0.0
        fused_results: list[SearchResult] = []
        for (
            (chunk, _document),
            dense_score,
            bm25_score,
            metadata,
            doc_metadata,
            text,
        ) in zip(
            chunks,
            dense_scores,
            bm25_scores,
            metadata_per_chunk,
            doc_metadata_per_chunk,
            texts,
            strict=False,
        ):
            dense_norm = (dense_score + 1.0) / 2.0
            bm25_norm = (bm25_score / max_bm25) if max_bm25 > 0 else 0.0
            weight_sum = (
                dense_weight + sparse_weight
                if (dense_weight + sparse_weight) > 0
                else 1.0
            )
            score = (dense_weight * dense_norm + sparse_weight * bm25_norm) / weight_sum
            fused_results.append(
                SearchResult(
                    doc_id=chunk.doc_id,
                    chunk_index=chunk.chunk_index,
                    text=text,
                    metadata=metadata,
                    document_metadata=doc_metadata,
                    dense_score=dense_score,
                    bm25_score=bm25_score,
                    score=score,
                )
            )

        fused_results.sort(key=lambda item: item.score, reverse=True)
        if top_k > 0:
            fused_results = fused_results[:top_k]
        return fused_results
