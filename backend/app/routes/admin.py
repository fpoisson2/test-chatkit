from __future__ import annotations

import asyncio
import datetime
import json
import logging
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..admin_settings import (
    apply_runtime_model_overrides,
    get_thread_title_prompt_override,
    serialize_admin_settings,
    serialize_appearance_settings,
    update_admin_settings,
    update_appearance_settings,
)
from ..config import get_settings
from ..database import get_session, SessionLocal
from ..dependencies import require_admin
from ..mcp.server_service import McpServerService
from ..model_providers import configure_model_provider
from ..models import Language, LanguageGenerationTask, SipAccount, TelephonyRoute, User
from ..schemas import (
    AppSettingsResponse,
    AppSettingsUpdateRequest,
    McpServerCreateRequest,
    McpServerResponse,
    McpServerUpdateRequest,
    AppearanceSettingsResponse,
    AppearanceSettingsUpdateRequest,
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


@router.get(
    "/api/admin/appearance-settings",
    response_model=AppearanceSettingsResponse,
)
async def get_appearance_settings_admin(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    override = get_thread_title_prompt_override(session)
    payload = serialize_appearance_settings(override)
    return AppearanceSettingsResponse.model_validate(payload)


@router.patch(
    "/api/admin/appearance-settings",
    response_model=AppearanceSettingsResponse,
)
async def patch_appearance_settings(
    payload: AppearanceSettingsUpdateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    kwargs: dict[str, object] = {}
    if "color_scheme" in payload.model_fields_set:
        kwargs["color_scheme"] = payload.color_scheme
    if "accent_color" in payload.model_fields_set:
        kwargs["accent_color"] = payload.accent_color
    if "use_custom_surface_colors" in payload.model_fields_set:
        kwargs["use_custom_surface_colors"] = payload.use_custom_surface_colors
    if "surface_hue" in payload.model_fields_set:
        kwargs["surface_hue"] = payload.surface_hue
    if "surface_tint" in payload.model_fields_set:
        kwargs["surface_tint"] = payload.surface_tint
    if "surface_shade" in payload.model_fields_set:
        kwargs["surface_shade"] = payload.surface_shade
    if "heading_font" in payload.model_fields_set:
        kwargs["heading_font"] = payload.heading_font
    if "body_font" in payload.model_fields_set:
        kwargs["body_font"] = payload.body_font
    if "start_screen_greeting" in payload.model_fields_set:
        kwargs["start_screen_greeting"] = payload.start_screen_greeting
    if "start_screen_prompt" in payload.model_fields_set:
        kwargs["start_screen_prompt"] = payload.start_screen_prompt
    if "start_screen_placeholder" in payload.model_fields_set:
        kwargs["start_screen_placeholder"] = payload.start_screen_placeholder
    if "start_screen_disclaimer" in payload.model_fields_set:
        kwargs["start_screen_disclaimer"] = payload.start_screen_disclaimer

    try:
        settings = update_appearance_settings(session, **kwargs)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except SQLAlchemyError as exc:  # pragma: no cover - database failure
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Impossible d'enregistrer l'apparence",
        ) from exc

    serialized = serialize_appearance_settings(settings)
    return AppearanceSettingsResponse.model_validate(serialized)


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


# ========== MCP Servers ==========


@router.get("/api/admin/mcp-servers", response_model=list[McpServerResponse])
async def list_mcp_servers(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    service = McpServerService(session)
    return service.list_servers()


@router.post(
    "/api/admin/mcp-servers",
    response_model=McpServerResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_mcp_server(
    payload: McpServerCreateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    service = McpServerService(session)
    server = await service.create_server(payload)
    return server


@router.patch(
    "/api/admin/mcp-servers/{server_id}",
    response_model=McpServerResponse,
)
async def update_mcp_server(
    server_id: int,
    payload: McpServerUpdateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    service = McpServerService(session)
    server = await service.update_server(server_id, payload)
    return server


@router.delete(
    "/api/admin/mcp-servers/{server_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_mcp_server(
    server_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    service = McpServerService(session)
    service.delete_server(server_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ========== SIP Accounts ==========


@router.get("/api/admin/sip-accounts", response_model=list[SipAccountResponse])
async def list_sip_accounts(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    """Récupère la liste de tous les comptes SIP."""
    accounts = session.scalars(
        select(SipAccount).order_by(
            SipAccount.is_default.desc(), SipAccount.label.asc()
        )
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
        .where(SipAccount.is_active)
        .order_by(SipAccount.is_default.desc(), SipAccount.label.asc())
    ).all()

    result = []
    for account in accounts:
        # Chercher si ce compte est déjà associé à un workflow
        assigned_definition = session.scalar(
            select(WorkflowDefinition)
            .where(
                WorkflowDefinition.sip_account_id == account.id,
                WorkflowDefinition.is_active,
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
            select(SipAccount).where(SipAccount.is_default)
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
            logger.exception(
                "Erreur lors du rechargement des comptes SIP", exc_info=exc
            )

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
                SipAccount.is_default,
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
                logger.exception(
                    "Erreur lors du rechargement des comptes SIP", exc_info=exc
                )

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
            logger.exception(
                "Erreur lors du rechargement des comptes SIP", exc_info=exc
            )

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
            detail=(
                "Des comptes SIP existent déjà. La migration n'est possible que s'il "
                "n'y a aucun compte."
            ),
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
            logger.exception(
                "Erreur lors du rechargement des comptes SIP", exc_info=exc
            )

    return account


# ============================================================================
# Language Management Endpoints
# ============================================================================

class LanguageResponse(BaseModel):
    code: str
    name: str
    translationFile: str
    keysCount: int
    totalKeys: int
    fileExists: bool


class LanguageGenerateRequest(BaseModel):
    code: str
    name: str
    model: str | None = None
    provider_id: str | None = None
    provider_slug: str | None = None
    custom_prompt: str | None = None
    save_to_db: bool = False  # Sauvegarder en BD en plus du téléchargement


class LanguagesListResponse(BaseModel):
    languages: list[LanguageResponse]


class TaskStartedResponse(BaseModel):
    task_id: str
    status: str
    message: str


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str  # pending, running, completed, failed
    progress: int  # 0-100
    error_message: str | None = None
    created_at: str
    completed_at: str | None = None
    language_id: int | None = None
    can_download: bool


class StoredLanguageResponse(BaseModel):
    id: int
    code: str
    name: str
    created_at: str
    updated_at: str


class StoredLanguagesListResponse(BaseModel):
    languages: list[StoredLanguageResponse]


class GeneratedFileResponse(BaseModel):
    filename: str
    content: str
    instructions: str


@router.get("/api/admin/languages", response_model=LanguagesListResponse)
async def list_languages(_admin: User = Depends(require_admin)):
    """
    Liste toutes les langues disponibles dans l'interface.
    """
    import os
    import json
    import re
    from pathlib import Path

    try:
        # Chemin vers le dossier des traductions
        # Le frontend est monté en lecture seule dans /frontend via docker-compose
        i18n_path = Path("/frontend/src/i18n")

        logger.info(f"Looking for translations at: {i18n_path}")

        if not i18n_path.exists():
            logger.error(f"i18n directory does not exist at {i18n_path}")
            raise HTTPException(
                status_code=500,
                detail=f"Translation directory not found at {i18n_path}"
            )

        languages = []

        # Charger le fichier principal pour obtenir les langues définies
        main_file = i18n_path / "translations.ts"

        if not main_file.exists():
            logger.error(f"Main translations file does not exist at {main_file}")
            raise HTTPException(
                status_code=500,
                detail=f"Main translations file not found at {main_file}"
            )

        content = main_file.read_text()
        logger.debug(f"Read {len(content)} characters from translations.ts")

        # Extraire les codes de langues de AVAILABLE_LANGUAGES
        pattern = r'code:\s*"([a-z]{2})"'
        codes = re.findall(pattern, content)

        logger.info(f"Found language codes: {codes}")

        if not codes:
            logger.warning("No language codes found in translations.ts")

        # Pour chaque code, vérifier si le fichier existe
        for code in codes:
            translation_file = f"translations.{code}.ts"
            file_path = i18n_path / translation_file
            file_exists = file_path.exists()

            logger.debug(f"Checking {translation_file}: exists={file_exists}")

            # Compter les clés de traduction
            keys_count = 0
            if file_exists:
                file_content = file_path.read_text()
                # Compter les lignes qui contiennent des clés de traduction (format: "key": "value")
                keys_count = len(re.findall(r'^\s*"[^"]+"\s*:\s*', file_content, re.MULTILINE))

            # Obtenir le nom de la langue depuis le fichier de traductions
            name = code.upper()
            if file_exists:
                file_content = file_path.read_text()
                name_match = re.search(rf'"language\.name\.{code}"\s*:\s*"([^"]+)"', file_content)
                if name_match:
                    name = name_match.group(1)

            # Compter le total de clés (on utilise le fichier anglais comme référence)
            total_keys = 0
            en_file = i18n_path / "translations.en.ts"
            if en_file.exists():
                en_content = en_file.read_text()
                total_keys = len(re.findall(r'^\s*"[^"]+"\s*:\s*', en_content, re.MULTILINE))

            languages.append(
                LanguageResponse(
                    code=code,
                    name=name,
                    translationFile=translation_file,
                    keysCount=keys_count,
                    totalKeys=total_keys,
                    fileExists=file_exists,
                )
            )

        logger.info(f"Returning {len(languages)} languages")
        return LanguagesListResponse(languages=languages)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to list languages: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list languages: {str(e)}"
        )



async def _generate_language_background(
    task_id: str,
    code: str,
    name: str,
    model_name: str | None,
    provider_id: str | None,
    provider_slug: str | None,
    custom_prompt: str | None,
    save_to_db: bool
):
    """
    Génère une langue en background et met à jour la tâche.

    Steps:
    1. Charger le modèle et provider (copier de l'endpoint actuel)
    2. Extraire les traductions EN (copier de l'endpoint actuel)
    3. Mettre à jour task.status = "running", task.progress = 10
    4. Créer un Pydantic model dynamique pour structured output
    5. Créer Agent avec le model dynamique en output_type
    6. Exécuter avec Runner.run()
    7. Mettre à jour task.progress = 80
    8. Si save_to_db: créer/update Language en BD
    9. Générer file_content (format .ts)
    10. Sauvegarder task.file_content, task.language_id
    11. Mettre à jour task.status = "completed", task.progress = 100

    En cas d'erreur:
    - task.status = "failed"
    - task.error_message = str(e)
    - task.progress = 0
    """
    try:
        # Utiliser SessionLocal pour créer une session dans le background task
        with SessionLocal() as session:
            # Charger la tâche
            task = session.scalar(
                select(LanguageGenerationTask).where(LanguageGenerationTask.task_id == task_id)
            )
            if not task:
                logger.error(f"Task {task_id} not found in database")
                return

            try:
                # Étape 1: Charger les traductions anglaises
                i18n_path = Path("/frontend/src/i18n")
                en_file = i18n_path / "translations.en.ts"

                if not en_file.exists():
                    raise ValueError("Source language file (English) not found")

                en_content = en_file.read_text()
                pattern = r'"([^"]+)"\s*:\s*"([^"]*(?:\\.[^"]*)*)"'
                matches = re.findall(pattern, en_content)

                if not matches:
                    raise ValueError("No translations found in source file")

                en_translations = {key: value for key, value in matches}

                # Mettre à jour: status = running, progress = 10
                task.status = "running"
                task.progress = 10
                session.commit()

                logger.info(f"Task {task_id}: Starting translation for {code} ({name}) with {len(en_translations)} keys")

                # Étape 2: Charger le modèle et provider
                from agents import Agent, Runner, RunConfig
                from ..models import AvailableModel
                from ..chatkit.agent_registry import get_agent_provider_binding

                if model_name:
                    query = select(AvailableModel).where(AvailableModel.name == model_name)
                    available_model = session.scalar(query)
                    if not available_model:
                        raise ValueError(f"Model '{model_name}' not found in database")
                else:
                    available_model = session.scalar(
                        select(AvailableModel).order_by(AvailableModel.id).limit(1)
                    )
                    if not available_model:
                        raise ValueError("No models configured in the database")

                model_name = available_model.name

                # Résoudre le provider
                if provider_id or provider_slug:
                    provider_id_used = provider_id
                    provider_slug_used = provider_slug
                else:
                    provider_id_used = None
                    provider_slug_used = available_model.provider_slug

                provider_binding = get_agent_provider_binding(provider_id_used, provider_slug_used)
                if not provider_binding:
                    raise ValueError(f"Failed to get provider binding for model '{model_name}'")

                # Étape 3: Préparer le prompt
                translations_json = json.dumps(en_translations, ensure_ascii=False, indent=2)

                if custom_prompt:
                    prompt = custom_prompt.replace("{{language_name}}", name)
                    prompt = prompt.replace("{{language_code}}", code)
                    prompt = prompt.replace("{{translations_json}}", translations_json)
                else:
                    prompt = f"""You are a professional translator. Translate the following JSON object containing interface strings from English to {name} ({code}).

IMPORTANT RULES:
1. Keep all keys exactly as they are (do not translate keys)
2. Only translate the values
3. Preserve any placeholders like {{{{variable}}}}, {{{{count}}}}, etc.
4. Preserve any HTML tags or special formatting
5. Maintain the same level of formality/informality as the source
6. Return ONLY the translated JSON object, nothing else

Source translations (English):
{translations_json}

Return the complete JSON object with all keys and their translated values in {name}."""

                # Mettre à jour progress = 20
                task.progress = 20
                session.commit()

                # Étape 4: Créer l'agent et exécuter
                agent = Agent(
                    name="Language Translator",
                    model=model_name,
                    instructions=prompt,
                )
                agent._chatkit_provider_binding = provider_binding

                # Mettre à jour progress = 30
                task.progress = 30
                session.commit()

                logger.info(f"Task {task_id}: Executing translation agent")

                run_config_kwargs = {}
                if provider_binding is not None:
                    run_config_kwargs["model_provider"] = provider_binding.provider

                try:
                    run_config = RunConfig(**run_config_kwargs)
                except TypeError:
                    run_config_kwargs.pop("model_provider", None)
                    run_config = RunConfig(**run_config_kwargs)

                result = await Runner.run(
                    agent,
                    input="Translate the provided JSON to the target language.",
                    run_config=run_config
                )

                # Mettre à jour progress = 80
                task.progress = 80
                session.commit()

                logger.info(f"Task {task_id}: Translation completed, processing result")

                # Étape 5: Extraire et parser la réponse
                response_text = result.output if hasattr(result, 'output') else str(result)
                json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
                if not json_match:
                    raise ValueError("Failed to extract JSON from AI response")

                translated_dict = json.loads(json_match.group(0))
                logger.info(f"Task {task_id}: Successfully translated {len(translated_dict)} keys")

                # Étape 6: Générer le fichier .ts
                file_content = f'import type {{ TranslationDictionary }} from "./translations";\n\nexport const {code}: TranslationDictionary = {{\n'
                for key, value in translated_dict.items():
                    escaped_value = value.replace('\\', '\\\\').replace('"', '\\"')
                    file_content += f'  "{key}": "{escaped_value}",\n'
                file_content += '};\n'

                task.file_content = file_content

                # Étape 7: Si save_to_db, créer/update Language en BD
                language_id = None
                if save_to_db:
                    logger.info(f"Task {task_id}: Saving to database")
                    existing_lang = session.scalar(
                        select(Language).where(Language.code == code)
                    )

                    if existing_lang:
                        existing_lang.name = name
                        existing_lang.translations = translated_dict
                        existing_lang.updated_at = datetime.datetime.now(datetime.UTC)
                        language = existing_lang
                    else:
                        language = Language(
                            code=code,
                            name=name,
                            translations=translated_dict
                        )
                        session.add(language)

                    session.commit()
                    session.refresh(language)
                    language_id = language.id
                    task.language_id = language_id
                    logger.info(f"Task {task_id}: Saved to database with language_id={language_id}")

                # Étape 8: Marquer comme terminé
                task.status = "completed"
                task.progress = 100
                task.completed_at = datetime.datetime.now(datetime.UTC)
                session.commit()

                logger.info(f"Task {task_id}: Completed successfully")

            except Exception as e:
                # En cas d'erreur, marquer la tâche comme failed
                logger.exception(f"Task {task_id} failed: {e}")
                task.status = "failed"
                task.error_message = str(e)
                task.progress = 0
                session.commit()

    except Exception as e:
        # Erreur fatale (impossible de charger la tâche)
        logger.exception(f"Fatal error in background task {task_id}: {e}")


@router.post("/api/admin/languages/generate", response_model=TaskStartedResponse)
async def generate_language_file(
    request: LanguageGenerateRequest,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin)
):
    """
    Lance la génération de traduction en background et retourne task_id immédiatement.
    """
    code = request.code.strip().lower()
    name = request.name.strip()
    model_name = request.model.strip() if request.model else None
    provider_id = request.provider_id.strip() if request.provider_id else None
    provider_slug = request.provider_slug.strip() if request.provider_slug else None
    custom_prompt = request.custom_prompt.strip() if request.custom_prompt else None
    save_to_db = request.save_to_db

    # Validation
    if not re.match(r'^[a-z]{2}$', code):
        raise HTTPException(
            status_code=400,
            detail="Language code must be 2 lowercase letters (ISO 639-1)"
        )

    if code in ["en", "fr"]:
        raise HTTPException(
            status_code=400,
            detail="Cannot generate base languages (en, fr) - they already exist"
        )

    # Vérifier que le fichier source existe
    i18n_path = Path("/frontend/src/i18n")
    en_file = i18n_path / "translations.en.ts"
    if not en_file.exists():
        raise HTTPException(status_code=404, detail="Source language file (English) not found")

    # Créer la tâche en BD
    task_id = str(uuid.uuid4())
    task = LanguageGenerationTask(
        task_id=task_id,
        code=code,
        name=name,
        status="pending",
        progress=0
    )
    session.add(task)
    session.commit()

    logger.info(f"Created task {task_id} for language {code} ({name})")

    # Lancer la génération en background
    asyncio.create_task(_generate_language_background(
        task_id=task_id,
        code=code,
        name=name,
        model_name=model_name,
        provider_id=provider_id,
        provider_slug=provider_slug,
        custom_prompt=custom_prompt,
        save_to_db=save_to_db
    ))

    return TaskStartedResponse(
        task_id=task_id,
        status="pending",
        message=f"Language generation started for {code} ({name})"
    )


@router.get("/api/admin/languages/tasks/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(
    task_id: str,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin)
):
    """
    Récupère le statut d'une tâche de génération de langue.
    """
    task = session.scalar(
        select(LanguageGenerationTask).where(LanguageGenerationTask.task_id == task_id)
    )
    if not task:
        raise HTTPException(
            status_code=404,
            detail=f"Task {task_id} not found"
        )

    return TaskStatusResponse(
        task_id=task.task_id,
        status=task.status,
        progress=task.progress,
        error_message=task.error_message,
        created_at=task.created_at.isoformat(),
        completed_at=task.completed_at.isoformat() if task.completed_at else None,
        language_id=task.language_id,
        can_download=(task.status == "completed" and task.file_content is not None)
    )


@router.get("/api/admin/languages/tasks/{task_id}/download")
async def download_task_result(
    task_id: str,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin)
):
    """
    Télécharge le fichier de traduction généré par une tâche.
    """
    task = session.scalar(
        select(LanguageGenerationTask).where(LanguageGenerationTask.task_id == task_id)
    )
    if not task:
        raise HTTPException(
            status_code=404,
            detail=f"Task {task_id} not found"
        )

    if task.status != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Task is not completed (status: {task.status})"
        )

    if not task.file_content:
        raise HTTPException(
            status_code=404,
            detail="No file content available for this task"
        )

    return Response(
        content=task.file_content,
        media_type="text/plain",
        headers={
            "Content-Disposition": f'attachment; filename="translations.{task.code}.ts"'
        }
    )


@router.get("/api/admin/languages/stored", response_model=StoredLanguagesListResponse)
async def list_stored_languages(
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin)
):
    """
    Liste toutes les langues stockées en base de données.
    """
    languages = session.scalars(
        select(Language).order_by(Language.code.asc())
    ).all()

    return StoredLanguagesListResponse(
        languages=[
            StoredLanguageResponse(
                id=lang.id,
                code=lang.code,
                name=lang.name,
                created_at=lang.created_at.isoformat(),
                updated_at=lang.updated_at.isoformat()
            )
            for lang in languages
        ]
    )


@router.get("/api/admin/languages/stored/{id}/download")
async def download_stored_language(
    id: int,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin)
):
    """
    Télécharge le fichier de traduction d'une langue stockée en BD.
    """
    language = session.get(Language, id)
    if not language:
        raise HTTPException(
            status_code=404,
            detail=f"Language with id {id} not found"
        )

    # Générer le fichier .ts depuis language.translations
    file_content = f'import type {{ TranslationDictionary }} from "./translations";\n\nexport const {language.code}: TranslationDictionary = {{\n'
    for key, value in language.translations.items():
        escaped_value = str(value).replace('\\', '\\\\').replace('"', '\\"')
        file_content += f'  "{key}": "{escaped_value}",\n'
    file_content += '};\n'

    return Response(
        content=file_content,
        media_type="text/plain",
        headers={
            "Content-Disposition": f'attachment; filename="translations.{language.code}.ts"'
        }
    )


@router.delete("/api/admin/languages/stored/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stored_language(
    id: int,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin)
):
    """
    Supprime une langue stockée en base de données.
    """
    language = session.get(Language, id)
    if not language:
        raise HTTPException(
            status_code=404,
            detail=f"Language with id {id} not found"
        )

    session.delete(language)
    session.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/admin/languages/stored/{id}/activate")
async def activate_stored_language(
    id: int,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin)
):
    """
    Active une langue stockée en BD en l'ajoutant au système de traduction.

    Cette fonction :
    1. Récupère la langue depuis la BD
    2. Écrit le fichier translations.{code}.ts
    3. Met à jour translations.ts pour ajouter la langue à AVAILABLE_LANGUAGES
    """
    language = session.get(Language, id)
    if not language:
        raise HTTPException(
            status_code=404,
            detail=f"Language with id {id} not found"
        )

    i18n_path = Path("/frontend/src/i18n")

    # 1. Générer et écrire le fichier de traduction
    translation_file = i18n_path / f"translations.{language.code}.ts"
    file_content = f'import type {{ TranslationDictionary }} from "./translations";\n\nexport const {language.code}: TranslationDictionary = {{\n'
    for key, value in language.translations.items():
        escaped_value = str(value).replace('\\', '\\\\').replace('"', '\\"')
        file_content += f'  "{key}": "{escaped_value}",\n'
    file_content += '};\n'

    try:
        translation_file.write_text(file_content, encoding='utf-8')
        logger.info(f"Written translation file: {translation_file}")
    except Exception as e:
        logger.exception(f"Failed to write translation file: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to write translation file: {str(e)}"
        )

    # 2. Mettre à jour translations.ts
    main_file = i18n_path / "translations.ts"

    try:
        content = main_file.read_text(encoding='utf-8')

        # Vérifier si la langue existe déjà
        if f'"{language.code}"' in content.split('\n')[0]:
            raise HTTPException(
                status_code=400,
                detail=f"Language {language.code} is already activated"
            )

        # Modifier la ligne du type Language
        lines = content.split('\n')

        # 1. Modifier la première ligne pour ajouter le code
        if lines[0].startswith('export type Language = '):
            # Extraire les codes existants
            match = re.search(r'= (.+);', lines[0])
            if match:
                existing_codes = match.group(1)
                # Ajouter le nouveau code
                new_codes = f'{existing_codes.rstrip(";")} | "{language.code}";'
                lines[0] = f'export type Language = {new_codes}'

        # 2. Ajouter dans AVAILABLE_LANGUAGES (après la ligne avec "fr")
        for i, line in enumerate(lines):
            if '{ code: "fr"' in line:
                # Trouver l'indentation
                indent = '  '
                # Insérer après cette ligne
                lines.insert(i + 1, f'{indent}{{ code: "{language.code}", label: "{language.name}" }},')
                break

        # 3. Ajouter l'import (après les imports existants)
        import_line = f'import {{ {language.code} }} from "./translations.{language.code}";'
        for i, line in enumerate(lines):
            if line.startswith('import { en }'):
                lines.insert(i + 1, import_line)
                break

        # 4. Ajouter dans l'objet translations (avant la ligne avec "fr,")
        for i, line in enumerate(lines):
            if line.strip() == 'fr,':
                indent = '  '
                lines.insert(i + 1, f'{indent}{language.code},')
                break

        # Écrire le fichier modifié
        new_content = '\n'.join(lines)
        main_file.write_text(new_content, encoding='utf-8')
        logger.info(f"Updated translations.ts to include {language.code}")

        return {
            "success": True,
            "message": f"Language {language.code} ({language.name}) has been activated",
            "code": language.code,
            "name": language.name
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to update translations.ts: {e}")
        # Essayer de supprimer le fichier de traduction si on a échoué
        try:
            if translation_file.exists():
                translation_file.unlink()
        except:
            pass
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update translations.ts: {str(e)}"
        )


class AvailableModelResponse(BaseModel):
    id: int
    name: str
    provider_id: str | None
    provider_slug: str | None
    provider_configured: bool  # True if provider can be resolved


class AvailableModelsListResponse(BaseModel):
    models: list[AvailableModelResponse]


class DefaultPromptResponse(BaseModel):
    prompt: str
    variables: list[str]


@router.get("/api/admin/languages/models", response_model=AvailableModelsListResponse)
async def list_available_models(
    _admin: User = Depends(require_admin)
):
    """
    Liste tous les modèles disponibles pour la génération de traductions.
    """
    from sqlalchemy import select
    from ..models import AvailableModel
    from ..chatkit.agent_registry import get_agent_provider_binding

    try:
        with SessionLocal() as session:
            models = session.scalars(
                select(AvailableModel)
                .order_by(AvailableModel.provider_slug, AvailableModel.name)
            ).all()

            model_list = []
            for model in models:
                # Check if provider can be resolved
                provider_configured = False
                if model.provider_id or model.provider_slug:
                    binding = get_agent_provider_binding(model.provider_id, model.provider_slug)
                    provider_configured = binding is not None

                model_list.append(AvailableModelResponse(
                    id=model.id,
                    name=model.name,
                    provider_id=model.provider_id,
                    provider_slug=model.provider_slug,
                    provider_configured=provider_configured
                ))

            return AvailableModelsListResponse(models=model_list)

    except Exception as e:
        logger.exception(f"Failed to list available models: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list available models: {str(e)}"
        )


@router.get("/api/admin/languages/default-prompt", response_model=DefaultPromptResponse)
async def get_default_translation_prompt(
    _admin: User = Depends(require_admin)
):
    """
    Retourne le prompt par défaut pour la génération de traductions avec la liste des variables disponibles.
    """
    default_prompt = """You are a professional translator. Translate the following JSON object containing interface strings from English to {{language_name}} ({{language_code}}).

IMPORTANT RULES:
1. Keep all keys exactly as they are (do not translate keys)
2. Only translate the values
3. Preserve any placeholders like {{variable}}, {{count}}, etc.
4. Preserve any HTML tags or special formatting
5. Maintain the same level of formality/informality as the source
6. Return ONLY the translated JSON object, nothing else

Source translations (English):
{{translations_json}}

Return the complete JSON object with all keys and their translated values in {{language_name}}."""

    return DefaultPromptResponse(
        prompt=default_prompt,
        variables=["{{language_name}}", "{{language_code}}", "{{translations_json}}"]
    )
