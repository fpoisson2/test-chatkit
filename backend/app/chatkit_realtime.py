"""Compatibilité historique pour la création de sessions Realtime."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .realtime_runner import open_voice_session


async def create_realtime_voice_session(
    *,
    user_id: str,
    model: str,
    instructions: str,
    provider_id: str | None = None,
    provider_slug: str | None = None,
    voice: str | None = None,
    realtime: Mapping[str, Any] | None = None,
    tools: Sequence[Any] | None = None,
) -> dict[str, Any]:
    """Conserve l'ancienne signature en délégant au nouvel orchestrateur."""

    handle = await open_voice_session(
        user_id=user_id,
        model=model,
        instructions=instructions,
        provider_id=provider_id,
        provider_slug=provider_slug,
        voice=voice,
        realtime=realtime,
        tools=tools,
    )
    return handle.payload


__all__ = ["create_realtime_voice_session"]
