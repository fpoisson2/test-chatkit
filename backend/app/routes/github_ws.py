"""WebSocket endpoint for real-time GitHub sync notifications."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..security import decode_access_token

router = APIRouter()
logger = logging.getLogger(__name__)


class GitHubSyncConnectionManager:
    """Manages WebSocket connections for GitHub sync notifications."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"GitHub sync WebSocket connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"GitHub sync WebSocket disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict[str, Any]):
        """Send a message to all connected clients."""
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting to websocket: {e}")
                disconnected.append(connection)

        for conn in disconnected:
            try:
                self.active_connections.remove(conn)
            except ValueError:
                pass


# Global manager instance
github_sync_manager = GitHubSyncConnectionManager()


async def notify_github_sync_complete(
    repo_full_name: str,
    branch: str,
    sync_type: str,
    workflows_affected: list[str],
):
    """
    Notify all connected clients that a GitHub sync has completed.

    Args:
        repo_full_name: The repository (e.g., "owner/repo")
        branch: The branch that was synced
        sync_type: Either "pull" or "push"
        workflows_affected: List of workflow slugs that were affected
    """
    await github_sync_manager.broadcast({
        "type": "github_sync_complete",
        "data": {
            "repo_full_name": repo_full_name,
            "branch": branch,
            "sync_type": sync_type,
            "workflows_affected": workflows_affected,
        }
    })


@router.websocket("/api/github/sync/ws")
async def github_sync_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for real-time GitHub sync notifications.

    Requires authentication via ?token=JWT query parameter.
    Clients receive notifications when GitHub syncs complete (from webhooks).
    """
    # Verify authentication via token
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing authentication token")
        return

    # Decode and validate JWT token
    try:
        payload = decode_access_token(token)
    except Exception as e:
        logger.warning(f"GitHub sync WebSocket auth failed: invalid token - {e}")
        await websocket.close(code=4001, reason="Invalid authentication token")
        return

    try:
        await github_sync_manager.connect(websocket)

        # Send initial connection confirmation
        await websocket.send_json({
            "type": "connected",
            "data": {"message": "Connected to GitHub sync notifications"}
        })

        # Keep connection alive - just wait for messages or disconnection
        # The connection stays open and receives broadcast messages
        while True:
            try:
                # Send periodic ping to keep connection alive
                await asyncio.sleep(25)
                await websocket.send_json({"type": "ping"})
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.debug(f"GitHub sync WebSocket ping failed: {e}")
                break

    except WebSocketDisconnect:
        logger.info("GitHub sync WebSocket client disconnected during setup")
    except Exception as e:
        logger.error(f"Error in GitHub sync WebSocket endpoint: {e}")
    finally:
        github_sync_manager.disconnect(websocket)
