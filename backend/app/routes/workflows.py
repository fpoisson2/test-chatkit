from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import (
    get_current_user,
    get_workflow_appearance_service,
    get_workflow_persistence_service,
)
from ..models import User
from ..rate_limit import get_rate_limit, limiter
from ..schemas import (
    WorkflowAppearanceResponse,
    WorkflowAppearanceUpdateRequest,
    WorkflowChatKitUpdate,
    WorkflowCreateRequest,
    WorkflowDefinitionResponse,
    WorkflowDefinitionUpdate,
    WorkflowDuplicateRequest,
    WorkflowImportRequest,
    WorkflowProductionUpdate,
    WorkflowShareRequest,
    WorkflowSharedUserResponse,
    WorkflowShareUpdateRequest,
    WorkflowStepMessageUpdate,
    WorkflowSummaryResponse,
    WorkflowUnshareRequest,
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

    # LTI users can only see workflows from their LTI resource links
    # They should only access the specific workflow assigned via deeplink
    if current_user.is_lti:
        from ..models import LTIUserSession
        from sqlalchemy import select, desc

        # Get the most recent launched LTI session for this user
        # This represents the current deeplink context
        latest_session_stmt = (
            select(LTIUserSession)
            .where(
                LTIUserSession.user_id == current_user.id,
                LTIUserSession.launched_at.isnot(None)
            )
            .order_by(desc(LTIUserSession.launched_at))
            .limit(1)
        )
        latest_session = session.scalar(latest_session_stmt)

        if not latest_session or not latest_session.resource_link:
            # No active LTI session found
            return []

        # Return only the workflow from the current resource link
        workflow = latest_session.resource_link.workflow
        if workflow and workflow.active_version_id is not None:
            return [
                WorkflowSummaryResponse.model_validate(serialize_workflow_summary(workflow))
            ]

        return []

    # Regular users can see their own workflows and workflows shared with them
    from ..models import Workflow, workflow_shares
    from sqlalchemy import select, or_

    # Query workflows where user is owner OR workflow is shared with user
    stmt = (
        select(Workflow)
        .outerjoin(workflow_shares, Workflow.id == workflow_shares.c.workflow_id)
        .where(
            or_(
                Workflow.owner_id == current_user.id,
                workflow_shares.c.user_id == current_user.id,
            )
        )
        .distinct()
        .order_by(Workflow.updated_at.desc())
    )
    workflows = list(session.scalars(stmt).unique().all())

    return [
        WorkflowSummaryResponse.model_validate(serialize_workflow_summary(w))
        for w in workflows
    ]


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


@limiter.limit(get_rate_limit("api_write"))
@router.post(
    "/api/workflows",
    response_model=WorkflowDefinitionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_workflow(
    payload: WorkflowCreateRequest,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> WorkflowDefinitionResponse:
    # LTI users cannot create workflows
    if current_user.is_lti:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Les utilisateurs LTI ne peuvent pas créer de workflows"
        )

    # Set owner_id for non-admin users, admin-created workflows have no owner
    owner_id = None if current_user.is_admin else current_user.id

    try:
        definition = service.create_workflow(
            slug=payload.slug,
            display_name=payload.display_name,
            description=payload.description,
            graph_payload=payload.graph.model_dump() if payload.graph else None,
            owner_id=owner_id,
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
    from ..models import Workflow

    # Get the workflow to check ownership
    workflow = session.get(Workflow, workflow_id)
    if workflow is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workflow non trouvé"
        )

    # Only admin or owner can delete a workflow
    if not current_user.is_admin and workflow.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Seul le propriétaire peut supprimer ce workflow",
        )

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


@router.post(
    "/api/workflows/{workflow_id}/duplicate",
    response_model=WorkflowSummaryResponse,
    status_code=status.HTTP_201_CREATED,
)
async def duplicate_workflow(
    workflow_id: int,
    payload: WorkflowDuplicateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> WorkflowSummaryResponse:
    from sqlalchemy import select
    from ..models import Workflow, workflow_shares

    # LTI users cannot duplicate workflows
    if current_user.is_lti:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Les utilisateurs LTI ne peuvent pas dupliquer de workflows",
        )

    # Get the workflow to check access
    workflow = session.get(Workflow, workflow_id)
    if workflow is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workflow non trouvé"
        )

    # Check if user has access to this workflow (owner, shared with write, or admin)
    can_duplicate = current_user.is_admin or workflow.owner_id == current_user.id

    if not can_duplicate:
        # Check if shared with write permission
        share_stmt = select(workflow_shares.c.permission).where(
            workflow_shares.c.workflow_id == workflow_id,
            workflow_shares.c.user_id == current_user.id,
        )
        share_permission = session.scalar(share_stmt)
        can_duplicate = share_permission == "write"

    if not can_duplicate:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Vous n'avez pas la permission de dupliquer ce workflow",
        )

    # Set owner_id for non-admin users duplicating
    # Admin duplication keeps no owner (system workflow)
    owner_id = None if current_user.is_admin else current_user.id

    try:
        new_workflow = service.duplicate_workflow(
            workflow_id, payload.display_name, owner_id=owner_id, session=session
        )
    except WorkflowNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except WorkflowValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from exc
    return WorkflowSummaryResponse.model_validate(serialize_workflow_summary(new_workflow))


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
    # Admin users can access all workflows
    if current_user.is_admin:
        try:
            definition = service.get_version(workflow_id, version_id, session)
        except WorkflowVersionNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
            ) from exc
        return WorkflowDefinitionResponse.model_validate(serialize_definition(definition))

    # LTI users can only access workflows from their LTI resource links
    if current_user.is_lti:
        from ..models import LTIUserSession
        from sqlalchemy import select, desc

        # Get the most recent launched LTI session for this user
        latest_session_stmt = (
            select(LTIUserSession)
            .where(
                LTIUserSession.user_id == current_user.id,
                LTIUserSession.launched_at.isnot(None)
            )
            .order_by(desc(LTIUserSession.launched_at))
            .limit(1)
        )
        latest_session = session.scalar(latest_session_stmt)

        if not latest_session or not latest_session.resource_link:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No active LTI session found"
            )

        # Check if the requested workflow matches the LTI session workflow
        if latest_session.resource_link.workflow_id != workflow_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this workflow"
            )

        try:
            definition = service.get_version(workflow_id, version_id, session)
        except WorkflowVersionNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
            ) from exc
        return WorkflowDefinitionResponse.model_validate(serialize_definition(definition))

    # Regular users - check ownership or shares
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


@router.patch("/api/workflows/{workflow_id}/steps/{step_slug}/message")
async def update_step_message_live(
    workflow_id: int,
    step_slug: str,
    payload: WorkflowStepMessageUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    service: WorkflowPersistenceService = Depends(
        get_workflow_persistence_service
    ),
) -> dict[str, Any]:
    """Update a step's message text in-place on the active definition.

    This modifies the published version directly (no draft) and updates
    all stored thread items. Connected clients are notified via SSE.
    """
    _ensure_admin(current_user)
    from ..live_updates import LiveUpdateManager, StepContentUpdate, live_update_manager

    try:
        step = service.update_step_message_live(
            workflow_id, step_slug, payload.message, session=session,
        )
    except WorkflowNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except WorkflowValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from exc

    # Broadcast to connected SSE clients
    await live_update_manager.publish(
        StepContentUpdate(
            workflow_id=workflow_id,
            step_slug=step_slug,
            new_text=payload.message,
        )
    )

    return {"ok": True, "step_slug": step_slug}


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


# ============================================================================
# Workflow Sharing Endpoints
# ============================================================================


def _get_workflow_for_sharing(
    workflow_id: int, current_user: User, session: Session
) -> "Workflow":
    """Get a workflow and verify the user can share it (owner or admin)."""
    from ..models import Workflow

    workflow = session.get(Workflow, workflow_id)
    if workflow is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workflow non trouvé"
        )

    # Only owner or admin can share a workflow
    if not current_user.is_admin and workflow.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Seul le propriétaire peut partager ce workflow",
        )

    return workflow


@router.get(
    "/api/workflows/{workflow_id}/shares",
    response_model=list[WorkflowSharedUserResponse],
)
async def list_workflow_shares(
    workflow_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[WorkflowSharedUserResponse]:
    """List users a workflow is shared with."""
    from sqlalchemy import select
    from ..models import workflow_shares

    workflow = _get_workflow_for_sharing(workflow_id, current_user, session)

    # Get shares with permissions
    stmt = select(
        User.id, User.email, workflow_shares.c.permission
    ).join(
        workflow_shares, User.id == workflow_shares.c.user_id
    ).where(
        workflow_shares.c.workflow_id == workflow_id
    )
    shares = session.execute(stmt).all()

    return [
        WorkflowSharedUserResponse(id=row.id, email=row.email, permission=row.permission)
        for row in shares
    ]


@router.post(
    "/api/workflows/{workflow_id}/shares",
    response_model=WorkflowSharedUserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def share_workflow(
    workflow_id: int,
    payload: WorkflowShareRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WorkflowSharedUserResponse:
    """Share a workflow with another user by email."""
    from sqlalchemy import select, insert
    from ..models import workflow_shares

    workflow = _get_workflow_for_sharing(workflow_id, current_user, session)

    # Validate permission value
    if payload.permission not in ("read", "write"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La permission doit être 'read' ou 'write'",
        )

    # Find the target user by email
    target_user = session.scalar(
        select(User).where(User.email == payload.user_email)
    )
    if target_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utilisateur non trouvé avec cet email",
        )

    # Cannot share with yourself
    if target_user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vous ne pouvez pas partager un workflow avec vous-même",
        )

    # Cannot share with the owner
    if target_user.id == workflow.owner_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vous ne pouvez pas partager un workflow avec son propriétaire",
        )

    # Check if already shared
    if target_user in workflow.shared_with:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ce workflow est déjà partagé avec cet utilisateur",
        )

    # Add the share with permission using raw insert
    stmt = insert(workflow_shares).values(
        workflow_id=workflow_id,
        user_id=target_user.id,
        permission=payload.permission,
    )
    session.execute(stmt)
    session.commit()

    return WorkflowSharedUserResponse(
        id=target_user.id, email=target_user.email, permission=payload.permission
    )


@router.delete(
    "/api/workflows/{workflow_id}/shares/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unshare_workflow(
    workflow_id: int,
    user_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Remove a user's access to a shared workflow."""
    workflow = _get_workflow_for_sharing(workflow_id, current_user, session)

    # Find the user to remove
    target_user = None
    for user in workflow.shared_with:
        if user.id == user_id:
            target_user = user
            break

    if target_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ce workflow n'est pas partagé avec cet utilisateur",
        )

    workflow.shared_with.remove(target_user)
    session.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch(
    "/api/workflows/{workflow_id}/shares/{user_id}",
    response_model=WorkflowSharedUserResponse,
)
async def update_share_permission(
    workflow_id: int,
    user_id: int,
    payload: WorkflowShareUpdateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WorkflowSharedUserResponse:
    """Update a user's permission for a shared workflow."""
    from sqlalchemy import select, update
    from ..models import workflow_shares

    workflow = _get_workflow_for_sharing(workflow_id, current_user, session)

    # Validate permission value
    if payload.permission not in ("read", "write"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La permission doit être 'read' ou 'write'",
        )

    # Find the target user
    target_user = session.get(User, user_id)
    if target_user is None or target_user not in workflow.shared_with:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ce workflow n'est pas partagé avec cet utilisateur",
        )

    # Update the permission
    stmt = (
        update(workflow_shares)
        .where(
            workflow_shares.c.workflow_id == workflow_id,
            workflow_shares.c.user_id == user_id,
        )
        .values(permission=payload.permission)
    )
    session.execute(stmt)
    session.commit()

    return WorkflowSharedUserResponse(
        id=target_user.id, email=target_user.email, permission=payload.permission
    )


# ============================================================================
# Workflow Generation Endpoints
# ============================================================================


from pydantic import BaseModel as PydanticBaseModel


class WorkflowGenerateRequest(PydanticBaseModel):
    prompt_id: int | None = None
    user_message: str


class WorkflowGenerationTaskResponse(PydanticBaseModel):
    task_id: str
    workflow_id: int
    version_id: int | None
    prompt_id: int | None
    user_message: str
    status: str
    progress: int
    error_message: str | None
    result_json: dict | None
    created_at: str
    completed_at: str | None


class WorkflowGenerationStartResponse(PydanticBaseModel):
    task_id: str
    status: str
    message: str


class WorkflowGenerationPromptSummary(PydanticBaseModel):
    id: int
    name: str
    description: str | None
    is_default: bool


@router.get(
    "/api/workflows/generation/prompts",
    response_model=list[WorkflowGenerationPromptSummary],
)
async def list_active_generation_prompts(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[WorkflowGenerationPromptSummary]:
    """Liste les prompts de génération actifs pour le sélecteur."""
    from sqlalchemy import select
    from ..models import WorkflowGenerationPrompt

    _ensure_admin(current_user)

    prompts = session.scalars(
        select(WorkflowGenerationPrompt)
        .where(WorkflowGenerationPrompt.is_active)
        .order_by(
            WorkflowGenerationPrompt.is_default.desc(),
            WorkflowGenerationPrompt.name.asc(),
        )
    ).all()

    return [
        WorkflowGenerationPromptSummary(
            id=p.id,
            name=p.name,
            description=p.description,
            is_default=p.is_default,
        )
        for p in prompts
    ]


@router.post(
    "/api/workflows/{workflow_id}/generate",
    response_model=WorkflowGenerationStartResponse,
)
async def generate_workflow(
    workflow_id: int,
    payload: WorkflowGenerateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WorkflowGenerationStartResponse:
    """Lance la génération d'un workflow via Celery."""
    import uuid
    from sqlalchemy import select
    from ..models import Workflow, WorkflowGenerationTask
    from ..tasks.workflow_generation import generate_workflow_task

    _ensure_admin(current_user)

    # Vérifier que le workflow existe
    workflow = session.get(Workflow, workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow non trouvé",
        )

    # Déterminer la version cible
    version_id = None
    if workflow.versions:
        # Utiliser la première version (brouillon) si elle existe
        version_id = workflow.versions[0].id if workflow.versions else None

    # Créer la tâche en BD
    task_id = str(uuid.uuid4())
    task = WorkflowGenerationTask(
        task_id=task_id,
        workflow_id=workflow_id,
        version_id=version_id,
        prompt_id=payload.prompt_id,
        user_message=payload.user_message,
        status="pending",
        progress=0,
    )
    session.add(task)
    session.commit()

    # Lancer la tâche Celery
    generate_workflow_task.delay(
        task_id=task_id,
        prompt_id=payload.prompt_id,
        user_message=payload.user_message,
        workflow_id=workflow_id,
        version_id=version_id,
    )

    return WorkflowGenerationStartResponse(
        task_id=task_id,
        status="pending",
        message="Génération du workflow lancée",
    )


@router.get(
    "/api/workflows/generation/tasks/{task_id}",
    response_model=WorkflowGenerationTaskResponse,
)
async def get_generation_task_status(
    task_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WorkflowGenerationTaskResponse:
    """Récupère le statut d'une tâche de génération."""
    from sqlalchemy import select
    from ..models import WorkflowGenerationTask

    _ensure_admin(current_user)

    task = session.scalar(
        select(WorkflowGenerationTask).where(
            WorkflowGenerationTask.task_id == task_id
        )
    )
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tâche non trouvée",
        )

    return WorkflowGenerationTaskResponse(
        task_id=task.task_id,
        workflow_id=task.workflow_id,
        version_id=task.version_id,
        prompt_id=task.prompt_id,
        user_message=task.user_message,
        status=task.status,
        progress=task.progress,
        error_message=task.error_message,
        result_json=task.result_json,
        created_at=task.created_at.isoformat(),
        completed_at=task.completed_at.isoformat() if task.completed_at else None,
    )


@router.post("/api/workflows/{workflow_id}/generate/stream")
async def generate_workflow_stream(
    workflow_id: int,
    payload: WorkflowGenerateRequest,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """
    Génère un workflow avec streaming SSE.

    Retourne un flux SSE avec les événements suivants:
    - type: "reasoning" - Contenu du raisonnement de l'IA
    - type: "content" - Contenu du message de l'assistant
    - type: "result" - Résultat final JSON avec nodes et edges
    - type: "error" - Erreur lors de la génération
    - type: "done" - Fin du streaming
    """
    import json
    import re
    from fastapi.responses import StreamingResponse
    from sqlalchemy import select
    from openai import OpenAI
    from ..models import Workflow, WorkflowGenerationPrompt
    from ..chatkit.agent_registry import get_agent_provider_binding
    from ..model_providers._shared import normalize_api_base

    _ensure_admin(current_user)

    # Vérifier que le workflow existe
    workflow = session.get(Workflow, workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow non trouvé",
        )

    # Charger le prompt
    prompt_id = payload.prompt_id
    if prompt_id:
        prompt = session.get(WorkflowGenerationPrompt, prompt_id)
    else:
        prompt = session.scalar(
            select(WorkflowGenerationPrompt)
            .where(WorkflowGenerationPrompt.is_default)
            .where(WorkflowGenerationPrompt.is_active)
        )

    if not prompt:
        prompt = session.scalar(
            select(WorkflowGenerationPrompt)
            .where(WorkflowGenerationPrompt.is_active)
            .order_by(WorkflowGenerationPrompt.id)
            .limit(1)
        )

    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Aucun prompt de génération configuré",
        )

    async def generate_stream():
        try:
            # Résoudre le provider
            provider_binding = get_agent_provider_binding(
                prompt.provider_id, prompt.provider_slug
            )

            # Configurer le client OpenAI
            client_kwargs = {}
            if provider_binding and provider_binding.credentials:
                if provider_binding.credentials.api_base:
                    client_kwargs["base_url"] = normalize_api_base(
                        provider_binding.credentials.api_base
                    )
                if provider_binding.credentials.api_key:
                    client_kwargs["api_key"] = provider_binding.credentials.api_key

            client = OpenAI(**client_kwargs)

            # Préparer les messages
            messages = [
                {"role": "developer", "content": prompt.developer_message},
                {"role": "user", "content": payload.user_message},
            ]

            # Préparer les paramètres du modèle
            model_params = {
                "model": prompt.model,
                "messages": messages,
                "stream": True,
            }

            # Ajouter le niveau de raisonnement si supporté
            if prompt.reasoning_effort and prompt.reasoning_effort != "none":
                model_params["reasoning_effort"] = prompt.reasoning_effort

            # Appeler l'API en streaming
            stream = client.chat.completions.create(**model_params)

            full_content = ""
            full_reasoning = ""

            for chunk in stream:
                if chunk.choices and len(chunk.choices) > 0:
                    choice = chunk.choices[0]
                    delta = choice.delta

                    # Récupérer le reasoning si disponible (pour les modèles o1, o3, etc.)
                    if hasattr(delta, "reasoning") and delta.reasoning:
                        full_reasoning += delta.reasoning
                        yield f"data: {json.dumps({'type': 'reasoning', 'content': delta.reasoning})}\n\n"

                    # Récupérer le contenu du message
                    if delta.content:
                        full_content += delta.content
                        yield f"data: {json.dumps({'type': 'content', 'content': delta.content})}\n\n"

            # Parser le résultat JSON
            try:
                result_json = json.loads(full_content)
            except json.JSONDecodeError:
                # Essayer d'extraire le JSON de la réponse
                json_match = re.search(r"\{.*\}", full_content, re.DOTALL)
                if not json_match:
                    yield f"data: {json.dumps({'type': 'error', 'content': 'Failed to extract JSON from AI response'})}\n\n"
                    yield "data: {\"type\": \"done\"}\n\n"
                    return
                result_json = json.loads(json_match.group(0))

            # Valider la structure
            if "nodes" not in result_json or "edges" not in result_json:
                yield f"data: {json.dumps({'type': 'error', 'content': 'Invalid workflow structure: missing nodes or edges'})}\n\n"
                yield "data: {\"type\": \"done\"}\n\n"
                return

            # Envoyer le résultat final
            yield f"data: {json.dumps({'type': 'result', 'content': result_json})}\n\n"
            yield "data: {\"type\": \"done\"}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            yield "data: {\"type\": \"done\"}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _run_ai_improve(
    content: str,
    content_type: str,
    user_instructions: str = "",
) -> str:
    """Shared AI content improvement logic using Agents SDK with gpt-5.4."""
    from agents import Agent, RunConfig, Runner

    from ..chatkit.agent_registry import create_litellm_model, get_agent_provider_binding

    if user_instructions:
        # When specific instructions are given, prioritize them
        if content_type == "system_prompt":
            instructions = (
                "You are an expert at editing AI system prompts. "
                "The user will give you a system prompt and specific instructions for changes. "
                "Apply the requested changes precisely. Keep the same language and overall structure. "
                "Return ONLY the modified text, nothing else."
                f"\n\nUser instructions: {user_instructions}"
            )
        else:
            instructions = (
                "You are an expert at editing instructional and conversational text. "
                "The user will give you a message and specific instructions for changes. "
                "Apply the requested changes precisely. Keep the same language and overall structure. "
                "Return ONLY the modified text, nothing else."
                f"\n\nUser instructions: {user_instructions}"
            )
    else:
        if content_type == "system_prompt":
            instructions = (
                "You are an expert at improving AI system prompts. "
                "The user will give you a system prompt. Improve it to be clearer, "
                "more precise, and more effective. Keep the same intent and language. "
                "Return ONLY the improved text, nothing else."
            )
        else:
            instructions = (
                "You are an expert at improving instructional and conversational text. "
                "The user will give you a message. Improve it to be clearer, "
                "more engaging, and better structured. Keep the same intent and language. "
                "Return ONLY the improved text, nothing else."
            )

    provider_binding = get_agent_provider_binding(None, "openai")
    if not provider_binding:
        raise RuntimeError("No OpenAI provider configured")

    model_instance = create_litellm_model("gpt-5.4", provider_binding)
    agent = Agent(
        name="Content Improver",
        model=model_instance,
        instructions=instructions,
    )
    agent._chatkit_provider_binding = provider_binding

    run_config_kwargs: dict[str, Any] = {}
    if provider_binding.provider is not None:
        run_config_kwargs["model_provider"] = provider_binding.provider

    try:
        run_config = RunConfig(**run_config_kwargs)
    except TypeError:
        run_config_kwargs.pop("model_provider", None)
        run_config = RunConfig(**run_config_kwargs)

    result = await Runner.run(agent, input=content, run_config=run_config)
    return result.final_output or content


@router.post("/api/workflows/ai/improve-content")
async def ai_improve_content(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Use AI (Agents SDK) to improve text content (assistant messages or system prompts)."""
    _ensure_admin(current_user)

    body = await request.json()
    content: str = body.get("content", "").strip()
    content_type: str = body.get("content_type", "assistant_message")
    user_instructions: str = (body.get("instructions") or "").strip()

    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Content is required",
        )

    try:
        improved = await _run_ai_improve(content, content_type, user_instructions)
        return {"improved_content": improved}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI improvement failed: {str(e)}",
        )


def _get_admin_voice_tools_definitions() -> list[dict[str, Any]]:
    """Return tool definitions for the admin voice session (sent to OpenAI)."""
    return [
        {
            "type": "function",
            "name": "list_workflow_steps",
            "description": "List all steps in the current workflow with their slugs, titles, and types. Includes message, agent, evaluated_step, help_loop, and guided_exercise steps.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
        {
            "type": "function",
            "name": "improve_step_content",
            "description": (
                "Improve the content (system prompt, assistant message, or instruction) of a specific "
                "workflow step using AI and apply the changes immediately. "
                "Works with message, agent, evaluated_step, help_loop, and guided_exercise steps."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "step_slug": {"type": "string", "description": "The slug of the step to improve."},
                    "instructions": {"type": "string", "description": "Instructions for how to improve the content."},
                },
                "required": ["step_slug", "instructions"],
            },
        },
        {
            "type": "function",
            "name": "get_student_progress",
            "description": "Get the current progress of all students in the workflow, showing who is at which step.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
        {
            "type": "function",
            "name": "publish_step_message",
            "description": "Publish a new message or instruction for a specific step, updating it live for all active conversations. Works with all editable step types including evaluated_step, help_loop, and guided_exercise.",
            "parameters": {
                "type": "object",
                "properties": {
                    "step_slug": {"type": "string", "description": "The slug of the step to update."},
                    "new_message": {"type": "string", "description": "The new message text to publish."},
                },
                "required": ["step_slug", "new_message"],
            },
        },
        {
            "type": "function",
            "name": "unlock_student",
            "description": "Unblock a student stuck at a wait step by clearing their wait state so the workflow can advance.",
            "parameters": {
                "type": "object",
                "properties": {
                    "thread_id": {"type": "string", "description": "The thread ID of the student to unblock."},
                },
                "required": ["thread_id"],
            },
        },
    ]


async def _execute_admin_voice_tool(
    tool_name: str,
    arguments: dict[str, Any],
    workflow_id: int,
    session: Session,
) -> str:
    """Execute an admin voice tool and return the result string."""
    from sqlalchemy import select as sa_select

    from ..models import ChatThread, Workflow, WorkflowDefinition, WorkflowStep
    from ..routes.workflow_monitor_ws import get_active_sessions

    # Load workflow context
    active_def = session.scalar(
        sa_select(WorkflowDefinition).where(
            WorkflowDefinition.workflow_id == workflow_id,
            WorkflowDefinition.is_active == True,  # noqa: E712
        )
    )
    if active_def is None:
        return "Error: No active workflow definition found."

    # Only these step types are editable via voice
    EDITABLE_STEP_KINDS = {
        "message", "assistant_message", "agent",
        "evaluated_step", "help_loop", "guided_exercise",
    }

    if tool_name == "list_workflow_steps":
        steps = session.scalars(
            sa_select(WorkflowStep)
            .where(WorkflowStep.definition_id == active_def.id)
            .order_by(WorkflowStep.position)
        ).all()
        lines: list[str] = []
        for s in steps:
            if s.kind not in EDITABLE_STEP_KINDS:
                continue
            params = s.parameters or {}
            title = params.get("title", s.display_name or s.slug)
            msg = (
                params.get("message", "")
                or params.get("instruction", "")
                or ""
            )
            lines.append(
                f"- slug: {s.slug}, title: {title}, type: {s.kind}"
                + (f", content: {msg}" if msg else "")
            )
        return "\n".join(lines) or "No editable steps found."

    elif tool_name == "improve_step_content":
        step_slug = arguments.get("step_slug", "")
        instructions = arguments.get("instructions", "")
        logger.info(f"[ADMIN_VOICE] improve_step_content: slug={step_slug}, instructions={instructions}")
        step = session.scalar(
            sa_select(WorkflowStep).where(
                WorkflowStep.definition_id == active_def.id,
                WorkflowStep.slug == step_slug,
            )
        )
        if step is None:
            return f"Error: Step '{step_slug}' not found."
        if step.kind not in EDITABLE_STEP_KINDS:
            return f"Error: Step '{step_slug}' is of type '{step.kind}' and cannot be edited via voice."
        params = step.parameters or {}
        # Determine content field and type based on step kind
        if step.kind in ("evaluated_step", "help_loop", "guided_exercise"):
            content = params.get("instruction", "") or ""
            content_type = "assistant_message"
        elif step.kind == "agent":
            content = params.get("message", "") or ""
            content_type = "system_prompt"
        else:
            content = params.get("message", "") or ""
            content_type = "assistant_message"
        if not content:
            return f"Error: Step '{step_slug}' has no message content to improve."
        logger.info(f"[ADMIN_VOICE] improve_step_content: original content length={len(content)}")
        improved = await _run_ai_improve(content, content_type, instructions)
        logger.info(f"[ADMIN_VOICE] improve_step_content: improved content length={len(improved)}")

        # Use the same live-update path as "Publier en direct" button:
        # updates step, all stored thread items, and broadcasts SSE.
        from ..live_updates import LiveUpdateManager, StepContentUpdate, live_update_manager

        svc = WorkflowPersistenceService(session)
        svc.update_step_message_live(workflow_id, step_slug, improved, session=session)
        logger.info(f"[ADMIN_VOICE] improve_step_content: committed via update_step_message_live")

        await live_update_manager.publish(
            StepContentUpdate(
                workflow_id=workflow_id,
                step_slug=step_slug,
                new_text=improved,
            )
        )

        return f"Le contenu de l'étape '{step_slug}' a été amélioré et publié."

    elif tool_name == "get_student_progress":
        sessions_list = get_active_sessions(session)
        relevant = [
            s for s in sessions_list
            if s.get("workflow", {}).get("id") == workflow_id
        ]
        if not relevant:
            return "No active student sessions found for this workflow."
        lines = []
        for s in relevant:
            user = s.get("user", {})
            step_info = s.get("current_step", {})
            name = user.get("display_name") or user.get("email", "Unknown")
            step_name = step_info.get("display_name", step_info.get("slug", "unknown"))
            s_slug = step_info.get("slug", "unknown")
            tid = s.get("thread_id", "")
            lines.append(f"- {name}: at step '{step_name}' (slug: {s_slug}), thread: {tid}")
        return f"Active students ({len(relevant)}):\n" + "\n".join(lines)

    elif tool_name == "publish_step_message":
        step_slug = arguments.get("step_slug", "")
        new_message = arguments.get("new_message", "")
        from ..live_updates import StepContentUpdate, live_update_manager

        svc = WorkflowPersistenceService(session)
        try:
            svc.update_step_message_live(workflow_id, step_slug, new_message, session=session)
            await live_update_manager.publish(
                StepContentUpdate(
                    workflow_id=workflow_id,
                    step_slug=step_slug,
                    new_text=new_message,
                )
            )
            return f"Successfully published new message for step '{step_slug}'."
        except Exception as e:
            return f"Error publishing message: {str(e)}"

    elif tool_name == "unlock_student":
        from ..chatkit_server.context import _get_wait_state_metadata, _set_wait_state_metadata

        thread_id = arguments.get("thread_id", "")
        thread = session.get(ChatThread, thread_id)
        if thread is None:
            return f"Error: Thread '{thread_id}' not found."
        wait_state = _get_wait_state_metadata(thread)
        if not wait_state:
            return f"Student in thread '{thread_id}' is not in a waiting state."
        current_slug = wait_state.get("slug", "unknown")
        next_slug = wait_state.get("next_step_slug")
        _set_wait_state_metadata(thread, None)
        session.commit()
        return (
            f"Student in thread '{thread_id}' has been unblocked from step '{current_slug}'."
            + (f" They will advance to '{next_slug}' on their next message." if next_slug else "")
        )

    else:
        return f"Error: Unknown tool '{tool_name}'."


@router.post("/api/workflows/{workflow_id}/admin-voice/session")
async def create_admin_voice_session(
    workflow_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Create a Realtime voice session for the admin workflow assistant."""
    import httpx
    from sqlalchemy import select as sa_select

    from ..admin_settings import get_settings
    from ..models import Workflow, WorkflowDefinition, WorkflowStep

    _ensure_admin(current_user)

    workflow = session.get(Workflow, workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")

    active_def = session.scalar(
        sa_select(WorkflowDefinition).where(
            WorkflowDefinition.workflow_id == workflow_id,
            WorkflowDefinition.is_active == True,  # noqa: E712
        )
    )
    if active_def is None:
        raise HTTPException(status_code=404, detail="No active definition found")

    steps = session.scalars(
        sa_select(WorkflowStep)
        .where(WorkflowStep.definition_id == active_def.id)
        .order_by(WorkflowStep.position)
    ).all()

    step_descriptions: list[str] = []
    for s in steps:
        params = s.parameters or {}
        title = params.get("title", s.display_name or s.slug)
        msg = params.get("message", "") or ""
        step_descriptions.append(
            f"- slug: {s.slug}, title: {title}, type: {s.kind}"
            + (f", message: {msg}" if msg else "")
        )
    steps_context = "\n".join(step_descriptions)

    instructions = (
        f"Tu es un assistant administrateur concis pour le workflow '{workflow.display_name}'. "
        "Sois extrêmement bref et direct. Donne uniquement l'information essentielle, "
        "pas de formules de politesse, pas de suggestions non sollicitées. "
        "Maximum une ou deux phrases courtes. "
        "RÈGLE CRITIQUE sur les appels d'outils : "
        "AVANT d'appeler un outil, dis une courte phrase comme 'OK, je m'en occupe, un instant...' ou 'Hmm, laisse-moi faire ça...'. "
        "Ne confirme JAMAIS que c'est fait avant d'avoir reçu le résultat de l'outil. "
        "APRÈS avoir reçu le résultat, confirme brièvement : 'C'est fait !' ou décris ce qui a été changé en une phrase. "
        "Quand l'utilisateur mentionne une étape par son contenu plutôt que son slug, "
        "utilise list_workflow_steps pour retrouver le bon slug à partir du contenu affiché. "
        "Réponds dans la même langue que l'utilisateur."
        f"\n\nÉtapes du workflow:\n{steps_context}"
    )

    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    voice = body.get("voice", "ash")
    model = body.get("model", "gpt-realtime-1.5")

    settings = get_settings()
    api_key = settings.openai_api_key or settings.model_api_key

    session_payload: dict[str, Any] = {
        "model": model,
        "instructions": instructions,
        "voice": voice,
        "tools": _get_admin_voice_tools_definitions(),
        "input_audio_transcription": {"model": "gpt-4o-mini-transcribe"},
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/realtime/sessions",
            json=session_payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

    if resp.status_code >= 400:
        raise HTTPException(
            status_code=500,
            detail=f"OpenAI Realtime session creation failed: {resp.text[:500]}",
        )

    data = resp.json()
    cs = data.get("client_secret", {})
    client_secret = cs.get("value") if isinstance(cs, dict) else cs

    if not client_secret:
        raise HTTPException(
            status_code=500,
            detail="Failed to obtain client secret for voice session",
        )

    return {
        "session_id": data.get("id", ""),
        "client_secret": client_secret,
        "model": model,
        "voice": voice,
        "instructions": instructions,
    }


@router.post("/api/workflows/{workflow_id}/admin-voice/execute-tool")
async def execute_admin_voice_tool(
    workflow_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Execute a tool call from the admin voice assistant.

    The frontend intercepts function_call events from the WebRTC data channel,
    forwards them here for execution, and sends the result back to OpenAI.
    """
    _ensure_admin(current_user)

    body = await request.json()
    tool_name = body.get("tool_name", "")
    arguments = body.get("arguments", {})

    logger.info(f"[ADMIN_VOICE] execute-tool called: tool={tool_name}, args={arguments}")

    if isinstance(arguments, str):
        import json as json_mod
        try:
            arguments = json_mod.loads(arguments)
        except (json_mod.JSONDecodeError, TypeError):
            arguments = {}

    try:
        result = await _execute_admin_voice_tool(tool_name, arguments, workflow_id, session)
        logger.info(f"[ADMIN_VOICE] tool result: {result[:200]}")
    except Exception as e:
        logger.error(f"[ADMIN_VOICE] tool error: {e}", exc_info=True)
        result = f"Error executing tool '{tool_name}': {str(e)}"

    return {"result": result}
