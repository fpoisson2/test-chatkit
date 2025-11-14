from __future__ import annotations

import datetime
import logging
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..models import McpServer
from ..secret_utils import (
    SecretKeyUnavailableError,
    decrypt_secret,
    encrypt_secret,
    mask_secret,
)
from .connection import probe_mcp_connection

MCP_SECRET_HINT_MAX_LENGTH = 32
"""Maximum length for displayed secret hints in the MCP admin views."""

logger = logging.getLogger("chatkit.mcp.server_service")


class McpServerService:
    """Service d'orchestration pour la gestion des serveurs MCP."""

    def __init__(self, session: Session):
        self._session = session

    # --- Requêtes ---

    def list_servers(self) -> list[McpServer]:
        stmt = select(McpServer).order_by(McpServer.label.asc(), McpServer.id.asc())
        return self._session.scalars(stmt).all()

    def list_active_servers(self) -> list[McpServer]:
        stmt = (
            select(McpServer)
            .where(McpServer.is_active.is_(True))
            .order_by(McpServer.label.asc(), McpServer.id.asc())
        )
        return self._session.scalars(stmt).all()

    # --- Mutations ---

    async def create_server(self, payload: Any) -> McpServer:
        label = payload.label.strip()
        server_url = str(payload.server_url).strip()
        transport = self._normalize_transport(payload.transport)

        self._ensure_unique(label, server_url)

        server = McpServer(
            label=label,
            server_url=server_url,
            transport=transport,
            is_active=payload.is_active,
            oauth_client_id=self._normalize_optional(payload.oauth_client_id),
            oauth_scope=self._normalize_optional(payload.oauth_scope),
            oauth_authorization_endpoint=self._normalize_optional(payload.oauth_authorization_endpoint),
            oauth_token_endpoint=self._normalize_optional(payload.oauth_token_endpoint),
            oauth_redirect_uri=self._normalize_optional(payload.oauth_redirect_uri),
            oauth_metadata=payload.oauth_metadata,
        )

        authorization_plain = self._store_secret(server, "authorization", payload)
        self._store_secret(server, "access_token", payload)
        self._store_secret(server, "refresh_token", payload)
        self._store_secret(server, "oauth_client_secret", payload)

        self._session.add(server)
        self._commit()
        self._session.refresh(server)

        if getattr(payload, "refresh_tools", True):
            await self.refresh_tools_cache(
                server, authorization_override=authorization_plain
            )
        else:
            self._session.refresh(server)

        return server

    async def update_server(self, server_id: int, payload: Any) -> McpServer:
        server = self._session.get(McpServer, server_id)
        if server is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Serveur MCP introuvable",
            )

        fields = getattr(payload, "model_fields_set", set())

        if "label" in fields:
            if payload.label is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Le label ne peut pas être vide.",
                )
            label = payload.label.strip()
            if not label:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Le label ne peut pas être vide.",
                )
            self._ensure_unique(label, server.server_url, exclude_id=server.id)
            server.label = label

        if "server_url" in fields:
            if payload.server_url is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="L'URL du serveur est obligatoire.",
                )
            server_url = str(payload.server_url).strip()
            if not server_url:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="L'URL du serveur est obligatoire.",
                )
            self._ensure_unique(server.label, server_url, exclude_id=server.id)
            server.server_url = server_url

        if "transport" in fields and payload.transport is not None:
            server.transport = self._normalize_transport(payload.transport)

        if "is_active" in fields and payload.is_active is not None:
            server.is_active = bool(payload.is_active)

        if "oauth_client_id" in fields:
            server.oauth_client_id = self._normalize_optional(payload.oauth_client_id)

        if "oauth_scope" in fields:
            server.oauth_scope = self._normalize_optional(payload.oauth_scope)

        if "oauth_authorization_endpoint" in fields:
            server.oauth_authorization_endpoint = self._normalize_optional(
                payload.oauth_authorization_endpoint
            )

        if "oauth_token_endpoint" in fields:
            server.oauth_token_endpoint = self._normalize_optional(
                payload.oauth_token_endpoint
            )

        if "oauth_redirect_uri" in fields:
            server.oauth_redirect_uri = self._normalize_optional(
                payload.oauth_redirect_uri
            )

        if "oauth_metadata" in fields:
            server.oauth_metadata = payload.oauth_metadata

        override_authorization = self._store_secret(server, "authorization", payload)
        self._store_secret(server, "access_token", payload)
        self._store_secret(server, "refresh_token", payload)
        self._store_secret(server, "oauth_client_secret", payload)

        self._session.add(server)
        self._commit()
        self._session.refresh(server)

        if getattr(payload, "refresh_tools", False):
            await self.refresh_tools_cache(
                server, authorization_override=override_authorization
            )
        else:
            self._session.refresh(server)

        return server

    def delete_server(self, server_id: int) -> None:
        server = self._session.get(McpServer, server_id)
        if server is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Serveur MCP introuvable",
            )
        self._session.delete(server)
        self._commit()

    async def refresh_tools_cache(
        self, server: McpServer, *, authorization_override: str | None = None
    ) -> dict[str, Any]:
        config = {
            "type": "mcp",
            "transport": server.transport or "http_sse",
            "url": server.server_url,
        }

        authorization = authorization_override
        if authorization is None:
            authorization = decrypt_secret(server.authorization_encrypted)
        if authorization:
            config["authorization"] = authorization

        try:
            result = await probe_mcp_connection(config)
        except Exception as exc:  # pragma: no cover - garde-fou
            logger.exception("Probe MCP échouée pour le serveur %s", server.id)
            result = {
                "status": "error",
                "detail": str(exc),
            }

        server.tools_cache = result
        server.tools_cache_updated_at = datetime.datetime.now(datetime.UTC)

        self._session.add(server)
        self._commit()
        self._session.refresh(server)
        return result

    # --- Helpers ---

    def _ensure_unique(
        self, label: str, server_url: str, *, exclude_id: int | None = None
    ) -> None:
        lower_label = label.casefold()
        stmt = select(McpServer.id, McpServer.label, McpServer.server_url)
        stmt = stmt.where(
            func.lower(McpServer.label) == lower_label,
        )
        if exclude_id is not None:
            stmt = stmt.where(McpServer.id != exclude_id)
        existing = self._session.execute(stmt).first()
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "mcp_server_conflict", "field": "label"},
            )

        stmt = select(McpServer.id).where(McpServer.server_url == server_url)
        if exclude_id is not None:
            stmt = stmt.where(McpServer.id != exclude_id)
        existing_url = self._session.execute(stmt).first()
        if existing_url is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "mcp_server_conflict", "field": "server_url"},
            )

    def _store_secret(self, server: McpServer, field: str, payload: Any) -> str | None:
        fields = getattr(payload, "model_fields_set", set())
        provided = field in fields
        value = getattr(payload, field, None)
        if not provided:
            logger.debug(
                "Champ '%s' absent de model_fields_set (%s), ignoré",
                field,
                sorted(fields) if fields else "vide",
            )
            return None

        if value is None:
            setattr(server, f"{field}_encrypted", None)
            setattr(server, f"{field}_hint", None)
            return None

        candidate = str(value).strip()
        if not candidate:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Le champ {field} ne peut pas être vide.",
            )

        try:
            encrypted = encrypt_secret(candidate)
        except SecretKeyUnavailableError as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(exc),
            ) from exc

        hint = mask_secret(candidate, max_length=MCP_SECRET_HINT_MAX_LENGTH)
        setattr(server, f"{field}_encrypted", encrypted)
        setattr(server, f"{field}_hint", hint)
        logger.debug(
            "Champ '%s' chiffré et sauvegardé (longueur originale: %d, hint: %s)",
            field,
            len(candidate),
            hint,
        )
        return candidate

    def _normalize_transport(self, value: str | None) -> str:
        if value is None:
            return "http_sse"
        candidate = value.strip().lower()
        if candidate in {"http_sse", "sse"}:
            return "http_sse"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Le transport MCP supporté est 'http_sse'.",
        )

    @staticmethod
    def _normalize_optional(value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str):
            candidate = value.strip()
            return candidate or None
        return value

    def _commit(self) -> None:
        try:
            self._session.commit()
        except SQLAlchemyError as exc:  # pragma: no cover - dépend du SGBD
            self._session.rollback()
            logger.exception("Erreur SQLAlchemy lors de la persistance MCP")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Impossible d'enregistrer le serveur MCP.",
            ) from exc
