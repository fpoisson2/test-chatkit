"""Générateur de workflows par IA utilisant OpenAI structured output.

Ce module utilise les structured outputs d'OpenAI pour garantir que
l'IA génère du JSON conforme au schéma Pydantic défini.
"""

from __future__ import annotations

import re
from typing import Any

import structlog
from openai import AsyncOpenAI

from ..config import settings
from .schemas import (
    WorkflowEdgeSpec,
    WorkflowGenerationRequest,
    WorkflowGenerationResponse,
    WorkflowGraphSpec,
    WorkflowNodeParametersSpec,
    WorkflowNodeSpec,
)
from .validator import WorkflowAIValidator

logger = structlog.get_logger(__name__)

# Prompt système pour la génération de workflows
SYSTEM_PROMPT = """Tu es un expert en conception de workflows conversationnels pour des chatbots IA.

Ton rôle est de concevoir des workflows structurés basés sur les descriptions en langage naturel fournies par l'utilisateur.

Principes de conception :
1. **Simplicité** : Commence toujours par un nœud 'start' et termine par un nœud 'end'
2. **Clarté** : Utilise des noms de nœuds descriptifs et clairs
3. **Modularité** : Divise les tâches complexes en étapes simples
4. **Robustesse** : Gère les cas d'erreur et les branches conditionnelles
5. **Efficacité** : Évite les nœuds redondants

Types de nœuds disponibles :
- **start** : Point d'entrée du workflow (requis)
- **agent** : Agent IA conversationnel avec instructions et outils
- **voice_agent** : Agent vocal pour les interactions audio
- **condition** : Branchement conditionnel basé sur une expression
- **while** : Boucle conditionnelle
- **state** : Assignation de variable
- **assistant_message** : Message prédéfini de l'assistant
- **user_message** : Message simulé de l'utilisateur
- **widget** : Affichage d'un widget UI
- **end** : Point de sortie du workflow

Bonnes pratiques :
- Utilise des slugs en snake_case (ex: 'agent_principal', 'condition_check')
- Définis des instructions claires pour les agents
- Spécifie les modèles LLM appropriés (gpt-4o, gpt-4o-mini, claude-3-5-sonnet, etc.)
- Ajoute des métadonnées de position pour une visualisation optimale
- Connecte tous les nœuds de manière logique

Exemple de positions (metadata) :
- Nœud start : {"position": {"x": 100, "y": 100}}
- Nœuds suivants : espacement de 200-300 pixels horizontalement ou verticalement
"""


class WorkflowAIGenerator:
    """Générateur de workflows utilisant OpenAI structured output."""

    def __init__(self, api_key: str | None = None) -> None:
        """Initialise le générateur.

        Args:
            api_key: Clé API OpenAI (utilise settings si non fournie)
        """
        self.api_key = api_key or settings.OPENAI_API_KEY
        if not self.api_key:
            raise ValueError(
                "Une clé API OpenAI est requise. "
                "Définissez OPENAI_API_KEY dans les variables d'environnement."
            )

        self.client = AsyncOpenAI(api_key=self.api_key)
        self.validator = WorkflowAIValidator()

    async def generate(
        self, request: WorkflowGenerationRequest
    ) -> WorkflowGenerationResponse:
        """Génère un workflow basé sur la description fournie.

        Args:
            request: Requête de génération contenant la description et les paramètres

        Returns:
            WorkflowGenerationResponse avec le workflow généré

        Raises:
            Exception: Si la génération échoue
        """
        logger.info(
            "Génération de workflow par IA",
            description=request.description[:100],
            model=request.model,
        )

        try:
            # Générer le workflow avec structured output
            completion = await self.client.beta.chat.completions.parse(
                model=request.model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": f"Génère un workflow pour : {request.description}",
                    },
                ],
                response_format=WorkflowGraphSpec,
                temperature=request.temperature,
            )

            # Extraire le graphe généré
            if not completion.choices[0].message.parsed:
                raise ValueError("Aucun graphe n'a été généré par le modèle")

            graph: WorkflowGraphSpec = completion.choices[0].message.parsed

            # Générer le nom et le slug si non fournis
            workflow_name = request.workflow_name
            workflow_slug = request.workflow_slug

            if not workflow_name:
                workflow_name = await self._generate_workflow_name(request.description)

            if not workflow_slug:
                workflow_slug = self._slugify(workflow_name)

            # Valider le workflow généré
            validation_result = self.validator.validate(graph)

            # Calculer les tokens utilisés
            tokens_used = completion.usage.total_tokens if completion.usage else None

            logger.info(
                "Workflow généré avec succès",
                workflow_name=workflow_name,
                nodes_count=len(graph.nodes),
                edges_count=len(graph.edges),
                validation_passed=validation_result.valid,
                tokens_used=tokens_used,
            )

            return WorkflowGenerationResponse(
                graph=graph,
                workflow_name=workflow_name,
                workflow_slug=workflow_slug,
                description=request.description,
                validation_passed=validation_result.valid,
                validation_errors=validation_result.errors,
                workflow_id=None,  # Sera défini si save_to_database=True
                tokens_used=tokens_used,
            )

        except Exception as e:
            logger.error(
                "Erreur lors de la génération du workflow",
                error=str(e),
                description=request.description[:100],
            )
            raise

    async def _generate_workflow_name(self, description: str) -> str:
        """Génère un nom de workflow basé sur la description.

        Args:
            description: Description du workflow

        Returns:
            Nom de workflow généré
        """
        try:
            completion = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "Génère un nom court et descriptif (max 50 caractères) pour un workflow basé sur la description fournie. Réponds uniquement avec le nom, sans guillemets ni ponctuation supplémentaire.",
                    },
                    {"role": "user", "content": description},
                ],
                max_tokens=50,
                temperature=0.3,
            )

            name = completion.choices[0].message.content
            if name:
                # Nettoyer le nom
                name = name.strip().strip('"').strip("'")
                return name[:128]  # Limiter à 128 caractères

            return "Workflow généré par IA"

        except Exception as e:
            logger.warning(
                "Impossible de générer un nom de workflow",
                error=str(e),
            )
            return "Workflow généré par IA"

    def _slugify(self, text: str) -> str:
        """Convertit un texte en slug valide.

        Args:
            text: Texte à convertir

        Returns:
            Slug valide (lowercase, underscores, alphanumeric)
        """
        # Convertir en minuscules
        text = text.lower()

        # Remplacer les espaces et caractères spéciaux par des underscores
        text = re.sub(r"[^\w\s-]", "", text)
        text = re.sub(r"[-\s]+", "_", text)

        # Nettoyer les underscores multiples
        text = re.sub(r"_+", "_", text)

        # Retirer les underscores au début et à la fin
        text = text.strip("_")

        # Limiter à 128 caractères
        return text[:128] or "generated_workflow"

    async def validate_workflow(
        self, graph: WorkflowGraphSpec | dict[str, Any]
    ) -> tuple[bool, list[str], list[str]]:
        """Valide un workflow.

        Args:
            graph: Graphe de workflow à valider

        Returns:
            Tuple (is_valid, errors, warnings)
        """
        validation_result = self.validator.validate(graph)
        return (
            validation_result.valid,
            validation_result.errors,
            validation_result.warnings,
        )

    def convert_to_api_format(self, graph: WorkflowGraphSpec) -> dict[str, Any]:
        """Convertit un WorkflowGraphSpec en format API attendu.

        Args:
            graph: Graphe à convertir

        Returns:
            Dictionnaire au format API
        """
        return {
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
                for node in graph.nodes
            ],
            "edges": [
                {
                    "source": edge.source,
                    "target": edge.target,
                    "condition": edge.condition,
                    "metadata": edge.metadata,
                }
                for edge in graph.edges
            ],
        }
