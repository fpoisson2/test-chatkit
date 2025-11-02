"""LTI 1.3 API routes"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..database import get_session
from ..lti.service import LTIService
from ..models import LTISession, LTIPlatform, Workflow
from ..schemas import (
    LTIDeepLinkRequest,
    LTIScoreUpdate,
    LTISessionResponse,
)
from ..security import create_access_token

router = APIRouter(prefix="/api/lti", tags=["lti"])


def get_lti_service(
    session: Session = Depends(get_session), settings: Settings = Depends(get_settings)
) -> LTIService:
    """Get LTI service instance"""
    # Construct base URL from settings
    base_url = settings.allowed_origins[0] if settings.allowed_origins else "http://localhost:3000"
    return LTIService(session, base_url)


@router.post("/login")
async def lti_login(
    iss: str = Form(...),
    login_hint: str = Form(...),
    target_link_uri: str = Form(...),
    lti_message_hint: str = Form(None),
    client_id: str = Form(...),
    lti_deployment_id: str = Form(None),
    lti_service: LTIService = Depends(get_lti_service),
):
    """
    LTI 1.3 OIDC Login Initiation
    This is the first step in the LTI launch flow
    """
    # Get platform
    platform = lti_service.get_platform(iss, client_id)
    if not platform:
        raise HTTPException(
            status_code=404,
            detail=f"Platform not found for issuer={iss}, client_id={client_id}",
        )

    # Generate OIDC auth response
    auth_url = lti_service.generate_oidc_auth_response(
        platform, login_hint, target_link_uri
    )

    # Redirect to platform's auth endpoint
    return RedirectResponse(url=auth_url, status_code=302)


@router.post("/launch")
async def lti_launch(
    request: Request,
    id_token: str = Form(...),
    state: str = Form(...),
    session: Session = Depends(get_session),
    lti_service: LTIService = Depends(get_lti_service),
):
    """
    LTI 1.3 Launch endpoint
    Handles both Resource Link launches and Deep Link launches
    """
    # Decode the id_token to get platform info
    try:
        # First decode without verification to get issuer
        import jwt as jwt_lib

        unverified = jwt_lib.decode(id_token, options={"verify_signature": False})
        issuer = unverified.get("iss")
        aud = unverified.get("aud")

        # Get platform
        platform = lti_service.get_platform(issuer, aud)
        if not platform:
            raise HTTPException(
                status_code=404, detail=f"Platform not found: {issuer}"
            )

        # Verify and decode JWT
        jwt_payload = lti_service.verify_and_decode_jwt(id_token, platform)

        # Parse launch data
        launch_data = lti_service.parse_launch_data(jwt_payload)

        # Get or create deployment
        deployment = lti_service.get_deployment(platform, launch_data.deployment_id)
        if not deployment:
            raise HTTPException(
                status_code=404,
                detail=f"Deployment not found: {launch_data.deployment_id}",
            )

        # Get or create user
        user = lti_service.get_or_create_lti_user(platform, launch_data)

        # Handle different message types
        if launch_data.message_type == LTIService.MESSAGE_TYPE_DEEP_LINK:
            # Deep Link Request - show workflow selection page
            lti_session_obj = lti_service.create_lti_session(
                user, platform, deployment, launch_data
            )

            # Create JWT token for the user
            token = create_access_token(user)

            # Redirect to deep link selection page
            frontend_url = lti_service.base_url
            return RedirectResponse(
                url=f"{frontend_url}/lti/deep-link?session_id={lti_session_obj.session_id}&token={token}",
                status_code=302,
            )

        elif launch_data.message_type == LTIService.MESSAGE_TYPE_RESOURCE_LINK:
            # Resource Link Request - launch specific workflow
            # Check if workflow_id is in custom params or query
            workflow_id = launch_data.custom.get("workflow_id")
            if not workflow_id:
                # Try to get from query params
                workflow_id = request.query_params.get("workflow_id")

            workflow = None
            if workflow_id:
                stmt = select(Workflow).where(
                    Workflow.id == int(workflow_id), Workflow.lti_enabled == True
                )
                workflow = session.execute(stmt).scalar_one_or_none()

            if not workflow:
                raise HTTPException(
                    status_code=404, detail="Workflow not found or not LTI-enabled"
                )

            # Create LTI session
            lti_session_obj = lti_service.create_lti_session(
                user, platform, deployment, launch_data, workflow
            )

            # Create JWT token for the user
            token = create_access_token(user)

            # Redirect to workflow page
            frontend_url = lti_service.base_url
            return RedirectResponse(
                url=f"{frontend_url}/lti/workflow/{workflow.slug}?session_id={lti_session_obj.session_id}&token={token}",
                status_code=302,
            )

        else:
            raise HTTPException(
                status_code=400, detail=f"Unsupported message type: {launch_data.message_type}"
            )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Launch failed: {str(e)}")


@router.get("/jwks/{platform_id}")
async def get_jwks(
    platform_id: int,
    session: Session = Depends(get_session),
    lti_service: LTIService = Depends(get_lti_service),
):
    """
    Get JWKS (JSON Web Key Set) for a platform
    This is used by the LMS to verify our signatures
    """
    stmt = select(LTIPlatform).where(LTIPlatform.id == platform_id)
    platform = session.execute(stmt).scalar_one_or_none()

    if not platform:
        raise HTTPException(status_code=404, detail="Platform not found")

    jwks = lti_service.get_public_jwks(platform)
    return JSONResponse(content=jwks)


@router.post("/deep-link/submit")
async def submit_deep_link(
    deep_link_request: LTIDeepLinkRequest,
    session_id: str,
    session: Session = Depends(get_session),
    lti_service: LTIService = Depends(get_lti_service),
):
    """
    Submit a deep link selection
    Creates a deep link JWT to send back to the LMS
    """
    # Get LTI session
    stmt = select(LTISession).where(LTISession.session_id == session_id)
    lti_session = session.execute(stmt).scalar_one_or_none()

    if not lti_session:
        raise HTTPException(status_code=404, detail="LTI session not found")

    if lti_session.message_type != LTIService.MESSAGE_TYPE_DEEP_LINK:
        raise HTTPException(
            status_code=400, detail="Session is not a deep link request"
        )

    # Get workflow
    stmt = select(Workflow).where(
        Workflow.id == deep_link_request.workflow_id, Workflow.lti_enabled == True
    )
    workflow = session.execute(stmt).scalar_one_or_none()

    if not workflow:
        raise HTTPException(
            status_code=404, detail="Workflow not found or not LTI-enabled"
        )

    # Create deep link response
    response = lti_service.create_deep_link_response(lti_session, workflow)

    return {
        "return_url": response["return_url"],
        "jwt": response["jwt"],
    }


@router.post("/grades/submit")
async def submit_grade(
    grade_request: LTIScoreUpdate,
    session: Session = Depends(get_session),
    lti_service: LTIService = Depends(get_lti_service),
):
    """
    Submit a grade to the LMS via AGS
    """
    # Get LTI session
    stmt = select(LTISession).where(LTISession.session_id == grade_request.session_id)
    lti_session = session.execute(stmt).scalar_one_or_none()

    if not lti_session:
        raise HTTPException(status_code=404, detail="LTI session not found")

    # Submit grade
    result = lti_service.submit_grade(
        lti_session, grade_request.score, grade_request.comment
    )

    return result


@router.get("/sessions/{session_id}")
async def get_lti_session(
    session_id: str,
    session: Session = Depends(get_session),
) -> LTISessionResponse:
    """Get LTI session details"""
    stmt = select(LTISession).where(LTISession.session_id == session_id)
    lti_session = session.execute(stmt).scalar_one_or_none()

    if not lti_session:
        raise HTTPException(status_code=404, detail="LTI session not found")

    return LTISessionResponse.model_validate(lti_session)


@router.get("/config")
async def get_lti_config(
    request: Request,
    lti_service: LTIService = Depends(get_lti_service),
):
    """
    Get LTI 1.3 configuration (for LMS registration)
    This provides the JSON configuration that can be used to register the tool
    """
    base_url = lti_service.base_url

    config = {
        "title": "ChatKit Workflows",
        "description": "Interactive AI-powered workflows for learning",
        "oidc_initiation_url": f"{base_url}/api/lti/login",
        "target_link_uri": f"{base_url}/api/lti/launch",
        "public_jwk_url": f"{base_url}/api/lti/jwks/{{platform_id}}",
        "scopes": [
            "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
            "https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly",
            "https://purl.imsglobal.org/spec/lti-ags/scope/score",
        ],
        "extensions": [
            {
                "platform": "canvas.instructure.com",
                "settings": {
                    "placements": [
                        {
                            "placement": "course_navigation",
                            "message_type": "LtiDeepLinkingRequest",
                            "enabled": True,
                        },
                        {
                            "placement": "assignment_selection",
                            "message_type": "LtiDeepLinkingRequest",
                            "enabled": True,
                        },
                    ]
                },
            }
        ],
    }

    return JSONResponse(content=config)
