from __future__ import annotations

import logging
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from ..mcp.connection import MCPConnectionStatus, probe_mcp_connection
from ..weather import fetch_weather

router = APIRouter()

logger = logging.getLogger("chatkit.tools")


class MCPConnectionProbeRequest(BaseModel):
    """Payload accepted by the MCP connection test endpoint."""

    type: Literal["mcp"] | None = Field(
        default="mcp", description="Type d'outil attendu (forcé à 'mcp')."
    )
    mcp: dict[str, Any] = Field(
        default_factory=dict,
        description="Configuration MCP telle qu'envoyée par le workflow builder.",
    )


@router.get("/api/tools/weather")
async def get_weather(
    city: str = Query(..., min_length=1, description="Ville ou localité à rechercher"),
    country: str | None = Query(
        None,
        min_length=2,
        description="Optionnel : pays ou code pays ISO pour affiner la recherche",
    ),
):
    logger.info("Client tool get_weather invoked city=%s country=%s", city, country)
    try:
        return await fetch_weather(city, country)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="La requête vers le fournisseur météo a échoué.",
        ) from exc


@router.post(
    "/api/tools/mcp/test-connection", response_model=MCPConnectionStatus
)
async def test_mcp_connection(
    payload: MCPConnectionProbeRequest,
) -> MCPConnectionStatus:
    """Trigger a connectivity probe against an existing MCP server."""

    config = payload.model_dump(exclude_none=True)
    logger.info("Testing MCP connection for payload with keys: %s", list(config.keys()))
    result = await probe_mcp_connection(config)
    return result
