from __future__ import annotations

import logging
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, HttpUrl, field_validator

from ..database import SessionLocal
from ..mcp.connection import MCPConnectionStatus, probe_mcp_connection
from ..mcp.credentials import (
    McpCredentialPublic,
    complete_oauth_callback,
    create_mcp_credential,
    delete_mcp_credential,
    prepare_public_credential,
    start_oauth_authorization,
)
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


class McpCredentialOAuthConfig(BaseModel):
    authorization_url: HttpUrl
    token_url: HttpUrl
    client_id: str
    client_secret: str | None = None
    scope: str | list[str] | None = None
    extra_authorize_params: dict[str, Any] | None = None
    extra_token_params: dict[str, Any] | None = None

    @field_validator("client_id")
    @classmethod
    def _validate_client_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("client_id est requis")
        return normalized


class McpCredentialCreateRequest(BaseModel):
    label: str
    provider: str | None = None
    auth_type: Literal["api_key", "oauth"]
    authorization: str | None = None
    headers: dict[str, Any] | None = None
    env: dict[str, Any] | None = None
    oauth: McpCredentialOAuthConfig | None = None

    @field_validator("label")
    @classmethod
    def _validate_label(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("label est requis")
        return normalized


class McpCredentialResponse(BaseModel):
    id: int
    label: str
    provider: str | None
    auth_type: str
    secret_hint: str | None
    connected: bool
    created_at: str
    updated_at: str

    @classmethod
    def from_public(cls, credential: McpCredentialPublic) -> McpCredentialResponse:
        return cls(
            id=credential.id,
            label=credential.label,
            provider=credential.provider,
            auth_type=credential.auth_type,
            secret_hint=credential.secret_hint,
            connected=credential.connected,
            created_at=credential.created_at.isoformat(),
            updated_at=credential.updated_at.isoformat(),
        )


class McpOAuthStartRequest(BaseModel):
    credential_id: int
    redirect_uri: HttpUrl
    scope: list[str] | None = None


class McpOAuthStartResponse(BaseModel):
    authorization_url: HttpUrl
    state: str


class McpOAuthCallbackRequest(BaseModel):
    credential_id: int
    code: str
    state: str | None = None
    redirect_uri: HttpUrl | None = None


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


@router.post(
    "/api/mcp/credentials",
    response_model=McpCredentialResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_mcp_credential_route(
    payload: McpCredentialCreateRequest,
) -> McpCredentialResponse:
    with SessionLocal() as session:
        try:
            credential = create_mcp_credential(
                session,
                label=payload.label,
                auth_type=payload.auth_type,
                provider=payload.provider,
                authorization=payload.authorization,
                headers=payload.headers,
                env=payload.env,
                oauth=payload.oauth.model_dump(mode="json", exclude_none=True)
                if payload.oauth
                else None,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

        session.refresh(credential)
        public = prepare_public_credential(credential)
        return McpCredentialResponse.from_public(public)


@router.post(
    "/api/mcp/oauth/start",
    response_model=McpOAuthStartResponse,
    status_code=status.HTTP_200_OK,
)
def start_mcp_oauth(payload: McpOAuthStartRequest) -> McpOAuthStartResponse:
    with SessionLocal() as session:
        try:
            redirect_uri = str(payload.redirect_uri)
            result = start_oauth_authorization(
                session,
                credential_id=payload.credential_id,
                redirect_uri=redirect_uri,
                scope_override=payload.scope,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

        return McpOAuthStartResponse(**result)


@router.post(
    "/api/mcp/oauth/callback",
    response_model=McpCredentialResponse,
    status_code=status.HTTP_200_OK,
)
def complete_mcp_oauth(payload: McpOAuthCallbackRequest) -> McpCredentialResponse:
    with SessionLocal() as session:
        try:
            redirect_uri = (
                str(payload.redirect_uri) if payload.redirect_uri else None
            )
            public = complete_oauth_callback(
                session,
                credential_id=payload.credential_id,
                code=payload.code,
                state=payload.state,
                redirect_uri=redirect_uri,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

        return McpCredentialResponse.from_public(public)


@router.delete(
    "/api/mcp/credentials/{credential_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_mcp_credential_route(credential_id: int) -> None:
    with SessionLocal() as session:
        deleted = delete_mcp_credential(session, credential_id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Identifiant MCP introuvable",
            )
    return None
