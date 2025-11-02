from __future__ import annotations

import logging
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field

from ..mcp.connection import probe_mcp_connection
from ..mcp.oauth import (
    complete_oauth_callback,
    delete_oauth_session,
    get_oauth_session_status,
    start_oauth_flow,
)
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
    server_id: int | None = Field(
        None,
        ge=1,
        description="Identifiant d'un serveur MCP persisté à réutiliser.",
    )
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


class MCPOAuthStartPayload(BaseModel):
    url: AnyHttpUrl = Field(..., description="URL de base du fournisseur OAuth2")
    client_id: str | None = Field(
        None,
        min_length=1,
        description="Identifiant client optionnel pour l'autorisation.",
    )
    scope: str | None = Field(
        None,
        min_length=1,
        description="Portée optionnelle demandée au fournisseur OAuth2.",
    )
    server_id: int | None = Field(
        None,
        ge=1,
        description="Identifiant du serveur MCP associé pour récupérer les secrets.",
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
    logger.info(
        "MCP test connection url=%s has_authorization=%s",
        payload.url,
        bool(payload.authorization),
    )
    try:
        config = payload.model_dump(exclude_none=True, mode="json")
        logger.debug("MCP test connection config keys=%s", sorted(config.keys()))
        result = await probe_mcp_connection(config)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return result


@router.post("/api/tools/mcp/oauth/start")
async def post_mcp_oauth_start(
    payload: MCPOAuthStartPayload,
    request: Request,
) -> dict[str, object]:
    redirect_uri = str(request.url_for("get_mcp_oauth_callback"))
    logger.info(
        "Received MCP OAuth start url=%s client_id=%s scope=%s redirect_uri=%s",
        payload.url,
        payload.client_id,
        payload.scope,
        redirect_uri,
    )
    try:
        async with httpx.AsyncClient() as client:
            return await start_oauth_flow(
                str(payload.url),
                redirect_uri=redirect_uri,
                client_id=payload.client_id,
                scope=payload.scope,
                server_id=payload.server_id,
                http_client=client,
            )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.get("/api/tools/mcp/oauth/session/{state}")
async def get_mcp_oauth_session(state: str) -> dict[str, object]:
    status_payload = await get_oauth_session_status(state)
    if status_payload is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session OAuth introuvable ou expirée.",
        )
    return status_payload


@router.delete("/api/tools/mcp/oauth/session/{state}")
async def delete_mcp_oauth_session(state: str) -> dict[str, object]:
    deleted = await delete_oauth_session(state)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session OAuth introuvable ou expirée.",
        )
    return {"state": state, "status": "deleted"}


@router.get(
    "/api/tools/mcp/oauth/callback",
    response_class=HTMLResponse,
    name="get_mcp_oauth_callback",
)
async def get_mcp_oauth_callback(
    state: str = Query(
        ...,
        description="Identifiant de corrélation généré lors du flux OAuth",
    ),
    code: str | None = Query(
        None,
        description="Code d'autorisation renvoyé par le fournisseur OAuth",
    ),
    error: str | None = Query(
        None,
        description="Code d'erreur renvoyé par le fournisseur OAuth",
    ),
    error_description: str | None = Query(
        None,
        description="Description optionnelle de l'erreur OAuth",
    ),
) -> HTMLResponse:
    logger.info(
        "Handling MCP OAuth callback state=%s has_code=%s has_error=%s",
        state,
        bool(code),
        bool(error),
    )
    try:
        async with httpx.AsyncClient() as client:
            result = await complete_oauth_callback(
                state=state,
                code=code,
                error=error,
                error_description=error_description,
                http_client=client,
            )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    if result["status"] == "ok":
        logger.info("MCP OAuth session state=%s completed successfully", state)
        message = "Authentification terminée. Vous pouvez fermer cette fenêtre."
    else:
        logger.warning(
            "MCP OAuth session state=%s failed error=%s",
            state,
            result.get("error"),
        )
        message = "Échec de l'authentification. Vous pouvez fermer cette fenêtre."

    html = f"""
    <html>
        <head>
            <title>OAuth</title>
        </head>
        <body>
            <p>{message}</p>
        </body>
    </html>
    """

    return HTMLResponse(content=html, status_code=status.HTTP_200_OK)
