"""
Tâches Celery pour la génération de workflows via OpenAI.
"""
from __future__ import annotations

import datetime
import json
import logging
import re

from sqlalchemy import select

from ..celery_app import celery_app
from ..database import SessionLocal
from ..models import (
    WorkflowGenerationPrompt,
    WorkflowGenerationTask,
    WorkflowDefinition,
)

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="app.tasks.workflow_generation.generate_workflow_task")
def generate_workflow_task(
    self,
    task_id: str,
    prompt_id: int | None,
    user_message: str,
    workflow_id: int,
    version_id: int | None,
):
    """
    Tâche Celery pour générer un workflow en background via OpenAI.

    Cette tâche :
    1. Charge le prompt configuré
    2. Appelle l'API OpenAI avec le message utilisateur
    3. Parse la réponse JSON
    4. Sauvegarde le résultat

    Args:
        self: Instance de la tâche Celery (bind=True)
        task_id: ID de la tâche dans la BD
        prompt_id: ID du prompt à utiliser (ou None pour le défaut)
        user_message: Message de l'utilisateur décrivant le workflow souhaité
        workflow_id: ID du workflow cible
        version_id: ID de la version du workflow
    """
    import asyncio

    from openai import OpenAI

    from ..chatkit.agent_registry import get_agent_provider_binding

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
                task.status = "running"
                task.progress = 10
                session.commit()

                self.update_state(
                    state="PROGRESS",
                    meta={"current": 10, "total": 100, "status": "Loading prompt..."},
                )

                # Charger le prompt configuré ou le défaut
                if prompt_id:
                    prompt = session.get(WorkflowGenerationPrompt, prompt_id)
                else:
                    prompt = session.scalar(
                        select(WorkflowGenerationPrompt)
                        .where(WorkflowGenerationPrompt.is_default)
                        .where(WorkflowGenerationPrompt.is_active)
                    )

                if not prompt:
                    # Utiliser un prompt par défaut si aucun n'est configuré
                    prompt = session.scalar(
                        select(WorkflowGenerationPrompt)
                        .where(WorkflowGenerationPrompt.is_active)
                        .order_by(WorkflowGenerationPrompt.id)
                        .limit(1)
                    )

                if not prompt:
                    raise ValueError(
                        "Aucun prompt de génération configuré. "
                        "Veuillez configurer un prompt dans l'administration."
                    )

                logger.info(
                    f"Task {task_id}: Using prompt '{prompt.name}' "
                    f"with model {prompt.model}"
                )

                # Étape 2: Préparer l'appel API
                task.progress = 20
                session.commit()

                self.update_state(
                    state="PROGRESS",
                    meta={
                        "current": 20,
                        "total": 100,
                        "status": "Preparing API call...",
                    },
                )

                # Résoudre le provider
                provider_binding = get_agent_provider_binding(
                    prompt.provider_id, prompt.provider_slug
                )

                # Configurer le client OpenAI
                client_kwargs = {}
                if provider_binding and provider_binding.api_base:
                    client_kwargs["base_url"] = provider_binding.api_base
                if provider_binding and provider_binding.api_key:
                    client_kwargs["api_key"] = provider_binding.api_key

                client = OpenAI(**client_kwargs)

                # Étape 3: Appeler l'API
                task.progress = 30
                session.commit()

                self.update_state(
                    state="PROGRESS",
                    meta={
                        "current": 30,
                        "total": 100,
                        "status": "Generating workflow...",
                    },
                )

                logger.info(f"Task {task_id}: Calling OpenAI API")

                # Préparer les messages
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

                # Préparer les paramètres du modèle
                model_params = {
                    "model": prompt.model,
                    "messages": messages,
                    "response_format": {"type": "json_object"},
                }

                # Ajouter le niveau de raisonnement si le modèle le supporte
                if prompt.reasoning_effort and prompt.reasoning_effort != "none":
                    model_params["reasoning_effort"] = prompt.reasoning_effort

                # Appeler l'API
                response = client.chat.completions.create(**model_params)

                # Étape 4: Parser la réponse
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

                response_text = response.choices[0].message.content
                logger.info(f"Task {task_id}: Received response, parsing JSON")

                # Parser le JSON
                try:
                    result_json = json.loads(response_text)
                except json.JSONDecodeError:
                    # Essayer d'extraire le JSON de la réponse
                    json_match = re.search(r"\{.*\}", response_text, re.DOTALL)
                    if not json_match:
                        raise ValueError("Failed to extract JSON from AI response")
                    result_json = json.loads(json_match.group(0))

                # Valider la structure
                if "nodes" not in result_json or "edges" not in result_json:
                    raise ValueError(
                        "Invalid workflow structure: missing 'nodes' or 'edges'"
                    )

                # Étape 5: Sauvegarder le résultat
                task.result_json = result_json
                task.status = "completed"
                task.progress = 100
                task.completed_at = datetime.datetime.now(datetime.UTC)
                session.commit()

                logger.info(
                    f"Task {task_id}: Completed successfully with "
                    f"{len(result_json.get('nodes', []))} nodes and "
                    f"{len(result_json.get('edges', []))} edges"
                )

                return {
                    "status": "completed",
                    "task_id": task_id,
                    "nodes_count": len(result_json.get("nodes", [])),
                    "edges_count": len(result_json.get("edges", [])),
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
