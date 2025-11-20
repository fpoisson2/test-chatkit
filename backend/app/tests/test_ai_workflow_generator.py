"""Tests pour l'infrastructure de génération de workflows par IA."""

from __future__ import annotations

import pytest

from ..ai_workflow_generator.schemas import (
    WorkflowEdgeSpec,
    WorkflowGraphSpec,
    WorkflowNodeParametersSpec,
    WorkflowNodeSpec,
)
from ..ai_workflow_generator.validator import WorkflowAIValidator


class TestWorkflowSchemas:
    """Tests pour les schémas Pydantic."""

    def test_node_spec_creation(self):
        """Test de création d'un nœud valide."""
        node = WorkflowNodeSpec(
            slug="start",
            kind="start",
            display_name="Démarrage",
        )
        assert node.slug == "start"
        assert node.kind == "start"
        assert node.is_enabled is True

    def test_node_spec_invalid_slug(self):
        """Test qu'un slug invalide est rejeté."""
        with pytest.raises(ValueError, match="slug doit contenir uniquement"):
            WorkflowNodeSpec(
                slug="invalid slug with spaces!",
                kind="start",
                display_name="Test",
            )

    def test_edge_spec_creation(self):
        """Test de création d'une connexion valide."""
        edge = WorkflowEdgeSpec(
            source="start",
            target="agent_1",
            condition="true",
        )
        assert edge.source == "start"
        assert edge.target == "agent_1"
        assert edge.condition == "true"

    def test_graph_spec_requires_start_node(self):
        """Test qu'un graphe sans nœud start est rejeté."""
        with pytest.raises(ValueError, match="au moins un nœud de type 'start'"):
            WorkflowGraphSpec(
                nodes=[
                    WorkflowNodeSpec(
                        slug="agent_1",
                        kind="agent",
                        display_name="Agent",
                        agent_key="agent_1",
                    ),
                ],
                edges=[],
            )

    def test_graph_spec_unique_slugs(self):
        """Test que les slugs dupliqués sont rejetés."""
        with pytest.raises(ValueError, match="Slugs dupliqués"):
            WorkflowGraphSpec(
                nodes=[
                    WorkflowNodeSpec(
                        slug="start",
                        kind="start",
                        display_name="Démarrage",
                    ),
                    WorkflowNodeSpec(
                        slug="start",  # Duplicate
                        kind="agent",
                        display_name="Agent",
                        agent_key="agent_1",
                    ),
                ],
                edges=[],
            )

    def test_graph_spec_valid(self):
        """Test de création d'un graphe valide."""
        graph = WorkflowGraphSpec(
            nodes=[
                WorkflowNodeSpec(
                    slug="start",
                    kind="start",
                    display_name="Démarrage",
                ),
                WorkflowNodeSpec(
                    slug="agent_1",
                    kind="agent",
                    display_name="Agent principal",
                    agent_key="agent_1",
                ),
                WorkflowNodeSpec(
                    slug="end",
                    kind="end",
                    display_name="Fin",
                ),
            ],
            edges=[
                WorkflowEdgeSpec(source="start", target="agent_1"),
                WorkflowEdgeSpec(source="agent_1", target="end"),
            ],
        )
        assert len(graph.nodes) == 3
        assert len(graph.edges) == 2


class TestWorkflowValidator:
    """Tests pour le validateur de workflows."""

    def test_validator_valid_workflow(self):
        """Test de validation d'un workflow valide."""
        graph = WorkflowGraphSpec(
            nodes=[
                WorkflowNodeSpec(
                    slug="start",
                    kind="start",
                    display_name="Démarrage",
                ),
                WorkflowNodeSpec(
                    slug="agent_1",
                    kind="agent",
                    display_name="Agent principal",
                    agent_key="agent_1",
                    parameters=WorkflowNodeParametersSpec(
                        instructions="Tu es un assistant utile",
                        model="gpt-4o",
                    ),
                ),
                WorkflowNodeSpec(
                    slug="end",
                    kind="end",
                    display_name="Fin",
                ),
            ],
            edges=[
                WorkflowEdgeSpec(source="start", target="agent_1"),
                WorkflowEdgeSpec(source="agent_1", target="end"),
            ],
        )

        validator = WorkflowAIValidator()
        result = validator.validate(graph)

        assert result.valid is True
        assert len(result.errors) == 0

    def test_validator_missing_edge_target(self):
        """Test que les edges vers des nœuds inexistants sont détectés."""
        graph = WorkflowGraphSpec(
            nodes=[
                WorkflowNodeSpec(
                    slug="start",
                    kind="start",
                    display_name="Démarrage",
                ),
            ],
            edges=[
                WorkflowEdgeSpec(
                    source="start",
                    target="nonexistent",  # N'existe pas
                ),
            ],
        )

        validator = WorkflowAIValidator()
        result = validator.validate(graph)

        assert result.valid is False
        assert any("nonexistent" in error for error in result.errors)

    def test_validator_agent_without_agent_key(self):
        """Test qu'un agent sans agent_key génère une erreur."""
        graph = WorkflowGraphSpec(
            nodes=[
                WorkflowNodeSpec(
                    slug="start",
                    kind="start",
                    display_name="Démarrage",
                ),
                WorkflowNodeSpec(
                    slug="agent_1",
                    kind="agent",
                    display_name="Agent sans clé",
                    # Pas de agent_key
                ),
            ],
            edges=[
                WorkflowEdgeSpec(source="start", target="agent_1"),
            ],
        )

        validator = WorkflowAIValidator()
        result = validator.validate(graph)

        assert result.valid is False
        assert any("agent_key" in error for error in result.errors)

    def test_validator_unreachable_nodes(self):
        """Test que les nœuds non accessibles génèrent un warning."""
        graph = WorkflowGraphSpec(
            nodes=[
                WorkflowNodeSpec(
                    slug="start",
                    kind="start",
                    display_name="Démarrage",
                ),
                WorkflowNodeSpec(
                    slug="agent_1",
                    kind="agent",
                    display_name="Agent accessible",
                    agent_key="agent_1",
                ),
                WorkflowNodeSpec(
                    slug="orphan",
                    kind="agent",
                    display_name="Nœud orphelin",
                    agent_key="orphan",
                ),
            ],
            edges=[
                WorkflowEdgeSpec(source="start", target="agent_1"),
                # orphan n'est pas connecté
            ],
        )

        validator = WorkflowAIValidator()
        result = validator.validate(graph)

        assert any("orphan" in warning for warning in result.warnings)

    def test_validator_condition_without_expression(self):
        """Test qu'une condition sans expression génère une erreur."""
        graph = WorkflowGraphSpec(
            nodes=[
                WorkflowNodeSpec(
                    slug="start",
                    kind="start",
                    display_name="Démarrage",
                ),
                WorkflowNodeSpec(
                    slug="condition_1",
                    kind="condition",
                    display_name="Condition",
                    # Pas d'expression
                ),
            ],
            edges=[
                WorkflowEdgeSpec(source="start", target="condition_1"),
            ],
        )

        validator = WorkflowAIValidator()
        result = validator.validate(graph)

        assert result.valid is False
        assert any("expression" in error for error in result.errors)

    def test_validator_dict_input(self):
        """Test que le validateur accepte aussi les dictionnaires."""
        graph_dict = {
            "nodes": [
                {
                    "slug": "start",
                    "kind": "start",
                    "display_name": "Démarrage",
                    "is_enabled": True,
                    "parameters": {},
                    "metadata": {},
                }
            ],
            "edges": [],
        }

        validator = WorkflowAIValidator()
        result = validator.validate(graph_dict)

        assert result.valid is True
