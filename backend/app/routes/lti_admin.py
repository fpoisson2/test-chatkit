"""LTI 1.3 Admin API routes"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import require_admin
from ..models import LTIDeployment, LTIPlatform, User, Workflow
from ..schemas import (
    LTIDeploymentCreate,
    LTIDeploymentResponse,
    LTIPlatformCreate,
    LTIPlatformResponse,
    LTIPlatformUpdate,
    WorkflowLTISettings,
)

router = APIRouter(prefix="/api/admin/lti", tags=["lti-admin"])


# Platform management


@router.get("/platforms", response_model=list[LTIPlatformResponse])
async def list_platforms(
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
):
    """List all LTI platforms"""
    stmt = select(LTIPlatform).order_by(LTIPlatform.created_at.desc())
    platforms = session.execute(stmt).scalars().all()
    return [LTIPlatformResponse.model_validate(p) for p in platforms]


@router.get("/platforms/{platform_id}", response_model=LTIPlatformResponse)
async def get_platform(
    platform_id: int,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
):
    """Get a specific LTI platform"""
    stmt = select(LTIPlatform).where(LTIPlatform.id == platform_id)
    platform = session.execute(stmt).scalar_one_or_none()

    if not platform:
        raise HTTPException(status_code=404, detail="Platform not found")

    return LTIPlatformResponse.model_validate(platform)


@router.post("/platforms", response_model=LTIPlatformResponse, status_code=201)
async def create_platform(
    platform_data: LTIPlatformCreate,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
):
    """Create a new LTI platform"""
    # Check if platform already exists
    stmt = select(LTIPlatform).where(
        LTIPlatform.issuer == platform_data.issuer,
        LTIPlatform.client_id == platform_data.client_id,
    )
    existing = session.execute(stmt).scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=400,
            detail="Platform with this issuer and client_id already exists",
        )

    # Extract deployment IDs before creating platform
    primary_deployment_id = platform_data.primary_deployment_id
    additional_deployment_ids = platform_data.additional_deployment_ids

    # Create platform (exclude deployment fields)
    platform_dict = platform_data.model_dump(
        exclude={"primary_deployment_id", "additional_deployment_ids"}
    )
    platform = LTIPlatform(**platform_dict)
    session.add(platform)
    session.commit()
    session.refresh(platform)

    # Create primary deployment
    primary_deployment = LTIDeployment(
        platform_id=platform.id,
        deployment_id=primary_deployment_id,
        name="Primary Deployment",
    )
    session.add(primary_deployment)

    # Create additional deployments
    for i, deployment_id in enumerate(additional_deployment_ids, start=2):
        if deployment_id.strip():  # Only if not empty
            deployment = LTIDeployment(
                platform_id=platform.id,
                deployment_id=deployment_id.strip(),
                name=f"Deployment {i}",
            )
            session.add(deployment)

    session.commit()

    return LTIPlatformResponse.model_validate(platform)


@router.put("/platforms/{platform_id}", response_model=LTIPlatformResponse)
async def update_platform(
    platform_id: int,
    platform_data: LTIPlatformUpdate,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
):
    """Update an LTI platform"""
    stmt = select(LTIPlatform).where(LTIPlatform.id == platform_id)
    platform = session.execute(stmt).scalar_one_or_none()

    if not platform:
        raise HTTPException(status_code=404, detail="Platform not found")

    # Update fields
    for field, value in platform_data.model_dump(exclude_unset=True).items():
        setattr(platform, field, value)

    session.commit()
    session.refresh(platform)

    return LTIPlatformResponse.model_validate(platform)


@router.delete("/platforms/{platform_id}", status_code=204)
async def delete_platform(
    platform_id: int,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
):
    """Delete an LTI platform"""
    stmt = select(LTIPlatform).where(LTIPlatform.id == platform_id)
    platform = session.execute(stmt).scalar_one_or_none()

    if not platform:
        raise HTTPException(status_code=404, detail="Platform not found")

    session.delete(platform)
    session.commit()


# Deployment management


@router.get(
    "/platforms/{platform_id}/deployments",
    response_model=list[LTIDeploymentResponse],
)
async def list_deployments(
    platform_id: int,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
):
    """List deployments for a platform"""
    # Verify platform exists
    stmt = select(LTIPlatform).where(LTIPlatform.id == platform_id)
    platform = session.execute(stmt).scalar_one_or_none()

    if not platform:
        raise HTTPException(status_code=404, detail="Platform not found")

    stmt = select(LTIDeployment).where(LTIDeployment.platform_id == platform_id)
    deployments = session.execute(stmt).scalars().all()

    return [LTIDeploymentResponse.model_validate(d) for d in deployments]


@router.post(
    "/platforms/{platform_id}/deployments",
    response_model=LTIDeploymentResponse,
    status_code=201,
)
async def create_deployment(
    platform_id: int,
    deployment_data: LTIDeploymentCreate,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
):
    """Create a new deployment for a platform"""
    # Verify platform exists
    stmt = select(LTIPlatform).where(LTIPlatform.id == platform_id)
    platform = session.execute(stmt).scalar_one_or_none()

    if not platform:
        raise HTTPException(status_code=404, detail="Platform not found")

    # Check deployment_data.platform_id matches platform_id
    if deployment_data.platform_id != platform_id:
        raise HTTPException(
            status_code=400, detail="Platform ID in body must match URL parameter"
        )

    # Check if deployment already exists
    stmt = select(LTIDeployment).where(
        LTIDeployment.platform_id == platform_id,
        LTIDeployment.deployment_id == deployment_data.deployment_id,
    )
    existing = session.execute(stmt).scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=400, detail="Deployment with this ID already exists"
        )

    # Create deployment
    deployment = LTIDeployment(**deployment_data.model_dump())
    session.add(deployment)
    session.commit()
    session.refresh(deployment)

    return LTIDeploymentResponse.model_validate(deployment)


@router.delete("/deployments/{deployment_id}", status_code=204)
async def delete_deployment(
    deployment_id: int,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
):
    """Delete a deployment"""
    stmt = select(LTIDeployment).where(LTIDeployment.id == deployment_id)
    deployment = session.execute(stmt).scalar_one_or_none()

    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found")

    session.delete(deployment)
    session.commit()


# Workflow LTI settings


@router.get("/workflows/{workflow_id}/lti", response_model=WorkflowLTISettings)
async def get_workflow_lti_settings(
    workflow_id: int,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
):
    """Get LTI settings for a workflow"""
    stmt = select(Workflow).where(Workflow.id == workflow_id)
    workflow = session.execute(stmt).scalar_one_or_none()

    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    return WorkflowLTISettings(
        lti_enabled=workflow.lti_enabled,
        lti_title=workflow.lti_title,
        lti_description=workflow.lti_description,
    )


@router.put("/workflows/{workflow_id}/lti", response_model=WorkflowLTISettings)
async def update_workflow_lti_settings(
    workflow_id: int,
    lti_settings: WorkflowLTISettings,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
):
    """Update LTI settings for a workflow"""
    stmt = select(Workflow).where(Workflow.id == workflow_id)
    workflow = session.execute(stmt).scalar_one_or_none()

    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Update LTI settings
    workflow.lti_enabled = lti_settings.lti_enabled
    workflow.lti_title = lti_settings.lti_title
    workflow.lti_description = lti_settings.lti_description

    session.commit()
    session.refresh(workflow)

    return WorkflowLTISettings(
        lti_enabled=workflow.lti_enabled,
        lti_title=workflow.lti_title,
        lti_description=workflow.lti_description,
    )


@router.get("/workflows/lti-enabled", response_model=list[dict])
async def list_lti_enabled_workflows(
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
):
    """List all LTI-enabled workflows"""
    stmt = select(Workflow).where(Workflow.lti_enabled == True)
    workflows = session.execute(stmt).scalars().all()

    return [
        {
            "id": w.id,
            "slug": w.slug,
            "display_name": w.display_name,
            "lti_title": w.lti_title,
            "lti_description": w.lti_description,
        }
        for w in workflows
    ]
