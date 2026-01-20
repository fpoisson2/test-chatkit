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
    ModelImportSummary,
    ModelInfoResponse,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _resolve_litellm_entry_name(entry: dict[str, object]) -> str:
    model_name = entry.get("model_name")
    if isinstance(model_name, str) and model_name.strip():
        return model_name.strip()
    litellm_params = entry.get("litellm_params")
    if isinstance(litellm_params, dict):
        candidate = litellm_params.get("model")
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return ""


def _resolve_litellm_entry_provider_slug(entry: dict[str, object]) -> str:
    litellm_params = entry.get("litellm_params")
    if isinstance(litellm_params, dict):
        candidate = litellm_params.get("custom_llm_provider") or litellm_params.get(
            "provider"
        )
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip().lower()
    model_info = entry.get("model_info")
    if isinstance(model_info, dict):
        candidate = model_info.get("litellm_provider")
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip().lower()
    return ""


def _resolve_litellm_entry_supports_reasoning(entry: dict[str, object]) -> bool:
    model_info = entry.get("model_info")
    if isinstance(model_info, dict):
        return bool(model_info.get("supports_reasoning"))
    return False


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


@router.post("/api/admin/models/import-litellm", response_model=ModelImportSummary)
async def import_litellm_models(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> ModelImportSummary:
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

    headers = {
        "accept": "application/json",
        "x-litellm-api-key": settings.model_api_key,
        "Authorization": f"Bearer {settings.model_api_key}",
    }

    try:
        async with httpx.AsyncClient(
            base_url=settings.model_api_base, timeout=httpx.Timeout(10.0)
        ) as client:
            response = await client.get("/v1/model/info", headers=headers)
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

    data = payload.get("data")
    if not isinstance(data, list):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Réponse LiteLLM sans liste de modèles.",
        )

    existing_names = set(
        session.scalars(select(AvailableModel.name)).all()
    )

    litellm_configs = [
        config for config in settings.model_providers if config.provider == "litellm"
    ]
    litellm_config = next(
        (config for config in litellm_configs if config.is_default),
        litellm_configs[0] if litellm_configs else None,
    )
    provider_id = litellm_config.id if litellm_config else None

    created_count = 0
    skipped_count = 0
    now = datetime.datetime.now(datetime.UTC)

    for entry in data:
        if not isinstance(entry, dict):
            skipped_count += 1
            continue
        model_name = _resolve_litellm_entry_name(entry)
        if not model_name or model_name in existing_names:
            skipped_count += 1
            continue

        provider_slug = _resolve_litellm_entry_provider_slug(entry)
        if not provider_slug:
            provider_slug = "litellm"
        if provider_id is None:
            provider_slug = "litellm"

        model = AvailableModel(
            name=model_name,
            display_name=None,
            description=None,
            provider_id=provider_id,
            provider_slug=provider_slug,
            supports_reasoning=_resolve_litellm_entry_supports_reasoning(entry),
            created_at=now,
            updated_at=now,
        )
        session.add(model)
        existing_names.add(model_name)
        created_count += 1

    if created_count:
        session.commit()

    total_count = len(data)
    if skipped_count + created_count < total_count:
        skipped_count = total_count - created_count

    return ModelImportSummary(
        total_count=total_count,
        created_count=created_count,
        skipped_count=skipped_count,
    )
