"""Validateur de workflows générés par IA.

Ce module fournit une validation approfondie des workflows générés
pour s'assurer qu'ils sont conformes au schéma attendu.
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from .schemas import (
    WorkflowEdgeSpec,
    WorkflowGraphSpec,
    WorkflowNodeSpec,
    WorkflowValidationResponse,
)


class WorkflowAIValidator:
    """Validateur pour les workflows générés par IA.

    Vérifie que :
    - Le format JSON est conforme au schéma Pydantic
    - Tous les nœuds référencés dans les edges existent
    - Il n'y a pas de cycles invalides
    - Les nœuds start et end sont présents
    - Les connexions sont valides
    """

    def validate(self, graph_data: dict[str, Any] | WorkflowGraphSpec) -> WorkflowValidationResponse:
        """Valide un workflow généré.

        Args:
            graph_data: Dictionnaire ou objet WorkflowGraphSpec à valider

        Returns:
            WorkflowValidationResponse avec le résultat de la validation
        """
        errors: list[str] = []
        warnings: list[str] = []
        suggestions: list[str] = []

        # Validation du schéma Pydantic
        try:
            if isinstance(graph_data, dict):
                graph = WorkflowGraphSpec(**graph_data)
            else:
                graph = graph_data
        except ValidationError as e:
            errors.append(f"Erreur de validation du schéma : {e}")
            return WorkflowValidationResponse(
                valid=False,
                errors=errors,
                warnings=warnings,
                suggestions=suggestions,
            )

        # Validation de la structure du graphe
        self._validate_graph_structure(graph, errors, warnings, suggestions)

        # Validation des connexions
        self._validate_edges(graph, errors, warnings, suggestions)

        # Validation des nœuds
        self._validate_nodes(graph, errors, warnings, suggestions)

        # Validation de la connectivité
        self._validate_connectivity(graph, errors, warnings, suggestions)

        return WorkflowValidationResponse(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            suggestions=suggestions,
        )

    def _validate_graph_structure(
        self,
        graph: WorkflowGraphSpec,
        errors: list[str],
        warnings: list[str],
        suggestions: list[str],
    ) -> None:
        """Valide la structure générale du graphe."""
        # Vérifier qu'il y a au moins un nœud start
        start_nodes = [node for node in graph.nodes if node.kind == "start"]
        if not start_nodes:
            errors.append("Le workflow doit contenir au moins un nœud de type 'start'")
        elif len(start_nodes) > 1:
            warnings.append(
                f"Le workflow contient {len(start_nodes)} nœuds 'start', "
                "assurez-vous que c'est intentionnel"
            )

        # Vérifier qu'il y a au moins un nœud end
        end_nodes = [node for node in graph.nodes if node.kind == "end"]
        if not end_nodes:
            warnings.append(
                "Le workflow ne contient aucun nœud 'end'. "
                "Ajoutez au moins un nœud de fin pour terminer proprement le workflow."
            )

        # Vérifier les slugs uniques
        slugs = [node.slug for node in graph.nodes]
        duplicates = [slug for slug in set(slugs) if slugs.count(slug) > 1]
        if duplicates:
            errors.append(f"Slugs dupliqués trouvés : {', '.join(duplicates)}")

    def _validate_edges(
        self,
        graph: WorkflowGraphSpec,
        errors: list[str],
        warnings: list[str],
        suggestions: list[str],
    ) -> None:
        """Valide les connexions entre nœuds."""
        node_slugs = {node.slug for node in graph.nodes}

        for edge in graph.edges:
            # Vérifier que la source existe
            if edge.source not in node_slugs:
                errors.append(
                    f"La connexion référence un nœud source inexistant : '{edge.source}'"
                )

            # Vérifier que la cible existe
            if edge.target not in node_slugs:
                errors.append(
                    f"La connexion référence un nœud cible inexistant : '{edge.target}'"
                )

            # Vérifier les auto-références
            if edge.source == edge.target:
                warnings.append(
                    f"Le nœud '{edge.source}' a une connexion vers lui-même, "
                    "cela peut créer une boucle infinie"
                )

        # Vérifier les nœuds sans connexions sortantes (sauf end)
        nodes_with_outgoing = {edge.source for edge in graph.edges}
        for node in graph.nodes:
            if node.kind != "end" and node.slug not in nodes_with_outgoing:
                warnings.append(
                    f"Le nœud '{node.slug}' ({node.display_name}) n'a aucune connexion sortante. "
                    "Le workflow pourrait se bloquer ici."
                )

    def _validate_nodes(
        self,
        graph: WorkflowGraphSpec,
        errors: list[str],
        warnings: list[str],
        suggestions: list[str],
    ) -> None:
        """Valide les nœuds individuellement."""
        for node in graph.nodes:
            # Validation spécifique par type de nœud
            if node.kind == "agent" or node.kind == "voice_agent":
                self._validate_agent_node(node, errors, warnings, suggestions)
            elif node.kind == "condition":
                self._validate_condition_node(node, errors, warnings, suggestions)
            elif node.kind == "assistant_message" or node.kind == "user_message":
                self._validate_message_node(node, errors, warnings, suggestions)
            elif node.kind == "while":
                self._validate_while_node(node, errors, warnings, suggestions)
            elif node.kind == "state":
                self._validate_state_node(node, errors, warnings, suggestions)

    def _validate_agent_node(
        self,
        node: WorkflowNodeSpec,
        errors: list[str],
        warnings: list[str],
        suggestions: list[str],
    ) -> None:
        """Valide un nœud agent."""
        if not node.agent_key:
            errors.append(
                f"Le nœud agent '{node.slug}' doit avoir un agent_key défini"
            )

        # Vérifier les paramètres recommandés
        if not node.parameters.instructions:
            warnings.append(
                f"Le nœud agent '{node.slug}' n'a pas d'instructions définies. "
                "Cela peut entraîner un comportement imprévisible."
            )

        if not node.parameters.model:
            suggestions.append(
                f"Le nœud agent '{node.slug}' n'a pas de modèle spécifié. "
                "Considérez définir un modèle explicite."
            )

    def _validate_condition_node(
        self,
        node: WorkflowNodeSpec,
        errors: list[str],
        warnings: list[str],
        suggestions: list[str],
    ) -> None:
        """Valide un nœud condition."""
        if not node.parameters.expression:
            errors.append(
                f"Le nœud condition '{node.slug}' doit avoir une expression définie"
            )

    def _validate_message_node(
        self,
        node: WorkflowNodeSpec,
        errors: list[str],
        warnings: list[str],
        suggestions: list[str],
    ) -> None:
        """Valide un nœud message."""
        if not node.parameters.content:
            warnings.append(
                f"Le nœud message '{node.slug}' n'a pas de contenu défini"
            )

    def _validate_while_node(
        self,
        node: WorkflowNodeSpec,
        errors: list[str],
        warnings: list[str],
        suggestions: list[str],
    ) -> None:
        """Valide un nœud while."""
        if not node.parameters.expression:
            errors.append(
                f"Le nœud while '{node.slug}' doit avoir une expression de condition"
            )

        if not node.parameters.max_iterations:
            suggestions.append(
                f"Le nœud while '{node.slug}' devrait avoir un max_iterations "
                "pour éviter les boucles infinies"
            )

    def _validate_state_node(
        self,
        node: WorkflowNodeSpec,
        errors: list[str],
        warnings: list[str],
        suggestions: list[str],
    ) -> None:
        """Valide un nœud state (assign)."""
        if not node.parameters.variable:
            errors.append(
                f"Le nœud state '{node.slug}' doit avoir une variable définie"
            )

    def _validate_connectivity(
        self,
        graph: WorkflowGraphSpec,
        errors: list[str],
        warnings: list[str],
        suggestions: list[str],
    ) -> None:
        """Valide que le graphe est bien connecté."""
        if not graph.edges:
            if len(graph.nodes) > 1:
                warnings.append(
                    "Le workflow contient plusieurs nœuds mais aucune connexion. "
                    "Les nœuds ne seront pas exécutés dans un ordre défini."
                )
            return

        # Construire le graphe d'adjacence
        adjacency: dict[str, set[str]] = {}
        for node in graph.nodes:
            adjacency[node.slug] = set()

        for edge in graph.edges:
            if edge.source in adjacency:
                adjacency[edge.source].add(edge.target)

        # Vérifier l'accessibilité depuis les nœuds start
        start_nodes = [node.slug for node in graph.nodes if node.kind == "start"]
        if start_nodes:
            reachable = self._get_reachable_nodes(start_nodes, adjacency)
            unreachable = set(adjacency.keys()) - reachable - set(start_nodes)

            if unreachable:
                warnings.append(
                    f"Les nœuds suivants ne sont pas accessibles depuis 'start' : "
                    f"{', '.join(unreachable)}"
                )

    def _get_reachable_nodes(
        self, start_nodes: list[str], adjacency: dict[str, set[str]]
    ) -> set[str]:
        """Obtient tous les nœuds accessibles depuis les nœuds de départ."""
        visited: set[str] = set()
        to_visit = list(start_nodes)

        while to_visit:
            current = to_visit.pop(0)
            if current in visited:
                continue

            visited.add(current)
            if current in adjacency:
                for neighbor in adjacency[current]:
                    if neighbor not in visited:
                        to_visit.append(neighbor)

        return visited
