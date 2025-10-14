from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import HTTPException, status

from .config import get_settings
from .token_sanitizer import sanitize_value

logger = logging.getLogger("chatkit.realtime")


async def create_realtime_voice_session(
    *,
    user_id: str,
    model: str,
    instructions: str,
) -> dict[str, Any]:
    """Crée un client_secret Realtime pour une session vocale."""

    settings = get_settings()
    payload = {
        "session": {
            "type": "realtime",
            "instructions": instructions,
            "model": model,
            "user": {"id": user_id},
        },
    }

    sanitized_request, removed_request = sanitize_value(payload)
    if removed_request:
        logger.debug(
            "Champs sensibles retirés de la requête Realtime client_secret"
        )
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug(
            "Requête Realtime client_secret (sanitisée) : %s",
            sanitized_request,
        )

    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
    }

    timeout = httpx.Timeout(30.0, connect=10.0, read=None)
    try:
        async with httpx.AsyncClient(base_url=settings.chatkit_api_base, timeout=timeout) as client:
            response = await client.post(
                "/v1/realtime/client_secrets",
                json=payload,
                headers=headers,
            )
    except httpx.HTTPError as exc:  # pragma: no cover - exception réseau difficile à reproduire
        logger.error("Échec de la requête Realtime client_secret : %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "Impossible de contacter l'API ChatKit Realtime",
            },
        ) from exc

    if response.status_code >= 400:
        try:
            error_payload = response.json()
        except ValueError:
            error_payload = {"error": response.text}
        sanitized_error, removed_error = sanitize_value(error_payload)
        if removed_error:
            logger.debug(
                "Champs sensibles retirés de la réponse d'erreur Realtime"
            )
        logger.error(
            "Erreur de l'API Realtime (%s) : %s",
            response.status_code,
            sanitized_error,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "Realtime client secret request failed",
                "status_code": response.status_code,
                "details": sanitized_error,
            },
        )

    raw_payload = response.json()
    sanitized_response, removed_response = sanitize_value(raw_payload)
    if removed_response:
        logger.debug(
            "Champs sensibles retirés de la réponse Realtime client_secret"
        )

    if logger.isEnabledFor(logging.DEBUG):
        logger.debug(
            "Réponse Realtime client_secret (sanitisée) : %s",
            sanitized_response,
        )

    return sanitized_response
