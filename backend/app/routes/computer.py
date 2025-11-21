"""Routes for computer use debugging and Chrome DevTools Protocol proxy."""

from __future__ import annotations

import logging
import secrets
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from ..dependencies import get_current_user
from ..models import User

logger = logging.getLogger("chatkit.computer")

router = APIRouter(prefix="/api/computer", tags=["computer"])


# Store debug URLs per session token
# Format: {token: {"debug_url": str, "user_id": int}}
_DEBUG_SESSIONS: dict[str, dict[str, Any]] = {}


def register_debug_session(debug_url: str, user_id: int | None = None) -> str:
    """
    Register a debug URL for a user session and return a session token.

    Args:
        debug_url: The Chrome DevTools debug URL
        user_id: Optional user ID for authorization

    Returns:
        A unique session token to use for accessing this debug URL
    """
    token = secrets.token_urlsafe(32)
    _DEBUG_SESSIONS[token] = {
        "debug_url": debug_url,
        "user_id": user_id,
    }
    logger.info(f"Registered debug session {token[:8]}... for user {user_id}")
    return token


def get_debug_session(token: str, user_id: int | None = None) -> str | None:
    """
    Get the debug URL for a session token.

    Args:
        token: The session token
        user_id: Optional user ID for authorization check

    Returns:
        The debug URL if found and authorized, None otherwise
    """
    session = _DEBUG_SESSIONS.get(token)
    if not session:
        return None

    # Check authorization if user_id is provided
    session_user_id = session.get("user_id")
    if user_id is not None and session_user_id is not None:
        if user_id != session_user_id:
            logger.warning(
                f"User {user_id} attempted to access debug session "
                f"belonging to user {session_user_id}"
            )
            return None

    return session.get("debug_url")


def cleanup_debug_session(token: str) -> None:
    """Remove a debug session."""
    if token in _DEBUG_SESSIONS:
        del _DEBUG_SESSIONS[token]
        logger.info(f"Cleaned up debug session {token[:8]}...")


@router.get("/cdp/json")
async def proxy_cdp_json(
    token: str,
    current_user: User = Depends(get_current_user),
) -> JSONResponse:
    """
    Proxy the Chrome DevTools Protocol /json endpoint.

    Args:
        token: The debug session token from debug_url_token field
        current_user: The authenticated user (for authorization)

    Returns the list of available debug targets from Chrome.
    This endpoint is needed because the Chrome debug port (9222) is not
    accessible from the browser client directly.
    """
    debug_url = get_debug_session(token, current_user.id)
    if not debug_url:
        raise HTTPException(
            status_code=403,
            detail="Invalid or unauthorized debug session token"
        )

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{debug_url}/json")
            response.raise_for_status()
            targets = response.json()

            # Rewrite webSocketDebuggerUrl to point to our proxy
            if isinstance(targets, list):
                for target in targets:
                    if "webSocketDebuggerUrl" in target:
                        # Extract the path from the WebSocket URL
                        # Example: ws://127.0.0.1:9222/devtools/page/ABC123
                        # We want: /api/computer/cdp/ws?token=SESSION&target=/devtools/page/ABC123
                        ws_url = target["webSocketDebuggerUrl"]
                        if ws_url.startswith("ws://") or ws_url.startswith("wss://"):
                            # Extract path after host:port
                            parts = ws_url.split("/", 3)
                            if len(parts) >= 4:
                                path = "/" + parts[3]
                                # Rewrite to our proxy endpoint with token
                                target["webSocketDebuggerUrl"] = f"/api/computer/cdp/ws?token={token}&target={path}"

            return JSONResponse(content=targets)
    except httpx.RequestError as exc:
        logger.error(f"Failed to proxy Chrome DevTools /json: {exc}")
        raise HTTPException(
            status_code=503,
            detail=f"Failed to connect to Chrome DevTools: {str(exc)}"
        )
    except Exception as exc:
        logger.error(f"Unexpected error in Chrome DevTools proxy: {exc}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.websocket("/cdp/ws")
async def proxy_cdp_websocket(websocket: WebSocket, token: str, target: str) -> None:
    """
    Proxy WebSocket connection to Chrome DevTools Protocol.

    Args:
        token: The debug session token
        target: The CDP target path (e.g., /devtools/page/ABC123)
    """
    # Accept the client WebSocket connection first
    await websocket.accept()

    # Note: WebSocket doesn't have built-in auth like HTTP endpoints
    # The token provides session-based authorization
    debug_url = get_debug_session(token, user_id=None)  # No user_id check for WS
    if not debug_url:
        await websocket.close(code=1008, reason="Invalid or unauthorized debug session")
        return

    # Convert http://host:port to ws://host:port
    ws_base_url = debug_url.replace("http://", "ws://").replace("https://", "wss://")
    cdp_ws_url = f"{ws_base_url}{target}"

    logger.info(f"Proxying WebSocket to Chrome DevTools: {cdp_ws_url}")

    try:
        import websockets

        # Connect to Chrome DevTools WebSocket
        async with websockets.connect(cdp_ws_url) as cdp_ws:
            async def forward_to_cdp() -> None:
                """Forward messages from client to Chrome DevTools."""
                try:
                    while True:
                        data = await websocket.receive_text()
                        await cdp_ws.send(data)
                except WebSocketDisconnect:
                    logger.debug("Client WebSocket disconnected")
                except Exception as exc:
                    logger.error(f"Error forwarding to CDP: {exc}")

            async def forward_to_client() -> None:
                """Forward messages from Chrome DevTools to client."""
                try:
                    async for message in cdp_ws:
                        await websocket.send_text(message)
                except WebSocketDisconnect:
                    logger.debug("CDP WebSocket disconnected")
                except Exception as exc:
                    logger.error(f"Error forwarding to client: {exc}")

            # Run both forwarding tasks concurrently
            import asyncio
            await asyncio.gather(
                forward_to_cdp(),
                forward_to_client(),
                return_exceptions=True,
            )
    except Exception as exc:
        logger.error(f"WebSocket proxy error: {exc}")
        await websocket.close(code=1011, reason=str(exc))
