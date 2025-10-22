from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import get_current_user
from ..models import User
from ..schemas import (
    WorkflowChatKitUpdate,
    WorkflowCreateRequest,
    WorkflowDefinitionResponse,
    WorkflowDefinitionUpdate,
    WorkflowProductionUpdate,
    WorkflowSummaryResponse,
    WorkflowUpdateRequest,
    WorkflowVersionCreateRequest,
    WorkflowVersionSummaryResponse,
    WorkflowVersionUpdateRequest,
)
from ..workflows import (
    WorkflowNotFoundError,
    WorkflowService,
    WorkflowValidationError,
    WorkflowVersionNotFoundError,
    serialize_definition,
    serialize_definition_graph,
    serialize_version_summary,
    serialize_workflow_summary,
)

router = APIRouter()


def _ensure_admin(user: User) -> None:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Accès administrateur requis"
        )


@router.get("/api/workflows/current", response_model=WorkflowDefinitionResponse)
async def get_current_workflow(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
    service = WorkflowService()
    definition = service.get_current(session)
    return WorkflowDefinitionResponse.model_validate(serialize_definition(definition))


@router.put("/api/workflows/current", response_model=WorkflowDefinitionResponse)
async def update_current_workflow(
    payload: WorkflowDefinitionUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
    service = WorkflowService()
    try:
        definition = service.update_current(payload.graph.model_dump(), session=session)
    except WorkflowValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from exc
    return WorkflowDefinitionResponse.model_validate(serialize_definition(definition))


@router.get("/api/workflows", response_model=list[WorkflowSummaryResponse])
async def list_workflows(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[WorkflowSummaryResponse]:
    _ensure_admin(current_user)
    service = WorkflowService()
    workflows = service.list_workflows(session)
    return [
        WorkflowSummaryResponse.model_validate(serialize_workflow_summary(w))
        for w in workflows
    ]


@router.post(
    "/api/workflows",
    response_model=WorkflowDefinitionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_workflow(
    payload: WorkflowCreateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
    service = WorkflowService()
    try:
        definition = service.create_workflow(
            slug=payload.slug,
            display_name=payload.display_name,
            description=payload.description,
            graph_payload=payload.graph.model_dump() if payload.graph else None,
            session=session,
        )
    except WorkflowValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from exc
    return WorkflowDefinitionResponse.model_validate(serialize_definition(definition))


@router.patch("/api/workflows/{workflow_id}", response_model=WorkflowSummaryResponse)
async def update_workflow(
    workflow_id: int,
    payload: WorkflowUpdateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WorkflowSummaryResponse:
    _ensure_admin(current_user)
    service = WorkflowService()
    try:
        workflow = service.update_workflow(
            workflow_id,
            payload.model_dump(exclude_unset=True),
            session=session,
        )
    except WorkflowNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except WorkflowValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from exc
    return WorkflowSummaryResponse.model_validate(serialize_workflow_summary(workflow))


@router.delete("/api/workflows/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(
    workflow_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    _ensure_admin(current_user)
    service = WorkflowService()
    try:
        service.delete_workflow(workflow_id, session=session)
    except WorkflowNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except WorkflowValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/api/workflows/{workflow_id}/versions",
    response_model=list[WorkflowVersionSummaryResponse],
)
async def list_workflow_versions(
    workflow_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[WorkflowVersionSummaryResponse]:
    _ensure_admin(current_user)
    service = WorkflowService()
    try:
        versions = service.list_versions(workflow_id, session)
    except WorkflowNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    return [
        WorkflowVersionSummaryResponse.model_validate(serialize_version_summary(v))
        for v in versions
    ]


@router.get(
    "/api/workflows/{workflow_id}/versions/{version_id}",
    response_model=WorkflowDefinitionResponse,
)
async def get_workflow_version(
    workflow_id: int,
    version_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
    service = WorkflowService()
    try:
        definition = service.get_version(workflow_id, version_id, session)
    except WorkflowVersionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    return WorkflowDefinitionResponse.model_validate(serialize_definition(definition))


@router.get("/api/workflows/{workflow_id}/versions/{version_id}/export")
async def export_workflow_version(
    workflow_id: int,
    version_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _ensure_admin(current_user)
    service = WorkflowService()
    try:
        definition = service.get_version(workflow_id, version_id, session)
    except WorkflowVersionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    return serialize_definition_graph(
        definition, include_position_metadata=False
    )


@router.post(
    "/api/workflows/{workflow_id}/versions",
    response_model=WorkflowDefinitionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_workflow_version(
    workflow_id: int,
    payload: WorkflowVersionCreateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
    service = WorkflowService()
    try:
        definition = service.create_version(
            workflow_id,
            payload.graph.model_dump(),
            name=payload.name,
            mark_as_active=payload.mark_as_active,
            session=session,
        )
    except WorkflowNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except WorkflowValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from exc
    return WorkflowDefinitionResponse.model_validate(serialize_definition(definition))


@router.put(
    "/api/workflows/{workflow_id}/versions/{version_id}",
    response_model=WorkflowDefinitionResponse,
)
async def update_workflow_version(
    workflow_id: int,
    version_id: int,
    payload: WorkflowVersionUpdateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
    service = WorkflowService()
    try:
        definition = service.update_version(
            workflow_id,
            version_id,
            payload.graph.model_dump(),
            session=session,
        )
    except WorkflowVersionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except WorkflowValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from exc
    return WorkflowDefinitionResponse.model_validate(serialize_definition(definition))


@router.post(
    "/api/workflows/{workflow_id}/production",
    response_model=WorkflowDefinitionResponse,
)
async def set_workflow_production_version(
    workflow_id: int,
    payload: WorkflowProductionUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
    service = WorkflowService()
    try:
        definition = service.set_production_version(
            workflow_id,
            payload.version_id,
            session=session,
        )
    except WorkflowVersionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    return WorkflowDefinitionResponse.model_validate(serialize_definition(definition))


@router.post("/api/workflows/chatkit", response_model=WorkflowSummaryResponse)
async def set_chatkit_workflow(
    payload: WorkflowChatKitUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WorkflowSummaryResponse:
    _ensure_admin(current_user)
    service = WorkflowService()
    try:
        workflow = service.set_chatkit_workflow(payload.workflow_id, session=session)
    except WorkflowNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except WorkflowValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from exc
    return WorkflowSummaryResponse.model_validate(serialize_workflow_summary(workflow))
