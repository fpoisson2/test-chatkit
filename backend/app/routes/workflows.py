from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import get_current_user
from ..models import User
from ..schemas import WorkflowDefinitionResponse, WorkflowDefinitionUpdate
from ..workflows import WorkflowService, WorkflowValidationError

router = APIRouter()


def _ensure_admin(user: User) -> None:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès administrateur requis")


@router.get("/api/workflows/current", response_model=WorkflowDefinitionResponse)
async def get_current_workflow(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
    service = WorkflowService()
    definition = service.get_current(session)
    return WorkflowDefinitionResponse.model_validate(definition)


@router.put("/api/workflows/current", response_model=WorkflowDefinitionResponse)
async def update_current_workflow(
    payload: WorkflowDefinitionUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> WorkflowDefinitionResponse:
    _ensure_admin(current_user)
    service = WorkflowService()
    try:
        definition = service.update_current([step.model_dump() for step in payload.steps], session=session)
    except WorkflowValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message) from exc
    return WorkflowDefinitionResponse.model_validate(definition)
