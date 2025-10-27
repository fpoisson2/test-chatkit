from __future__ import annotations

import logging
import os
from collections.abc import Mapping, Sequence
from typing import Any, Literal

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

    def _clean_voice(value: Any) -> str:
        if isinstance(value, str):
            candidate = value.strip()
            if candidate:
                return candidate
        return ""

    voice_value = _clean_voice(voice)

    def _build_payload(
        voice_mode: Literal["top_level", "session", "none"],
        realtime_mode: Literal["top_level", "session", "none"],
    ) -> dict[str, Any]:
        session_payload: dict[str, Any] = {
            "type": "realtime",
            "instructions": instructions,
            "model": model,
        }
        if tools:
            session_payload["tools"] = list(tools)

        payload: dict[str, Any] = {"session": session_payload}

        if isinstance(realtime, Mapping):
            if realtime_mode == "session":
                session_payload["realtime"] = dict(realtime)
            elif realtime_mode == "top_level":
                payload["realtime"] = dict(realtime)

        if voice_value:
            if voice_mode == "session":
                session_payload["voice"] = voice_value
            elif voice_mode == "top_level":
                payload["voice"] = voice_value

        return payload

    def _should_retry_voice_mode(
        voice_mode: Literal["top_level", "session", "none"],
        error_payload: Any,
    ) -> bool:
        if not voice_value:
            return False
        if voice_mode == "none":
            return False
        if not isinstance(error_payload, dict):
            return False
        error_details = error_payload.get("error")
        if not isinstance(error_details, dict):
            return False
        if error_details.get("code") != "unknown_parameter":
            return False
        expected_param = "voice" if voice_mode == "top_level" else "session.voice"
        return error_details.get("param") == expected_param

    def _should_retry_realtime_mode(
        realtime_mode: Literal["top_level", "session", "none"],
        error_payload: Any,
    ) -> bool:
        if not isinstance(realtime, Mapping):
            return False
        if realtime_mode == "none":
            return False
        if not isinstance(error_payload, dict):
            return False
        error_details = error_payload.get("error")
        if not isinstance(error_details, dict):
            return False
        if error_details.get("code") != "unknown_parameter":
            return False
        expected_param = (
            "realtime" if realtime_mode == "top_level" else "session.realtime"
        )
        return error_details.get("param") == expected_param

    voice_modes: list[Literal["top_level", "session", "none"]]
    if voice_value:
        voice_modes = ["top_level", "session", "none"]
    else:
        voice_modes = ["none"]

    realtime_modes: list[Literal["top_level", "session", "none"]]
    if isinstance(realtime, Mapping) and realtime:
        realtime_modes = ["top_level", "session", "none"]
    elif isinstance(realtime, Mapping):
        realtime_modes = ["session", "none"]
    else:
        realtime_modes = ["none"]

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

    last_error: Any = None
    last_status: int | None = None

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            voice_index = 0
            realtime_index = 0

            while True:
                voice_mode = voice_modes[voice_index]
                realtime_mode = realtime_modes[realtime_index]
                payload = _build_payload(voice_mode, realtime_mode)

                sanitized_request, removed_request = sanitize_value(payload)
                if removed_request:
                    logger.debug(
                        "Champs sensibles retirés de la requête Realtime client_secret",
                    )
                if logger.isEnabledFor(logging.DEBUG):
                    logger.debug(
                        "Requête Realtime client_secret (sanitisée, voix=%s, "
                        "realtime=%s) : %s",
                        voice_mode,
                        realtime_mode,
                        sanitized_request,
                    )

                response = await client.post(
                    str(endpoint_url),
                    json=payload,
                    headers=headers,
                )

                if response.status_code < 400:
                    raw_payload = response.json()
                    sanitized_response, removed_response = sanitize_value(raw_payload)
                    if removed_response:
                        logger.debug(
                            "Champs sensibles retirés de la réponse "
                            "Realtime client_secret",
                        )
                    if logger.isEnabledFor(logging.DEBUG):
                        logger.debug(
                            "Réponse Realtime client_secret (sanitisée) : %s",
                            sanitized_response,
                        )
                    return sanitized_response

                last_status = response.status_code
                try:
                    error_payload = response.json()
                except ValueError:
                    error_payload = {"error": response.text}
                sanitized_error, removed_error = sanitize_value(error_payload)
                if removed_error:
                    logger.debug(
                        "Champs sensibles retirés de la réponse d'erreur Realtime",
                    )
                logger.error(
                    "Erreur de l'API Realtime (%s, voix=%s, realtime=%s) : %s",
                    response.status_code,
                    voice_mode,
                    realtime_mode,
                    sanitized_error,
                )

                last_error = sanitized_error

                retried = False
                if (
                    _should_retry_voice_mode(voice_mode, sanitized_error)
                    and voice_index < len(voice_modes) - 1
                ):
                    voice_index += 1
                    next_mode = voice_modes[voice_index]
                    logger.info(
                        "Requête client_secret Realtime réessayée avec le mode "
                        "de voix %s",
                        next_mode,
                    )
                    retried = True

                elif (
                    _should_retry_realtime_mode(realtime_mode, sanitized_error)
                    and realtime_index < len(realtime_modes) - 1
                ):
                    realtime_index += 1
                    next_realtime = realtime_modes[realtime_index]
                    logger.info(
                        "Requête client_secret Realtime réessayée avec le mode "
                        "realtime %s",
                        next_realtime,
                    )
                    retried = True

                if retried:
                    continue

                break
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

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={
            "error": "Realtime client secret request failed",
            "status_code": last_status,
            "details": last_error,
        },
    )
