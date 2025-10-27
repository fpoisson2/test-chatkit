from __future__ import annotations

import logging
import os
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

    def _clean_identifier(value: Any) -> str:
        if isinstance(value, str):
            candidate = value.strip()
            if candidate:
                return candidate
        return ""

    def _clean_slug(value: Any) -> str:
        if isinstance(value, str):
            candidate = value.strip().lower()
            if candidate:
                return candidate
        return ""

    def _clean_url(value: Any) -> str | None:
        if isinstance(value, str):
            candidate = value.strip()
            if candidate:
                return candidate.rstrip("/")
        return None

    def _clean_secret(value: Any) -> str | None:
        if isinstance(value, str):
            candidate = value.strip()
            if candidate:
                return candidate
        return None

    normalized_provider_id = _clean_identifier(provider_id)
    normalized_provider_slug = _clean_slug(provider_slug)

    api_base = settings.model_api_base
    api_key = settings.model_api_key

    provider_base_override: str | None = None
    provider_key_override: str | None = None

    credentials = None
    if normalized_provider_id:
        credentials = resolve_model_provider_credentials(normalized_provider_id)
        if (
            credentials is not None
            and normalized_provider_slug
            and getattr(credentials, "provider", None) != normalized_provider_slug
        ):
            credentials = None
    if credentials is not None:
        provider_base_override = _clean_url(getattr(credentials, "api_base", None))
        provider_key_override = _clean_secret(getattr(credentials, "api_key", None))
    elif normalized_provider_id:
        for config in settings.model_providers:
            if config.id == normalized_provider_id:
                if (
                    normalized_provider_slug
                    and config.provider != normalized_provider_slug
                ):
                    break
                provider_base_override = _clean_url(config.api_base)
                provider_key_override = _clean_secret(config.api_key)
                break

    if provider_base_override is None and normalized_provider_slug:
        for config in settings.model_providers:
            if config.provider == normalized_provider_slug:
                provider_base_override = _clean_url(config.api_base)
                provider_key_override = _clean_secret(config.api_key)
                break

    if provider_base_override is None and normalized_provider_slug:
        default_provider = _clean_slug(getattr(settings, "model_provider", None))
        if default_provider and default_provider == normalized_provider_slug:
            provider_base_override = _clean_url(settings.model_api_base)
            provider_key_override = _clean_secret(settings.model_api_key)

    if provider_base_override is None and normalized_provider_slug == "openai":
        openai_base_env = _clean_url(os.environ.get("CHATKIT_API_BASE"))
        provider_base_override = openai_base_env or "https://api.openai.com"
        openai_key = _clean_secret(getattr(settings, "openai_api_key", None))
        if openai_key:
            provider_key_override = openai_key

    if provider_base_override:
        api_base = provider_base_override
    if provider_key_override:
        api_key = provider_key_override

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
    }

    timeout = httpx.Timeout(30.0, connect=10.0, read=None)

    base_url = httpx.URL(api_base)
    normalized_path = base_url.path.rstrip("/")
    path_segments = [segment for segment in normalized_path.split("/") if segment]
    has_version_segment = bool(path_segments) and path_segments[-1].lower() == "v1"

    if has_version_segment:
        target_path = f"{normalized_path}/realtime/client_secrets"
    else:
        base_path = normalized_path or ""
        target_path = f"{base_path}/v1/realtime/client_secrets"

    if not target_path.startswith("/"):
        target_path = "/" + target_path

    endpoint_url = base_url.copy_with(path=target_path, query=None, fragment=None)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                str(endpoint_url),
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
