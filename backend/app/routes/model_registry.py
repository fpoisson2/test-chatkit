import datetime
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_session
from ..dependencies import get_current_user, require_admin
from ..models import AvailableModel, User
from ..schemas import (
    AvailableModelCreateRequest,
    AvailableModelResponse,
    AvailableModelUpdateRequest,
    ModelInfoResponse,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/api/models", response_model=list[AvailableModelResponse])
async def list_models(
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
) -> list[AvailableModel]:
    models = session.scalars(
        select(AvailableModel).order_by(
            AvailableModel.display_name.asc(), AvailableModel.name.asc()
        )
    ).all()
    return models


@router.get("/api/admin/models", response_model=list[AvailableModelResponse])
async def list_admin_models(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[AvailableModel]:
    models = session.scalars(
        select(AvailableModel).order_by(
            AvailableModel.display_name.asc(), AvailableModel.name.asc()
        )
    ).all()
    return models


@router.post(
    "/api/admin/models",
    response_model=AvailableModelResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_model(
    payload: AvailableModelCreateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> AvailableModel:
    existing = session.scalar(
        select(AvailableModel).where(AvailableModel.name == payload.name)
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Un modèle avec ce nom existe déjà",
        )

    now = datetime.datetime.now(datetime.UTC)
    model = AvailableModel(
        name=payload.name,
        display_name=payload.display_name,
        description=payload.description,
        provider_id=payload.provider_id,
        provider_slug=payload.provider_slug,
        supports_reasoning=payload.supports_reasoning,
        created_at=now,
        updated_at=now,
    )
    session.add(model)
    session.commit()
    session.refresh(model)
    return model


@router.patch(
    "/api/admin/models/{model_id}",
    response_model=AvailableModelResponse,
)
async def update_model(
    model_id: int,
    payload: AvailableModelUpdateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> AvailableModel:
    model = session.get(AvailableModel, model_id)
    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Modèle introuvable"
        )

    update_data = payload.model_dump(exclude_unset=True)

    if "name" in update_data:
        existing = session.scalar(
            select(AvailableModel)
            .where(AvailableModel.name == update_data["name"])
            .where(AvailableModel.id != model_id)
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Un modèle avec ce nom existe déjà",
            )
        model.name = update_data["name"]

    if "display_name" in update_data:
        model.display_name = update_data["display_name"]

    if "description" in update_data:
        model.description = update_data["description"]

    provider_id = model.provider_id
    provider_slug = model.provider_slug

    if "provider_id" in update_data:
        provider_id = update_data["provider_id"]

    if "provider_slug" in update_data:
        provider_slug = update_data["provider_slug"]

    if provider_id is not None and provider_slug is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="provider_slug doit être fourni lorsque provider_id est défini",
        )

    model.provider_id = provider_id
    model.provider_slug = provider_slug

    if "supports_reasoning" in update_data:
        model.supports_reasoning = update_data["supports_reasoning"]

    session.commit()
    session.refresh(model)
    return model


@router.delete("/api/admin/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(
    model_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> Response:
    model = session.get(AvailableModel, model_id)
    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Modèle introuvable"
        )

    session.delete(model)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/api/admin/models/info", response_model=ModelInfoResponse)
async def list_model_info(
    litellm_model_id: str | None = None,
    _: User = Depends(require_admin),
) -> dict:
    settings = get_settings()
    if settings.model_provider != "litellm":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Le fournisseur de modèles actif n'est pas LiteLLM.",
        )
    if not settings.model_api_base:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MODEL_API_BASE n'est pas configuré.",
        )
    if not settings.model_api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Clé API LiteLLM manquante.",
        )

    params: dict[str, str] = {}
    if litellm_model_id:
        params["litellm_model_id"] = litellm_model_id

    headers = {
        "accept": "application/json",
        "x-litellm-api-key": settings.model_api_key,
        "Authorization": f"Bearer {settings.model_api_key}",
    }

    try:
        async with httpx.AsyncClient(
            base_url=settings.model_api_base, timeout=httpx.Timeout(10.0)
        ) as client:
            response = await client.get(
                "/v1/model/info",
                headers=headers,
                params=params or None,
            )
    except httpx.RequestError as exc:
        logger.error("LiteLLM model info request failed", exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Impossible de joindre le proxy LiteLLM.",
        ) from exc

    if response.status_code >= 400:
        try:
            detail = response.json()
        except ValueError:
            detail = response.text
        raise HTTPException(status_code=response.status_code, detail=detail)

    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Réponse LiteLLM invalide.",
        ) from exc

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Réponse LiteLLM inattendue.",
        )

    return payload
