"""Routes for computer use debugging and Chrome DevTools Protocol proxy."""

from __future__ import annotations

import ipaddress
import logging
import secrets
import time
from enum import Enum
from typing import Any
from urllib.parse import urlparse

import httpx

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..dependencies import get_current_user
from ..models import User
from ..security import decode_access_token

logger = logging.getLogger("chatkit.computer")

router = APIRouter(prefix="/api/computer", tags=["computer"])

# Session expiration time in seconds (1 hour)
SESSION_EXPIRATION_SECONDS = 3600


def _is_safe_url(url: str) -> tuple[bool, str]:
    """Validate URL to prevent SSRF attacks.

    Returns (is_safe, error_message).
    Blocks:
    - Private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x)
    - Link-local addresses (169.254.x)
    - Localhost
    - Non-http(s) protocols
    - Cloud metadata endpoints (169.254.169.254)
    """
    try:
        parsed = urlparse(url)
    except Exception:
        return False, "Invalid URL format"

    # Only allow http and https
    if parsed.scheme not in ("http", "https"):
        return False, f"Protocol '{parsed.scheme}' not allowed. Use http or https."

    hostname = parsed.hostname
    if not hostname:
        return False, "URL must have a hostname"

    # Block localhost variants
    localhost_names = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}
    if hostname.lower() in localhost_names:
        return False, "Localhost URLs are not allowed"

    # Try to resolve hostname to IP and check if it's private
    try:
        # Check if hostname is already an IP address
        ip = ipaddress.ip_address(hostname)
        if ip.is_private:
            return False, "Private IP addresses are not allowed"
        if ip.is_loopback:
            return False, "Loopback addresses are not allowed"
        if ip.is_link_local:
            return False, "Link-local addresses are not allowed"
        if ip.is_reserved:
            return False, "Reserved addresses are not allowed"
        # Block cloud metadata endpoint
        if str(ip) == "169.254.169.254":
            return False, "Cloud metadata endpoint is not allowed"
    except ValueError:
        # Not an IP address, it's a hostname - allow it but block known internal patterns
        hostname_lower = hostname.lower()
        blocked_patterns = [
            "internal", "local", "private", "intranet",
            "corp", "lan", "localhost", "metadata"
        ]
        for pattern in blocked_patterns:
            if pattern in hostname_lower:
                return False, f"Hostname containing '{pattern}' is not allowed"

    return True, ""


async def _authenticate_websocket(websocket: WebSocket) -> dict | None:
    """Authenticate WebSocket connection using JWT token from query params.

    Returns the decoded token payload if valid, None otherwise.
    """
    token = websocket.query_params.get("auth_token")
    if not token:
        # Also check for token in headers for compatibility
        auth_header = websocket.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]

    if not token:
        logger.warning("WebSocket connection rejected: missing auth token")
        return None

    try:
        payload = decode_access_token(token)
        return payload
    except Exception as e:
        logger.warning(f"WebSocket connection rejected: invalid token - {e}")
        return None


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
# Format: {token: {"debug_url": str, "user_id": int, "browser": HostedBrowser | None, "driver": _BaseBrowserDriver | None, "created_at": float}}
_DEBUG_SESSIONS: dict[str, dict[str, Any]] = {}

# Store SSH sessions per token
# Format: {token: {"ssh": HostedSSH, "user_id": int, "config": SSHConfig, "created_at": float}}
_SSH_SESSIONS: dict[str, dict[str, Any]] = {}

# Store VNC sessions per token
# Format: {token: {"vnc": HostedVNC, "user_id": int, "config": VNCConfig, "created_at": float}}
_VNC_SESSIONS: dict[str, dict[str, Any]] = {}


def _cleanup_expired_sessions() -> None:
    """Remove expired sessions from all session stores."""
    current_time = time.time()

    # Cleanup debug sessions
    expired_debug = [
        token for token, session in _DEBUG_SESSIONS.items()
        if current_time - session.get("created_at", 0) > SESSION_EXPIRATION_SECONDS
    ]
    for token in expired_debug:
        logger.info(f"Expiring debug session {token[:8]}...")
        del _DEBUG_SESSIONS[token]

    # Cleanup SSH sessions
    expired_ssh = [
        token for token, session in _SSH_SESSIONS.items()
        if current_time - session.get("created_at", 0) > SESSION_EXPIRATION_SECONDS
    ]
    for token in expired_ssh:
        logger.info(f"Expiring SSH session {token[:8]}...")
        del _SSH_SESSIONS[token]

    # Cleanup VNC sessions
    expired_vnc = [
        token for token, session in _VNC_SESSIONS.items()
        if current_time - session.get("created_at", 0) > SESSION_EXPIRATION_SECONDS
    ]
    for token in expired_vnc:
        logger.info(f"Expiring VNC session {token[:8]}...")
        del _VNC_SESSIONS[token]


def register_debug_session(debug_url: str, user_id: int | None = None) -> str:
    """
    Register a debug URL for a user session and return a session token.

    Args:
        debug_url: The Chrome DevTools debug URL
        user_id: Optional user ID for authorization

    Returns:
        A unique session token to use for accessing this debug URL
    """
    # Clean up expired sessions before creating new ones
    _cleanup_expired_sessions()

    token = secrets.token_urlsafe(32)
    _DEBUG_SESSIONS[token] = {
        "debug_url": debug_url,
        "user_id": user_id,
        "created_at": time.time(),
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

    # Check if session has expired
    if time.time() - session.get("created_at", 0) > SESSION_EXPIRATION_SECONDS:
        logger.info(f"Debug session {token[:8]}... has expired")
        del _DEBUG_SESSIONS[token]
        return None

    # Check authorization if user_id is provided
    session_user_id = session.get("user_id")
    if user_id is not None and session_user_id is not None:
        # Ensure robust comparison by converting to string
        if str(user_id) != str(session_user_id):
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
    # Clean up expired sessions before creating new ones
    _cleanup_expired_sessions()

    token = secrets.token_urlsafe(32)
    _SSH_SESSIONS[token] = {
        "ssh": ssh_instance,
        "config": ssh_config,
        "user_id": user_id,
        "created_at": time.time(),
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

    # Check if session has expired
    if time.time() - session.get("created_at", 0) > SESSION_EXPIRATION_SECONDS:
        logger.info(f"SSH session {token[:8]}... has expired")
        del _SSH_SESSIONS[token]
        return None

    # Check authorization if user_id is provided
    session_user_id = session.get("user_id")
    if user_id is not None and session_user_id is not None:
        # Ensure robust comparison by converting to string
        if str(user_id) != str(session_user_id):
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
    # Clean up expired sessions before creating new ones
    _cleanup_expired_sessions()

    token = secrets.token_urlsafe(32)
    _VNC_SESSIONS[token] = {
        "vnc": vnc_instance,
        "config": vnc_config,
        "user_id": user_id,
        "created_at": time.time(),
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

    # Check if session has expired
    if time.time() - session.get("created_at", 0) > SESSION_EXPIRATION_SECONDS:
        logger.info(f"VNC session {token[:8]}... has expired")
        del _VNC_SESSIONS[token]
        return None

    # Check authorization if user_id is provided
    session_user_id = session.get("user_id")
    if user_id is not None and session_user_id is not None:
        # Ensure robust comparison by converting to string
        if str(user_id) != str(session_user_id):
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

    Requires authentication via ?auth_token=JWT query parameter.

    Args:
        token: The debug session token
        target: The CDP target path (e.g., /devtools/page/ABC123)
    """
    # Authenticate user first
    auth_payload = await _authenticate_websocket(websocket)
    if not auth_payload:
        await websocket.close(code=4001, reason="Authentication required")
        return

    user_id = int(auth_payload.get("sub", 0))

    # Accept the client WebSocket connection
    await websocket.accept()

    # Validate session with user authorization check
    debug_url = get_debug_session(token, user_id=user_id)
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
    # SSRF Protection: Validate URL before navigation
    is_safe, error_msg = _is_safe_url(request.url)
    if not is_safe:
        logger.warning(
            f"SSRF attempt blocked: user {current_user.id} tried to navigate to {request.url}: {error_msg}"
        )
        raise HTTPException(
            status_code=400,
            detail=f"URL not allowed: {error_msg}"
        )

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
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Failed to navigate browser: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Navigation failed"
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

    Requires authentication via ?auth_token=JWT query parameter.

    The client sends input data, and the server sends back terminal output.
    Uses xterm.js on the frontend to render the terminal.

    Args:
        token: The SSH session token
    """
    import asyncio

    # Authenticate user first
    auth_payload = await _authenticate_websocket(websocket)
    if not auth_payload:
        await websocket.close(code=4001, reason="Authentication required")
        return

    user_id = int(auth_payload.get("sub", 0))

    # Accept the client WebSocket connection
    await websocket.accept()

    # Get SSH session with user authorization check
    session = get_ssh_session(token, user_id=user_id)
    if not session:
        await websocket.close(code=1008, reason="Invalid or unauthorized SSH session")
        return

    session_lock: asyncio.Lock = session.setdefault("ws_lock", asyncio.Lock())
    availability: asyncio.Event = session.setdefault("ws_available", asyncio.Event())

    # Ensure the availability event reflects the current state
    if not session.get("ws_active"):
        availability.set()
    else:
        availability.clear()

    # Wait for the session to become available instead of failing fast, so the
    # frontend doesn't churn through rapid reconnects while another connection
    # is still cleaning up.
    try:
        await asyncio.wait_for(availability.wait(), timeout=15)
    except asyncio.TimeoutError:
        await websocket.close(code=1013, reason="SSH session busy")
        return

    async with session_lock:
        if session.get("ws_active"):
            await websocket.close(code=1013, reason="SSH session already active")
            return

        session["ws_active"] = True
        availability.clear()

    ssh_instance = session.get("ssh")
    if not ssh_instance:
        await websocket.close(code=1011, reason="SSH instance not found")
        async with session_lock:
            session["ws_active"] = False
            availability.set()
        return

    logger.info(f"SSH WebSocket connected for session {token[:8]}...")

    try:
        # Create interactive shell
        process = await ssh_instance.create_interactive_shell()
        if not process:
            await websocket.close(code=1011, reason="Failed to create SSH shell")
            async with session_lock:
                session["ws_active"] = False
                availability.set()
            return

        async def forward_ssh_to_client() -> None:
            """Forward SSH output to WebSocket client."""
            try:
                while True:
                    data = await process.stdout.read(4096)
                    if not data:
                        break
                    try:
                        await websocket.send_bytes(data)
                    except Exception as send_exc:  # WebSocket might already be closed
                        logger.debug(f"SSH to client forward ended while sending: {send_exc}")
                        break
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
                    process.stdin.write(data)
                    await process.stdin.drain()
            except WebSocketDisconnect:
                logger.debug("Client WebSocket disconnected")
            except Exception as exc:
                logger.debug(f"Client to SSH forward ended: {exc}")

        send_task = asyncio.create_task(forward_ssh_to_client())
        recv_task = asyncio.create_task(forward_client_to_ssh())

        try:
            done, pending = await asyncio.wait(
                {send_task, recv_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            # Drain any cancellation exceptions
            await asyncio.gather(*pending, return_exceptions=True)
            # Surface any real exception from the finished tasks for logging
            for task in done:
                exc = task.exception()
                if exc:
                    logger.debug(f"SSH WebSocket task ended with error: {exc}")
        finally:
            try:
                process.stdin.write_eof()
            except Exception:
                pass
            try:
                process.close()
                await process.wait_closed()
            except Exception:
                pass

    except Exception as exc:
        logger.error(f"SSH WebSocket error: {exc}")
        await websocket.close(code=1011, reason=str(exc))
    finally:
        async with session_lock:
            session["ws_active"] = False
            availability.set()
        logger.info(f"SSH WebSocket closed for session {token[:8]}...")


# VNC WebSocket endpoint - direct WebSocket to TCP proxy
@router.websocket("/vnc/ws")
async def vnc_websocket_proxy(websocket: WebSocket, token: str) -> None:
    """
    WebSocket endpoint for VNC - proxies directly to VNC server via TCP.

    Requires authentication via ?auth_token=JWT query parameter.

    This is a WebSocket-to-TCP proxy that translates noVNC/RFB WebSocket
    messages directly to the VNC server, without going through websockify.

    Args:
        token: The VNC session token
    """
    import asyncio

    # Authenticate user first
    auth_payload = await _authenticate_websocket(websocket)
    if not auth_payload:
        await websocket.close(code=4001, reason="Authentication required")
        return

    user_id = int(auth_payload.get("sub", 0))

    # Check if client requested a subprotocol (noVNC requires "binary")
    requested_protocols = websocket.headers.get("sec-websocket-protocol", "")
    logger.info(f"VNC WebSocket: client requested subprotocols: {requested_protocols}")

    # Accept with "binary" subprotocol if client requested it (required by noVNC)
    if "binary" in requested_protocols.lower():
        await websocket.accept(subprotocol="binary")
        logger.info("VNC WebSocket: accepted with 'binary' subprotocol")
    else:
        await websocket.accept()
        logger.info("VNC WebSocket: accepted without subprotocol")

    # Get VNC session with user authorization check
    session = get_vnc_session(token, user_id=user_id)
    if not session:
        await websocket.close(code=1008, reason="Invalid or unauthorized VNC session")
        return

    vnc_instance = session.get("vnc")
    if not vnc_instance:
        await websocket.close(code=1011, reason="VNC instance not found")
        return

    # Get VNC server connection details
    vnc_config = vnc_instance.config
    vnc_host = vnc_config.host
    vnc_port = vnc_config.port

    logger.info(f"VNC WebSocket connected for session {token[:8]}..., connecting to {vnc_host}:{vnc_port}")

    reader: asyncio.StreamReader | None = None
    writer: asyncio.StreamWriter | None = None

    try:
        # Connect directly to VNC server via TCP
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(vnc_host, vnc_port),
                timeout=10.0
            )
            logger.info(f"Connected to VNC server {vnc_host}:{vnc_port} via TCP")
        except asyncio.TimeoutError:
            logger.error(f"Timeout connecting to VNC server {vnc_host}:{vnc_port}")
            await websocket.close(code=1011, reason="VNC server connection timeout")
            return
        except Exception as connect_exc:
            logger.error(f"Failed to connect to VNC server: {connect_exc}", exc_info=True)
            await websocket.close(code=1011, reason=f"Cannot connect to VNC: {connect_exc}")
            return

        async def forward_vnc_to_client() -> None:
            """Forward VNC TCP data to WebSocket client."""
            try:
                while True:
                    # Read from VNC TCP connection
                    data = await reader.read(65536)
                    if not data:
                        logger.debug("VNC server closed connection")
                        break
                    # Send as binary WebSocket message
                    await websocket.send_bytes(data)
            except WebSocketDisconnect:
                logger.debug("VNC client WebSocket disconnected")
            except Exception as exc:
                logger.debug(f"VNC to client forward ended: {exc}")

        async def forward_client_to_vnc() -> None:
            """Forward WebSocket input from client to VNC TCP."""
            try:
                while True:
                    message = await websocket.receive()
                    if message["type"] == "websocket.disconnect":
                        break
                    if "bytes" in message:
                        writer.write(message["bytes"])
                        await writer.drain()
                    elif "text" in message:
                        # noVNC sends binary data, but handle text just in case
                        writer.write(message["text"].encode("latin-1"))
                        await writer.drain()
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
        logger.error(f"VNC WebSocket error: {exc}", exc_info=True)
        try:
            await websocket.close(code=1011, reason=str(exc)[:120])
        except Exception:
            pass  # WebSocket might already be closed
    finally:
        # Close the TCP connection
        if writer is not None:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
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

    # Allow access if session has no user_id (created without user context)
    # or if the user_id matches the current user
    session_user_id = session.get("user_id")
    logger.info(f"VNC info request: token={token[:8]}..., session_user_id={session_user_id} (type={type(session_user_id).__name__}), current_user.id={current_user.id} (type={type(current_user.id).__name__})")
    # Convert to int for comparison if needed
    if session_user_id is not None:
        try:
            session_user_id = int(session_user_id)
        except (ValueError, TypeError):
            pass
    if session_user_id is not None and session_user_id != current_user.id:
        logger.warning(f"VNC access denied: session_user_id={session_user_id} != current_user.id={current_user.id}")
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

    # Allow access if session has no user_id (created without user context)
    # or if the user_id matches the current user
    session_user_id = session.get("user_id")
    # Convert to int for comparison if needed
    if session_user_id is not None:
        try:
            session_user_id = int(session_user_id)
        except (ValueError, TypeError):
            pass
    if session_user_id is not None and session_user_id != current_user.id:
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
