from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import get_current_user, require_admin
from ..models import User
from ..schemas import (
    WidgetPreviewRequest,
    WidgetPreviewResponse,
    WidgetTemplateCreateRequest,
    WidgetTemplateResponse,
    WidgetTemplateSummaryResponse,
    WidgetTemplateUpdateRequest,
)
from ..widgets import (
    WidgetLibraryService,
    WidgetTemplateEntry,
    WidgetValidationError,
)

router = APIRouter()


def _serialize_widget(widget: WidgetTemplateEntry) -> WidgetTemplateResponse:
    return WidgetTemplateResponse.model_validate(widget.as_response())


def _handle_widget_error(exc: Exception) -> None:
    if isinstance(exc, WidgetValidationError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": str(exc), "errors": exc.errors},
        ) from exc
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


@router.get("/api/widgets", response_model=list[WidgetTemplateResponse])
async def list_widgets(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[WidgetTemplateResponse]:
    service = WidgetLibraryService(session)
    widgets = service.list_widgets()
    return [_serialize_widget(widget) for widget in widgets]


@router.get("/api/workflow-widgets", response_model=list[WidgetTemplateSummaryResponse])
async def list_workflow_widgets(
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
) -> list[WidgetTemplateSummaryResponse]:
    service = WidgetLibraryService(session)
    widgets = service.list_widgets()
    return [
        WidgetTemplateSummaryResponse.model_validate(widget.as_summary())
        for widget in widgets
    ]


@router.post(
    "/api/widgets",
    response_model=WidgetTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_widget(
    payload: WidgetTemplateCreateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> WidgetTemplateResponse:
    service = WidgetLibraryService(session)
    try:
        widget = service.create_widget(
            payload.slug,
            title=payload.title,
            description=payload.description,
            definition=payload.definition,
        )
    except Exception as exc:  # pragma: no cover - mutualisé via _handle_widget_error
        _handle_widget_error(exc)
    session.commit()
    return _serialize_widget(widget)


@router.get(
    "/api/widgets/{slug}",
    response_model=WidgetTemplateResponse,
)
async def get_widget(
    slug: str,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> WidgetTemplateResponse:
    service = WidgetLibraryService(session)
    widget = service.get_widget(slug)
    if widget is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Widget introuvable"
        )
    return _serialize_widget(widget)


@router.patch(
    "/api/widgets/{slug}",
    response_model=WidgetTemplateResponse,
)
async def update_widget(
    slug: str,
    payload: WidgetTemplateUpdateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> WidgetTemplateResponse:
    service = WidgetLibraryService(session)
    try:
        widget = service.update_widget(
            slug,
            title=payload.title,
            description=payload.description,
            definition=payload.definition,
        )
    except Exception as exc:  # pragma: no cover - mutualisé via _handle_widget_error
        _handle_widget_error(exc)
    session.commit()
    return _serialize_widget(widget)


@router.delete("/api/widgets/{slug}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_widget(
    slug: str,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> Response:
    service = WidgetLibraryService(session)
    try:
        service.delete_widget(slug)
    except Exception as exc:  # pragma: no cover - mutualisé via _handle_widget_error
        _handle_widget_error(exc)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/api/widgets/preview",
    response_model=WidgetPreviewResponse,
)
async def preview_widget(
    payload: WidgetPreviewRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> WidgetPreviewResponse:
    service = WidgetLibraryService(session)
    try:
        definition = service.preview_widget(payload.definition)
    except Exception as exc:  # pragma: no cover - mutualisé via _handle_widget_error
        _handle_widget_error(exc)
    return WidgetPreviewResponse(definition=definition)
