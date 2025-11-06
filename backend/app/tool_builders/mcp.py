"""Builders et utilitaires MCP."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from agents.mcp import MCPServerSse

from ..database import SessionLocal
from ..models import McpServer
from ..secret_utils import decrypt_secret

logger = logging.getLogger("chatkit.server")

__all__ = [
    "ResolvedMcpServerContext",
    "build_mcp_tool",
    "resolve_mcp_tool_configuration",
    "get_mcp_runtime_context",
    "attach_mcp_runtime_context",
]

_SENSITIVE_HEADER_MARKERS = (
    "authorization",
    "token",
    "secret",
    "key",
    "cookie",
)


@dataclass(slots=True)
class ResolvedMcpServerContext:
    """Runtime metadata extracted while building an MCP tool."""

    record: McpServer | None
    server_id: int | None
    label: str | None
    server_url: str
    transport: str
    authorization: str | None
    authorization_token: str | None
    allowlist: tuple[str, ...] | None


_MCP_RUNTIME_CONTEXT_ATTR = "_chatkit_mcp_runtime_context"


def _mask_sensitive_header_value(value: Any) -> str:
    string_value = str(value)
    if not string_value:
        return "<vide>"
    if len(string_value) <= 8:
        return "***"
    return f"{string_value[:3]}…{string_value[-3:]}"


def _headers_preview_for_logging(
    headers: Mapping[str, Any] | None,
) -> dict[str, str] | None:
    if not headers:
        return None

    sanitized: dict[str, str] = {}
    for raw_key, raw_value in headers.items():
        key = str(raw_key)
        value = str(raw_value)
        lower_key = key.lower()
        if any(marker in lower_key for marker in _SENSITIVE_HEADER_MARKERS):
            sanitized[key] = _mask_sensitive_header_value(value)
        else:
            sanitized[key] = value

    return sanitized or None


def _coerce_positive_float(value: Any, *, field_name: str) -> float | None:
    """Convertit la valeur fournie en float strictement positif."""

    if value is None:
        return None

    candidate: float
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        candidate = float(value)
    elif isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            message = (
                f"Le champ {field_name} doit être un nombre strictement positif."
            )
            raise ValueError(message)
        try:
            candidate = float(stripped)
        except ValueError as exc:  # pragma: no cover - chemin exceptionnel
            message = (
                f"Le champ {field_name} doit être un nombre strictement positif."
            )
            raise ValueError(message) from exc
    else:
        message = (
            f"Le champ {field_name} doit être un nombre strictement positif."
        )
        raise ValueError(message)

    if candidate <= 0:
        message = (
            f"Le champ {field_name} doit être un nombre strictement positif."
        )
        raise ValueError(message)

    return candidate


def _extract_mcp_payload(payload: Any) -> Mapping[str, Any]:
    if isinstance(payload, Mapping):
        return payload

    raise ValueError("La configuration MCP doit être un objet JSON.")


def get_mcp_runtime_context(server: MCPServerSse) -> ResolvedMcpServerContext | None:
    """Retrieve the runtime context previously attached to an MCP server."""

    context = getattr(server, _MCP_RUNTIME_CONTEXT_ATTR, None)
    if isinstance(context, ResolvedMcpServerContext):
        return context
    return None


def attach_mcp_runtime_context(
    server: MCPServerSse, context: ResolvedMcpServerContext
) -> None:
    """Attach runtime metadata to an MCP server instance."""

    setattr(server, _MCP_RUNTIME_CONTEXT_ATTR, context)


def resolve_mcp_tool_configuration(
    payload: Any,
) -> tuple[dict[str, Any], ResolvedMcpServerContext | None]:
    """Resolve an arbitrary MCP payload into a normalized configuration."""

    config = dict(_extract_mcp_payload(payload))
    return _resolve_mcp_configuration(config)


def _resolve_mcp_configuration(
    config: Mapping[str, Any]
) -> tuple[dict[str, Any], ResolvedMcpServerContext | None]:
    merged_config = dict(config)

    server_block = merged_config.get("server")
    if isinstance(server_block, Mapping):
        if "server_id" not in merged_config and "id" in server_block:
            merged_config["server_id"] = server_block.get("id")
        if "label" not in merged_config and "label" in server_block:
            merged_config["label"] = server_block.get("label")

    server_id_value = merged_config.get("server_id")
    resolved_server: McpServer | None = None
    resolved_server_id: int | None = None

    if server_id_value is not None:
        if isinstance(server_id_value, int):
            resolved_server_id = server_id_value
        elif isinstance(server_id_value, str) and server_id_value.strip():
            try:
                resolved_server_id = int(server_id_value.strip())
            except ValueError as exc:
                raise ValueError("Identifiant de serveur MCP invalide.") from exc
        else:
            raise ValueError("Identifiant de serveur MCP invalide.")

        with SessionLocal() as session:
            resolved_server = session.get(McpServer, resolved_server_id)
        if resolved_server is None:
            raise ValueError("Serveur MCP introuvable pour server_id fourni.")

    raw_type = merged_config.get("type") or merged_config.get("name")
    if isinstance(raw_type, str) and raw_type.strip():
        normalized_type = raw_type.strip().lower()
        if normalized_type not in {"", "mcp"}:
            raise ValueError("Le type d'outil MCP doit être 'mcp'.")

    raw_transport = (
        merged_config.get("transport")
        or merged_config.get("kind")
        or (resolved_server.transport if resolved_server else None)
    )
    if not isinstance(raw_transport, str) or not raw_transport.strip():
        normalized_transport = "http_sse"
    else:
        candidate = raw_transport.strip().lower()
        if candidate in {"sse", "http_sse"}:
            normalized_transport = "http_sse"
        elif candidate in {"streamable_http", "streamable-http", "http_streamable"}:
            normalized_transport = "streamable_http"
        else:
            raise ValueError("Le transport MCP supporté est 'http_sse'.")

    raw_url = merged_config.get("url") or merged_config.get("server_url")
    if not isinstance(raw_url, str) or not raw_url.strip():
        if resolved_server is not None and resolved_server.server_url:
            normalized_url = resolved_server.server_url.strip()
        else:
            raise ValueError("Le champ 'url' est obligatoire pour une connexion MCP.")
    else:
        normalized_url = raw_url.strip()

    raw_headers = merged_config.get("headers")
    headers: dict[str, str] = {}
    if isinstance(raw_headers, Mapping):
        for key, value in raw_headers.items():
            if isinstance(key, str) and isinstance(value, str):
                trimmed_key = key.strip()
                trimmed_value = value.strip()
                if trimmed_key and trimmed_value:
                    headers[trimmed_key] = trimmed_value

    raw_authorization = merged_config.get("authorization")
    if raw_authorization is None and resolved_server is not None:
        raw_authorization = decrypt_secret(resolved_server.authorization_encrypted)
        if raw_authorization:
            logger.debug(
                "Authorization récupérée depuis la BDD pour server_id=%d (longueur: %d)",
                resolved_server.id,
                len(raw_authorization),
            )
        else:
            logger.warning(
                "Aucune authorization trouvée dans la BDD pour server_id=%d "
                "(authorization_encrypted=%s)",
                resolved_server.id,
                "présent" if resolved_server.authorization_encrypted else "absent",
            )

    authorization_token: str | None = None
    if raw_authorization is not None:
        if not isinstance(raw_authorization, str):
            raise ValueError(
                "Le champ 'authorization' doit être une chaîne de caractères."
            )
        token = raw_authorization.strip()
        if token:
            lower = token.lower()
            if lower.startswith("bearer "):
                token = token[7:].strip()
            elif lower == "bearer":
                token = ""
            if not token:
                raise ValueError(
                    "Le champ 'authorization' doit contenir un jeton Bearer valide."
                )
            authorization_token = token
        else:
            raise ValueError(
                "Le champ 'authorization' ne peut pas être une chaîne vide."
            )

    authorization_header: str | None = None
    if authorization_token:
        authorization_header = f"Bearer {authorization_token}"

    timeout = _coerce_positive_float(
        merged_config.get("timeout"), field_name="timeout"
    )
    sse_read_timeout = _coerce_positive_float(
        merged_config.get("sse_read_timeout"), field_name="sse_read_timeout"
    )
    client_session_timeout = _coerce_positive_float(
        merged_config.get("client_session_timeout_seconds"),
        field_name="client_session_timeout_seconds",
    )

    tool_name = None
    raw_name = merged_config.get("name")
    if isinstance(raw_name, str):
        stripped = raw_name.strip()
        tool_name = stripped or None

    allowlist: list[str] = []
    allow_config = merged_config.get("allow") or merged_config.get("allowlist")
    if isinstance(allow_config, Mapping):
        candidates = allow_config.get("tools")
    else:
        candidates = allow_config
    if isinstance(candidates, (list, tuple, set)):
        for entry in candidates:
            if isinstance(entry, str):
                trimmed = entry.strip()
                if trimmed:
                    allowlist.append(trimmed)

    if resolved_server and isinstance(resolved_server.tools_cache, Mapping):
        cache_tools = resolved_server.tools_cache.get("tool_names")
        if isinstance(cache_tools, (list, tuple, set)):
            for entry in cache_tools:
                if isinstance(entry, str):
                    trimmed = entry.strip()
                    if trimmed:
                        allowlist.append(trimmed)

    if allowlist:
        seen: dict[str, None] = {}
        for entry in allowlist:
            if entry not in seen:
                seen[entry] = None
        normalized_allowlist: tuple[str, ...] | None = tuple(seen.keys())
    else:
        normalized_allowlist = None

    context = ResolvedMcpServerContext(
        record=resolved_server,
        server_id=resolved_server.id if resolved_server else resolved_server_id,
        label=(
            resolved_server.label
            if resolved_server is not None
            else (
                merged_config.get("label")
                if isinstance(merged_config.get("label"), str)
                else None
            )
        ),
        server_url=normalized_url,
        transport=normalized_transport,
        authorization=authorization_header,
        authorization_token=authorization_token,
        allowlist=normalized_allowlist,
    )

    normalized_config: dict[str, Any] = {
        "type": "mcp",
        "transport": normalized_transport,
        "url": normalized_url,
    }
    if headers:
        normalized_config["headers"] = headers
    if authorization_header:
        normalized_config["authorization"] = authorization_header
    if timeout is not None:
        normalized_config["timeout"] = timeout
    if sse_read_timeout is not None:
        normalized_config["sse_read_timeout"] = sse_read_timeout
    if client_session_timeout is not None:
        normalized_config["client_session_timeout_seconds"] = client_session_timeout
    if tool_name is not None:
        normalized_config["name"] = tool_name

    return normalized_config, context


def build_mcp_tool(payload: Any) -> MCPServerSse:
    """Construit une instance réutilisable de serveur MCP via SSE."""

    if isinstance(payload, MCPServerSse):
        return payload

    normalized_config, context = resolve_mcp_tool_configuration(payload)

    params: dict[str, Any] = {"url": normalized_config["url"]}
    headers = normalized_config.get("headers")
    normalized_headers: dict[str, str] | None = None
    if isinstance(headers, Mapping) and headers:
        normalized_headers = {str(key): str(value) for key, value in headers.items()}
    if normalized_headers is None:
        normalized_headers = {}

    normalized_headers.setdefault("Accept", "text/event-stream")
    normalized_headers.setdefault("Cache-Control", "no-cache")

    headers_preview = _headers_preview_for_logging(normalized_headers)

    if normalized_headers:
        params["headers"] = normalized_headers

    timeout = normalized_config.get("timeout")
    if isinstance(timeout, (int, float)):
        params["timeout"] = timeout

    sse_read_timeout = normalized_config.get("sse_read_timeout")
    if isinstance(sse_read_timeout, (int, float)):
        params["sse_read_timeout"] = sse_read_timeout

    client_session_timeout = normalized_config.get(
        "client_session_timeout_seconds"
    )
    if isinstance(client_session_timeout, (int, float)):
        params["client_session_timeout_seconds"] = client_session_timeout

    tool_name = normalized_config.get("name")
    if isinstance(tool_name, str) and tool_name.strip():
        params["name"] = tool_name.strip()

    server = MCPServerSse(**params)

    if context:
        attach_mcp_runtime_context(server, context)

    if headers_preview:
        logger.debug(
            "Connexion MCP initialisée (url=%s, headers=%s)",
            normalized_config["url"],
            headers_preview,
        )

    return server
