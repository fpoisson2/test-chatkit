from __future__ import annotations

import asyncio
import datetime
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..admin_settings import (
    apply_runtime_model_overrides,
    get_thread_title_prompt_override,
    serialize_admin_settings,
    update_admin_settings,
)
from ..config import get_settings
from ..database import get_session
from ..dependencies import require_admin
from ..model_providers import configure_model_provider
from ..models import SipAccount, TelephonyRoute, User
from ..schemas import (
    AppSettingsResponse,
    AppSettingsUpdateRequest,
    SipAccountCreateRequest,
    SipAccountResponse,
    SipAccountUpdateRequest,
    TelephonyRouteCreateRequest,
    TelephonyRouteResponse,
    TelephonyRouteUpdateRequest,
    UserCreate,
    UserResponse,
    UserUpdate,
)
from ..security import hash_password

router = APIRouter()
logger = logging.getLogger(__name__)


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
    request: Request,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    kwargs: dict[str, object] = {}
    if "thread_title_prompt" in payload.model_fields_set:
        kwargs["thread_title_prompt"] = payload.thread_title_prompt
    if "thread_title_model" in payload.model_fields_set:
        kwargs["thread_title_model"] = payload.thread_title_model
    if "sip_trunk_uri" in payload.model_fields_set:
        kwargs["sip_trunk_uri"] = payload.sip_trunk_uri
    if "sip_trunk_username" in payload.model_fields_set:
        kwargs["sip_trunk_username"] = payload.sip_trunk_username
    if "sip_trunk_password" in payload.model_fields_set:
        kwargs["sip_trunk_password"] = payload.sip_trunk_password
    if "sip_contact_host" in payload.model_fields_set:
        kwargs["sip_contact_host"] = payload.sip_contact_host
    if "sip_contact_port" in payload.model_fields_set:
        kwargs["sip_contact_port"] = payload.sip_contact_port
    if "sip_contact_transport" in payload.model_fields_set:
        kwargs["sip_contact_transport"] = payload.sip_contact_transport
    if "model_provider" in payload.model_fields_set:
        kwargs["model_provider"] = payload.model_provider
    if "model_api_base" in payload.model_fields_set:
        kwargs["model_api_base"] = payload.model_api_base
    if "model_api_key" in payload.model_fields_set:
        kwargs["model_api_key"] = payload.model_api_key
    if "model_providers" in payload.model_fields_set:
        kwargs["model_providers"] = payload.model_providers

    try:
        result = update_admin_settings(session, **kwargs)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except SQLAlchemyError as exc:  # pragma: no cover - database failure
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Impossible d'enregistrer les paramètres",
        ) from exc

    runtime_settings = None

    if result.sip_changed:
        manager = getattr(request.app.state, "sip_registration", None)
        if manager is None:
            logger.warning(
                "Gestionnaire d'enregistrement SIP absent : "
                "impossible d'appliquer la nouvelle configuration",
            )
        else:
            try:
                await manager.apply_config_from_settings(session, result.settings)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # pragma: no cover - depends on SIP stack
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="La mise à jour de la configuration SIP a échoué",
                ) from exc

    if result.model_settings_changed:
        runtime_settings = apply_runtime_model_overrides(result.settings)

    if result.provider_changed or result.model_settings_changed:
        configure_model_provider(runtime_settings or get_settings())

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


# ========== SIP Accounts ==========


@router.get("/api/admin/sip-accounts", response_model=list[SipAccountResponse])
async def list_sip_accounts(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    """Récupère la liste de tous les comptes SIP."""
    accounts = session.scalars(
        select(SipAccount).order_by(SipAccount.is_default.desc(), SipAccount.label.asc())
    ).all()
    return accounts


class SipAccountAvailability(BaseModel):
    """Disponibilité d'un compte SIP pour association à un workflow."""

    id: int
    label: str
    is_active: bool
    is_available: bool
    assigned_workflow_id: int | None = None
    assigned_workflow_slug: str | None = None


@router.get(
    "/api/admin/sip-accounts/availability",
    response_model=list[SipAccountAvailability],
)
async def list_sip_accounts_availability(
    workflow_id: int | None = None,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    """Récupère la liste des comptes SIP avec leur disponibilité pour association.

    Args:
        workflow_id: ID du workflow pour lequel on vérifie la disponibilité.
            Si fourni, le compte associé à ce workflow sera marqué comme disponible.

    Returns:
        Liste des comptes SIP avec leur statut de disponibilité.
    """
    from ..models import Workflow, WorkflowDefinition

    # Récupérer tous les comptes SIP actifs
    accounts = session.scalars(
        select(SipAccount)
        .where(SipAccount.is_active == True)
        .order_by(SipAccount.is_default.desc(), SipAccount.label.asc())
    ).all()

    result = []
    for account in accounts:
        # Chercher si ce compte est déjà associé à un workflow
        assigned_definition = session.scalar(
            select(WorkflowDefinition)
            .where(
                WorkflowDefinition.sip_account_id == account.id,
                WorkflowDefinition.is_active == True,
            )
        )

        if assigned_definition:
            # Le compte est assigné, vérifier si c'est au workflow courant
            is_available = (
                workflow_id is not None
                and assigned_definition.workflow_id == workflow_id
            )

            # Récupérer le slug du workflow
            workflow = session.get(Workflow, assigned_definition.workflow_id)
            workflow_slug = workflow.slug if workflow else None

            result.append(
                SipAccountAvailability(
                    id=account.id,
                    label=account.label,
                    is_active=account.is_active,
                    is_available=is_available,
                    assigned_workflow_id=assigned_definition.workflow_id,
                    assigned_workflow_slug=workflow_slug,
                )
            )
        else:
            # Le compte n'est pas assigné, il est disponible
            result.append(
                SipAccountAvailability(
                    id=account.id,
                    label=account.label,
                    is_active=account.is_active,
                    is_available=True,
                    assigned_workflow_id=None,
                    assigned_workflow_slug=None,
                )
            )

    return result


@router.post(
    "/api/admin/sip-accounts",
    response_model=SipAccountResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_sip_account(
    payload: SipAccountCreateRequest,
    request: Request,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    """Crée un nouveau compte SIP."""
    # Si is_default est True, désactiver les autres comptes par défaut
    if payload.is_default:
        existing_defaults = session.scalars(
            select(SipAccount).where(SipAccount.is_default == True)
        ).all()
        for account in existing_defaults:
            account.is_default = False
            session.add(account)

    account = SipAccount(
        label=payload.label,
        trunk_uri=payload.trunk_uri,
        username=payload.username,
        password=payload.password,
        contact_host=payload.contact_host,
        contact_port=payload.contact_port,
        contact_transport=payload.contact_transport,
        is_default=payload.is_default,
        is_active=payload.is_active,
    )
    session.add(account)
    session.commit()
    session.refresh(account)

    # Recharger les comptes SIP dans le gestionnaire
    manager = getattr(request.app.state, "sip_registration", None)
    if manager is not None:
        try:
            await manager.load_accounts_from_db(session)
            logger.info("Comptes SIP rechargés après création")
        except Exception as exc:
            logger.exception("Erreur lors du rechargement des comptes SIP", exc_info=exc)

    return account


@router.patch("/api/admin/sip-accounts/{account_id}", response_model=SipAccountResponse)
async def update_sip_account(
    account_id: int,
    payload: SipAccountUpdateRequest,
    request: Request,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    """Met à jour un compte SIP existant."""
    account = session.get(SipAccount, account_id)
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compte SIP introuvable",
        )

    updated = False

    # Si on définit ce compte comme défaut, désactiver les autres
    if payload.is_default is True and not account.is_default:
        existing_defaults = session.scalars(
            select(SipAccount).where(
                SipAccount.is_default == True,
                SipAccount.id != account_id,
            )
        ).all()
        for other in existing_defaults:
            other.is_default = False
            session.add(other)
        account.is_default = True
        updated = True
    elif payload.is_default is False:
        account.is_default = False
        updated = True

    if payload.label is not None:
        account.label = payload.label
        updated = True
    if payload.trunk_uri is not None:
        account.trunk_uri = payload.trunk_uri
        updated = True
    if payload.username is not None:
        account.username = payload.username
        updated = True
    if payload.password is not None:
        account.password = payload.password
        updated = True
    if payload.contact_host is not None:
        account.contact_host = payload.contact_host
        updated = True
    if payload.contact_port is not None:
        account.contact_port = payload.contact_port
        updated = True
    if payload.contact_transport is not None:
        account.contact_transport = payload.contact_transport
        updated = True
    if payload.is_active is not None:
        account.is_active = payload.is_active
        updated = True

    if updated:
        account.updated_at = datetime.datetime.now(datetime.UTC)
        session.add(account)
        session.commit()
        session.refresh(account)

        # Recharger les comptes SIP dans le gestionnaire
        manager = getattr(request.app.state, "sip_registration", None)
        if manager is not None:
            try:
                await manager.load_accounts_from_db(session)
                logger.info("Comptes SIP rechargés après modification")
            except Exception as exc:
                logger.exception("Erreur lors du rechargement des comptes SIP", exc_info=exc)

    return account


@router.delete(
    "/api/admin/sip-accounts/{account_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_sip_account(
    account_id: int,
    request: Request,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    """Supprime un compte SIP."""
    account = session.get(SipAccount, account_id)
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compte SIP introuvable",
        )

    session.delete(account)
    session.commit()

    # Recharger les comptes SIP dans le gestionnaire
    manager = getattr(request.app.state, "sip_registration", None)
    if manager is not None:
        try:
            await manager.load_accounts_from_db(session)
            logger.info("Comptes SIP rechargés après suppression")
        except Exception as exc:
            logger.exception("Erreur lors du rechargement des comptes SIP", exc_info=exc)

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/api/admin/sip-accounts/migrate-from-global",
    response_model=SipAccountResponse,
    status_code=status.HTTP_201_CREATED,
)
async def migrate_global_sip_to_account(
    request: Request,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    """
    Migre les paramètres SIP globaux (legacy) vers un nouveau compte SIP.

    Cette fonction :
    1. Vérifie qu'aucun compte SIP n'existe déjà
    2. Récupère les paramètres SIP globaux depuis app_settings
    3. Crée un compte SIP avec ces paramètres
    4. Nettoie les paramètres globaux
    """
    # Vérifier qu'il n'y a pas déjà de comptes SIP
    existing_count = session.scalar(
        select(SipAccount).with_only_columns(SipAccount.id).limit(1)
    )
    if existing_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Des comptes SIP existent déjà. La migration n'est possible que s'il n'y a aucun compte.",
        )

    # Récupérer les paramètres globaux
    override = get_thread_title_prompt_override(session)
    settings_data = serialize_admin_settings(override)

    # Vérifier qu'il y a des paramètres SIP à migrer
    if not settings_data.get("sip_trunk_uri"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Aucun paramètre SIP global trouvé à migrer.",
        )

    # Extraire les paramètres
    trunk_uri_raw = settings_data.get("sip_trunk_uri", "")
    username = settings_data.get("sip_trunk_username")
    password = settings_data.get("sip_trunk_password")
    contact_host = settings_data.get("sip_contact_host")
    contact_port = settings_data.get("sip_contact_port")
    contact_transport = settings_data.get("sip_contact_transport", "udp")

    # Construire un URI SIP valide
    # Si trunk_uri ne commence pas par sip: ou sips:, on construit l'URI
    trunk_uri = trunk_uri_raw.strip()
    if not trunk_uri.lower().startswith(("sip:", "sips:")):
        # Format legacy: probablement juste l'host
        if username:
            trunk_uri = f"sip:{username}@{trunk_uri}"
        else:
            trunk_uri = f"sip:chatkit@{trunk_uri}"

    # Créer le compte SIP
    account = SipAccount(
        label="Compte migré (legacy)",
        trunk_uri=trunk_uri,
        username=username,
        password=password,
        contact_host=contact_host,
        contact_port=contact_port,
        contact_transport=contact_transport,
        is_default=True,
        is_active=True,
    )
    session.add(account)

    # Nettoyer les paramètres globaux
    update_admin_settings(
        session,
        sip_trunk_uri=None,
        sip_trunk_username=None,
        sip_trunk_password=None,
        sip_contact_host=None,
        sip_contact_port=None,
        sip_contact_transport=None,
    )

    session.commit()
    session.refresh(account)

    # Recharger les comptes SIP dans le gestionnaire
    manager = getattr(request.app.state, "sip_registration", None)
    if manager is not None:
        try:
            await manager.load_accounts_from_db(session)
            logger.info("Comptes SIP rechargés après migration")
        except Exception as exc:
            logger.exception("Erreur lors du rechargement des comptes SIP", exc_info=exc)

    return account
