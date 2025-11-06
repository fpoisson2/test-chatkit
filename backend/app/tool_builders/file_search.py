"""Builders liés à la recherche dans les vector stores."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Mapping

from agents import FunctionTool, function_tool

from ..database import SessionLocal
from ..vector_store import DocumentSearchResult, JsonVectorStoreService, SearchResult

logger = logging.getLogger("chatkit.server")

__all__ = ["build_file_search_tool"]


def _extract_vector_store_ids(config: Mapping[str, Any]) -> list[str]:
    """Récupère la liste des identifiants de vector store à partir du payload."""

    result: list[str] = []

    raw_ids = config.get("vector_store_ids")
    if isinstance(raw_ids, (list, tuple, set)):
        for entry in raw_ids:
            if isinstance(entry, str) and entry.strip():
                normalized = entry.strip()
                if normalized not in result:
                    result.append(normalized)

    candidate = config.get("vector_store_id")
    if isinstance(candidate, str) and candidate.strip():
        normalized = candidate.strip()
        if normalized not in result:
            result.append(normalized)

    slug = config.get("vector_store_slug")
    if isinstance(slug, str) and slug.strip():
        normalized = slug.strip()
        if normalized not in result:
            result.append(normalized)

    store = config.get("store")
    if isinstance(store, Mapping):
        nested_slug = store.get("slug")
        if isinstance(nested_slug, str) and nested_slug.strip():
            normalized = nested_slug.strip()
            if normalized not in result:
                result.append(normalized)

    return result


def _coerce_max_num_results(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.isdigit():
            return int(stripped)
    return None


def _coerce_include_search_results(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if not normalized:
            return False
        return normalized in {"full", "true", "1", "yes", "y"}
    return False


def _coerce_ranking_options(value: Any) -> dict[str, Any] | None:
    """Nettoie les options de ranking attendues par l'outil de recherche locale."""

    if value is None:
        return None

    if isinstance(value, Mapping):
        data: dict[str, Any] = {}
        ranker = value.get("ranker")
        if isinstance(ranker, str) and ranker.strip():
            data["ranker"] = ranker.strip()

        threshold = value.get("score_threshold")
        if isinstance(threshold, (int, float)):
            data["score_threshold"] = float(threshold)
        elif isinstance(threshold, str):
            try:
                data["score_threshold"] = float(threshold.strip())
            except ValueError:
                pass

        return data or None

    return None


def _format_document_search_results(
    matches: list[tuple[str, list[DocumentSearchResult]]], *, include_text: bool
) -> list[dict[str, Any]]:
    formatted: list[dict[str, Any]] = []
    for slug, documents in matches:
        formatted_documents: list[dict[str, Any]] = []
        for document in documents:
            chunk_entries: list[dict[str, Any]] = []
            for entry in document.matches:
                item: dict[str, Any] = {
                    "doc_id": entry.doc_id,
                    "chunk_index": entry.chunk_index,
                    "score": entry.score,
                    "dense_score": entry.dense_score,
                    "bm25_score": entry.bm25_score,
                    "metadata": entry.metadata,
                    "document_metadata": entry.document_metadata,
                }
                if include_text:
                    item["text"] = entry.text
                chunk_entries.append(item)

            formatted_documents.append(
                {
                    "doc_id": document.doc_id,
                    "score": document.score,
                    "metadata": document.metadata,
                    "matches": chunk_entries,
                }
            )

        formatted.append(
            {
                "vector_store_slug": slug,
                "documents": formatted_documents,
            }
        )

    return formatted


def build_file_search_tool(payload: Any) -> list[FunctionTool] | None:
    """Construit une paire d'outils de recherche documentaire pour les agents."""

    if isinstance(payload, FunctionTool):
        return [payload]

    config: Mapping[str, Any] = payload if isinstance(payload, Mapping) else {}
    vector_store_ids = _extract_vector_store_ids(config)
    if not vector_store_ids:
        return None

    max_num_results = _coerce_max_num_results(config.get("max_num_results"))
    include_search_results = _coerce_include_search_results(
        config.get("return_documents")
    )
    ranking_options = _coerce_ranking_options(config.get("ranking_options"))
    default_top_k = max_num_results if max_num_results else 5

    configured_chunk_limit = _coerce_max_num_results(
        config.get("chunks_per_document")
    )
    if configured_chunk_limit is not None and configured_chunk_limit <= 0:
        configured_chunk_limit = None

    def _resolve_chunk_limit(override: Any) -> int | None:
        if isinstance(override, int) and override > 0:
            return override
        if isinstance(override, float) and override.is_integer() and override > 0:
            return int(override)
        if isinstance(override, str) and override.strip().isdigit():
            candidate = int(override.strip())
            return candidate if candidate > 0 else None
        return configured_chunk_limit

    async def _search_vector_store_documents(
        query: str,
        top_k: int | None = None,
        chunks_per_document: int | None = None,
    ) -> dict[str, Any]:
        """Recherche les documents les plus pertinents dans les magasins configurés."""

        normalized_query = query.strip() if isinstance(query, str) else ""
        if not normalized_query:
            return {
                "query": "",
                "vector_stores": [],
                "errors": ["La requête de recherche est vide."],
            }

        limit: int = default_top_k
        if isinstance(top_k, int) and top_k > 0:
            limit = top_k

        chunk_limit = _resolve_chunk_limit(chunks_per_document)

        def _search_sync() -> (
            tuple[list[tuple[str, list[DocumentSearchResult]]], list[dict[str, Any]]]
        ):
            matches: list[tuple[str, list[DocumentSearchResult]]] = []
            errors: list[dict[str, Any]] = []
            with SessionLocal() as session:
                service = JsonVectorStoreService(session)
                for slug in vector_store_ids:
                    try:
                        results = service.search_documents(
                            slug,
                            normalized_query,
                            top_k=limit,
                            chunks_per_document=chunk_limit,
                        )
                    except LookupError:
                        errors.append(
                            {
                                "vector_store_slug": slug,
                                "message": "Magasin introuvable.",
                            }
                        )
                        continue
                    except Exception as exc:  # pragma: no cover - dépend du runtime
                        logger.exception(
                            "Erreur lors de la recherche dans le magasin %s",
                            slug,
                            exc_info=exc,
                        )
                        errors.append(
                            {
                                "vector_store_slug": slug,
                                "message": "Recherche impossible : erreur interne.",
                            }
                        )
                        continue

                    matches.append((slug, list(results)))

            return matches, errors

        store_matches, store_errors = await asyncio.to_thread(_search_sync)

        response: dict[str, Any] = {
            "query": normalized_query,
            "vector_stores": _format_document_search_results(
                store_matches,
                include_text=include_search_results,
            ),
        }
        if ranking_options:
            response["ranking_options"] = ranking_options
        if chunk_limit:
            response["chunks_per_document"] = chunk_limit
        if store_errors:
            response["errors"] = store_errors

        return response

    async def _search_vector_store_document_chunks(
        vector_store_slug: str,
        doc_id: str,
        query: str,
        top_k: int | None = None,
    ) -> dict[str, Any]:
        """Recherche des extraits pertinents pour un document donné."""

        normalized_slug = (
            vector_store_slug.strip() if isinstance(vector_store_slug, str) else ""
        )
        normalized_doc_id = doc_id.strip() if isinstance(doc_id, str) else ""
        normalized_query = query.strip() if isinstance(query, str) else ""

        if not normalized_slug:
            return {
                "query": normalized_query,
                "doc_id": normalized_doc_id,
                "errors": ["Le slug du magasin est requis."],
            }

        if normalized_slug not in vector_store_ids:
            return {
                "query": normalized_query,
                "doc_id": normalized_doc_id,
                "errors": [
                    "Le magasin demandé n'est pas configuré pour cet outil."
                ],
            }

        if not normalized_doc_id:
            return {
                "query": normalized_query,
                "vector_store_slug": normalized_slug,
                "errors": ["L'identifiant du document est requis."],
            }

        limit: int = default_top_k
        if isinstance(top_k, int) and top_k > 0:
            limit = top_k

        def _search_sync() -> tuple[list[SearchResult], list[dict[str, Any]]]:
            matches: list[SearchResult] = []
            errors: list[dict[str, Any]] = []
            with SessionLocal() as session:
                service = JsonVectorStoreService(session)
                try:
                    matches = service.search_document_chunks(
                        normalized_slug,
                        normalized_doc_id,
                        normalized_query,
                        top_k=limit,
                    )
                except LookupError as exc:
                    errors.append(
                        {
                            "vector_store_slug": normalized_slug,
                            "doc_id": normalized_doc_id,
                            "message": str(exc),
                        }
                    )
                except Exception as exc:  # pragma: no cover - dépend du runtime
                    logger.exception(
                        "Erreur lors de la recherche de chunks (%s/%s)",
                        normalized_slug,
                        normalized_doc_id,
                        exc_info=exc,
                    )
                    errors.append(
                        {
                            "vector_store_slug": normalized_slug,
                            "doc_id": normalized_doc_id,
                            "message": "Recherche impossible : erreur interne.",
                        }
                    )
            return matches, errors

        chunk_matches, chunk_errors = await asyncio.to_thread(_search_sync)

        response: dict[str, Any] = {
            "query": normalized_query,
            "vector_store_slug": normalized_slug,
            "doc_id": normalized_doc_id,
            "matches": [
                {
                    "doc_id": entry.doc_id,
                    "chunk_index": entry.chunk_index,
                    "score": entry.score,
                    "dense_score": entry.dense_score,
                    "bm25_score": entry.bm25_score,
                    "metadata": entry.metadata,
                    "document_metadata": entry.document_metadata,
                    **({"text": entry.text} if include_search_results else {}),
                }
                for entry in chunk_matches
            ],
        }
        if chunk_errors:
            response["errors"] = chunk_errors

        return response

    if len(vector_store_ids) == 1:
        suffix = vector_store_ids[0].replace("-", "_")
        documents_tool_name = f"file_search_{suffix}"
        chunks_tool_name = f"file_search_{suffix}_chunks"
    else:
        documents_tool_name = "file_search_documents"
        chunks_tool_name = "file_search_document_chunks"

    documents_tool = function_tool(name_override=documents_tool_name)(
        _search_vector_store_documents
    )
    if include_search_results:
        documents_tool.description = (
            "Recherche dans les magasins locaux et renvoie les documents les plus "
            "pertinents ainsi qu'un aperçu textuel des meilleurs extraits."
        )
    else:
        documents_tool.description = (
            "Recherche dans les magasins locaux et renvoie les documents les plus "
            "pertinents accompagnés de leurs métadonnées."
        )

    chunks_tool = function_tool(name_override=chunks_tool_name)(
        _search_vector_store_document_chunks
    )
    if include_search_results:
        chunks_tool.description = (
            "Recherche les extraits les plus pertinents au sein d'un document "
            "sélectionné et renvoie le texte correspondant."
        )
    else:
        chunks_tool.description = (
            "Recherche les extraits les plus pertinents au sein d'un document "
            "sélectionné en renvoyant uniquement les métadonnées."
        )

    return [documents_tool, chunks_tool]
