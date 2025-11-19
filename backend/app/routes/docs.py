from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import get_current_user, require_admin
from ..docs import DocumentationEntry, DocumentationService
from ..models import User
from ..rate_limit import get_rate_limit, limiter
from ..schemas import (
    DocumentationCreateRequest,
    DocumentationMetadataResponse,
    DocumentationResponse,
    DocumentationUpdateRequest,
)

router = APIRouter()


def _serialize_document(entry: DocumentationEntry) -> DocumentationResponse:
    return DocumentationResponse.model_validate(entry.as_response())


def _serialize_summary(entry: DocumentationEntry) -> DocumentationMetadataResponse:
    return DocumentationMetadataResponse.model_validate(entry.as_summary())


def _handle_docs_error(exc: Exception) -> None:
    if isinstance(exc, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    if isinstance(exc, LookupError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    if isinstance(exc, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    raise exc


@router.get("/api/docs", response_model=list[DocumentationMetadataResponse])
async def list_documents(
    language: str | None = Query(
        default=None,
        description=(
            "Filtre optionnel sur le code langue (format BCP 47, ex. 'fr' ou 'en-us')."
        ),
    ),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
) -> list[DocumentationMetadataResponse]:
    service = DocumentationService(session)
    try:
        documents = service.list_documents(language=language)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return [_serialize_summary(document) for document in documents]


@router.get("/api/docs/{slug}", response_model=DocumentationResponse)
async def get_document(
    slug: str,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
) -> DocumentationResponse:
    service = DocumentationService(session)
    document = service.get_document(slug)
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document introuvable"
        )
    return _serialize_document(document)


@router.post(
    "/api/docs",
    response_model=DocumentationResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(get_rate_limit("api_write"))
async def create_document(
    payload: DocumentationCreateRequest,
    request: Request,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> DocumentationResponse:
    service = DocumentationService(session)
    try:
        document = service.create_document(
            payload.slug,
            title=payload.title,
            summary=payload.summary,
            language=payload.language,
            content_markdown=payload.content_markdown,
            metadata=payload.metadata,
        )
    except Exception as exc:  # pragma: no cover - mutualisé via _handle_docs_error
        _handle_docs_error(exc)
    session.commit()
    return _serialize_document(document)


@router.patch(
    "/api/docs/{slug}",
    response_model=DocumentationResponse,
)
async def update_document(
    slug: str,
    payload: DocumentationUpdateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> DocumentationResponse:
    service = DocumentationService(session)
    update_data = payload.model_dump(exclude_unset=True)
    kwargs: dict[str, Any] = {}
    if "title" in update_data:
        kwargs["title"] = update_data["title"]
    if "summary" in update_data:
        kwargs["summary"] = update_data["summary"]
    if "language" in update_data:
        kwargs["language"] = update_data["language"]
    if "content_markdown" in update_data:
        kwargs["content_markdown"] = update_data["content_markdown"]
    if "metadata" in update_data:
        kwargs["metadata"] = update_data["metadata"]
    try:
        document = service.update_document(slug, **kwargs)
    except Exception as exc:  # pragma: no cover - mutualisé via _handle_docs_error
        _handle_docs_error(exc)
    session.commit()
    return _serialize_document(document)


@router.delete("/api/docs/{slug}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    slug: str,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> Response:
    service = DocumentationService(session)
    try:
        service.delete_document(slug)
    except Exception as exc:  # pragma: no cover - mutualisé via _handle_docs_error
        _handle_docs_error(exc)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
