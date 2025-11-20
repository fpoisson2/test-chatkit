"""Schémas Pydantic pour la génération de workflows par IA avec structured output.

Ces schémas garantissent que l'IA génère du JSON valide conforme au format attendu.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class WorkflowNodeParametersSpec(BaseModel):
    """Paramètres d'un nœud pour structured output."""

    model_config = {"extra": "allow"}

    # Pour les nœuds agent
    model: str | None = Field(
        default=None,
        description="Modèle LLM à utiliser pour un nœud agent (ex: gpt-4o, claude-3-5-sonnet)",
    )
    instructions: str | None = Field(
        default=None,
        description="Instructions système pour un agent",
    )
    temperature: float | None = Field(
        default=None,
        ge=0.0,
        le=2.0,
        description="Température du modèle (0.0 à 2.0)",
    )

    # Pour les nœuds message
    content: str | None = Field(
        default=None,
        description="Contenu du message pour les nœuds message",
    )

    # Pour les nœuds condition
    expression: str | None = Field(
        default=None,
        description="Expression conditionnelle à évaluer",
    )

    # Pour les nœuds assign (state)
    variable: str | None = Field(
        default=None,
        description="Nom de la variable à assigner",
    )
    value: str | None = Field(
        default=None,
        description="Valeur ou expression à assigner",
    )

    # Pour les nœuds while
    max_iterations: int | None = Field(
        default=None,
        ge=1,
        le=100,
        description="Nombre maximum d'itérations pour une boucle",
    )

    # Champ générique pour autres paramètres
    tools: list[dict[str, Any]] | None = Field(
        default=None,
        description="Liste des outils disponibles pour l'agent",
    )


class WorkflowNodeSpec(BaseModel):
    """Spécification d'un nœud de workflow pour structured output.

    Compatible avec le format attendu par l'API existante.
    """

    slug: str = Field(
        ...,
        min_length=1,
        max_length=128,
        description="Identifiant unique du nœud (ex: 'start', 'agent_1', 'condition_check')",
    )
    kind: Literal[
        "start",
        "agent",
        "voice_agent",
        "condition",
        "while",
        "state",
        "watch",
        "assistant_message",
        "user_message",
        "json_vector_store",
        "widget",
        "end",
    ] = Field(
        ...,
        description="Type du nœud dans le workflow",
    )
    display_name: str = Field(
        ...,
        min_length=1,
        max_length=128,
        description="Nom d'affichage du nœud (ex: 'Démarrage', 'Agent principal')",
    )
    agent_key: str | None = Field(
        default=None,
        description="Clé d'agent unique si le nœud est un agent",
    )
    parent_slug: str | None = Field(
        default=None,
        description="Slug du nœud parent pour les nœuds imbriqués",
    )
    is_enabled: bool = Field(
        default=True,
        description="Indique si le nœud est activé",
    )
    parameters: WorkflowNodeParametersSpec = Field(
        default_factory=WorkflowNodeParametersSpec,
        description="Paramètres spécifiques au type de nœud",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Métadonnées pour l'interface utilisateur (position, etc.)",
    )

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str) -> str:
        """Valide que le slug ne contient que des caractères alphanumériques, tirets et underscores."""
        if not v.replace("_", "").replace("-", "").isalnum():
            raise ValueError(
                "Le slug doit contenir uniquement des caractères alphanumériques, tirets et underscores"
            )
        return v


class WorkflowEdgeSpec(BaseModel):
    """Spécification d'une connexion (edge) entre nœuds pour structured output."""

    source: str = Field(
        ...,
        min_length=1,
        description="Slug du nœud source",
    )
    target: str = Field(
        ...,
        min_length=1,
        description="Slug du nœud cible",
    )
    condition: str | None = Field(
        default=None,
        description="Condition pour suivre cette connexion (ex: 'true', 'false', 'continue')",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Métadonnées pour l'interface utilisateur",
    )


class WorkflowGraphSpec(BaseModel):
    """Spécification complète d'un graphe de workflow pour structured output.

    Ce schéma est utilisé par l'IA pour générer des workflows valides.
    """

    nodes: list[WorkflowNodeSpec] = Field(
        ...,
        min_length=1,
        description="Liste des nœuds du workflow (doit contenir au moins un nœud 'start')",
    )
    edges: list[WorkflowEdgeSpec] = Field(
        default_factory=list,
        description="Liste des connexions entre nœuds",
    )

    @field_validator("nodes")
    @classmethod
    def validate_has_start_node(cls, v: list[WorkflowNodeSpec]) -> list[WorkflowNodeSpec]:
        """Valide qu'il y a au moins un nœud 'start'."""
        if not any(node.kind == "start" for node in v):
            raise ValueError("Le workflow doit contenir au moins un nœud de type 'start'")
        return v

    @field_validator("nodes")
    @classmethod
    def validate_unique_slugs(cls, v: list[WorkflowNodeSpec]) -> list[WorkflowNodeSpec]:
        """Valide que tous les slugs sont uniques."""
        slugs = [node.slug for node in v]
        if len(slugs) != len(set(slugs)):
            duplicates = [slug for slug in slugs if slugs.count(slug) > 1]
            raise ValueError(f"Slugs dupliqués trouvés : {', '.join(set(duplicates))}")
        return v


class WorkflowGenerationRequest(BaseModel):
    """Requête pour générer un workflow par IA."""

    description: str = Field(
        ...,
        min_length=10,
        max_length=5000,
        description="Description du workflow à générer en langage naturel",
    )
    workflow_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
        description="Nom du workflow (sera généré automatiquement si non fourni)",
    )
    workflow_slug: str | None = Field(
        default=None,
        pattern=r"^[a-z0-9_-]+$",
        min_length=1,
        max_length=128,
        description="Slug du workflow (sera généré automatiquement si non fourni)",
    )
    model: str = Field(
        default="gpt-4o-2024-08-06",
        description="Modèle OpenAI à utiliser pour la génération (doit supporter structured output)",
    )
    temperature: float = Field(
        default=0.3,
        ge=0.0,
        le=2.0,
        description="Température pour la génération (0.0 = déterministe, 2.0 = créatif)",
    )
    save_to_database: bool = Field(
        default=False,
        description="Si True, sauvegarde automatiquement le workflow généré dans la base de données",
    )


class WorkflowGenerationResponse(BaseModel):
    """Réponse contenant le workflow généré."""

    graph: WorkflowGraphSpec = Field(
        ...,
        description="Graphe du workflow généré",
    )
    workflow_name: str = Field(
        ...,
        description="Nom du workflow généré",
    )
    workflow_slug: str = Field(
        ...,
        description="Slug du workflow généré",
    )
    description: str | None = Field(
        default=None,
        description="Description du workflow",
    )
    validation_passed: bool = Field(
        ...,
        description="Indique si la validation a réussi",
    )
    validation_errors: list[str] = Field(
        default_factory=list,
        description="Liste des erreurs de validation (vide si validation_passed=True)",
    )
    workflow_id: int | None = Field(
        default=None,
        description="ID du workflow si save_to_database=True",
    )
    tokens_used: int | None = Field(
        default=None,
        description="Nombre de tokens utilisés pour la génération",
    )


class WorkflowValidationRequest(BaseModel):
    """Requête pour valider un workflow généré."""

    graph: WorkflowGraphSpec = Field(
        ...,
        description="Graphe du workflow à valider",
    )


class WorkflowValidationResponse(BaseModel):
    """Réponse de validation d'un workflow."""

    valid: bool = Field(
        ...,
        description="Indique si le workflow est valide",
    )
    errors: list[str] = Field(
        default_factory=list,
        description="Liste des erreurs de validation",
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Liste des avertissements",
    )
    suggestions: list[str] = Field(
        default_factory=list,
        description="Suggestions d'amélioration",
    )
