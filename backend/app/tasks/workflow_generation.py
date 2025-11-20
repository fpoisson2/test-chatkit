"""
Tâches Celery pour la génération de workflows par IA.
"""

from __future__ import annotations

import asyncio
import datetime
import logging

from sqlalchemy import select

from ..ai_workflow_generator import (
    WorkflowAIGenerator,
    WorkflowGenerationRequest,
)
from ..celery_app import celery_app
from ..database import SessionLocal
from ..models import Workflow

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="app.tasks.workflow_generation.generate_workflow_task")
def generate_workflow_task(
    self,
    task_id: str,
    description: str,
    workflow_name: str | None,
    workflow_slug: str | None,
    model: str,
    temperature: float,
    save_to_database: bool,
):
    """
    Tâche Celery pour générer un workflow par IA en background.

    Cette tâche :
    1. Met à jour le statut : initialisation
    2. Crée le générateur de workflows
    3. Met à jour le statut : génération en cours
    4. Génère le workflow via OpenAI structured output
    5. Met à jour le statut : validation
    6. Valide le workflow généré
    7. Met à jour le statut : sauvegarde (si demandé)
    8. Sauvegarde en BD si save_to_database=True
    9. Met à jour le statut : terminé

    Args:
        self: Instance de la tâche Celery (bind=True)
        task_id: ID unique de la tâche
        description: Description du workflow à générer
        workflow_name: Nom du workflow (optionnel)
        workflow_slug: Slug du workflow (optionnel)
        model: Modèle OpenAI à utiliser
        temperature: Température pour la génération
        save_to_database: Sauvegarder automatiquement en BD

    Returns:
        dict: Résultat contenant le workflow généré et les métadonnées
    """
    try:
        # Étape 1: Initialisation
        logger.info(f"Task {task_id}: Starting workflow generation")
        self.update_state(
            state="PROGRESS",
            meta={
                "current": 0,
                "total": 100,
                "status": "Initialisation...",
                "step": "init",
            },
        )

        # Étape 2: Créer le générateur
        generator = WorkflowAIGenerator()
        logger.info(f"Task {task_id}: Generator created")

        self.update_state(
            state="PROGRESS",
            meta={
                "current": 10,
                "total": 100,
                "status": "Préparation de la génération...",
                "step": "prepare",
            },
        )

        # Étape 3: Créer la requête
        request = WorkflowGenerationRequest(
            description=description,
            workflow_name=workflow_name,
            workflow_slug=workflow_slug,
            model=model,
            temperature=temperature,
            save_to_database=False,  # On gère la sauvegarde manuellement
        )

        # Étape 4: Générer le workflow (opération longue)
        logger.info(f"Task {task_id}: Generating workflow with {model}")
        self.update_state(
            state="PROGRESS",
            meta={
                "current": 20,
                "total": 100,
                "status": f"Génération du workflow avec {model}...",
                "step": "generating",
                "description": description[:100],
            },
        )

        # Exécuter la génération de manière synchrone dans le worker Celery
        response = asyncio.run(generator.generate(request))

        logger.info(
            f"Task {task_id}: Workflow generated with "
            f"{len(response.graph.nodes)} nodes and "
            f"{len(response.graph.edges)} edges"
        )

        # Étape 5: Validation
        self.update_state(
            state="PROGRESS",
            meta={
                "current": 70,
                "total": 100,
                "status": "Validation du workflow...",
                "step": "validating",
                "nodes_count": len(response.graph.nodes),
                "edges_count": len(response.graph.edges),
            },
        )

        # Vérifier la validation
        if not response.validation_passed:
            logger.warning(
                f"Task {task_id}: Validation failed with errors: "
                f"{response.validation_errors}"
            )
            self.update_state(
                state="FAILURE",
                meta={
                    "current": 70,
                    "total": 100,
                    "status": "Erreur de validation",
                    "step": "validation_failed",
                    "errors": response.validation_errors,
                },
            )
            raise ValueError(
                f"Workflow validation failed: {', '.join(response.validation_errors)}"
            )

        # Étape 6: Sauvegarde en base de données (si demandé)
        workflow_id = None
        if save_to_database:
            logger.info(f"Task {task_id}: Saving to database")
            self.update_state(
                state="PROGRESS",
                meta={
                    "current": 80,
                    "total": 100,
                    "status": "Sauvegarde en base de données...",
                    "step": "saving",
                },
            )

            try:
                with SessionLocal() as session:
                    # Convertir au format API
                    graph_dict = generator.convert_to_api_format(response.graph)

                    # Importer le service de persistence
                    from ..workflows.service import WorkflowPersistenceService

                    service = WorkflowPersistenceService()

                    # Vérifier si un workflow avec ce slug existe déjà
                    existing = service.get_workflow_by_slug(
                        response.workflow_slug, session
                    )

                    if existing:
                        # Générer un slug unique
                        base_slug = response.workflow_slug
                        counter = 1
                        while existing:
                            response.workflow_slug = f"{base_slug}_{counter}"
                            existing = service.get_workflow_by_slug(
                                response.workflow_slug, session
                            )
                            counter += 1

                    # Créer le workflow
                    workflow = service.create_workflow(
                        slug=response.workflow_slug,
                        display_name=response.workflow_name,
                        description=response.description,
                        graph_payload=graph_dict,
                        session=session,
                    )

                    workflow_id = workflow.id

                    logger.info(
                        f"Task {task_id}: Workflow saved with id={workflow_id}, "
                        f"slug={response.workflow_slug}"
                    )

            except Exception as e:
                logger.error(f"Task {task_id}: Failed to save workflow: {e}")
                # Ne pas échouer la tâche, juste logger l'erreur
                # Le workflow sera retourné même si la sauvegarde échoue
                self.update_state(
                    state="PROGRESS",
                    meta={
                        "current": 80,
                        "total": 100,
                        "status": "Avertissement: échec de la sauvegarde",
                        "step": "save_failed",
                        "save_error": str(e),
                    },
                )

        # Étape 7: Terminé
        logger.info(f"Task {task_id}: Completed successfully")
        self.update_state(
            state="PROGRESS",
            meta={
                "current": 100,
                "total": 100,
                "status": "Workflow généré avec succès !",
                "step": "completed",
            },
        )

        # Convertir le graphe en dictionnaire pour la sérialisation
        graph_dict = {
            "nodes": [
                {
                    "slug": node.slug,
                    "kind": node.kind,
                    "display_name": node.display_name,
                    "agent_key": node.agent_key,
                    "parent_slug": node.parent_slug,
                    "is_enabled": node.is_enabled,
                    "parameters": node.parameters.model_dump(exclude_none=True),
                    "metadata": node.metadata,
                }
                for node in response.graph.nodes
            ],
            "edges": [
                {
                    "source": edge.source,
                    "target": edge.target,
                    "condition": edge.condition,
                    "metadata": edge.metadata,
                }
                for edge in response.graph.edges
            ],
        }

        return {
            "status": "completed",
            "task_id": task_id,
            "workflow": {
                "graph": graph_dict,
                "workflow_name": response.workflow_name,
                "workflow_slug": response.workflow_slug,
                "description": response.description,
                "validation_passed": response.validation_passed,
                "validation_errors": response.validation_errors,
                "workflow_id": workflow_id,
                "tokens_used": response.tokens_used,
            },
        }

    except Exception as e:
        # Erreur fatale
        logger.exception(f"Task {task_id} failed: {e}")
        self.update_state(
            state="FAILURE",
            meta={
                "current": 0,
                "total": 100,
                "status": f"Erreur: {str(e)}",
                "step": "failed",
                "error": str(e),
            },
        )
        raise
