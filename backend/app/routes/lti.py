"""Routes FastAPI dédiées à l'intégration LTI 1.3."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..database import get_session
from ..lti.service import LTIService
from ..schemas import TokenResponse

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
async def get_jwks(service: LTIService = Depends(_get_service)) -> dict[str, Any]:
    return service.get_tool_jwks()


@router.post("/api/lti/login")
async def lti_login(
    request: Request, service: LTIService = Depends(_get_service)
):
    params = await _extract_request_data(request)
    return service.initiate_login(params)


@router.post("/api/lti/launch", response_model=TokenResponse)
async def lti_launch(
    request: Request, service: LTIService = Depends(_get_service)
) -> TokenResponse:
    payload = await _extract_request_data(request)
    state = payload.get("state")
    id_token = payload.get("id_token")

    if not isinstance(state, str) or not isinstance(id_token, str):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Les champs state et id_token sont requis",
        )

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


@router.post("/api/lti/deep-link")
async def lti_deep_link(
    request: Request, service: LTIService = Depends(_get_service)
) -> dict[str, Any]:
    payload = await _extract_request_data(request)
    state = payload.get("state")
    id_token = payload.get("id_token")
    if not isinstance(state, str) or not isinstance(id_token, str):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Les champs state et id_token sont requis",
        )

    workflow_ids = _as_int_sequence(payload.get("workflow_ids"))
    workflow_slugs = _as_str_sequence(payload.get("workflow_slugs"))

    return service.handle_deep_link(
        state=state,
        id_token=id_token,
        workflow_ids=workflow_ids,
        workflow_slugs=workflow_slugs,
    )
