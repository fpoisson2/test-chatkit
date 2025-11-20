"""Endpoints API pour la génération de workflows par IA.

Ces endpoints permettent au frontend de :
- Générer des workflows par IA à partir de descriptions
- Valider des workflows générés
- Sauvegarder des workflows générés dans la base de données
"""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
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
from ..database import get_session
from ..dependencies import get_current_user, get_workflow_persistence_service
from ..models import User
from ..workflows import WorkflowPersistenceService

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/ai-workflows", tags=["AI Workflows"])


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
