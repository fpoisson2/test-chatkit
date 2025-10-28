from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlparse

import httpx
from agents.realtime.agent import RealtimeAgent
from agents.realtime.runner import RealtimeRunner
from fastapi import HTTPException, status

from .admin_settings import resolve_model_provider_credentials
from .config import get_settings
from .token_sanitizer import sanitize_value

logger = logging.getLogger("chatkit.realtime.runner")


def _normalize_realtime_tools_payload(
    tools: Sequence[Any] | Iterable[Any] | None,
) -> list[Any] | None:
    """Normalise la configuration des outils pour l'API Realtime."""

    if tools is None:
        return None

    if isinstance(tools, (str, bytes, bytearray)):
        source_entries: list[Any] = [tools]
    elif isinstance(tools, Sequence):
        source_entries = list(tools)
    else:
        source_entries = list(tools)

    normalized: list[Any] = []
    seen_labels: set[str] = set()

    for index, entry in enumerate(source_entries):
        if isinstance(entry, Mapping):
            tool_entry = dict(entry)
            tool_type = str(
                tool_entry.get("type")
                or tool_entry.get("tool")
                or tool_entry.get("name")
                or ""
            ).strip().lower()

            if tool_type == "mcp":
                label = _derive_mcp_server_label(tool_entry)
                if not label:
                    label = f"mcp-server-{index + 1}"
                base_label = label
                suffix = 2
                while label in seen_labels:
                    label = f"{base_label}-{suffix}"
                    suffix += 1
                tool_entry["server_label"] = label
                seen_labels.add(label)

            normalized.append(tool_entry)
        else:
            normalized.append(entry)

    return normalized


def _derive_mcp_server_label(entry: Mapping[str, Any]) -> str | None:
    """Calcule un identifiant stable pour un serveur MCP."""

    for key in ("server_label", "label", "name", "identifier", "id"):
        label = _normalize_label(entry.get(key))
        if label:
            return label

    for key in ("url", "server_url", "endpoint", "transport_url"):
        raw = entry.get(key)
        if isinstance(raw, str):
            label = _normalize_label_from_url(raw)
            if label:
                return label

    authorization = entry.get("authorization")
    label = _normalize_label(authorization)
    if label:
        return label

    return None


def _normalize_label(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if not candidate:
        return None
    normalized = re.sub(r"[^0-9a-zA-Z_-]+", "-", candidate)
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-_").lower()
    if not normalized:
        return None
    return normalized[:64]


def _normalize_label_from_url(value: str) -> str | None:
    candidate = value.strip()
    if not candidate:
        return None
    parsed = urlparse(candidate if "://" in candidate else f"https://{candidate}")
    parts = parsed.netloc or parsed.path
    if parsed.netloc and parsed.path and parsed.path != "/":
        parts = f"{parsed.netloc}{parsed.path}"
    if not parts:
        parts = candidate
    return _normalize_label(parts)


@dataclass(slots=True)
class VoiceSessionHandle:
    """Informations retournées lors de l'ouverture d'une session vocale."""

    session_id: str
    payload: dict[str, Any]
    agent: RealtimeAgent[Any]
    runner: RealtimeRunner
    client_secret: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        """Retourne une vue résumée de la session pour le debug."""

        return {
            "session_id": self.session_id,
            "client_secret_present": bool(self.client_secret),
            "metadata": dict(self.metadata),
        }


class RealtimeVoiceSessionRegistry:
    """Registre en mémoire des sessions Realtime ouvertes."""

    def __init__(self) -> None:
        self._sessions: dict[str, VoiceSessionHandle] = {}
        self._sessions_by_secret: dict[str, str] = {}
        self._lock = asyncio.Lock()

    async def register(self, handle: VoiceSessionHandle) -> None:
        async with self._lock:
            self._sessions[handle.session_id] = handle
            if handle.client_secret:
                self._sessions_by_secret[handle.client_secret] = handle.session_id

    async def remove(
        self,
        *,
        session_id: str | None = None,
        client_secret: str | None = None,
    ) -> VoiceSessionHandle | None:
        target_id = session_id
        async with self._lock:
            if target_id is None and client_secret is not None:
                target_id = self._sessions_by_secret.pop(client_secret, None)
            handle = None
            if target_id is not None:
                handle = self._sessions.pop(target_id, None)
            if handle and handle.client_secret:
                self._sessions_by_secret.pop(handle.client_secret, None)
            return handle

    async def get(self, session_id: str) -> VoiceSessionHandle | None:
        async with self._lock:
            return self._sessions.get(session_id)


class RealtimeVoiceSessionOrchestrator:
    """Orchestration des sessions vocales Realtime ChatKit."""

    def __init__(self) -> None:
        # Agent de base cloné pour chaque session.
        self._base_agent = RealtimeAgent(name="chatkit-voice", instructions=None)
        self._registry = RealtimeVoiceSessionRegistry()

    @staticmethod
    def _clean_voice(value: Any) -> str:
        if isinstance(value, str):
            candidate = value.strip()
            if candidate:
                return candidate
        return ""

    @staticmethod
    def _clean_identifier(value: Any) -> str:
        if isinstance(value, str):
            candidate = value.strip()
            if candidate:
                return candidate
        return ""

    @staticmethod
    def _clean_slug(value: Any) -> str:
        if isinstance(value, str):
            candidate = value.strip().lower()
            if candidate:
                return candidate
        return ""

    @staticmethod
    def _clean_url(value: Any) -> str | None:
        if isinstance(value, str):
            candidate = value.strip()
            if candidate:
                return candidate.rstrip("/")
        return None

    @staticmethod
    def _clean_secret(value: Any) -> str | None:
        if isinstance(value, str):
            candidate = value.strip()
            if candidate:
                return candidate
        return None

    @staticmethod
    def _extract_client_secret(payload: Mapping[str, Any]) -> str | None:
        # La réponse de l'API OpenAI Realtime a la structure:
        # {"value": "ek_...", "expires_at": ..., "session": {...}}
        value = payload.get("value")
        if isinstance(value, str):
            candidate = value.strip()
            if candidate:
                return candidate
        # Fallback: ancienne structure {"client_secret": {"value": "..."}}
        client_secret = payload.get("client_secret")
        if isinstance(client_secret, Mapping):
            value = client_secret.get("value")
            if isinstance(value, str):
                candidate = value.strip()
                if candidate:
                    return candidate
        return None

    async def _request_client_secret(
        self,
        *,
        user_id: str,
        model: str,
        instructions: str,
        voice: str | None,
        provider_id: str | None,
        provider_slug: str | None,
        realtime: Mapping[str, Any] | None,
        tools: Sequence[Any] | None,
        handoffs: Sequence[Any] | None,
    ) -> dict[str, Any]:
        settings = get_settings()

        voice_value = self._clean_voice(voice)
        realtime_tools_payload = _normalize_realtime_tools_payload(tools)

        def _build_payload(
            voice_mode: Literal["top_level", "session", "none"],
            realtime_mode: Literal["top_level", "session", "none"],
        ) -> dict[str, Any]:
            session_payload: dict[str, Any] = {
                "type": "realtime",
                "instructions": instructions,
                "model": model,
            }
            if realtime_tools_payload is not None:
                session_payload["tools"] = list(realtime_tools_payload)
            if handoffs:
                session_payload["handoffs"] = list(handoffs)

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
            if not voice_value or voice_mode == "none":
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
            if not isinstance(realtime, Mapping) or realtime_mode == "none":
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

        normalized_provider_id = self._clean_identifier(provider_id)
        normalized_provider_slug = self._clean_slug(provider_slug)

        # Optimisation : pour OpenAI, le paramètre voice n'est pas supporté dans
        # l'API client_secrets, donc on évite les tentatives inutiles
        is_openai = normalized_provider_slug == "openai"

        if voice_value and not is_openai:
            # Pour les providers non-OpenAI, essayer d'abord les modes moins verbeux
            voice_modes: list[Literal["top_level", "session", "none"]] = [
                "none",
                "session",
                "top_level",
            ]
        else:
            voice_modes = ["none"]

        if isinstance(realtime, Mapping) and realtime:
            realtime_modes: list[Literal["top_level", "session", "none"]] = [
                "none",
                "session",
                "top_level",
            ]
        elif isinstance(realtime, Mapping):
            realtime_modes = ["session", "none"]
        else:
            realtime_modes = ["none"]

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
            provider_base_override = self._clean_url(
                getattr(credentials, "api_base", None)
            )
            provider_key_override = self._clean_secret(
                getattr(credentials, "api_key", None)
            )
        elif normalized_provider_id:
            for config in settings.model_providers:
                if config.id == normalized_provider_id:
                    if (
                        normalized_provider_slug
                        and config.provider != normalized_provider_slug
                    ):
                        break
                    provider_base_override = self._clean_url(config.api_base)
                    provider_key_override = self._clean_secret(config.api_key)
                    break

        if provider_base_override is None and normalized_provider_slug:
            for config in settings.model_providers:
                if config.provider == normalized_provider_slug:
                    provider_base_override = self._clean_url(config.api_base)
                    provider_key_override = self._clean_secret(config.api_key)
                    break

        if provider_base_override is None and normalized_provider_slug:
            default_provider = self._clean_slug(
                getattr(settings, "model_provider", None)
            )
            if default_provider and default_provider == normalized_provider_slug:
                provider_base_override = self._clean_url(settings.model_api_base)
                provider_key_override = self._clean_secret(settings.model_api_key)

        if provider_base_override is None and normalized_provider_slug == "openai":
            openai_base_env = self._clean_url(os.environ.get("CHATKIT_API_BASE"))
            provider_base_override = openai_base_env or "https://api.openai.com"
            openai_key = self._clean_secret(getattr(settings, "openai_api_key", None))
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
                            "Champs sensibles retirés de la requête Realtime "
                            "client_secret",
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
                        sanitized_response, removed_response = sanitize_value(
                            raw_payload
                        )
                        if removed_response:
                            logger.debug(
                                "Champs sensibles retirés de la réponse Realtime "
                                "client_secret",
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
        except httpx.HTTPError as exc:  # pragma: no cover - erreur réseau rare
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

    async def open_voice_session(
        self,
        *,
        user_id: str,
        model: str,
        instructions: str,
        provider_id: str | None = None,
        provider_slug: str | None = None,
        voice: str | None = None,
        realtime: Mapping[str, Any] | None = None,
        tools: Sequence[Any] | None = None,
        handoffs: Sequence[Any] | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> VoiceSessionHandle:
        normalized_tools = _normalize_realtime_tools_payload(tools)

        agent = self._base_agent.clone(
            instructions=instructions,
            tools=list(normalized_tools or []),
            handoffs=list(handoffs or []),
        )
        runner = RealtimeRunner(agent)

        payload = await self._request_client_secret(
            user_id=user_id,
            model=model,
            instructions=instructions,
            voice=voice,
            provider_id=provider_id,
            provider_slug=provider_slug,
            realtime=realtime,
            tools=normalized_tools,
            handoffs=handoffs,
        )

        session_id = uuid.uuid4().hex
        client_secret = None
        if isinstance(payload, Mapping):
            client_secret = self._extract_client_secret(payload)

        metadata_payload: dict[str, Any] = {
            "user_id": user_id,
            "model": model,
            "voice": voice,
            "provider_id": provider_id,
            "provider_slug": provider_slug,
        }
        if isinstance(realtime, Mapping):
            metadata_payload["realtime"] = dict(realtime)
        if normalized_tools is not None:
            metadata_payload["tools"] = list(normalized_tools)
        if isinstance(metadata, Mapping) and metadata:
            metadata_payload.update(dict(metadata))
        # Toujours propager l'identifiant utilisateur explicite.
        metadata_payload["user_id"] = user_id

        payload_dict: dict[str, Any]
        if isinstance(payload, dict):
            payload_dict = payload
        elif isinstance(payload, Mapping):
            payload_dict = dict(payload)
        else:
            payload_dict = {}

        handle = VoiceSessionHandle(
            session_id=session_id,
            payload=payload_dict,
            agent=agent,
            runner=runner,
            client_secret=client_secret,
            metadata=metadata_payload,
        )

        await self._registry.register(handle)
        logger.debug("Session Realtime enregistrée : %s", handle.summary())
        try:  # pragma: no cover - le gateway peut ne pas être initialisé
            from .realtime_gateway import get_realtime_gateway

            gateway = get_realtime_gateway()
        except Exception:
            gateway = None

        if gateway is not None:
            await gateway.register_session(handle)

        return handle

    async def close_voice_session(
        self,
        *,
        session_id: str | None = None,
        client_secret: str | None = None,
    ) -> bool:
        handle = await self._registry.remove(
            session_id=session_id,
            client_secret=client_secret,
        )
        if handle is None:
            logger.debug(
                "Aucune session Realtime trouvée pour fermeture (session_id=%s)",
                session_id or "<inconnu>",
            )
            return False

        logger.debug("Session Realtime supprimée : %s", handle.summary())
        try:  # pragma: no cover - le gateway peut ne pas être initialisé
            from .realtime_gateway import get_realtime_gateway

            gateway = get_realtime_gateway()
        except Exception:
            gateway = None

        if gateway is not None:
            await gateway.unregister_session(handle=handle)

        return True

    async def get_voice_session(
        self, session_id: str
    ) -> VoiceSessionHandle | None:
        return await self._registry.get(session_id)


_ORCHESTRATOR = RealtimeVoiceSessionOrchestrator()


async def open_voice_session(
    *,
    user_id: str,
    model: str,
    instructions: str,
    provider_id: str | None = None,
    provider_slug: str | None = None,
    voice: str | None = None,
    realtime: Mapping[str, Any] | None = None,
    tools: Sequence[Any] | None = None,
    handoffs: Sequence[Any] | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> VoiceSessionHandle:
    """Ouvre une session vocale Realtime et la référence dans le registre."""

    return await _ORCHESTRATOR.open_voice_session(
        user_id=user_id,
        model=model,
        instructions=instructions,
        provider_id=provider_id,
        provider_slug=provider_slug,
        voice=voice,
        realtime=realtime,
        tools=tools,
        handoffs=handoffs,
        metadata=metadata,
    )


async def close_voice_session(
    *,
    session_id: str | None = None,
    client_secret: str | None = None,
) -> bool:
    """Ferme (logiquement) une session vocale Realtime."""

    return await _ORCHESTRATOR.close_voice_session(
        session_id=session_id,
        client_secret=client_secret,
    )


async def get_voice_session_handle(session_id: str) -> VoiceSessionHandle | None:
    """Retourne le handle d'une session vocale active si elle existe."""

    return await _ORCHESTRATOR.get_voice_session(session_id)


def get_realtime_session_orchestrator() -> RealtimeVoiceSessionOrchestrator:
    """Expose l'orchestrateur pour des usages avancés/tests."""

    return _ORCHESTRATOR


__all__ = [
    "VoiceSessionHandle",
    "RealtimeVoiceSessionOrchestrator",
    "open_voice_session",
    "close_voice_session",
    "get_voice_session_handle",
    "get_realtime_session_orchestrator",
]
