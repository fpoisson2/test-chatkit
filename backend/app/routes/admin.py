from __future__ import annotations

import datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import require_admin
from ..models import AccessibleModel, User
from ..schemas import (
    AccessibleModelCreate,
    AccessibleModelResponse,
    AccessibleModelUpdate,
    UserCreate,
    UserResponse,
    UserUpdate,
)
from ..security import hash_password

router = APIRouter()


@router.get("/api/admin/users", response_model=list[UserResponse])
async def list_users(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    users = session.scalars(select(User).order_by(User.created_at.asc())).all()
    return users


@router.post("/api/admin/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    email = payload.email.lower()
    existing = session.scalar(select(User).where(User.email == email))
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Un utilisateur avec cet e-mail existe déjà")

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        is_admin=payload.is_admin,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@router.patch("/api/admin/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    payload: UserUpdate,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utilisateur introuvable")

    updated = False
    if payload.password:
        user.password_hash = hash_password(payload.password)
        updated = True
    if payload.is_admin is not None:
        user.is_admin = payload.is_admin
        updated = True

    if updated:
        user.updated_at = datetime.datetime.now(datetime.UTC)
        session.add(user)
        session.commit()
        session.refresh(user)

    return user


@router.delete("/api/admin/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utilisateur introuvable")

    session.delete(user)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/api/admin/models", response_model=list[AccessibleModelResponse])
async def list_accessible_models(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    models = session.scalars(
        select(AccessibleModel).order_by(AccessibleModel.created_at.asc())
    ).all()
    return models


@router.post("/api/admin/models", response_model=AccessibleModelResponse, status_code=status.HTTP_201_CREATED)
async def create_accessible_model(
    payload: AccessibleModelCreate,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Le nom du modèle est requis")

    existing = session.scalar(select(AccessibleModel).where(AccessibleModel.name == name))
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ce modèle est déjà enregistré")

    display_name = payload.display_name.strip() if payload.display_name else None

    model = AccessibleModel(
        name=name,
        display_name=display_name,
        supports_reasoning=payload.supports_reasoning,
    )
    session.add(model)
    session.commit()
    session.refresh(model)
    return model


@router.patch("/api/admin/models/{model_id}", response_model=AccessibleModelResponse)
async def update_accessible_model(
    model_id: int,
    payload: AccessibleModelUpdate,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    model = session.get(AccessibleModel, model_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Modèle introuvable")

    updated = False

    if payload.display_name is not None:
        model.display_name = payload.display_name.strip() or None
        updated = True

    if payload.supports_reasoning is not None:
        model.supports_reasoning = payload.supports_reasoning
        updated = True

    if updated:
        model.updated_at = datetime.datetime.now(datetime.UTC)
        session.add(model)
        session.commit()
        session.refresh(model)

    return model


@router.delete("/api/admin/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_accessible_model(
    model_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    model = session.get(AccessibleModel, model_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Modèle introuvable")

    session.delete(model)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
