from __future__ import annotations

import datetime
import logging
from collections.abc import Mapping
from typing import Any

import httpx
from agents.mcp import MCPServerSse

from ..database import SessionLocal
from ..models import McpServer
from ..tool_factory import build_mcp_tool, get_mcp_runtime_context

logger = logging.getLogger("chatkit.mcp")


async def probe_mcp_connection(
    config: Mapping[str, Any] | MCPServerSse,
) -> dict[str, Any]:
    """Établit une connexion MCP pour valider l'accès au serveur distant."""

    server = build_mcp_tool(config)
    context = get_mcp_runtime_context(server)

    params: Mapping[str, Any] | None = getattr(server, "params", None)
    headers_preview: dict[str, str] | None = None
    timeout_preview: dict[str, Any] = {}
    if isinstance(params, Mapping):
        if "headers" in params:
            headers_preview = _format_headers_for_logging(params.get("headers"))
        if "timeout" in params:
            timeout_preview["timeout"] = params.get("timeout")
        if "sse_read_timeout" in params:
            timeout_preview["sse_read_timeout"] = params.get("sse_read_timeout")
        if "client_session_timeout_seconds" in params:
            timeout_preview["client_session_timeout_seconds"] = params.get(
                "client_session_timeout_seconds"
            )

    logger.debug(
        (
            "Préparation d'une connexion MCP | url=%s transport=%s server_id=%s "
            "has_authorization=%s headers=%s timeouts=%s"
        ),
        _safe_url(server),
        context.transport if context else "<inconnu>",
        context.server_id if context else None,
        bool(context and context.authorization),
        headers_preview,
        timeout_preview or None,
    )

    tools: list[Any]

    try:
        await server.connect()
        tools = await server.list_tools()
        logger.debug(
            "Connexion MCP réussie | url=%s outils=%d allowlist=%s",
            _safe_url(server),
            len(tools),
            context.allowlist if context else None,
        )
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        if status_code == 401:
            status_label = "unauthorized"
            detail = "Authentification refusée par le serveur MCP."
        elif status_code == 403:
            status_label = "forbidden"
            detail = "Accès refusé par le serveur MCP."
        else:
            status_label = "http_error"
            detail = f"Le serveur MCP a renvoyé le statut HTTP {status_code}."
        response_headers = _format_headers_for_logging(exc.response.headers)
        response_body = _preview_response_text(exc.response)
        logger.warning(
            (
                "Test de connexion MCP échoué (HTTP %s) pour %s | "
                "response_headers=%s | body=%s"
            ),
            status_code,
            _safe_url(server),
            response_headers,
            response_body,
        )
        return {
            "status": status_label,
            "detail": detail,
            "status_code": status_code,
        }
    except httpx.TimeoutException:
        logger.warning(
            "Test de connexion MCP échoué (timeout) pour %s",
            _safe_url(server),
        )
        return {
            "status": "timeout",
            "detail": "Le serveur MCP n'a pas répondu avant l'expiration du délai.",
        }
    except Exception as exc:  # pragma: no cover - robustesse
        logger.exception("Erreur inattendue lors du test de connexion MCP")
        return {
            "status": "error",
            "detail": str(exc),
        }
    finally:
        await server.cleanup()

    tool_names = [
        getattr(tool, "name", None)
        for tool in tools
        if getattr(tool, "name", None)
    ]

    result: dict[str, Any] = {
        "status": "ok",
        "detail": f"Connexion établie ({len(tools)} outil(s) disponible(s)).",
        "tool_names": tool_names,
    }

    if context and context.server_id is not None:
        result["server_id"] = context.server_id
        if context.allowlist:
            result["allow"] = {"tools": list(context.allowlist)}

        with SessionLocal() as session:
            record = session.get(McpServer, context.server_id)
            if record is not None and result["status"] == "ok":
                now = datetime.datetime.now(datetime.UTC)
                storage_payload = {
                    "status": result["status"],
                    "detail": result["detail"],
                    "tool_names": tool_names,
                }
                record.tools_cache = storage_payload
                record.tools_cache_updated_at = now
                session.add(record)
                session.commit()
                session.refresh(record)
                result["tools_cache_updated_at"] = (
                    record.tools_cache_updated_at.isoformat()
                )

    return result


def _safe_url(server: MCPServerSse) -> str:
    params = getattr(server, "params", {})
    return params.get("url", "<inconnu>")


_SENSITIVE_HEADER_MARKERS = (
    "authorization",
    "token",
    "secret",
    "key",
    "cookie",
)


def _mask_sensitive_value(value: Any) -> str:
    string_value = str(value)
    if not string_value:
        return "<vide>"
    if len(string_value) <= 8:
        return "***"
    return f"{string_value[:3]}…{string_value[-3:]}"


def _format_headers_for_logging(headers: Any) -> dict[str, str] | None:
    if not isinstance(headers, Mapping):
        return None

    sanitized: dict[str, str] = {}
    for raw_key, raw_value in headers.items():
        key = str(raw_key)
        value = str(raw_value)
        lower_key = key.lower()
        if any(marker in lower_key for marker in _SENSITIVE_HEADER_MARKERS):
            sanitized[key] = _mask_sensitive_value(value)
        else:
            sanitized[key] = value
    return sanitized or None


def _preview_response_text(response: httpx.Response) -> str:
    try:
        text = response.text
    except Exception:  # pragma: no cover - lecture défensive
        return "<non disponible>"

    return _trim_preview(text)


def _trim_preview(payload: str, *, limit: int = 512) -> str:
    if len(payload) <= limit:
        return payload
    return f"{payload[:limit]}…"
