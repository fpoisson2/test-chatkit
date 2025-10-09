from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request

from ..chatkit import create_chatkit_session, proxy_chatkit_request
from ..dependencies import get_optional_user
from ..models import User
from ..schemas import SessionRequest

router = APIRouter()


@router.post("/api/chatkit/session")
async def create_session(
    req: SessionRequest,
    current_user: User | None = Depends(get_optional_user),
):
    if current_user:
        user_id = f"user:{current_user.id}"
    else:
        user_id = req.user or str(uuid.uuid4())
    session_payload = await create_chatkit_session(user_id)
    client_secret = session_payload.get("client_secret")
    if not client_secret:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "ChatKit response missing client_secret",
                "details": session_payload,
            },
        )
    return {
        "client_secret": client_secret,
        "expires_after": session_payload.get("expires_after"),
    }


@router.api_route(
    "/api/chatkit/proxy/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
)
async def proxy_chatkit(path: str, request: Request):
    return await proxy_chatkit_request(path, request)
