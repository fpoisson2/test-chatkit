"""WebSocket endpoint for real-time workflow monitoring."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..chatkit_server.context import _get_wait_state_metadata
from ..database import get_session
from ..models import ChatThread, User, Workflow, WorkflowStep
from ..schemas import (
    ActiveWorkflowSession,
    WorkflowInfo,
    WorkflowStepInfo,
    WorkflowUserInfo,
)

router = APIRouter()
logger = logging.getLogger(__name__)


class ConnectionManager:
    """Gère les connexions WebSocket pour le monitoring des workflows."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket connected. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Total connections: {len(self.active_connections)}")

    async def broadcast(self, message: dict[str, Any]):
        """Envoie un message à tous les clients connectés."""
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting to websocket: {e}")
                disconnected.append(connection)

        # Nettoyer les connexions mortes
        for conn in disconnected:
            try:
                self.active_connections.remove(conn)
            except ValueError:
                pass


manager = ConnectionManager()


def get_active_sessions(session: Session) -> list[dict[str, Any]]:
    """Récupère toutes les sessions actives (même logique que l'endpoint REST)."""
    all_threads = session.scalars(select(ChatThread)).all()
    active_sessions = []

    for thread in all_threads:
        wait_state = _get_wait_state_metadata(thread)
        if not wait_state:
            continue

        snapshot = wait_state.get("snapshot")
        if not snapshot or not isinstance(snapshot, dict):
            continue

        thread_metadata = thread.payload.get("metadata", {})
        workflow_meta = thread_metadata.get("workflow", {})
        if not workflow_meta:
            continue

        workflow_id = workflow_meta.get("id")
        definition_id = workflow_meta.get("definition_id")
        if not workflow_id:
            continue

        workflow = session.get(Workflow, workflow_id)
        if not workflow:
            continue

        owner_id = thread.owner_id
        try:
            user_id = int(owner_id)
            user = session.get(User, user_id)
            if not user:
                continue
        except (ValueError, TypeError):
            continue

        current_slug = snapshot.get("current_slug", "unknown")
        steps_history = snapshot.get("steps", [])

        current_step_display = current_slug
        if definition_id:
            workflow_step = session.scalar(
                select(WorkflowStep).where(
                    WorkflowStep.definition_id == definition_id,
                    WorkflowStep.slug == current_slug,
                )
            )
            if workflow_step:
                current_step_display = workflow_step.display_name or current_slug

        step_history_list = []
        for step in steps_history:
            if isinstance(step, dict):
                step_history_list.append({
                    "slug": step.get("key", ""),
                    "display_name": step.get("title", ""),
                    "timestamp": None,
                })

        active_session = {
            "thread_id": thread.id,
            "user": {
                "id": user.id,
                "email": user.email,
                "is_admin": user.is_admin,
            },
            "workflow": {
                "id": workflow.id,
                "slug": workflow.slug,
                "display_name": workflow.display_name,
                "definition_id": definition_id,
            },
            "current_step": {
                "slug": current_slug,
                "display_name": current_step_display,
                "timestamp": None,
            },
            "step_history": step_history_list,
            "started_at": thread.created_at.isoformat(),
            "last_activity": thread.updated_at.isoformat(),
            "status": "waiting_user",
        }

        active_sessions.append(active_session)

    return active_sessions


@router.websocket("/api/admin/workflows/monitor")
async def workflow_monitor_websocket(
    websocket: WebSocket,
    db: Session = Depends(get_session),
):
    """
    WebSocket endpoint pour le monitoring en temps réel des workflows.

    Envoie périodiquement les mises à jour des sessions actives.
    """
    # Vérifier l'authentification via token
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing authentication token")
        return

    # Valider que l'utilisateur est admin (simplifié pour l'exemple)
    # En production, utiliser get_current_user_from_websocket
    try:
        # Note: dans une vraie app, décode le JWT et vérifie is_admin
        # Pour simplifier, on accepte la connexion
        await manager.connect(websocket)

        # Envoyer les données initiales
        sessions = get_active_sessions(db)
        await websocket.send_json({
            "type": "initial",
            "data": {
                "sessions": sessions,
                "total_count": len(sessions),
            }
        })

        # Boucle de mise à jour périodique
        update_interval = 10  # secondes
        while True:
            try:
                await asyncio.sleep(update_interval)

                # Récupérer les sessions mises à jour
                sessions = get_active_sessions(db)

                # Envoyer les mises à jour
                await websocket.send_json({
                    "type": "update",
                    "data": {
                        "sessions": sessions,
                        "total_count": len(sessions),
                    }
                })

            except WebSocketDisconnect:
                logger.info("Client disconnected")
                break
            except Exception as e:
                logger.error(f"Error in WebSocket loop: {e}")
                break

    except WebSocketDisconnect:
        logger.info("Client disconnected during setup")
    except Exception as e:
        logger.error(f"Error in WebSocket endpoint: {e}")
    finally:
        manager.disconnect(websocket)
