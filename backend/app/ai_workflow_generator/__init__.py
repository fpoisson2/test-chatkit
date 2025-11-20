"""Infrastructure pour la génération de workflows par IA.

Ce module fournit les outils nécessaires pour :
- Générer des workflows par IA avec structured output
- Valider les workflows générés
- S'assurer que le format JSON est conforme au schéma attendu
"""

from .generator import WorkflowAIGenerator
from .schemas import (
    WorkflowGenerationRequest,
    WorkflowGenerationResponse,
    WorkflowNodeSpec,
    WorkflowEdgeSpec,
    WorkflowGraphSpec,
)
from .validator import WorkflowAIValidator

__all__ = [
    "WorkflowAIGenerator",
    "WorkflowAIValidator",
    "WorkflowGenerationRequest",
    "WorkflowGenerationResponse",
    "WorkflowNodeSpec",
    "WorkflowEdgeSpec",
    "WorkflowGraphSpec",
]
