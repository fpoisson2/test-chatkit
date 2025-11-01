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

    tools: list[Any]

    try:
        await server.connect()
        tools = await server.list_tools()
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
        logger.warning(
            "Test de connexion MCP échoué (HTTP %s) pour %s",
            status_code,
            _safe_url(server),
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
