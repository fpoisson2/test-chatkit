from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import get_current_user
from ..mcp.server_service import McpServerService
from ..models import User
from ..schemas import McpServerPublicResponse

router = APIRouter()


@router.get("/api/mcp/servers", response_model=list[McpServerPublicResponse])
async def list_mcp_servers(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    service = McpServerService(session)
    servers = service.list_active_servers()
    return [
        McpServerPublicResponse(
            id=server.id,
            label=server.label,
            server_url=server.server_url,
            transport=server.transport,
            is_active=server.is_active,
            tools_cache=server.tools_cache,
            tools_cache_updated_at=server.tools_cache_updated_at,
            has_authorization=bool(server.authorization_encrypted),
            has_access_token=bool(server.access_token_encrypted),
            has_refresh_token=bool(server.refresh_token_encrypted),
            has_oauth_client_secret=bool(server.oauth_client_secret_encrypted),
        )
        for server in servers
    ]
