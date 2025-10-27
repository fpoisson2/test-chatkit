from __future__ import annotations

import logging
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field

from ..mcp.connection import probe_mcp_connection
from ..weather import fetch_weather

router = APIRouter()

logger = logging.getLogger("chatkit.tools")


class MCPTestConnectionPayload(BaseModel):
    type: Literal["mcp"] = Field(
        ..., description="Type d'outil attendu, doit toujours valoir 'mcp'."
    )
    transport: Literal["http_sse"] = Field(
        ..., description="Type de transport MCP supporté par le backend."
    )
    url: AnyHttpUrl = Field(..., description="URL publique du serveur MCP externe.")
    authorization: str | None = Field(
        None,
        min_length=1,
        description="Jeton d'autorisation à envoyer dans l'en-tête Authorization.",
    )
    timeout: float | None = Field(
        None, gt=0, description="Délai maximal (en secondes) pour l'établissement HTTP."
    )
    sse_read_timeout: float | None = Field(
        None,
        gt=0,
        description="Délai maximal (en secondes) pour la lecture des événements SSE.",
    )
    client_session_timeout_seconds: float | None = Field(
        None,
        gt=0,
        description="Délai maximal (en secondes) pour la session cliente MCP.",
    )
    name: str | None = Field(
        None,
        min_length=1,
        description="Nom optionnel pour identifier la connexion MCP.",
    )

    model_config = ConfigDict(extra="forbid")


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


@router.post("/api/tools/mcp/test-connection")
async def post_mcp_test_connection(
    payload: MCPTestConnectionPayload,
) -> dict[str, object]:
    try:
        config = payload.model_dump(exclude_none=True, mode="json")
        result = await probe_mcp_connection(config)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return result
