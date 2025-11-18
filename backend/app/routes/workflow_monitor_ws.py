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
        # On pourrait ajouter un filtre sur updated_at récent si on veut limiter l'historique
        .order_by(ChatThread.updated_at.desc())
        .limit(100) # Sécurité pour ne pas exploser la mémoire
    )
    
    all_threads = session.scalars(stmt).all()
    active_sessions = []

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

        # Essayer de récupérer le snapshot depuis wait_state si disponible
        wait_state = _get_wait_state_metadata(thread)
        snapshot = None
        current_slug = "unknown"
        steps_history = []

        if wait_state and isinstance(wait_state, dict):
            snapshot = wait_state.get("snapshot")
            if snapshot and isinstance(snapshot, dict):
                current_slug = snapshot.get("current_slug", "unknown")
                steps_history = snapshot.get("steps", [])
        
        # Si pas de wait_state (workflow actif/running), essayer de déduire du dernier snapshot connu
        # ou de l'historique dans les métadonnées si disponible
        if current_slug == "unknown":
             # Fallback: regarder si on a des infos dans le payload du thread
             # Parfois le snapshot est stocké ailleurs ou on peut prendre la dernière étape de l'historique
             pass

        # Récupérer l'affichage de l'étape
        current_step_display = current_slug
        
        # Si on a un historique mais current_slug est unknown, on prend la dernière étape
        if current_slug == "unknown" and steps_history:
            last_step = steps_history[-1]
            if isinstance(last_step, dict):
                current_slug = last_step.get("key", "unknown")
                current_step_display = last_step.get("title", current_slug)
        
        # Si on a toujours "unknown", c'est peut-être le début
        if current_slug == "unknown":
             current_step_display = "Initialisation..."

        # Essayer d'enrichir le nom de l'étape depuis la DB si on a un definition_id
        if definition_id and current_slug != "unknown" and current_slug != "Initialisation...":
            # Note: Idéalement on mettrait ça en cache ou batch aussi
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

    logger.info(f"[WS_MONITOR] Found {len(active_sessions)} active workflow sessions")
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
