"""WebSocket endpoint for real-time GitHub sync notifications."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import redis.asyncio as aioredis

from ..config import get_settings
from ..security import decode_access_token

router = APIRouter()
logger = logging.getLogger(__name__)

GITHUB_SYNC_CHANNEL = "github_sync_notifications"


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


def publish_github_sync_complete(
    repo_full_name: str,
    branch: str,
    sync_type: str,
    workflows_affected: list[str],
):
    """
    Publish a GitHub sync completion event to Redis.
    This is called from Celery tasks (synchronous context).

    Args:
        repo_full_name: The repository (e.g., "owner/repo")
        branch: The branch that was synced
        sync_type: Either "pull" or "push"
        workflows_affected: List of workflow slugs that were affected
    """
    import redis

    settings = get_settings()
    try:
        r = redis.from_url(settings.redis_url)
        message = json.dumps({
            "type": "github_sync_complete",
            "data": {
                "repo_full_name": repo_full_name,
                "branch": branch,
                "sync_type": sync_type,
                "workflows_affected": workflows_affected,
            }
        })
        r.publish(GITHUB_SYNC_CHANNEL, message)
        logger.info(f"Published GitHub sync notification to Redis: {repo_full_name}")
    except Exception as e:
        logger.error(f"Failed to publish GitHub sync notification: {e}")


async def listen_to_redis_pubsub():
    """
    Background task to listen to Redis pub/sub and broadcast to WebSocket clients.
    """
    settings = get_settings()
    while True:
        try:
            r = aioredis.from_url(settings.redis_url)
            pubsub = r.pubsub()
            await pubsub.subscribe(GITHUB_SYNC_CHANNEL)
            logger.info("Started listening to GitHub sync Redis channel")

            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        data = json.loads(message["data"])
                        await github_sync_manager.broadcast(data)
                        logger.info(f"Broadcasted GitHub sync notification to {len(github_sync_manager.active_connections)} clients")
                    except Exception as e:
                        logger.error(f"Error processing Redis message: {e}")

        except Exception as e:
            logger.error(f"Redis pub/sub error: {e}")
            await asyncio.sleep(5)  # Wait before reconnecting


# Start Redis listener as background task when first WebSocket connects
_redis_listener_task: asyncio.Task | None = None


def ensure_redis_listener():
    """Ensure the Redis listener background task is running."""
    global _redis_listener_task
    if _redis_listener_task is None or _redis_listener_task.done():
        _redis_listener_task = asyncio.create_task(listen_to_redis_pubsub())


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

        # Ensure Redis listener is running
        ensure_redis_listener()

        # Send initial connection confirmation
        await websocket.send_json({
            "type": "connected",
            "data": {"message": "Connected to GitHub sync notifications"}
        })

        # Keep connection alive - just wait for messages or disconnection
        # The connection stays open and receives broadcast messages from Redis
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
