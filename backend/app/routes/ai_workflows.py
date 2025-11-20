"""Endpoints API pour la génération de workflows par IA.

Ces endpoints permettent au frontend de :
- Générer des workflows par IA à partir de descriptions (mode sync et async)
- Streamer la progression en temps réel via SSE
- Valider des workflows générés
- Sauvegarder des workflows générés dans la base de données
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, AsyncGenerator

import structlog
from celery.result import AsyncResult
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..ai_workflow_generator import (
    WorkflowAIGenerator,
    WorkflowGenerationRequest,
    WorkflowGenerationResponse,
    WorkflowGraphSpec,
    WorkflowValidationRequest,
    WorkflowValidationResponse,
)
from ..ai_workflow_generator.validator import WorkflowAIValidator
from ..celery_app import celery_app
from ..database import get_session
from ..dependencies import get_current_user, get_workflow_persistence_service
from ..models import User
from ..workflows import WorkflowPersistenceService

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/ai-workflows", tags=["AI Workflows"])


# Schémas pour les endpoints asynchrones
class AsyncWorkflowGenerationRequest(BaseModel):
    """Requête pour générer un workflow de manière asynchrone."""

    description: str
    workflow_name: str | None = None
    workflow_slug: str | None = None
    model: str = "gpt-4o-2024-08-06"
    temperature: float = 0.3
    save_to_database: bool = False


class AsyncWorkflowGenerationResponse(BaseModel):
    """Réponse initiale pour une génération asynchrone."""

    task_id: str
    status: str = "pending"
    message: str = "Génération lancée"


@router.post(
    "/generate",
    response_model=WorkflowGenerationResponse,
    status_code=status.HTTP_200_OK,
    summary="Générer un workflow par IA",
    description="""
Génère un workflow complet à partir d'une description en langage naturel.

Utilise OpenAI structured output pour garantir un JSON valide.

**Exemple de description** :
```
Crée un agent de support client qui :
1. Accueille l'utilisateur
2. Identifie son problème
3. Propose des solutions
4. Transfère vers un humain si nécessaire
```

**Fonctionnalités** :
- Validation automatique du workflow généré
- Génération automatique du nom et du slug
- Option pour sauvegarder directement en base de données
- Retour des erreurs de validation si présentes
""",
)
async def generate_workflow(
    request: WorkflowGenerationRequest,
    session: Session = Depends(get_session),
    service: WorkflowPersistenceService = Depends(get_workflow_persistence_service),
) -> WorkflowGenerationResponse:
    """Génère un workflow par IA."""
    try:
        # Créer le générateur
        generator = WorkflowAIGenerator()

        # Générer le workflow
        response = await generator.generate(request)

        # Si demandé, sauvegarder en base de données
        if request.save_to_database:
            try:
                # Convertir au format API
                graph_dict = generator.convert_to_api_format(response.graph)

                # Vérifier si un workflow avec ce slug existe déjà
                existing = service.get_workflow_by_slug(response.workflow_slug, session)

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

                response.workflow_id = workflow.id

                logger.info(
                    "Workflow généré et sauvegardé",
                    workflow_id=workflow.id,
                    slug=response.workflow_slug,
                )

            except Exception as e:
                logger.error(
                    "Erreur lors de la sauvegarde du workflow",
                    error=str(e),
                    slug=response.workflow_slug,
                )
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Erreur lors de la sauvegarde du workflow : {str(e)}",
                )

        return response

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        logger.error("Erreur lors de la génération du workflow", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors de la génération du workflow : {str(e)}",
        )


@router.post(
    "/validate",
    response_model=WorkflowValidationResponse,
    status_code=status.HTTP_200_OK,
    summary="Valider un workflow",
    description="""
Valide un workflow généré pour s'assurer qu'il est conforme au schéma attendu.

**Vérifications effectuées** :
- Format JSON conforme au schéma Pydantic
- Présence des nœuds start et end
- Validité des connexions entre nœuds
- Absence de cycles invalides
- Accessibilité de tous les nœuds depuis start
- Paramètres requis pour chaque type de nœud

**Retour** :
- `valid` : true si le workflow est valide
- `errors` : liste des erreurs bloquantes
- `warnings` : liste des avertissements
- `suggestions` : liste des suggestions d'amélioration
""",
)
async def validate_workflow(
    request: WorkflowValidationRequest,
) -> WorkflowValidationResponse:
    """Valide un workflow généré."""
    try:
        validator = WorkflowAIValidator()
        return validator.validate(request.graph)
    except Exception as e:
        logger.error("Erreur lors de la validation du workflow", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors de la validation : {str(e)}",
        )


@router.post(
    "/convert-to-api-format",
    response_model=dict[str, Any],
    status_code=status.HTTP_200_OK,
    summary="Convertir au format API",
    description="""
Convertit un workflow au format WorkflowGraphSpec vers le format API attendu.

Utile pour intégrer un workflow généré avec l'API existante.
""",
)
async def convert_to_api_format(
    graph: WorkflowGraphSpec,
) -> dict[str, Any]:
    """Convertit un workflow au format API."""
    try:
        generator = WorkflowAIGenerator()
        return generator.convert_to_api_format(graph)
    except Exception as e:
        logger.error("Erreur lors de la conversion", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors de la conversion : {str(e)}",
        )


@router.get(
    "/capabilities",
    response_model=dict[str, Any],
    status_code=status.HTTP_200_OK,
    summary="Obtenir les capacités du générateur",
    description="""
Retourne les informations sur les capacités du générateur de workflows IA :
- Types de nœuds supportés
- Modèles IA disponibles
- Limites et contraintes
""",
)
async def get_capabilities() -> dict[str, Any]:
    """Retourne les capacités du générateur."""
    return {
        "node_types": [
            {
                "kind": "start",
                "display_name": "Démarrage",
                "description": "Point d'entrée du workflow",
                "required": True,
            },
            {
                "kind": "agent",
                "display_name": "Agent IA",
                "description": "Agent conversationnel avec instructions et outils",
                "required": False,
            },
            {
                "kind": "voice_agent",
                "display_name": "Agent vocal",
                "description": "Agent pour interactions vocales",
                "required": False,
            },
            {
                "kind": "condition",
                "display_name": "Condition",
                "description": "Branchement conditionnel",
                "required": False,
            },
            {
                "kind": "while",
                "display_name": "Boucle",
                "description": "Boucle conditionnelle",
                "required": False,
            },
            {
                "kind": "state",
                "display_name": "Variable",
                "description": "Assignation de variable",
                "required": False,
            },
            {
                "kind": "assistant_message",
                "display_name": "Message assistant",
                "description": "Message prédéfini de l'assistant",
                "required": False,
            },
            {
                "kind": "user_message",
                "display_name": "Message utilisateur",
                "description": "Message simulé de l'utilisateur",
                "required": False,
            },
            {
                "kind": "widget",
                "display_name": "Widget",
                "description": "Affichage d'un widget UI",
                "required": False,
            },
            {
                "kind": "end",
                "display_name": "Fin",
                "description": "Point de sortie du workflow",
                "required": False,
            },
        ],
        "supported_models": [
            {
                "id": "gpt-4o-2024-08-06",
                "name": "GPT-4o (Structured Output)",
                "provider": "OpenAI",
                "supports_structured_output": True,
                "recommended": True,
            },
            {
                "id": "gpt-4o-mini",
                "name": "GPT-4o Mini",
                "provider": "OpenAI",
                "supports_structured_output": True,
                "recommended": False,
            },
        ],
        "limits": {
            "max_description_length": 5000,
            "max_nodes": 50,
            "max_edges": 100,
            "max_workflow_name_length": 128,
            "max_slug_length": 128,
        },
        "validation_features": [
            "Schéma Pydantic strict",
            "Vérification de la connectivité",
            "Détection de cycles",
            "Validation des paramètres par type de nœud",
            "Suggestions d'amélioration",
        ],
    }


# ============================================================================
# ENDPOINTS ASYNCHRONES AVEC STREAMING
# ============================================================================


@router.post(
    "/generate-async",
    response_model=AsyncWorkflowGenerationResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Générer un workflow par IA (mode asynchrone)",
    description="""
Démarre la génération d'un workflow en tâche background avec Celery.

Retourne immédiatement un task_id pour suivre la progression via:
- GET /ai-workflows/status/{task_id} pour le statut
- GET /ai-workflows/stream/{task_id} pour le streaming SSE en temps réel

**Avantages du mode asynchrone** :
- Pas de timeout HTTP
- Progression en temps réel
- Peut générer des workflows complexes
- Annulation possible
""",
)
async def generate_workflow_async(
    request: AsyncWorkflowGenerationRequest,
) -> AsyncWorkflowGenerationResponse:
    """Démarre la génération asynchrone d'un workflow."""
    try:
        # Générer un ID unique pour la tâche
        task_id = str(uuid.uuid4())

        # Lancer la tâche Celery
        from ..tasks.workflow_generation import generate_workflow_task

        celery_task = generate_workflow_task.apply_async(
            args=[
                task_id,
                request.description,
                request.workflow_name,
                request.workflow_slug,
                request.model,
                request.temperature,
                request.save_to_database,
            ],
            task_id=task_id,
        )

        logger.info(
            "Tâche de génération lancée",
            task_id=task_id,
            description=request.description[:100],
        )

        return AsyncWorkflowGenerationResponse(
            task_id=task_id,
            status="pending",
            message="Génération du workflow lancée. Utilisez /ai-workflows/stream/{task_id} pour suivre la progression.",
        )

    except Exception as e:
        logger.error("Erreur lors du lancement de la tâche", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors du lancement de la génération : {str(e)}",
        )


@router.get(
    "/stream/{task_id}",
    summary="Streamer la progression (SSE)",
    description="""
Endpoint Server-Sent Events (SSE) pour streamer la progression en temps réel.

Envoie des événements JSON contenant :
- `status`: État actuel (init, prepare, generating, validating, saving, completed, failed)
- `current`: Progression actuelle (0-100)
- `total`: Total (toujours 100)
- `message`: Message descriptif
- Plus d'infos selon l'étape (nodes_count, edges_count, etc.)

**Utilisation depuis le frontend** :
```javascript
const eventSource = new EventSource('/ai-workflows/stream/{task_id}');
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.status, data.current);
};
```
""",
)
async def stream_workflow_generation(task_id: str, request: Request) -> StreamingResponse:
    """Streame la progression de la génération via Server-Sent Events."""

    async def event_generator() -> AsyncGenerator[str, None]:
        """Générateur d'événements SSE."""
        try:
            result = AsyncResult(task_id, app=celery_app)

            while True:
                # Vérifier si le client s'est déconnecté
                if await request.is_disconnected():
                    logger.info(f"Client déconnecté pour task_id={task_id}")
                    break

                # Obtenir l'état de la tâche
                state = result.state
                info = result.info or {}

                # Préparer les données à envoyer
                event_data = {
                    "task_id": task_id,
                    "state": state,
                    "status": info.get("status", "En attente..."),
                    "step": info.get("step", "pending"),
                    "current": info.get("current", 0),
                    "total": info.get("total", 100),
                }

                # Ajouter des infos supplémentaires selon l'état
                if state == "PROGRESS":
                    event_data.update({
                        "nodes_count": info.get("nodes_count"),
                        "edges_count": info.get("edges_count"),
                        "description": info.get("description"),
                    })
                elif state == "FAILURE":
                    event_data.update({
                        "error": info.get("error", str(info)),
                        "errors": info.get("errors", []),
                    })
                elif state == "SUCCESS":
                    # Tâche terminée avec succès
                    event_data.update({
                        "status": "Workflow généré avec succès !",
                        "current": 100,
                        "result": result.result,
                    })

                # Envoyer l'événement SSE
                yield f"data: {json.dumps(event_data)}\n\n"

                # Si la tâche est terminée (succès ou échec), arrêter le streaming
                if state in ["SUCCESS", "FAILURE"]:
                    logger.info(f"Tâche terminée: {task_id} avec état {state}")
                    break

                # Attendre avant la prochaine vérification
                await asyncio.sleep(0.5)

        except Exception as e:
            logger.error(f"Erreur dans le streaming: {e}")
            error_data = {
                "task_id": task_id,
                "state": "ERROR",
                "status": "Erreur de streaming",
                "error": str(e),
            }
            yield f"data: {json.dumps(error_data)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Désactiver le buffering nginx
        },
    )


@router.get(
    "/status/{task_id}",
    summary="Obtenir le statut d'une tâche",
    description="""
Obtient le statut actuel d'une tâche de génération.

Retourne :
- `state`: PENDING, PROGRESS, SUCCESS, ou FAILURE
- `info`: Informations sur la progression
- `result`: Résultat final si SUCCESS
""",
)
async def get_task_status(task_id: str) -> dict[str, Any]:
    """Obtient le statut d'une tâche de génération."""
    try:
        result = AsyncResult(task_id, app=celery_app)

        response = {
            "task_id": task_id,
            "state": result.state,
            "info": result.info or {},
        }

        if result.state == "SUCCESS":
            response["result"] = result.result

        return response

    except Exception as e:
        logger.error(f"Erreur lors de la récupération du statut: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors de la récupération du statut : {str(e)}",
        )
