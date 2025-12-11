"""
Tâches Celery pour la génération de workflows via IA.
"""
from __future__ import annotations

import datetime
import json
import logging

from sqlalchemy import select

from ..celery_app import celery_app
from ..database import SessionLocal
from ..models import (
    WorkflowGenerationPrompt,
    WorkflowGenerationTask,
)

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="app.tasks.workflow_generation.generate_workflow_task")
def generate_workflow_task(
    self,
    task_id: str,
    workflow_id: int,
    prompt_id: int,
    user_message: str,
):
    """
    Tâche Celery pour générer un workflow via l'API OpenAI.

    Cette tâche :
    1. Charge le prompt configuré depuis la BD
    2. Appelle l'API OpenAI avec le prompt et le message utilisateur
    3. Parse la réponse JSON
    4. Met à jour la tâche avec le résultat

    Args:
        self: Instance de la tâche Celery (bind=True)
        task_id: ID de la tâche dans la BD
        workflow_id: ID du workflow cible
        prompt_id: ID du prompt à utiliser
        user_message: Message de l'utilisateur décrivant le workflow
    """
    import asyncio

    from openai import OpenAI

    try:
        with SessionLocal() as session:
            # Charger la tâche
            task = session.scalar(
                select(WorkflowGenerationTask).where(
                    WorkflowGenerationTask.task_id == task_id
                )
            )
            if not task:
                logger.error(f"Task {task_id} not found in database")
                return

            try:
                # Étape 1: Charger le prompt
                prompt = session.get(WorkflowGenerationPrompt, prompt_id)
                if not prompt:
                    raise ValueError(f"Prompt {prompt_id} not found in database")

                # Mettre à jour: status = running, progress = 10
                task.status = "running"
                task.progress = 10
                session.commit()

                logger.info(
                    f"Task {task_id}: Starting workflow generation with prompt "
                    f"'{prompt.name}' (model: {prompt.model})"
                )

                self.update_state(
                    state="PROGRESS",
                    meta={"current": 10, "total": 100, "status": "Loading model..."},
                )

                # Étape 2: Préparer l'appel OpenAI
                task.progress = 20
                session.commit()
                self.update_state(
                    state="PROGRESS",
                    meta={"current": 20, "total": 100, "status": "Preparing request..."},
                )

                # Configurer le client OpenAI
                client = OpenAI()

                # Mapper les niveaux d'effort aux paramètres OpenAI
                reasoning_effort_map = {
                    "low": "low",
                    "medium": "medium",
                    "high": "high",
                }
                reasoning_effort = reasoning_effort_map.get(prompt.effort, "medium")

                # Étape 3: Appeler l'API OpenAI
                task.progress = 30
                session.commit()
                self.update_state(
                    state="PROGRESS",
                    meta={
                        "current": 30,
                        "total": 100,
                        "status": "Generating workflow with AI...",
                    },
                )

                logger.info(f"Task {task_id}: Calling OpenAI API with model {prompt.model}")

                # Construire les messages
                messages = [
                    {
                        "role": "developer",
                        "content": prompt.developer_message,
                    },
                    {
                        "role": "user",
                        "content": user_message,
                    },
                ]

                # Appeler l'API avec les paramètres configurés
                response = client.responses.create(
                    model=prompt.model,
                    input=messages,
                    text={
                        "format": {
                            "type": "json_object",
                        },
                    },
                    reasoning={
                        "effort": reasoning_effort,
                        "summary": "auto",
                    },
                    store=True,
                )

                # Étape 4: Extraire et parser la réponse
                task.progress = 80
                session.commit()
                self.update_state(
                    state="PROGRESS",
                    meta={
                        "current": 80,
                        "total": 100,
                        "status": "Processing response...",
                    },
                )

                logger.info(f"Task {task_id}: Processing OpenAI response")

                # Extraire le texte de la réponse
                response_text = None
                for item in response.output:
                    if item.type == "message":
                        for content in item.content:
                            if content.type == "output_text":
                                response_text = content.text
                                break

                if not response_text:
                    raise ValueError("No text response from OpenAI")

                # Parser le JSON
                workflow_json = json.loads(response_text)

                # Valider la structure basique
                if "nodes" not in workflow_json or "edges" not in workflow_json:
                    raise ValueError(
                        "Invalid workflow JSON: missing 'nodes' or 'edges' keys"
                    )

                logger.info(
                    f"Task {task_id}: Successfully generated workflow with "
                    f"{len(workflow_json.get('nodes', []))} nodes and "
                    f"{len(workflow_json.get('edges', []))} edges"
                )

                # Étape 5: Sauvegarder le résultat
                task.result_json = workflow_json
                task.status = "completed"
                task.progress = 100
                task.completed_at = datetime.datetime.now(datetime.UTC)
                session.commit()

                logger.info(f"Task {task_id}: Completed successfully")

                return {
                    "status": "completed",
                    "task_id": task_id,
                    "workflow_id": workflow_id,
                    "nodes_count": len(workflow_json.get("nodes", [])),
                    "edges_count": len(workflow_json.get("edges", [])),
                }

            except Exception as e:
                # En cas d'erreur, marquer la tâche comme failed
                logger.exception(f"Task {task_id} failed: {e}")
                task.status = "failed"
                task.error_message = str(e)
                task.progress = 0
                session.commit()

                # Propager l'erreur pour Celery
                raise

    except Exception as e:
        # Erreur fatale (impossible de charger la tâche)
        logger.exception(f"Fatal error in Celery task for {task_id}: {e}")
        raise
