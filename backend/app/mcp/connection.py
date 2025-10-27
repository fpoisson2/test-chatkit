"""Helpers to validate connectivity with existing MCP servers."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from typing import Any

import httpx
from agents.mcp.server import MCPServer
from agents.tool import HostedMCPTool
from pydantic import BaseModel, Field

from ..tool_factory import build_mcp_tool

logger = logging.getLogger("chatkit.mcp.connection")

_DEFAULT_TIMEOUT_SECONDS = 10.0


class MCPConnectionStatus(BaseModel):
    """Represents the outcome of an MCP connectivity probe."""

    ok: bool = Field(..., description="True when the server responded successfully.")
    message: str = Field(..., description="Human friendly status message.")


async def probe_mcp_connection(
    config: Any, *, timeout: float | None = None
) -> MCPConnectionStatus:
    """Attempt to connect to the configured MCP server and list its tools."""

    effective_timeout = _DEFAULT_TIMEOUT_SECONDS
    if isinstance(timeout, int | float) and timeout > 0:
        effective_timeout = float(timeout)

    payload: Any = config
    if (
        isinstance(config, Mapping)
        and "mcp" not in config
        and config.get("type") != "mcp"
    ):
        payload = {"type": "mcp", "mcp": dict(config)}

    try:
        tool = build_mcp_tool(payload, raise_on_error=True)
    except ValueError as exc:
        logger.warning("Invalid MCP configuration for probe: %s", exc)
        return MCPConnectionStatus(ok=False, message=str(exc))
    except Exception:  # pragma: no cover - defensive guard
        logger.exception("Unexpected error while preparing MCP tool for probe")
        return MCPConnectionStatus(
            ok=False,
            message="Impossible de préparer la configuration MCP fournie.",
        )

    if tool is None:
        return MCPConnectionStatus(
            ok=False, message="Configuration MCP non reconnue ou incomplète."
        )

    if isinstance(tool, HostedMCPTool):
        return await _probe_hosted_tool(tool, effective_timeout)

    if isinstance(tool, MCPServer):
        return await _probe_mcp_server(tool, effective_timeout)

    logger.warning("Unsupported MCP tool type for probe: %s", type(tool))
    return MCPConnectionStatus(
        ok=False, message="Type de serveur MCP non pris en charge pour le test."
    )


async def _probe_mcp_server(
    server: MCPServer, timeout: float
) -> MCPConnectionStatus:
    """Connect to a stdio/HTTP/SSE server and run list_tools."""

    try:
        await asyncio.wait_for(server.connect(), timeout=timeout)
        tools = await asyncio.wait_for(server.list_tools(), timeout=timeout)
    except asyncio.TimeoutError:
        logger.warning(
            "Timeout while probing MCP server %s",
            getattr(server, "name", ""),
        )
        return MCPConnectionStatus(
            ok=False, message="La connexion au serveur MCP a expiré."
        )
    except Exception as exc:  # pragma: no cover - depends on transport
        logger.warning("Failed to probe MCP server %s", server, exc_info=exc)
        return MCPConnectionStatus(
            ok=False,
            message=f"Erreur lors de la connexion au serveur MCP : {exc}",
        )
    finally:
        try:
            await asyncio.wait_for(server.cleanup(), timeout=timeout)
        except Exception:  # pragma: no cover - cleanup best effort
            logger.debug("Unable to cleanup MCP server probe resources", exc_info=True)

    count = len(tools) if isinstance(tools, list) else 0
    label = getattr(server, "name", None) or "MCP"
    message = (
        "Connexion établie avec le serveur "
        f"{label} ({count} outil(s) disponible(s))."
    )
    return MCPConnectionStatus(ok=True, message=message)


async def _probe_hosted_tool(
    tool: HostedMCPTool, timeout: float
) -> MCPConnectionStatus:
    """Send a minimal tools/list request to a hosted MCP endpoint."""

    config = dict(tool.tool_config)
    server_label = str(config.get("server_label") or config.get("label") or "MCP")
    server_url = config.get("server_url")
    if not isinstance(server_url, str) or not server_url.strip():
        return MCPConnectionStatus(
            ok=False,
            message="Impossible de tester ce serveur MCP hébergé sans URL publique.",
        )

    headers: dict[str, str] = {"Content-Type": "application/json"}
    authorization = config.get("authorization")
    if isinstance(authorization, str) and authorization.strip():
        headers["Authorization"] = authorization.strip()

    extra_headers = config.get("headers")
    if isinstance(extra_headers, Mapping):
        for key, value in extra_headers.items():
            if not isinstance(key, str):
                continue
            if isinstance(value, str | int | float):
                headers[key] = str(value)
            elif isinstance(value, bytes):
                try:
                    headers[key] = value.decode("utf-8")
                except UnicodeDecodeError:
                    continue

    payload = {
        "jsonrpc": "2.0",
        "id": "chatkit-probe",
        "method": "tools/list",
        "params": {},
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(server_url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
    except httpx.TimeoutException:
        logger.warning("Timeout while probing hosted MCP server %s", server_url)
        return MCPConnectionStatus(
            ok=False, message="La connexion au serveur MCP hébergé a expiré."
        )
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Hosted MCP server %s rejected probe with status %s",
            server_url,
            exc.response.status_code,
        )
        return MCPConnectionStatus(
            ok=False,
            message=(
                "Le serveur MCP a refusé la requête (statut "
                f"{exc.response.status_code})."
            ),
        )
    except httpx.HTTPError as exc:
        logger.warning(
            "HTTP error while probing hosted MCP server %s",
            server_url,
            exc_info=exc,
        )
        return MCPConnectionStatus(
            ok=False, message="Erreur réseau lors de la connexion au serveur MCP."
        )
    except ValueError as exc:
        logger.warning(
            "Invalid JSON payload from hosted MCP server %s",
            server_url,
            exc_info=exc,
        )
        return MCPConnectionStatus(
            ok=False,
            message="Réponse JSON inattendue du serveur MCP hébergé.",
        )

    tools = []
    if isinstance(data, Mapping):
        result = data.get("result")
        if isinstance(result, Mapping):
            raw_tools = result.get("tools")
            if isinstance(raw_tools, list):
                tools = raw_tools

    count = len(tools)
    return MCPConnectionStatus(
        ok=True,
        message=(
            "Connexion établie avec le serveur hébergé "
            f"{server_label} ({count} outil(s) disponible(s))."
        ),
    )
