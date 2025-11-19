"""Routes FastAPI dédiées à l'intégration LTI 1.3."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..database import get_session
from ..lti.service import LTIService

router = APIRouter()


def _get_service(session: Session = Depends(get_session)) -> LTIService:
    return LTIService(session=session)


async def _extract_request_data(request: Request) -> dict[str, Any]:
    content_type = request.headers.get("content-type", "").lower()
    if "application/json" in content_type:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Corps JSON invalide"
            )
        return payload

    form = await request.form()
    data: dict[str, Any] = {}
    for key in form.keys():
        values = form.getlist(key)
        if len(values) == 1:
            data[key] = values[0]
        else:
            data[key] = values
    return data


@router.get("/.well-known/jwks.json")
async def get_jwks(session: Session = Depends(get_session)) -> dict[str, Any]:
    """Public endpoint for JWKS - must be accessible without authentication.

    This endpoint exposes the tool's public key for JWT signature verification by LMS platforms.
    The session dependency is required to instantiate LTIService, but the JWKS generation
    itself does not use the database.
    """
    service = LTIService(session=session)
    return service.get_tool_jwks()


@router.post("/api/lti/login")
async def lti_login(
    request: Request, service: LTIService = Depends(_get_service)
):
    params = await _extract_request_data(request)
    return service.initiate_login(params)


@router.post("/api/lti/launch")
async def lti_launch(
    request: Request, service: LTIService = Depends(_get_service)
):
    import jwt
    import logging
    from urllib.parse import urlencode
    from fastapi.responses import RedirectResponse

    logger = logging.getLogger(__name__)

    payload = await _extract_request_data(request)
    state = payload.get("state")
    id_token = payload.get("id_token")

    if not isinstance(state, str) or not isinstance(id_token, str):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Les champs state et id_token sont requis",
        )

    # Decode id_token without verification to check message type
    # Full verification will be done by the service methods
    message_type = None
    try:
        unverified_payload = jwt.decode(
            id_token,
            options={
                "verify_signature": False,
                "verify_aud": False,
                "verify_iat": False,
                "verify_exp": False,
                "verify_nbf": False,
                "verify_iss": False,
                "verify_at_hash": False
            }
        )
        message_type = unverified_payload.get(
            "https://purl.imsglobal.org/spec/lti/claim/message_type"
        )
        logger.info(
            "LTI launch received with message_type: %r",
            message_type
        )
    except Exception as e:
        # If we can't decode, fall back to normal launch
        logger.warning(
            "Could not decode id_token to check message type: %s. "
            "Falling back to normal resource launch.",
            str(e)
        )

    # Route to Deep Linking if that's the message type
    if message_type == "LtiDeepLinkingRequest":
        logger.info("Routing to deep linking selection page")
        # Redirect to deep linking selection page with state and id_token
        # Use absolute URL to ensure proper routing through reverse proxy
        base_url = f"{request.url.scheme}://{request.url.netloc}"
        params = urlencode({"state": state, "id_token": id_token})
        redirect_url = f"{base_url}/lti/deep-link?{params}"
        logger.info("Redirecting to deep link page: %s", redirect_url)
        return RedirectResponse(
            url=redirect_url,
            status_code=status.HTTP_302_FOUND
        )

    # Otherwise, proceed with normal resource link launch
    logger.info("Processing as normal resource link launch")
    return service.complete_launch(state=state, id_token=id_token)


def _as_int_sequence(value: Any) -> list[int]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        values = value
    else:
        values = [value]
    result: list[int] = []
    for item in values:
        try:
            result.append(int(item))
        except (TypeError, ValueError):
            continue
    return result


def _as_str_sequence(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        values = value
    else:
        values = [value]
    return [str(item) for item in values if isinstance(item, str) and item]


@router.get("/api/lti/registrations")
async def list_lti_registrations(session: Session = Depends(get_session)) -> list[dict[str, Any]]:
    """Liste toutes les registrations LTI disponibles."""
    from ..models import LTIRegistration
    from sqlalchemy import select

    registrations = session.scalars(select(LTIRegistration)).all()

    return [
        {
            "id": reg.id,
            "issuer": reg.issuer,
            "client_id": reg.client_id,
        }
        for reg in registrations
    ]


@router.get("/api/lti/workflows")
async def list_lti_workflows(
    issuer: str | None = None,
    session: Session = Depends(get_session)
) -> list[dict[str, Any]]:
    """Liste tous les workflows disponibles pour LTI Deep Linking.

    Args:
        issuer: Optionnel. Si fourni, ne retourne que les workflows autorisés pour cet issuer.
    """
    from ..models import Workflow, LTIRegistration, workflow_lti_registrations
    from sqlalchemy import select

    query = (
        select(Workflow)
        .where(Workflow.active_version_id.is_not(None))
    )

    if issuer:
        # Filter workflows authorized for this specific issuer
        query = query.join(
            workflow_lti_registrations,
            Workflow.id == workflow_lti_registrations.c.workflow_id
        ).join(
            LTIRegistration,
            workflow_lti_registrations.c.lti_registration_id == LTIRegistration.id
        ).where(LTIRegistration.issuer == issuer)
    else:
        # No issuer specified, fall back to lti_enabled flag
        query = query.where(Workflow.lti_enabled == True)

    workflows = session.scalars(query).all()

    return [
        {
            "id": w.id,
            "slug": w.slug,
            "display_name": w.display_name,
            "description": w.description,
        }
        for w in workflows
    ]


@router.get("/api/lti/current-workflow")
async def get_current_lti_workflow(
    session: Session = Depends(get_session)
) -> dict[str, Any] | None:
    """Get the workflow associated with the current user's LTI session.

    DEPRECATED: This endpoint is no longer used. The workflow is now passed
    directly in the LTI launch URL and stored in localStorage on the frontend.
    This endpoint remains for backward compatibility only.

    This endpoint can be called without authentication and will return None
    if the user is not authenticated or not an LTI user.
    """
    from ..dependencies import get_optional_user
    from ..models import LTIUserSession
    from sqlalchemy import select, desc

    # Try to get current user (optional, won't raise if not authenticated)
    try:
        user = await get_optional_user(None, session)
    except Exception:
        return None

    if not user or not user.is_lti:
        return None

    # Find the most recent LTI session for this user
    lti_session = session.scalar(
        select(LTIUserSession)
        .where(LTIUserSession.user_id == user.id)
        .order_by(desc(LTIUserSession.launched_at))
        .limit(1)
    )

    if not lti_session or not lti_session.resource_link:
        return None

    workflow = lti_session.resource_link.workflow
    if not workflow or workflow.active_version_id is None:
        return None

    return {
        "id": workflow.id,
        "slug": workflow.slug,
        "display_name": workflow.display_name,
        "description": workflow.description,
        "lti_enabled": workflow.lti_enabled,
        "lti_show_sidebar": workflow.lti_show_sidebar,
        "lti_show_header": workflow.lti_show_header,
        "lti_enable_history": workflow.lti_enable_history,
    }


@router.post("/api/lti/deep-link")
async def lti_deep_link(
    request: Request, service: LTIService = Depends(_get_service)
) -> dict[str, Any]:
    import logging
    from fastapi.responses import RedirectResponse
    from urllib.parse import urlencode

    logger = logging.getLogger(__name__)
    logger.info("Deep link endpoint called")

    payload = await _extract_request_data(request)
    state = payload.get("state")
    id_token = payload.get("id_token")

    logger.info("Deep link parameters: state=%s, id_token present=%s",
                bool(state), bool(id_token))
    if not isinstance(state, str) or not isinstance(id_token, str):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Les champs state et id_token sont requis",
        )

    workflow_ids = _as_int_sequence(payload.get("workflow_ids"))
    workflow_slugs = _as_str_sequence(payload.get("workflow_slugs"))

    # Si aucun workflow n'est sélectionné, rediriger vers la page de sélection
    if not workflow_ids and not workflow_slugs:
        # Use absolute URL to ensure proper routing through reverse proxy
        base_url = f"{request.url.scheme}://{request.url.netloc}"
        params = urlencode({"state": state, "id_token": id_token})
        redirect_url = f"{base_url}/lti/deep-link?{params}"
        logger.info("No workflows selected, redirecting to selection page: %s", redirect_url)
        return RedirectResponse(
            url=redirect_url,
            status_code=status.HTTP_302_FOUND
        )

    # Sinon, traiter la sélection
    return service.handle_deep_link(
        state=state,
        id_token=id_token,
        workflow_ids=workflow_ids,
        workflow_slugs=workflow_slugs,
    )
