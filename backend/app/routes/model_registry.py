import datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import get_current_user, require_admin
from ..models import AvailableModel, User
from ..schemas import (
    AvailableModelCreateRequest,
    AvailableModelResponse,
    AvailableModelUpdateRequest,
)

router = APIRouter()


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
