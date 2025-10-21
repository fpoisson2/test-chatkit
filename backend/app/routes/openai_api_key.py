from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import require_admin
from ..models import User
from ..schemas import ApiKeyStatusResponse, ApiKeyUpdateRequest
from ..secret_settings import get_openai_api_key_status, set_openai_api_key

router = APIRouter()


@router.get("/api/admin/openai-api-key", response_model=ApiKeyStatusResponse)
async def get_openai_api_key(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> ApiKeyStatusResponse:
    status_payload = get_openai_api_key_status(session)
    return ApiKeyStatusResponse.model_validate(status_payload)


@router.put("/api/admin/openai-api-key", response_model=ApiKeyStatusResponse)
async def put_openai_api_key(
    payload: ApiKeyUpdateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> ApiKeyStatusResponse:
    try:
        set_openai_api_key(session, payload.api_key)
    except ValueError as exc:  # pragma: no cover - validation gérée par Pydantic
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    status_payload = get_openai_api_key_status(session)
    return ApiKeyStatusResponse.model_validate(status_payload)
