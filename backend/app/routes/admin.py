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
    serialize_appearance_settings,
    update_admin_settings,
    update_appearance_settings,
)
from ..config import get_settings
from ..database import get_session, SessionLocal
from ..dependencies import require_admin
from ..mcp.server_service import McpServerService
from ..model_providers import configure_model_provider
from ..models import SipAccount, TelephonyRoute, User
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


class LanguagesListResponse(BaseModel):
    languages: list[LanguageResponse]


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



@router.post("/api/admin/languages/generate", response_model=GeneratedFileResponse)
async def generate_language_file(
    request: LanguageGenerateRequest,
    _admin: User = Depends(require_admin)
):
    """
    Génère un fichier de traductions traduit automatiquement par IA.
    Retourne le contenu du fichier au lieu de l'écrire sur le disque.
    L'administrateur peut ensuite télécharger et ajouter manuellement le fichier.
    """
    import re
    import json
    from pathlib import Path
    
    code = request.code.strip().lower()
    name = request.name.strip()
    model_name = request.model.strip() if request.model else None
    provider_id = request.provider_id.strip() if request.provider_id else None
    provider_slug_from_request = request.provider_slug.strip() if request.provider_slug else None
    custom_prompt = request.custom_prompt.strip() if request.custom_prompt else None

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
    
    # Le frontend est monté en lecture seule dans /frontend via docker-compose
    i18n_path = Path("/frontend/src/i18n")
    
    # Charger le fichier source (anglais)
    en_file = i18n_path / "translations.en.ts"
    if not en_file.exists():
        raise HTTPException(status_code=404, detail="Source language file (English) not found")
    
    # Extraire toutes les clés et valeurs du fichier anglais
    en_content = en_file.read_text()
    
    # Pattern pour extraire les paires clé-valeur
    pattern = r'"([^"]+)"\s*:\s*"([^"]*(?:\\.[^"]*)*)"'
    matches = re.findall(pattern, en_content)
    
    if not matches:
        raise HTTPException(status_code=500, detail="No translations found in source file")
    
    # Créer un dictionnaire des traductions anglaises
    en_translations = {key: value for key, value in matches}
    
    logger.info(f"Generating translation file for {code} ({name}) with {len(en_translations)} keys")
    
    # Utiliser le SDK Agent pour traduire
    try:
        from agents import Agent, Runner
        from sqlalchemy import select
        from ..models import AvailableModel
        from ..chatkit.agent_registry import get_agent_provider_binding

        # Charger le modèle depuis la base de données
        with SessionLocal() as session:
            if model_name:
                # Si un modèle spécifique est demandé, le chercher
                query = select(AvailableModel).where(AvailableModel.name == model_name)
                available_model = session.scalar(query)

                if not available_model:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Model '{model_name}' not found in database"
                    )
            else:
                # Sinon, prendre le premier modèle disponible
                available_model = session.scalar(
                    select(AvailableModel)
                    .order_by(AvailableModel.id)
                    .limit(1)
                )

                if not available_model:
                    raise HTTPException(
                        status_code=500,
                        detail="No models configured in the database. Please add a model first."
                    )

            model_name = available_model.name

            # Utiliser le provider_id et provider_slug fournis dans le formulaire en priorité
            # Sinon, utiliser ceux du modèle dans la base de données
            if provider_id:
                provider_id_used = provider_id
                logger.info(f"Using provider_id from form: {provider_id}")
            else:
                provider_id_used = available_model.provider_id
                logger.info(f"Using provider_id from model in database: {provider_id_used}")

            if provider_slug_from_request:
                provider_slug = provider_slug_from_request
                logger.info(f"Using provider_slug from form: {provider_slug}")
            else:
                provider_slug = available_model.provider_slug
                logger.info(f"Using provider_slug from model in database: {provider_slug}")

            logger.info(f"Using model {model_name} with provider_id={provider_id_used}, provider_slug={provider_slug}")

        # Obtenir le provider binding
        logger.info(f"Getting provider binding for provider_id={provider_id_used}, provider_slug={provider_slug}")

        # Debug: afficher les providers disponibles
        settings = get_settings()
        logger.info(f"Available providers in settings: {[(p.provider, p.id if hasattr(p, 'id') else 'no-id') for p in settings.model_providers]}")

        provider_binding = get_agent_provider_binding(provider_id_used, provider_slug)

        print(f"CHECKPOINT 5: Got provider binding result")
        logger.info(f"Provider binding result: {provider_binding}")

        if not provider_binding:
            error_msg = (
                f"Failed to get provider binding for model '{model_name}'. "
                f"Provider ID: {provider_id_used}, Provider slug: {provider_slug}. "
                f"Please ensure the model has a valid provider_id in the database or that "
                f"a provider with slug '{provider_slug}' is configured in your settings."
            )
            print(f"ERROR: {error_msg}")
            logger.error(error_msg)
            raise HTTPException(
                status_code=500,
                detail=error_msg
            )

        logger.info(f"Provider binding obtained successfully: id={provider_binding.provider_id}, slug={provider_binding.provider_slug}")

        # Préparer le prompt pour la traduction
        logger.info("Preparing translation prompt")
        translations_json = json.dumps(en_translations, ensure_ascii=False, indent=2)

        # Utiliser le prompt personnalisé ou le prompt par défaut
        if custom_prompt:
            # Remplacer les variables dans le prompt personnalisé
            prompt = custom_prompt.replace("{{language_name}}", name)
            prompt = prompt.replace("{{language_code}}", code)
            prompt = prompt.replace("{{translations_json}}", translations_json)
        else:
            # Prompt par défaut
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

        logger.info(f"Using agent SDK for translation to {name}")
        logger.info(f"About to create agent with model={model_name}")

        # Créer l'agent avec le provider
        try:
            agent = Agent(
                name="Language Translator",
                model=model_name,
                instructions=prompt,
                provider=provider_binding.provider
            )
            logger.info("Agent created successfully")
        except Exception as e:
            logger.exception(f"Failed to create agent: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to create translation agent: {str(e)}"
            )

        # Exécuter l'agent
        try:
            logger.info("Starting agent execution")
            runner = Runner(agent=agent)
            result = await runner.run("Translate the provided JSON to the target language.")
            logger.info(f"Agent execution completed, result type: {type(result)}")
        except Exception as e:
            logger.exception(f"Failed to run agent: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Translation execution failed: {str(e)}"
            )

        # Extraire la réponse
        try:
            logger.info("Extracting response from agent result")
            response_text = result.output if hasattr(result, 'output') else str(result)
            logger.info(f"Response text length: {len(response_text)} characters")
        except Exception as e:
            logger.exception(f"Failed to extract response: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to extract translation response: {str(e)}"
            )
        
        # Parser le JSON de la réponse
        # Nettoyer le texte pour extraire seulement le JSON
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if not json_match:
            logger.error("Failed to extract JSON from AI response")
            raise HTTPException(status_code=500, detail="Failed to parse AI response")
        
        translated_dict = json.loads(json_match.group(0))
        logger.info(f"Successfully translated {len(translated_dict)} keys")
        
        # Générer le fichier de traductions
        file_content = f'import type {{ TranslationDictionary }} from "./translations";\n\nexport const {code}: TranslationDictionary = {{\n'
        
        for key, value in translated_dict.items():
            # Échapper les guillemets et backslashes
            escaped_value = value.replace('\\', '\\\\').replace('"', '\\"')
            file_content += f'  "{key}": "{escaped_value}",\n'
        
        file_content += '};\n'
        
        # Instructions pour l'administrateur
        instructions = f"""# How to add this language to your application

1. Save this file as `frontend/src/i18n/translations.{code}.ts`

2. Edit `frontend/src/i18n/translations.ts` and add:

   a) Add to the Language type:
      export type Language = "en" | "fr" | "{code}";
   
   b) Add to AVAILABLE_LANGUAGES array:
      {{ code: "{code}", label: "{name}" }},
   
   c) Add the import:
      import {{ {code} }} from "./translations.{code}";
   
   d) Add to translations object:
      {code},

3. Restart the frontend development server

4. The new language will appear in the language switcher
"""
        
        return GeneratedFileResponse(
            filename=f"translations.{code}.ts",
            content=file_content,
            instructions=instructions
        )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_msg = f"Failed to generate translation for {code}: {e}"
        traceback_str = traceback.format_exc()
        print(f"ERROR: {error_msg}")
        print(f"TRACEBACK: {traceback_str}")
        logger.exception(error_msg)
        raise HTTPException(
            status_code=500,
            detail=f"Translation generation failed: {str(e)}"
        )


class AvailableModelResponse(BaseModel):
    id: int
    name: str
    provider_id: str | None
    provider_slug: str | None


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

    try:
        with SessionLocal() as session:
            models = session.scalars(
                select(AvailableModel)
                .order_by(AvailableModel.provider_slug, AvailableModel.name)
            ).all()

            model_list = [
                AvailableModelResponse(
                    id=model.id,
                    name=model.name,
                    provider_id=model.provider_id,
                    provider_slug=model.provider_slug
                )
                for model in models
            ]

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
