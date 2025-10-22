from __future__ import annotations

import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import VoiceSettings

_UNSET = object()


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


def _normalize_prompt_variables(
    variables: dict[str, Any] | None,
) -> dict[str, str]:
    if not variables:
        return {}
    normalized: dict[str, str] = {}
    for key, value in variables.items():
        if not key:
            continue
        normalized[key] = "" if value is None else str(value)
    return normalized


def get_or_create_voice_settings(session: Session) -> VoiceSettings:
    settings = session.scalar(select(VoiceSettings).limit(1))
    if settings:
        return settings

    defaults = get_settings()
    settings = VoiceSettings(
        instructions=defaults.chatkit_realtime_instructions,
        model=defaults.chatkit_realtime_model,
        voice=defaults.chatkit_realtime_voice,
        prompt_variables={},
    )
    session.add(settings)
    session.commit()
    session.refresh(settings)
    return settings


def update_voice_settings(
    session: Session,
    *,
    instructions: str | None = None,
    model: str | None = None,
    voice: str | None = None,
    prompt_id: str | None | object = _UNSET,
    prompt_version: str | None | object = _UNSET,
    prompt_variables: dict[str, Any] | object = _UNSET,
) -> VoiceSettings:
    settings = get_or_create_voice_settings(session)

    if instructions is not None:
        settings.instructions = instructions
    if model is not None:
        settings.model = model
    if voice is not None:
        settings.voice = voice
    if prompt_id is not _UNSET:
        settings.prompt_id = (
            prompt_id if isinstance(prompt_id, str) and prompt_id else None
        )
    if prompt_version is not _UNSET:
        settings.prompt_version = (
            prompt_version
            if isinstance(prompt_version, str) and prompt_version
            else None
        )
    if prompt_variables is not _UNSET:
        settings.prompt_variables = _normalize_prompt_variables(
            prompt_variables if isinstance(prompt_variables, dict) else None
        )

    settings.updated_at = _now()
    session.add(settings)
    session.commit()
    session.refresh(settings)
    return settings
