from __future__ import annotations

import asyncio
import builtins
import logging
import os
import re
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlparse

import httpx
from agents.handoffs import Handoff
from agents.mcp import MCPServer, MCPServerSse, MCPServerStreamableHttp
from agents.realtime.agent import RealtimeAgent
from agents.realtime.runner import RealtimeRunner
from agents.tool import (
    CodeInterpreterTool,
    ComputerTool,
    FileSearchTool,
    FunctionTool,
    HostedMCPTool,
    ImageGenerationTool,
    LocalShellTool,
    Tool,
    WebSearchTool,
)
from fastapi import HTTPException, status

from .admin_settings import resolve_model_provider_credentials
from .config import get_settings
from .token_sanitizer import sanitize_value

logger = logging.getLogger("chatkit.realtime.runner")

BaseExceptionGroup = getattr(  # type: ignore[assignment]
    builtins, "BaseExceptionGroup", BaseException
)


def _normalize_realtime_tools_payload(
    tools: Sequence[Any] | Iterable[Any] | None,
    *,
    mcp_server_configs: list[dict[str, Any]] | None = None,
) -> list[Any] | None:
    """Normalise la configuration des outils pour l'API Realtime."""

    if tools is None:
        return None

    if isinstance(tools, str | bytes | bytearray):
        source_entries: list[Any] = [tools]
    elif isinstance(tools, Sequence):
        source_entries = list(tools)
    else:
        source_entries = list(tools)

    normalized: list[Any] = []
    seen_labels: set[str] = set()

    disallowed_tool_keys = {"agent", "function", "metadata"}
    mcp_allowed_keys = {
        "type",
        "server_label",
        "server_url",
        "authorization",
        "name",
        "description",
    }

    for index, entry in enumerate(source_entries):
        if isinstance(entry, FunctionTool):
            tool_entry: dict[str, Any] = {
                "type": "function",
                "name": entry.name,
            }
            description = getattr(entry, "description", None)
            if isinstance(description, str) and description.strip():
                tool_entry["description"] = description.strip()
            parameters = getattr(entry, "params_json_schema", None)
            if isinstance(parameters, Mapping):
                tool_entry["parameters"] = dict(parameters)
            strict_schema = getattr(entry, "strict_json_schema", None)
            if isinstance(strict_schema, bool):
                tool_entry["strict"] = strict_schema
            response = getattr(entry, "response", None)
            if isinstance(response, Mapping):
                tool_entry["response"] = dict(response)
            cache_control = getattr(entry, "cache_control", None)
            if isinstance(cache_control, Mapping):
                tool_entry["cache_control"] = dict(cache_control)
            normalized.append(tool_entry)
            continue

        if isinstance(entry, Mapping):
            raw_entry = dict(entry)

            tool_type = str(
                raw_entry.get("type")
                or raw_entry.get("tool")
                or raw_entry.get("name")
                or ""
            ).strip().lower()

            if tool_type == "function":
                function_source: Mapping[str, Any] | None = None
                raw_function = raw_entry.get("function")
                if isinstance(raw_function, Mapping):
                    function_source = raw_function
                elif isinstance(raw_entry, Mapping):
                    function_source = raw_entry

                normalized_function = (
                    _normalize_function_tool_payload(function_source)
                    if function_source is not None
                    else {}
                )
                tool_entry: dict[str, Any] = {"type": "function"}
                tool_entry.update(normalized_function)
            else:
                tool_entry = {
                    key: value
                    for key, value in raw_entry.items()
                    if key not in disallowed_tool_keys
                }

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

                # L'API Realtime attend le champ `server_url` au lieu de `url`.
                server_url: str | None = None
                raw_server_url = tool_entry.get("server_url")
                if isinstance(raw_server_url, str) and raw_server_url.strip():
                    server_url = raw_server_url.strip()
                else:
                    legacy_keys = ("url", "endpoint", "transport_url")
                    for key in legacy_keys:
                        value = raw_entry.get(key)
                        if isinstance(value, str) and value.strip():
                            server_url = value.strip()
                            break

                if server_url:
                    tool_entry["server_url"] = server_url
                for legacy_key in ("url", "endpoint", "transport_url"):
                    tool_entry.pop(legacy_key, None)

                tool_entry = {
                    key: value
                    for key, value in tool_entry.items()
                    if key in mcp_allowed_keys
                }
                tool_entry["type"] = "mcp"

                if (
                    mcp_server_configs is not None
                    and server_url
                ):
                    transport = raw_entry.get("transport") or raw_entry.get(
                        "connector_transport"
                    )
                    transport_value: str | None = None
                    if isinstance(transport, str):
                        candidate = transport.strip()
                        if candidate:
                            transport_value = candidate.lower()

                    headers: dict[str, str] | None = None
                    raw_headers = raw_entry.get("headers")
                    if isinstance(raw_headers, Mapping):
                        candidate_headers: dict[str, str] = {}
                        for header_key, header_value in raw_headers.items():
                            if isinstance(header_key, str) and isinstance(
                                header_value, str
                            ):
                                candidate_headers[header_key] = header_value
                        if candidate_headers:
                            headers = candidate_headers

                    authorization = raw_entry.get("authorization")
                    authorization_value: str | None = None
                    if isinstance(authorization, str):
                        candidate = authorization.strip()
                        if candidate:
                            authorization_value = candidate

                    mcp_server_configs.append(
                        {
                            "server_label": label,
                            "server_url": server_url,
                            "authorization": authorization_value,
                            "headers": headers,
                            "transport": transport_value,
                        }
                    )

            normalized.append(tool_entry)
        else:
            normalized.append(entry)

    return normalized


_AGENT_TOOL_CLASSES: tuple[type, ...] = (
    FunctionTool,
    HostedMCPTool,
    ComputerTool,
    FileSearchTool,
    WebSearchTool,
    LocalShellTool,
    CodeInterpreterTool,
    ImageGenerationTool,
)


def _filter_agent_tools_for_clone(tools: Sequence[Any] | None) -> list[Tool]:
    """Extrait les outils SDK valides pour l'agent Realtime local."""

    if not tools:
        return []

    valid_tools: list[Tool] = []
    for entry in tools:
        if isinstance(entry, _AGENT_TOOL_CLASSES):
            valid_tools.append(entry)

    return valid_tools


def _filter_agent_handoffs_for_clone(
    handoffs: Sequence[Any] | None,
) -> list[RealtimeAgent[Any] | Handoff[Any, Any]]:
    """Conserve uniquement les handoffs compatibles avec le SDK Agents."""

    if not handoffs:
        return []

    valid_handoffs: list[RealtimeAgent[Any] | Handoff[Any, Any]] = []
    for entry in handoffs:
        if isinstance(entry, RealtimeAgent | Handoff):
            valid_handoffs.append(entry)

    return valid_handoffs


def _create_mcp_server_from_config(
    config: Mapping[str, Any],
) -> MCPServer | None:
    """Instancie un serveur MCP SDK à partir d'une configuration normalisée."""

    server_url = config.get("server_url")
    if not isinstance(server_url, str) or not server_url.strip():
        return None

    headers: dict[str, str] = {}
    raw_headers = config.get("headers")
    if isinstance(raw_headers, Mapping):
        for key, value in raw_headers.items():
            if isinstance(key, str) and isinstance(value, str):
                headers[key] = value

    authorization = config.get("authorization")
    if isinstance(authorization, str):
        normalized_authorization = _normalize_bearer_authorization(authorization)
        if normalized_authorization:
            headers["Authorization"] = normalized_authorization

    transport = config.get("transport")
    transport_value = (
        transport.strip().lower()
        if isinstance(transport, str) and transport.strip()
        else None
    )

    server_label = config.get("server_label")
    server_name = server_label if isinstance(server_label, str) else None

    params: dict[str, Any] = {"url": server_url.strip()}
    if headers:
        params["headers"] = headers

    if transport_value in (None, "", "http_sse", "sse"):
        return MCPServerSse(params=params, name=server_name)
    if transport_value in ("streamable_http", "streamable-http", "http_streamable"):
        return MCPServerStreamableHttp(params=params, name=server_name)

    logger.warning(
        "Transport MCP %s non supporté pour %s",
        transport_value,
        server_url,
    )
    return None


def _normalize_bearer_authorization(raw_value: str) -> str | None:
    """Normalise un jeton d'autorisation en entête Bearer."""

    token = raw_value.strip()
    if not token:
        return None

    lower_token = token.lower()
    if lower_token.startswith("bearer "):
        token = token[7:].strip()
    elif lower_token == "bearer":
        return None

    if not token:
        return None

    return f"Bearer {token}"


def _extract_http_status_error(
    exc: BaseException,
) -> httpx.HTTPStatusError | None:
    """Recherche récursivement une erreur HTTPStatusError dans une exception."""

    visited: set[int] = set()
    stack: list[BaseException] = [exc]

    while stack:
        current = stack.pop()
        current_id = id(current)
        if current_id in visited:
            continue
        visited.add(current_id)

        if isinstance(current, httpx.HTTPStatusError):
            return current

        if isinstance(current, BaseExceptionGroup):
            stack.extend(current.exceptions)

        cause = current.__cause__
        if cause is not None:
            stack.append(cause)

        context = current.__context__
        if context is not None:
            stack.append(context)

    return None


async def _connect_mcp_servers(
    configs: Sequence[Mapping[str, Any]],
) -> list[MCPServer]:
    """Crée et connecte les serveurs MCP définis dans la configuration."""

    servers: list[MCPServer] = []
    for config in configs:
        server = _create_mcp_server_from_config(config)
        if server is None:
            continue
        try:
            await server.connect()
        except Exception as exc:  # pragma: no cover - dépendances externes
            await _cleanup_mcp_servers(servers)
            http_error = _extract_http_status_error(exc)
            if http_error is not None and http_error.response is not None:
                response = http_error.response
                error_detail = {
                    "error": "MCP server connection failed",
                    "server_url": config.get("server_url"),
                    "status_code": response.status_code,
                    "reason": response.reason_phrase,
                }
                sanitized_detail, _ = sanitize_value(error_detail)
                logger.error(
                    "Échec de connexion au serveur MCP %s : %s",
                    config.get("server_url"),
                    sanitized_detail,
                    exc_info=exc,
                )
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=sanitized_detail,
                ) from http_error

            logger.exception(
                "Échec de connexion au serveur MCP %s",
                config.get("server_url"),
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"error": "MCP server connection failed"},
            ) from exc
        servers.append(server)

    return servers


async def _cleanup_mcp_servers(servers: Sequence[MCPServer]) -> None:
    """Ferme proprement les serveurs MCP gérés par la session."""

    for server in servers:
        try:
            await server.cleanup()
        except Exception:  # pragma: no cover - nettoyage best effort
            logger.debug(
                "Échec du nettoyage du serveur MCP %s",
                getattr(server, "name", "<inconnu>"),
                exc_info=True,
            )


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


def _normalize_function_tool_payload(value: Any) -> dict[str, Any]:
    """Transforme la configuration des fonctions au format Realtime attendu."""

    if not isinstance(value, Mapping):
        return {}

    normalized: dict[str, Any] = {}

    name = value.get("name")
    if isinstance(name, str) and name.strip():
        normalized["name"] = name.strip()

    description = value.get("description")
    if isinstance(description, str) and description.strip():
        normalized["description"] = description.strip()

    parameters = value.get("parameters")
    if isinstance(parameters, Mapping):
        normalized["parameters"] = dict(parameters)

    strict = value.get("strict")
    if isinstance(strict, bool):
        normalized["strict"] = strict

    cache_control = value.get("cache_control")
    if isinstance(cache_control, Mapping):
        normalized["cache_control"] = dict(cache_control)

    response = value.get("response")
    if isinstance(response, Mapping):
        normalized["response"] = dict(response)

    return normalized


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
    mcp_servers: list[MCPServer] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        """Retourne une vue résumée de la session pour le debug."""

        return {
            "session_id": self.session_id,
            "client_secret_present": bool(self.client_secret),
            "metadata": dict(self.metadata),
            "mcp_server_count": len(self.mcp_servers),
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
            voice_mode: Literal["include", "none"],
            realtime_mode: Literal["include", "none"],
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

            audio_input: dict[str, Any] = {}
            audio_output: dict[str, Any] = {}

            if voice_mode == "include" and voice_value:
                audio_output["voice"] = voice_value

            if isinstance(realtime, Mapping) and realtime_mode == "include":
                modalities = realtime.get("modalities")
                if isinstance(modalities, Sequence):
                    normalized_modalities: list[str] = []
                    for modality in modalities:
                        if isinstance(modality, str):
                            value = modality.strip()
                        elif isinstance(modality, bytes):
                            try:
                                value = modality.decode().strip()
                            except UnicodeDecodeError:
                                continue
                        else:
                            continue
                        if value:
                            normalized_modalities.append(value)
                    if normalized_modalities:
                        session_payload["modalities"] = normalized_modalities

                speed = realtime.get("speed")
                if isinstance(speed, int | float):
                    audio_output["speed"] = float(speed)

                output_format = realtime.get("output_audio_format")
                if isinstance(output_format, Mapping):
                    audio_output["format"] = dict(output_format)

                input_format = realtime.get("input_audio_format")
                if isinstance(input_format, Mapping):
                    audio_input["format"] = dict(input_format)

                turn_detection = realtime.get("turn_detection")
                if isinstance(turn_detection, Mapping):
                    audio_input["turn_detection"] = dict(turn_detection)

                noise_reduction = realtime.get("input_audio_noise_reduction")
                if isinstance(noise_reduction, Mapping):
                    audio_input["noise_reduction"] = dict(noise_reduction)

                transcription = realtime.get("input_audio_transcription")
                if isinstance(transcription, Mapping):
                    audio_input["transcription"] = dict(transcription)

            audio_payload: dict[str, Any] = {}
            if audio_input:
                audio_payload["input"] = audio_input
            if audio_output:
                audio_payload["output"] = audio_output
            if audio_payload:
                session_payload["audio"] = audio_payload

            return {"session": session_payload}

        def _should_retry_voice_mode(
            voice_mode: Literal["include", "none"],
            error_payload: Any,
        ) -> bool:
            if voice_mode == "none" or not voice_value:
                return False
            if not isinstance(error_payload, dict):
                return False
            error_details = error_payload.get("error")
            if not isinstance(error_details, dict):
                return False
            if error_details.get("code") != "unknown_parameter":
                return False
            param_value = error_details.get("param")
            if not isinstance(param_value, str):
                return False
            return param_value in {
                "voice",
                "session.voice",
                "audio.output.voice",
                "session.audio.output.voice",
            }

        def _should_retry_realtime_mode(
            realtime_mode: Literal["include", "none"],
            error_payload: Any,
        ) -> bool:
            if realtime_mode == "none" or not isinstance(realtime, Mapping):
                return False
            if not isinstance(error_payload, dict):
                return False
            error_details = error_payload.get("error")
            if not isinstance(error_details, dict):
                return False
            if error_details.get("code") != "unknown_parameter":
                return False
            param_value = error_details.get("param")
            if not isinstance(param_value, str):
                return False
            realtime_params = {
                "realtime",
                "session.realtime",
                "audio",
                "session.audio",
                "audio.input",
                "session.audio.input",
                "audio.output",
                "session.audio.output",
                "audio.input.format",
                "session.audio.input.format",
                "audio.input.turn_detection",
                "session.audio.input.turn_detection",
                "audio.input.noise_reduction",
                "session.audio.input.noise_reduction",
                "audio.input.transcription",
                "session.audio.input.transcription",
                "audio.output.format",
                "session.audio.output.format",
                "audio.output.speed",
                "session.audio.output.speed",
            }
            return param_value in realtime_params

        normalized_provider_id = self._clean_identifier(provider_id)
        normalized_provider_slug = self._clean_slug(provider_slug)

        if voice_value:
            voice_modes: list[Literal["include", "none"]] = ["include", "none"]
        else:
            voice_modes = ["none"]

        if isinstance(realtime, Mapping) and realtime:
            realtime_modes: list[Literal["include", "none"]] = ["include", "none"]
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
        agent_tools = _filter_agent_tools_for_clone(tools)
        agent_handoffs = _filter_agent_handoffs_for_clone(handoffs)

        mcp_server_configs: list[dict[str, Any]] = []
        normalized_tools = _normalize_realtime_tools_payload(
            tools, mcp_server_configs=mcp_server_configs
        )

        agent_mcp_servers: list[MCPServer] = []
        handle: VoiceSessionHandle | None = None

        try:
            agent_mcp_servers = await _connect_mcp_servers(mcp_server_configs)

            agent = self._base_agent.clone(
                instructions=instructions,
                tools=agent_tools,
                handoffs=agent_handoffs,
                mcp_servers=agent_mcp_servers,
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
                json_safe_tools: list[Any] = []
                for entry in normalized_tools:
                    if isinstance(entry, Mapping):
                        json_safe_tools.append(dict(entry))
                    elif isinstance(entry, Tool):
                        # Ces objets ne sont pas sérialisables en JSON.
                        continue
                    else:
                        json_safe_tools.append(entry)
                if json_safe_tools:
                    metadata_payload["tools"] = json_safe_tools
            if agent_tools:
                metadata_payload["sdk_tools"] = list(agent_tools)
            if mcp_server_configs:
                metadata_payload["mcp_servers"] = [
                    {
                        "server_label": config.get("server_label"),
                        "server_url": config.get("server_url"),
                        "transport": config.get("transport"),
                    }
                    for config in mcp_server_configs
                ]
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
                mcp_servers=agent_mcp_servers,
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
        except Exception:
            if handle is not None:
                await self._registry.remove(session_id=handle.session_id)
                await _cleanup_mcp_servers(handle.mcp_servers)
            else:
                await _cleanup_mcp_servers(agent_mcp_servers)
            raise

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

        await _cleanup_mcp_servers(handle.mcp_servers)

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
