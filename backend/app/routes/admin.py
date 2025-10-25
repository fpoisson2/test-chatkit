from __future__ import annotations

import datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..admin_settings import (
    get_thread_title_prompt_override,
    serialize_admin_settings,
    update_admin_settings,
)
from ..database import get_session
from ..dependencies import require_admin
from ..models import TelephonyRoute, User
from ..schemas import (
    AppSettingsResponse,
    AppSettingsUpdateRequest,
    TelephonyRouteCreateRequest,
    TelephonyRouteResponse,
    TelephonyRouteUpdateRequest,
    UserCreate,
    UserResponse,
    UserUpdate,
)
from ..security import hash_password

router = APIRouter()


@router.get("/api/admin/app-settings", response_model=AppSettingsResponse)
async def get_app_settings(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    override = get_thread_title_prompt_override(session)
    payload = serialize_admin_settings(override)
    return AppSettingsResponse.model_validate(payload)


@router.patch("/api/admin/app-settings", response_model=AppSettingsResponse)
async def patch_app_settings(
    payload: AppSettingsUpdateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    kwargs: dict[str, object] = {}
    if "thread_title_prompt" in payload.model_fields_set:
        kwargs["thread_title_prompt"] = payload.thread_title_prompt
    if "sip_trunk_uri" in payload.model_fields_set:
        kwargs["sip_trunk_uri"] = payload.sip_trunk_uri
    if "sip_trunk_username" in payload.model_fields_set:
        kwargs["sip_trunk_username"] = payload.sip_trunk_username
    if "sip_trunk_password" in payload.model_fields_set:
        kwargs["sip_trunk_password"] = payload.sip_trunk_password

    update_admin_settings(session, **kwargs)
    override = get_thread_title_prompt_override(session)
    serialized = serialize_admin_settings(override)
    return AppSettingsResponse.model_validate(serialized)


@router.get("/api/admin/users", response_model=list[UserResponse])
async def list_users(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    users = session.scalars(select(User).order_by(User.created_at.asc())).all()
    return users


@router.post(
    "/api/admin/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED
)
async def create_user(
    payload: UserCreate,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    email = payload.email.lower()
    existing = session.scalar(select(User).where(User.email == email))
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Un utilisateur avec cet e-mail existe déjà",
        )

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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Utilisateur introuvable"
        )

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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Utilisateur introuvable"
        )

    session.delete(user)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/api/admin/telephony-routes",
    response_model=list[TelephonyRouteResponse],
)
async def list_telephony_routes(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    routes = session.scalars(
        select(TelephonyRoute).order_by(TelephonyRoute.phone_number.asc())
    ).all()
    return routes


@router.post(
    "/api/admin/telephony-routes",
    response_model=TelephonyRouteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_telephony_route(
    payload: TelephonyRouteCreateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    existing = session.scalar(
        select(TelephonyRoute).where(
            TelephonyRoute.phone_number == payload.phone_number
        )
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Une route téléphonique existe déjà pour ce numéro",
        )

    route = TelephonyRoute(
        phone_number=payload.phone_number,
        workflow_slug=payload.workflow_slug,
        workflow_id=payload.workflow_id,
        metadata_=payload.metadata or {},
    )
    session.add(route)
    session.commit()
    session.refresh(route)
    return route


@router.patch(
    "/api/admin/telephony-routes/{route_id}",
    response_model=TelephonyRouteResponse,
)
async def update_telephony_route(
    route_id: int,
    payload: TelephonyRouteUpdateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    route = session.get(TelephonyRoute, route_id)
    if not route:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Route téléphonique introuvable",
        )

    updated = False
    if payload.phone_number and payload.phone_number != route.phone_number:
        existing = session.scalar(
            select(TelephonyRoute).where(
                TelephonyRoute.phone_number == payload.phone_number,
                TelephonyRoute.id != route.id,
            )
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Une route téléphonique existe déjà pour ce numéro",
            )
        route.phone_number = payload.phone_number
        updated = True
    if payload.workflow_slug is not None:
        route.workflow_slug = payload.workflow_slug
        updated = True
    if payload.workflow_id is not None:
        route.workflow_id = payload.workflow_id
        updated = True
    if payload.metadata is not None:
        route.metadata_ = payload.metadata
        updated = True

    if updated:
        route.updated_at = datetime.datetime.now(datetime.UTC)
        session.add(route)
        session.commit()
        session.refresh(route)

    return route


@router.delete(
    "/api/admin/telephony-routes/{route_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_telephony_route(
    route_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    route = session.get(TelephonyRoute, route_id)
    if not route:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Route téléphonique introuvable",
        )

    session.delete(route)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
