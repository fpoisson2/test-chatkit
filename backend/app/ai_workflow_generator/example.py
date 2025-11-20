"""Exemples d'utilisation de l'infrastructure de génération de workflows par IA.

Ce fichier contient des exemples pour démontrer comment utiliser le générateur.
"""

import asyncio

from .generator import WorkflowAIGenerator
from .schemas import WorkflowGenerationRequest, WorkflowValidationRequest
from .validator import WorkflowAIValidator


async def exemple_generation_simple():
    """Exemple de génération simple d'un workflow."""
    print("=== Exemple 1: Génération Simple ===\n")

    # Créer une requête
    request = WorkflowGenerationRequest(
        description="""
        Crée un agent de support client qui :
        1. Accueille l'utilisateur
        2. Demande quel est son problème
        3. Propose des solutions
        4. Si le problème persiste, transfère vers un humain
        """,
        workflow_name="Support Client IA",
        temperature=0.3,
        save_to_database=False,  # Ne pas sauvegarder pour l'exemple
    )

    # Générer le workflow
    generator = WorkflowAIGenerator()
    response = await generator.generate(request)

    # Afficher les résultats
    print(f"Workflow: {response.workflow_name}")
    print(f"Slug: {response.workflow_slug}")
    print(f"Nombre de nœuds: {len(response.graph.nodes)}")
    print(f"Nombre de connexions: {len(response.graph.edges)}")
    print(f"Validation: {'✅ Passée' if response.validation_passed else '❌ Échouée'}")

    if response.validation_errors:
        print(f"\nErreurs: {response.validation_errors}")

    print(f"\nTokens utilisés: {response.tokens_used}")

    # Afficher la structure du workflow
    print("\n--- Nœuds du workflow ---")
    for node in response.graph.nodes:
        print(f"  - {node.slug} ({node.kind}): {node.display_name}")

    print("\n--- Connexions ---")
    for edge in response.graph.edges:
        condition = f" [condition: {edge.condition}]" if edge.condition else ""
        print(f"  {edge.source} → {edge.target}{condition}")

    return response


async def exemple_validation():
    """Exemple de validation d'un workflow."""
    print("\n=== Exemple 2: Validation ===\n")

    # Créer un workflow invalide pour tester la validation
    from .schemas import WorkflowEdgeSpec, WorkflowGraphSpec, WorkflowNodeSpec

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
            # Nœud orphelin (pas connecté)
            WorkflowNodeSpec(
                slug="orphan_node",
                kind="end",
                display_name="Nœud orphelin",
            ),
        ],
        edges=[
            WorkflowEdgeSpec(
                source="start",
                target="agent_1",
            ),
            # Connexion vers un nœud qui n'existe pas
            WorkflowEdgeSpec(
                source="agent_1",
                target="nonexistent_node",
            ),
        ],
    )

    # Valider
    validator = WorkflowAIValidator()
    result = validator.validate(graph)

    print(f"Validation: {'✅ Passée' if result.valid else '❌ Échouée'}")

    if result.errors:
        print("\nErreurs:")
        for error in result.errors:
            print(f"  ❌ {error}")

    if result.warnings:
        print("\nAvertissements:")
        for warning in result.warnings:
            print(f"  ⚠️  {warning}")

    if result.suggestions:
        print("\nSuggestions:")
        for suggestion in result.suggestions:
            print(f"  💡 {suggestion}")


async def exemple_workflow_complexe():
    """Exemple de génération d'un workflow complexe."""
    print("\n=== Exemple 3: Workflow Complexe ===\n")

    request = WorkflowGenerationRequest(
        description="""
        Crée un système de réservation de restaurant intelligent qui :

        1. Accueille le client et demande ses préférences
        2. Vérifie si c'est un client régulier (condition)
        3. Si client régulier : propose ses tables préférées
        4. Si nouveau client : pose des questions sur ses préférences
        5. Recherche les disponibilités dans la base de données
        6. Affiche un widget avec les options de tables disponibles
        7. Demande confirmation de la réservation
        8. Enregistre la réservation en base de données
        9. Envoie un email de confirmation
        10. Propose d'ajouter un événement au calendrier
        11. Remercie et termine

        Le workflow doit gérer les cas où :
        - Aucune table n'est disponible (proposer d'autres créneaux)
        - Le client annule (retour au début)
        - Une erreur survient (message d'excuse et transfert vers un humain)
        """,
        workflow_name="Réservation Restaurant IA",
        temperature=0.5,  # Un peu plus créatif pour ce workflow complexe
        save_to_database=False,
    )

    generator = WorkflowAIGenerator()
    response = await generator.generate(request)

    print(f"Workflow: {response.workflow_name}")
    print(f"Nombre de nœuds: {len(response.graph.nodes)}")
    print(f"Nombre de connexions: {len(response.graph.edges)}")

    # Compter les types de nœuds
    node_types = {}
    for node in response.graph.nodes:
        node_types[node.kind] = node_types.get(node.kind, 0) + 1

    print("\n--- Types de nœuds ---")
    for kind, count in sorted(node_types.items()):
        print(f"  {kind}: {count}")

    print(f"\nTokens utilisés: {response.tokens_used}")


async def main():
    """Fonction principale pour exécuter tous les exemples."""
    try:
        # Exemple 1: Génération simple
        await exemple_generation_simple()

        # Exemple 2: Validation
        await exemple_validation()

        # Exemple 3: Workflow complexe
        await exemple_workflow_complexe()

        print("\n✅ Tous les exemples ont été exécutés avec succès !")

    except Exception as e:
        print(f"\n❌ Erreur: {e}")
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    # Pour exécuter cet exemple:
    # cd backend
    # python -m app.ai_workflow_generator.example

    print("🤖 Exemples de Génération de Workflows par IA\n")
    print("Note: Ces exemples nécessitent une clé API OpenAI valide.\n")

    asyncio.run(main())
