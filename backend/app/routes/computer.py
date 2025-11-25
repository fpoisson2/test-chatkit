"""Routes for computer use debugging and Chrome DevTools Protocol proxy."""

from __future__ import annotations

import logging
import secrets
from enum import Enum
from typing import Any

import httpx

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..dependencies import get_current_user
from ..models import User

logger = logging.getLogger("chatkit.computer")

router = APIRouter(prefix="/api/computer", tags=["computer"])


# Pydantic models for browser control
class BrowserStartRequest(BaseModel):
    """Request to start a test browser instance."""
    url: str | None = None
    width: int = 1024
    height: int = 768


class BrowserStartResponse(BaseModel):
    """Response with browser session token."""
    token: str


class BrowserNavigateRequest(BaseModel):
    """Request to navigate browser to a URL."""
    url: str


class BrowserHistoryDirection(str, Enum):
    """Navigation direction for history actions."""

    BACK = "back"
    FORWARD = "forward"


# Store debug URLs per session token
# Format: {token: {"debug_url": str, "user_id": int, "browser": HostedBrowser | None, "driver": _BaseBrowserDriver | None}}
_DEBUG_SESSIONS: dict[str, dict[str, Any]] = {}

# Store SSH sessions per token
# Format: {token: {"ssh": HostedSSH, "user_id": int, "config": SSHConfig}}
_SSH_SESSIONS: dict[str, dict[str, Any]] = {}

# Store VNC sessions per token
# Format: {token: {"vnc": HostedVNC, "user_id": int, "config": VNCConfig}}
_VNC_SESSIONS: dict[str, dict[str, Any]] = {}


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


def register_ssh_session(
    ssh_instance: Any,
    ssh_config: Any,
    user_id: int | None = None,
) -> str:
    """
    Register an SSH session and return a session token.

    Args:
        ssh_instance: The HostedSSH instance
        ssh_config: The SSHConfig used
        user_id: Optional user ID for authorization

    Returns:
        A unique session token
    """
    token = secrets.token_urlsafe(32)
    _SSH_SESSIONS[token] = {
        "ssh": ssh_instance,
        "config": ssh_config,
        "user_id": user_id,
    }
    logger.info(f"Registered SSH session {token[:8]}... for user {user_id}")
    return token


def get_ssh_session(token: str, user_id: int | None = None) -> dict[str, Any] | None:
    """
    Get the SSH session for a token.

    Args:
        token: The session token
        user_id: Optional user ID for authorization check

    Returns:
        The session dict if found and authorized, None otherwise
    """
    session = _SSH_SESSIONS.get(token)
    if not session:
        return None

    # Check authorization if user_id is provided
    session_user_id = session.get("user_id")
    if user_id is not None and session_user_id is not None:
        if user_id != session_user_id:
            logger.warning(
                f"User {user_id} attempted to access SSH session "
                f"belonging to user {session_user_id}"
            )
            return None

    return session


def cleanup_ssh_session(token: str) -> None:
    """Remove an SSH session."""
    if token in _SSH_SESSIONS:
        del _SSH_SESSIONS[token]
        logger.info(f"Cleaned up SSH session {token[:8]}...")


def register_vnc_session(
    vnc_instance: Any,
    vnc_config: Any,
    user_id: int | None = None,
) -> str:
    """
    Register a VNC session and return a session token.

    Args:
        vnc_instance: The HostedVNC instance
        vnc_config: The VNCConfig used
        user_id: Optional user ID for authorization

    Returns:
        A unique session token
    """
    token = secrets.token_urlsafe(32)
    _VNC_SESSIONS[token] = {
        "vnc": vnc_instance,
        "config": vnc_config,
        "user_id": user_id,
    }
    logger.info(f"Registered VNC session {token[:8]}... for user {user_id}")
    return token


def get_vnc_session(token: str, user_id: int | None = None) -> dict[str, Any] | None:
    """
    Get the VNC session for a token.

    Args:
        token: The session token
        user_id: Optional user ID for authorization check

    Returns:
        The session dict if found and authorized, None otherwise
    """
    session = _VNC_SESSIONS.get(token)
    if not session:
        return None

    # Check authorization if user_id is provided
    session_user_id = session.get("user_id")
    if user_id is not None and session_user_id is not None:
        if user_id != session_user_id:
            logger.warning(
                f"User {user_id} attempted to access VNC session "
                f"belonging to user {session_user_id}"
            )
            return None

    return session


def cleanup_vnc_session(token: str) -> None:
    """Remove a VNC session."""
    if token in _VNC_SESSIONS:
        del _VNC_SESSIONS[token]
        logger.info(f"Cleaned up VNC session {token[:8]}...")


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


# Browser test endpoints for admin panel
@router.post("/browser/start", response_model=BrowserStartResponse)
async def start_test_browser(
    request: BrowserStartRequest,
    current_user: User = Depends(get_current_user),
) -> BrowserStartResponse:
    """
    Start a test browser instance for admin testing.

    Args:
        request: Browser configuration (URL, dimensions)
        current_user: Authenticated user

    Returns:
        Session token and debug URL for the browser instance
    """
    try:
        from ..computer.hosted_browser import HostedBrowser

        # Create browser instance
        browser = HostedBrowser(
            width=request.width,
            height=request.height,
            environment="browser",  # Use browser environment for testing
            start_url=request.url,
        )

        # Get the driver (this initializes it if needed)
        driver = await browser._get_driver()

        # Ensure browser is ready (this starts it)
        await driver.ensure_ready()

        # Get debug URL from browser property
        debug_url = browser.debug_url
        if not debug_url:
            raise HTTPException(
                status_code=500,
                detail="Failed to get debug URL from browser"
            )

        # Register debug session with browser reference
        token = secrets.token_urlsafe(32)
        _DEBUG_SESSIONS[token] = {
            "debug_url": debug_url,
            "user_id": current_user.id,
            "browser": browser,
            "driver": driver,
        }

        logger.info(
            f"Started test browser for user {current_user.id}: "
            f"token={token[:8]}..., url={request.url}"
        )

        return BrowserStartResponse(
            token=token,
        )

    except Exception as exc:
        logger.error(f"Failed to start test browser: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start browser: {str(exc)}"
        )


@router.get("/browser/devtools/{token}")
async def get_devtools_url(
    token: str,
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    """
    Get the Chrome DevTools URL for remote debugging.

    This returns a URL that can be opened to control the browser manually.
    The URL uses the CDP proxy to securely tunnel the connection.
    """
    session = _DEBUG_SESSIONS.get(token)
    if not session:
        raise HTTPException(status_code=404, detail="Browser session not found")

    if session.get("user_id") != current_user.id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    # Get the actual CDP targets to find the page ID
    debug_url = session.get("debug_url")
    if not debug_url:
        raise HTTPException(
            status_code=500,
            detail="Debug URL not available"
        )

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{debug_url}/json")
            response.raise_for_status()
            targets = response.json()

            # Find the first page target
            page_target = None
            if isinstance(targets, list):
                for target in targets:
                    if target.get("type") == "page":
                        page_target = target
                        break

            if not page_target:
                raise HTTPException(
                    status_code=404,
                    detail="No page target found"
                )

            # Extract the devtools frontend URL
            devtools_frontend_url = page_target.get("devtoolsFrontendUrl", "")

            # Extract the page ID from webSocketDebuggerUrl
            ws_url = page_target.get("webSocketDebuggerUrl", "")
            if ws_url:
                # Extract path from ws://host:port/devtools/page/XXX
                parts = ws_url.split("/", 3)
                if len(parts) >= 4:
                    target_path = "/" + parts[3]

                    # Build WebSocket URL that will use our proxy
                    # This needs to be a full wss:// URL for the remote DevTools frontend
                    # The frontend will construct the full URL using window.location

                    # Return relative path that frontend will complete with domain
                    return {
                        "devtools_ws_path": f"/api/computer/cdp/ws?token={token}&target={target_path}"
                    }

            raise HTTPException(
                status_code=500,
                detail="Could not generate DevTools URL"
            )

    except httpx.RequestError as exc:
        logger.error(f"Failed to get DevTools URL: {exc}")
        raise HTTPException(
            status_code=503,
            detail=f"Failed to connect to Chrome DevTools: {str(exc)}"
        )


@router.post("/browser/navigate/{token}")
async def navigate_test_browser(
    token: str,
    request: BrowserNavigateRequest,
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    """
    Navigate the test browser to a new URL.

    Args:
        token: Browser session token
        request: Navigation request with URL
        current_user: Authenticated user

    Returns:
        Success message
    """
    session = _DEBUG_SESSIONS.get(token)
    if not session:
        raise HTTPException(status_code=404, detail="Browser session not found")

    # Check authorization
    if session.get("user_id") != current_user.id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    driver = session.get("driver")
    if not driver:
        raise HTTPException(
            status_code=500,
            detail="Browser driver not available"
        )

    try:
        # Access the page and navigate
        page = driver._page
        if page:
            await page.goto(request.url, wait_until="domcontentloaded")
            logger.info(f"Navigated browser {token[:8]}... to {request.url}")
            return {"status": "success", "url": request.url}
        else:
            raise HTTPException(
                status_code=500,
                detail="Browser page not available"
            )
    except Exception as exc:
        logger.error(f"Failed to navigate browser: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Navigation failed: {str(exc)}"
        )


#
# History navigation helpers
async def _navigate_history(
    token: str, direction: BrowserHistoryDirection, current_user: User
) -> dict[str, str]:
    session = _DEBUG_SESSIONS.get(token)
    if not session:
        raise HTTPException(status_code=404, detail="Browser session not found")

    # Check authorization
    if session.get("user_id") != current_user.id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    driver = session.get("driver")
    if not driver:
        raise HTTPException(
            status_code=500,
            detail="Browser driver not available",
        )

    page = driver._page
    if not page:
        raise HTTPException(
            status_code=500,
            detail="Browser page not available",
        )

    try:
        if direction == BrowserHistoryDirection.BACK:
            await page.go_back(wait_until="domcontentloaded")
        else:
            await page.go_forward(wait_until="domcontentloaded")

        logger.info(
            "Navigated browser %s... %s one step",
            token[:8],
            direction.value,
        )
        return {"status": "success", "direction": direction.value}
    except Exception as exc:
        logger.error(
            "Failed to move browser %s... %s: %s", token[:8], direction.value, exc,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Navigation failed: {str(exc)}",
        )


@router.post("/browser/history/{direction}/{token}")
async def navigate_test_browser_history(
    direction: BrowserHistoryDirection,
    token: str,
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    """
    Move the browser forward or backward one step in history.

    Args:
        direction: Either "back" or "forward"
        token: Browser session token
        current_user: Authenticated user

    Returns:
        Success message with direction used
    """

    return await _navigate_history(token, direction, current_user)


@router.delete("/browser/close/{token}")
async def close_test_browser(
    token: str,
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    """
    Close the test browser and clean up session.

    Args:
        token: Browser session token
        current_user: Authenticated user

    Returns:
        Success message
    """
    session = _DEBUG_SESSIONS.get(token)
    if not session:
        raise HTTPException(status_code=404, detail="Browser session not found")

    # Check authorization
    if session.get("user_id") != current_user.id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    driver = session.get("driver")
    if driver:
        try:
            await driver.close()
            logger.info(f"Closed test browser {token[:8]}... for user {current_user.id}")
        except Exception as exc:
            logger.warning(f"Error closing browser driver: {exc}")

    # Clean up session
    cleanup_debug_session(token)

    return {"status": "success", "message": "Browser closed"}


# SSH WebSocket endpoint for interactive terminal
@router.websocket("/ssh/ws")
async def ssh_websocket_terminal(websocket: WebSocket, token: str) -> None:
    """
    WebSocket endpoint for interactive SSH terminal.

    The client sends input data, and the server sends back terminal output.
    Uses xterm.js on the frontend to render the terminal.

    Args:
        token: The SSH session token
    """
    import asyncio

    # Accept the client WebSocket connection first
    await websocket.accept()

    # Get SSH session
    session = get_ssh_session(token, user_id=None)
    if not session:
        await websocket.close(code=1008, reason="Invalid or unauthorized SSH session")
        return

    ssh_instance = session.get("ssh")
    if not ssh_instance:
        await websocket.close(code=1011, reason="SSH instance not found")
        return

    logger.info(f"SSH WebSocket connected for session {token[:8]}...")

    try:
        # Create interactive shell
        process = await ssh_instance.create_interactive_shell()
        if not process:
            await websocket.close(code=1011, reason="Failed to create SSH shell")
            return

        async def forward_ssh_to_client() -> None:
            """Forward SSH output to WebSocket client."""
            try:
                while True:
                    # Read from SSH process stdout
                    data = await process.stdout.read(4096)
                    if not data:
                        break
                    # Send as binary to preserve terminal escape sequences
                    await websocket.send_bytes(data)
            except Exception as exc:
                logger.debug(f"SSH to client forward ended: {exc}")

        async def forward_client_to_ssh() -> None:
            """Forward WebSocket input to SSH process."""
            try:
                while True:
                    message = await websocket.receive()
                    if message["type"] == "websocket.disconnect":
                        break
                    if "bytes" in message:
                        data = message["bytes"]
                    elif "text" in message:
                        data = message["text"].encode("utf-8")
                    else:
                        continue
                    # Write to SSH process stdin
                    process.stdin.write(data)
                    await process.stdin.drain()
            except WebSocketDisconnect:
                logger.debug("Client WebSocket disconnected")
            except Exception as exc:
                logger.debug(f"Client to SSH forward ended: {exc}")

        # Run both forwarding tasks concurrently
        await asyncio.gather(
            forward_ssh_to_client(),
            forward_client_to_ssh(),
            return_exceptions=True,
        )

    except Exception as exc:
        logger.error(f"SSH WebSocket error: {exc}")
        await websocket.close(code=1011, reason=str(exc))
    finally:
        logger.info(f"SSH WebSocket closed for session {token[:8]}...")


# VNC WebSocket endpoint for websockify proxy
@router.websocket("/vnc/ws")
async def vnc_websocket_proxy(websocket: WebSocket, token: str) -> None:
    """
    WebSocket endpoint for VNC via websockify.

    Proxies WebSocket connections to the websockify server which handles
    the WebSocket-to-TCP (VNC) protocol translation.

    Args:
        token: The VNC session token
    """
    import asyncio

    # Accept the client WebSocket connection first
    await websocket.accept()

    # Get VNC session
    session = get_vnc_session(token, user_id=None)
    if not session:
        await websocket.close(code=1008, reason="Invalid or unauthorized VNC session")
        return

    vnc_instance = session.get("vnc")
    if not vnc_instance:
        await websocket.close(code=1011, reason="VNC instance not found")
        return

    logger.info(f"VNC WebSocket connected for session {token[:8]}...")

    try:
        # Get the websockify port
        websockify_port = vnc_instance.novnc_port

        # Connect to the local websockify WebSocket server
        import websockets

        # websockify proxies WebSocket connections to TCP (VNC)
        # The WebSocket URL format is: ws://localhost:port/
        websockify_ws_url = f"ws://127.0.0.1:{websockify_port}/"

        logger.info(f"Connecting to websockify WebSocket: {websockify_ws_url}")

        async with websockets.connect(websockify_ws_url) as vnc_ws:
            async def forward_vnc_to_client() -> None:
                """Forward VNC data from websockify to WebSocket client."""
                try:
                    async for message in vnc_ws:
                        if isinstance(message, bytes):
                            await websocket.send_bytes(message)
                        else:
                            await websocket.send_text(message)
                except WebSocketDisconnect:
                    logger.debug("VNC client WebSocket disconnected")
                except Exception as exc:
                    logger.debug(f"VNC to client forward ended: {exc}")

            async def forward_client_to_vnc() -> None:
                """Forward WebSocket input from client to websockify."""
                try:
                    while True:
                        message = await websocket.receive()
                        if message["type"] == "websocket.disconnect":
                            break
                        if "bytes" in message:
                            await vnc_ws.send(message["bytes"])
                        elif "text" in message:
                            await vnc_ws.send(message["text"])
                except WebSocketDisconnect:
                    logger.debug("Client WebSocket disconnected")
                except Exception as exc:
                    logger.debug(f"Client to VNC forward ended: {exc}")

            # Run both forwarding tasks concurrently
            await asyncio.gather(
                forward_vnc_to_client(),
                forward_client_to_vnc(),
                return_exceptions=True,
            )

    except Exception as exc:
        logger.error(f"VNC WebSocket error: {exc}")
        await websocket.close(code=1011, reason=str(exc))
    finally:
        logger.info(f"VNC WebSocket closed for session {token[:8]}...")


# VNC session info endpoint
@router.get("/vnc/info/{token}")
async def get_vnc_info(
    token: str,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Get VNC session information.

    Args:
        token: VNC session token
        current_user: Authenticated user

    Returns:
        VNC connection info including WebSocket URL
    """
    session = _VNC_SESSIONS.get(token)
    if not session:
        raise HTTPException(status_code=404, detail="VNC session not found")

    if session.get("user_id") != current_user.id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    vnc_instance = session.get("vnc")
    if not vnc_instance:
        raise HTTPException(status_code=500, detail="VNC instance not available")

    return {
        "vnc_host": vnc_instance.config.host,
        "vnc_port": vnc_instance.config.port,
        "novnc_port": vnc_instance.novnc_port,
        "websocket_path": f"/api/computer/vnc/ws?token={token}",
        "dimensions": {
            "width": vnc_instance.dimensions[0],
            "height": vnc_instance.dimensions[1],
        },
    }


@router.delete("/vnc/close/{token}")
async def close_vnc_session(
    token: str,
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    """
    Close a VNC session and clean up resources.

    Args:
        token: VNC session token
        current_user: Authenticated user

    Returns:
        Success message
    """
    session = _VNC_SESSIONS.get(token)
    if not session:
        raise HTTPException(status_code=404, detail="VNC session not found")

    if session.get("user_id") != current_user.id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    vnc_instance = session.get("vnc")
    if vnc_instance:
        try:
            await vnc_instance.close()
            logger.info(f"Closed VNC session {token[:8]}... for user {current_user.id}")
        except Exception as exc:
            logger.warning(f"Error closing VNC session: {exc}")

    # Clean up session
    cleanup_vnc_session(token)

    return {"status": "success", "message": "VNC session closed"}
