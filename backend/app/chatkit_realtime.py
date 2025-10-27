from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from typing import Any

import httpx
from fastapi import HTTPException, status

from .admin_settings import resolve_model_provider_credentials
from .config import get_settings
from .token_sanitizer import sanitize_value

logger = logging.getLogger("chatkit.realtime")


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
    """Crée un client_secret Realtime pour une session vocale."""

    settings = get_settings()
    session_payload: dict[str, Any] = {
        "type": "realtime",
        "instructions": instructions,
        "model": model,
    }
    if isinstance(voice, str) and voice.strip():
        session_payload["voice"] = voice.strip()
    if isinstance(realtime, Mapping):
        session_payload["realtime"] = dict(realtime)
    if tools:
        session_payload["tools"] = list(tools)

    payload = {"session": session_payload}

    sanitized_request, removed_request = sanitize_value(payload)
    if removed_request:
        logger.debug("Champs sensibles retirés de la requête Realtime client_secret")
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug(
            "Requête Realtime client_secret (sanitisée) : %s",
            sanitized_request,
        )

    normalized_provider_id = (
        provider_id.strip() if isinstance(provider_id, str) else ""
    )
    normalized_provider_slug = (
        provider_slug.strip().lower() if isinstance(provider_slug, str) else ""
    )

    api_base = settings.model_api_base
    api_key = settings.model_api_key

    credentials = None
    if normalized_provider_id:
        credentials = resolve_model_provider_credentials(normalized_provider_id)
    if credentials is None and normalized_provider_id:
        for config in settings.model_providers:
            if config.id == normalized_provider_id:
                credentials = config
                break
    if credentials is None and normalized_provider_slug:
        for config in settings.model_providers:
            if config.provider == normalized_provider_slug:
                credentials = config
                break

    if credentials is not None:
        candidate_base = getattr(credentials, "api_base", "")
        if isinstance(candidate_base, str) and candidate_base.strip():
            api_base = candidate_base.strip()
        candidate_key = getattr(credentials, "api_key", None)
        if isinstance(candidate_key, str) and candidate_key.strip():
            api_key = candidate_key.strip()

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
    }

    timeout = httpx.Timeout(30.0, connect=10.0, read=None)
    try:
        async with httpx.AsyncClient(base_url=api_base, timeout=timeout) as client:
            response = await client.post(
                "/v1/realtime/client_secrets",
                json=payload,
                headers=headers,
            )
    except (
        httpx.HTTPError
    ) as exc:  # pragma: no cover - exception réseau difficile à reproduire
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
            logger.debug("Champs sensibles retirés de la réponse d'erreur Realtime")
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
        logger.debug("Champs sensibles retirés de la réponse Realtime client_secret")

    if logger.isEnabledFor(logging.DEBUG):
        logger.debug(
            "Réponse Realtime client_secret (sanitisée) : %s",
            sanitized_response,
        )

    return sanitized_response
