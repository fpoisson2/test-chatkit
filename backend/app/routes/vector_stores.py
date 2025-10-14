"""Routes d'administration des magasins JSON vectoriels."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import get_current_user, require_admin
from ..models import JsonDocument, JsonVectorStore, User
from ..schemas import (
    VectorStoreCreateRequest,
    VectorStoreDocumentDetailResponse,
    VectorStoreDocumentIngestRequest,
    VectorStoreDocumentResponse,
    VectorStoreResponse,
    VectorStoreSearchRequest,
    VectorStoreSearchResult,
    VectorStoreUpdateRequest,
)
from ..vector_store import JsonVectorStoreService

router = APIRouter()


def _serialize_store(store: JsonVectorStore, *, documents_count: int) -> VectorStoreResponse:
    return VectorStoreResponse(
        slug=store.slug,
        title=store.title,
        description=store.description,
        metadata=dict(store.metadata_json or {}),
        created_at=store.created_at,
        updated_at=store.updated_at,
        documents_count=documents_count,
    )


def _count_documents(session: Session, store_id: int) -> int:
    return int(
        session.scalar(
            select(func.count(JsonDocument.id)).where(JsonDocument.store_id == store_id)
        )
        or 0
    )


@router.get("/api/vector-stores", response_model=list[VectorStoreResponse])
async def list_vector_stores(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[VectorStoreResponse]:
    service = JsonVectorStoreService(session)
    stores = service.list_stores()
    return [
        _serialize_store(store, documents_count=count)
        for store, count in stores
    ]


@router.post(
    "/api/vector-stores",
    response_model=VectorStoreResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_vector_store(
    payload: VectorStoreCreateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> VectorStoreResponse:
    service = JsonVectorStoreService(session)
    try:
        store = service.create_store(
            payload.slug,
            title=payload.title,
            description=payload.description,
            metadata=payload.metadata,
        )
    except ValueError as exc:  # slug invalide ou déjà pris
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    session.commit()
    session.refresh(store)
    return _serialize_store(store, documents_count=0)


@router.get("/api/vector-stores/{store_slug}", response_model=VectorStoreResponse)
async def get_vector_store(
    store_slug: str,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> VectorStoreResponse:
    service = JsonVectorStoreService(session)
    store = service.get_store(store_slug)
    if store is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Magasin introuvable")
    documents_count = _count_documents(session, store.id)
    return _serialize_store(store, documents_count=documents_count)


@router.patch("/api/vector-stores/{store_slug}", response_model=VectorStoreResponse)
async def update_vector_store(
    store_slug: str,
    payload: VectorStoreUpdateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> VectorStoreResponse:
    service = JsonVectorStoreService(session)
    try:
        store = service.update_store(
            store_slug,
            title=payload.title,
            description=payload.description,
            metadata=payload.metadata,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    session.commit()
    session.refresh(store)
    documents_count = _count_documents(session, store.id)
    return _serialize_store(store, documents_count=documents_count)


@router.delete("/api/vector-stores/{store_slug}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vector_store(
    store_slug: str,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> Response:
    service = JsonVectorStoreService(session)
    try:
        service.delete_store(store_slug)
    except LookupError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Magasin introuvable")

    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/api/vector-stores/{store_slug}/documents",
    response_model=VectorStoreDocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def ingest_document(
    store_slug: str,
    payload: VectorStoreDocumentIngestRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> VectorStoreDocumentResponse:
    service = JsonVectorStoreService(session)
    try:
        document = service.ingest(
            store_slug,
            payload.doc_id,
            payload.document,
            store_title=payload.store_title,
            store_metadata=payload.store_metadata,
            document_metadata=payload.metadata,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    chunk_count = len(document.chunks)
    session.commit()
    session.refresh(document)
    return VectorStoreDocumentResponse(
        doc_id=document.doc_id,
        metadata=dict(document.metadata_json or {}),
        chunk_count=chunk_count,
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


@router.get(
    "/api/vector-stores/{store_slug}/documents",
    response_model=list[VectorStoreDocumentResponse],
)
async def list_documents(
    store_slug: str,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[VectorStoreDocumentResponse]:
    service = JsonVectorStoreService(session)
    try:
        documents = service.list_documents(store_slug)
    except LookupError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Magasin introuvable")

    return [
        VectorStoreDocumentResponse(
            doc_id=document.doc_id,
            metadata=dict(document.metadata_json or {}),
            chunk_count=chunk_count,
            created_at=document.created_at,
            updated_at=document.updated_at,
        )
        for document, chunk_count in documents
    ]


@router.post(
    "/api/vector-stores/{store_slug}/search_json",
    response_model=list[VectorStoreSearchResult],
)
async def search_vector_store(
    store_slug: str,
    payload: VectorStoreSearchRequest,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
) -> list[VectorStoreSearchResult]:
    service = JsonVectorStoreService(session)
    try:
        results = service.search(
            store_slug,
            payload.query,
            top_k=payload.top_k,
            metadata_filters=payload.metadata_filters,
            dense_weight=payload.dense_weight,
            sparse_weight=payload.sparse_weight,
        )
    except LookupError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Magasin introuvable")

    return [
        VectorStoreSearchResult(
            doc_id=result.doc_id,
            chunk_index=result.chunk_index,
            text=result.text,
            metadata=result.metadata,
            document_metadata=result.document_metadata,
            dense_score=result.dense_score,
            bm25_score=result.bm25_score,
            score=result.score,
        )
        for result in results
    ]


@router.get(
    "/api/vector-stores/{store_slug}/documents/{doc_id}",
    response_model=VectorStoreDocumentDetailResponse,
)
async def get_document(
    store_slug: str,
    doc_id: str,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
) -> VectorStoreDocumentDetailResponse:
    service = JsonVectorStoreService(session)
    document = service.get_document(store_slug, doc_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document introuvable")

    chunk_count = len(document.chunks)
    return VectorStoreDocumentDetailResponse(
        doc_id=document.doc_id,
        metadata=dict(document.metadata_json or {}),
        chunk_count=chunk_count,
        created_at=document.created_at,
        updated_at=document.updated_at,
        document=document.raw_document,
    )


@router.delete(
    "/api/vector-stores/{store_slug}/documents/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_document(
    store_slug: str,
    doc_id: str,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> Response:
    service = JsonVectorStoreService(session)
    try:
        service.delete_document(store_slug, doc_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
