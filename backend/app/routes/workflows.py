from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import (
    get_current_user,
    get_workflow_appearance_service,
    get_workflow_persistence_service,
)
from ..models import User
from ..schemas import (
    WorkflowAppearanceResponse,
    WorkflowAppearanceUpdateRequest,
    WorkflowChatKitUpdate,
    WorkflowCreateRequest,
    WorkflowDefinitionResponse,
    WorkflowDefinitionUpdate,
    WorkflowImportRequest,
    WorkflowProductionUpdate,
    WorkflowSummaryResponse,
    WorkflowUpdateRequest,
    WorkflowVersionCreateRequest,
    WorkflowVersionSummaryResponse,
    WorkflowVersionUpdateRequest,
    WorkflowViewportListResponse,
    WorkflowViewportReplaceRequest,
)
from ..workflows import (
    HostedWorkflowNotFoundError,
    WorkflowAppearanceService,
    WorkflowNotFoundError,
    WorkflowPersistenceService,
    WorkflowValidationError,
    WorkflowVersionNotFoundError,
    serialize_definition,
    serialize_definition_graph,
    serialize_version_summary,
    serialize_viewport,
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
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
    definition = service.get_current(session)
    return WorkflowDefinitionResponse.model_validate(serialize_definition(definition))


@router.put("/api/workflows/current", response_model=WorkflowDefinitionResponse)
async def update_current_workflow(
    payload: WorkflowDefinitionUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
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
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> list[WorkflowSummaryResponse]:
    # Admin users can see all workflows
    if current_user.is_admin:
        workflows = service.list_workflows(session)
        return [
            WorkflowSummaryResponse.model_validate(serialize_workflow_summary(w))
            for w in workflows
        ]

    # LTI users can only see workflows from their LTI sessions
    if current_user.email.endswith('@lti.local'):
        from ..models import LTIUserSession, Workflow
        from sqlalchemy import select, distinct

        # Get all unique workflows this LTI user has accessed
        stmt = (
            select(Workflow)
            .join(LTIUserSession.resource_link)
            .where(
                LTIUserSession.user_id == current_user.id,
                Workflow.active_version_id.isnot(None)
            )
            .distinct()
        )
        workflows = list(session.scalars(stmt))

        return [
            WorkflowSummaryResponse.model_validate(serialize_workflow_summary(w))
            for w in workflows
        ]

    # Other non-admin users have no access
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail="Accès administrateur requis"
    )


@router.get(
    "/api/workflows/viewports",
    response_model=WorkflowViewportListResponse,
)
async def list_workflow_viewports(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> WorkflowViewportListResponse:
    _ensure_admin(current_user)
    viewports = service.list_user_viewports(current_user.id, session=session)
    return WorkflowViewportListResponse(
        viewports=[serialize_viewport(entry) for entry in viewports]
    )


@router.put(
    "/api/workflows/viewports",
    response_model=WorkflowViewportListResponse,
)
async def replace_workflow_viewports(
    payload: WorkflowViewportReplaceRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> WorkflowViewportListResponse:
    _ensure_admin(current_user)
    viewports = service.replace_user_viewports(
        current_user.id,
        [entry.model_dump() for entry in payload.viewports],
        session=session,
    )
    return WorkflowViewportListResponse(
        viewports=[serialize_viewport(entry) for entry in viewports]
    )


@router.post(
    "/api/workflows",
    response_model=WorkflowDefinitionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_workflow(
    payload: WorkflowCreateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
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
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> WorkflowSummaryResponse:
    _ensure_admin(current_user)
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


@router.post(
    "/api/workflows/import",
    response_model=WorkflowDefinitionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def import_workflow_definition(
    payload: WorkflowImportRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
    try:
        definition = service.import_workflow(
            workflow_id=payload.workflow_id,
            slug=payload.slug,
            display_name=payload.display_name,
            description=payload.description,
            version_name=payload.version_name,
            mark_as_active=bool(payload.mark_as_active),
            graph_payload=payload.graph.model_dump(),
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


@router.delete("/api/workflows/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(
    workflow_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> Response:
    _ensure_admin(current_user)
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
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> list[WorkflowVersionSummaryResponse]:
    _ensure_admin(current_user)
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
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
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
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> dict[str, Any]:
    _ensure_admin(current_user)
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
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
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
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
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
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
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
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> WorkflowSummaryResponse:
    _ensure_admin(current_user)
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


@router.get(
    "/api/workflows/{workflow_reference}/appearance",
    response_model=WorkflowAppearanceResponse,
)
async def get_workflow_appearance(
    workflow_reference: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    appearance_service: WorkflowAppearanceService = Depends(
        get_workflow_appearance_service
    ),
) -> WorkflowAppearanceResponse:
    _ensure_admin(current_user)
    try:
        reference: int | str = int(workflow_reference)
    except ValueError:
        reference = workflow_reference
    try:
        payload = appearance_service.get_workflow_appearance(reference, session=session)
    except (WorkflowNotFoundError, HostedWorkflowNotFoundError) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    return WorkflowAppearanceResponse.model_validate(payload)


@router.patch(
    "/api/workflows/{workflow_reference}/appearance",
    response_model=WorkflowAppearanceResponse,
)
async def update_workflow_appearance(
    workflow_reference: str,
    payload: WorkflowAppearanceUpdateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    appearance_service: WorkflowAppearanceService = Depends(
        get_workflow_appearance_service
    ),
) -> WorkflowAppearanceResponse:
    _ensure_admin(current_user)
    try:
        reference: int | str = int(workflow_reference)
    except ValueError:
        reference = workflow_reference
    try:
        data = appearance_service.update_workflow_appearance(
            reference, payload.model_dump(exclude_unset=True), session=session
        )
    except (WorkflowNotFoundError, HostedWorkflowNotFoundError) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    return WorkflowAppearanceResponse.model_validate(data)
