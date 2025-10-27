from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import require_admin
from ..models import User
from ..schemas import VoiceSettingsResponse, VoiceSettingsUpdateRequest
from ..voice_settings import get_or_create_voice_settings, update_voice_settings

router = APIRouter()


@router.get("/api/admin/voice-settings", response_model=VoiceSettingsResponse)
async def get_voice_settings(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> VoiceSettingsResponse:
    settings = get_or_create_voice_settings(session)
    return VoiceSettingsResponse.model_validate(settings)


@router.patch("/api/admin/voice-settings", response_model=VoiceSettingsResponse)
async def patch_voice_settings(
    payload: VoiceSettingsUpdateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> VoiceSettingsResponse:
    updates: dict[str, object] = {}
    if payload.instructions is not None:
        instructions = payload.instructions.strip()
        if not instructions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Les instructions vocales ne peuvent pas être vides.",
            )
        updates["instructions"] = instructions
    if payload.model is not None:
        model = payload.model.strip()
        if not model:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Le modèle Realtime ne peut pas être vide.",
            )
        updates["model"] = model
    if payload.provider_slug is not None:
        provider_slug = payload.provider_slug.strip().lower()
        updates["provider_slug"] = provider_slug or None
    if payload.provider_id is not None:
        provider_id = payload.provider_id.strip()
        updates["provider_id"] = provider_id or None
    if payload.voice is not None:
        voice = payload.voice.strip()
        if not voice:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La voix ne peut pas être vide.",
            )
        updates["voice"] = voice
    if payload.prompt_id is not None:
        prompt_id = payload.prompt_id.strip()
        updates["prompt_id"] = prompt_id or None
    if payload.prompt_version is not None:
        prompt_version = payload.prompt_version.strip()
        updates["prompt_version"] = prompt_version or None
    if payload.prompt_variables is not None:
        updates["prompt_variables"] = payload.prompt_variables

    settings = update_voice_settings(session, **updates)
    return VoiceSettingsResponse.model_validate(settings)
