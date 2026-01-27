"""WebSocket endpoint for real-time workflow monitoring."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from datetime import datetime, timedelta, timezone

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
from ..security import decode_access_token

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
    """Récupère toutes les sessions actives (optimisé)."""
    # Optimisation: Filtrer directement en SQL si possible, sinon filtrer en Python mais avec eager loading
    # Note: Le filtrage JSONB dépend du dialecte DB, on reste générique ici mais on eager load
    
    # On ne récupère que les threads qui ont potentiellement un workflow
    # Idéalement on filtrerait sur payload->'metadata'->'workflow' mais cela dépend de la DB
    # Pour l'instant on charge tout mais avec les relations nécessaires pour éviter le N+1
    stmt = (
        select(ChatThread)
        .options(
            # Eager load pour éviter les requêtes N+1
            # Note: User et Workflow ne sont pas des relations directes sur ChatThread dans le modèle actuel
            # On devra les charger efficacement
        )
        # Filter for sessions updated in the last 2 hours (truly active sessions)
        .where(ChatThread.updated_at >= datetime.now(timezone.utc) - timedelta(hours=2))
        .order_by(ChatThread.updated_at.desc())
        .limit(100) # Sécurité pour ne pas exploser la mémoire
    )
    
    all_threads = session.scalars(stmt).all()
    active_sessions: list[dict[str, Any]] = []

    logger.info(f"[WS_MONITOR] Checking {len(all_threads)} threads for active workflow sessions")

    # Collecter les IDs pour le chargement en batch
    user_ids = set()
    workflow_ids = set()
    thread_map = []

    for thread in all_threads:
        # Récupérer les métadonnées du thread
        thread_payload = thread.payload if hasattr(thread, 'payload') else {}
        thread_metadata = thread_payload.get("metadata", {}) if isinstance(thread_payload, dict) else {}
        workflow_meta = thread_metadata.get("workflow", {}) if isinstance(thread_metadata, dict) else {}

        # Skip threads sans workflow
        if not workflow_meta or not isinstance(workflow_meta, dict):
            continue

        workflow_id = workflow_meta.get("id")
        if not workflow_id:
            continue
            
        owner_id = thread.owner_id
        try:
            u_id = int(owner_id)
            user_ids.add(u_id)
        except (ValueError, TypeError):
            continue
            
        workflow_ids.add(workflow_id)
        
        thread_map.append({
            "thread": thread,
            "workflow_id": workflow_id,
            "user_id": int(owner_id),
            "definition_id": workflow_meta.get("definition_id")
        })

    # Chargement en batch des Users et Workflows
    users = {u.id: u for u in session.scalars(select(User).where(User.id.in_(user_ids))).all()}
    workflows = {w.id: w for w in session.scalars(select(Workflow).where(Workflow.id.in_(workflow_ids))).all()}

    for item in thread_map:
        thread = item["thread"]
        user = users.get(item["user_id"])
        workflow = workflows.get(item["workflow_id"])
        definition_id = item["definition_id"]

        if not user or not workflow:
            continue

        # Récupérer les métadonnées du workflow pour CE thread spécifique
        thread_payload = thread.payload if hasattr(thread, 'payload') else {}
        thread_metadata = thread_payload.get("metadata", {}) if isinstance(thread_payload, dict) else {}
        workflow_meta = thread_metadata.get("workflow", {}) if isinstance(thread_metadata, dict) else {}

        # Essayer de récupérer le snapshot depuis wait_state si disponible
        wait_state = _get_wait_state_metadata(thread)
        snapshot = None
        current_slug = "unknown"
        current_step_display = "unknown"
        steps_history = []

        if wait_state and isinstance(wait_state, dict):
            snapshot = wait_state.get("snapshot")
            if snapshot and isinstance(snapshot, dict):
                current_slug = snapshot.get("current_slug", "unknown")
                steps_history = snapshot.get("steps", [])
                logger.info(f"[WS_MONITOR] Thread {thread.id}: found snapshot with slug={current_slug}, steps_count={len(steps_history)}")
        else:
            logger.info(f"[WS_MONITOR] Thread {thread.id}: NO wait_state, workflow_meta keys={list(workflow_meta.keys())}")

        # Try to get current step from metadata (persisted during execution)
        current_step_meta = workflow_meta.get("current_step")
        if isinstance(current_step_meta, dict):
            # Get slug if we don't have it yet
            if current_slug == "unknown":
                current_slug = current_step_meta.get("slug", "unknown")
            # Always try to get the title from metadata
            title_from_meta = current_step_meta.get("title")
            if title_from_meta:
                current_step_display = title_from_meta

        # Try to get history from metadata if not found in wait_state
        if not steps_history:
             steps_history = workflow_meta.get("steps_history", [])
             if steps_history:
                 logger.info(f"[WS_MONITOR] Thread {thread.id}: using steps_history from workflow_meta, count={len(steps_history)}")

        # Enrichir le nom de l'étape depuis la DB SEULEMENT si on n'a pas déjà un titre
        if current_step_display == "unknown" and definition_id and current_slug != "unknown":
            # Note: Idéalement on mettrait ça en cache ou batch aussi
            workflow_step = session.scalar(
                select(WorkflowStep).where(
                    WorkflowStep.definition_id == definition_id,
                    WorkflowStep.slug == current_slug,
                )
            )
            if workflow_step:
                # Try parameters["title"] first, then display_name
                if workflow_step.parameters and workflow_step.parameters.get("title"):
                    current_step_display = str(workflow_step.parameters.get("title"))
                elif workflow_step.display_name:
                    current_step_display = workflow_step.display_name
                else:
                    current_step_display = current_slug

        step_history_list = []
        for step in steps_history:
            if isinstance(step, dict):
                step_history_list.append({
                    "slug": step.get("key", ""),
                    "display_name": step.get("title", ""),
                    "timestamp": None,
                })

        active_sessions.append({
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
            "status": "waiting_user" if wait_state else "active",
        })

    # Déduplication: un seul thread "actif" par (utilisateur, workflow) dans le monitoring.
    # Raison: un étudiant peut ouvrir plusieurs onglets / relancer un workflow, créant plusieurs threads
    # très similaires, ce qui donne des doublons dans l'UI d'admin.
    deduped: dict[tuple[int, int], tuple[datetime, dict[str, Any]]] = {}
    for sess in active_sessions:
        key = (sess["user"]["id"], sess["workflow"]["id"])
        try:
            last_activity = datetime.fromisoformat(sess["last_activity"])
            if last_activity.tzinfo is None:
                last_activity = last_activity.replace(tzinfo=timezone.utc)
        except Exception:
            last_activity = datetime.min.replace(tzinfo=timezone.utc)

        existing = deduped.get(key)
        if existing is None or last_activity > existing[0]:
            deduped[key] = (last_activity, sess)

    deduped_sessions = [entry[1] for entry in sorted(deduped.values(), key=lambda x: x[0], reverse=True)]
    if len(deduped_sessions) != len(active_sessions):
        logger.info(
            f"[WS_MONITOR] Deduped sessions: {len(active_sessions)} -> {len(deduped_sessions)} "
            "(by user_id + workflow_id)"
        )
    else:
        logger.info(f"[WS_MONITOR] Found {len(deduped_sessions)} active workflow sessions")

    return deduped_sessions


@router.websocket("/api/admin/workflows/monitor")
async def workflow_monitor_websocket(
    websocket: WebSocket,
):
    """
    WebSocket endpoint pour le monitoring en temps réel des workflows.

    Requires admin authentication via ?token=JWT query parameter.
    Envoie périodiquement les mises à jour des sessions actives.

    NOTE: We DON'T use Depends(get_session) here because WebSocket endpoints
    run indefinitely. Using Depends would hold a DB connection for the entire
    WebSocket lifetime, causing connection pool exhaustion.
    """
    from ..database import SessionLocal

    # Vérifier l'authentification via token
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing authentication token")
        return

    # Decode and validate JWT token
    try:
        payload = decode_access_token(token)
    except Exception as e:
        logger.warning(f"WebSocket auth failed: invalid token - {e}")
        await websocket.close(code=4001, reason="Invalid authentication token")
        return

    # Check admin privileges
    if not payload.get("is_admin"):
        logger.warning(f"WebSocket auth failed: user {payload.get('sub')} is not admin")
        await websocket.close(code=4003, reason="Admin privileges required")
        return

    def _fetch_sessions() -> list[dict[str, Any]]:
        """Fetch active sessions with a fresh DB session."""
        session = SessionLocal()
        try:
            return get_active_sessions(session)
        finally:
            session.close()

    try:
        await manager.connect(websocket)

        # Envoyer les données initiales
        sessions = _fetch_sessions()
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

                # Récupérer les sessions mises à jour (fresh session each time)
                sessions = _fetch_sessions()

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
