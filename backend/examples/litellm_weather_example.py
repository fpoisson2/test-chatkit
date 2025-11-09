"""
Exemple d'utilisation de LitellmModel avec les modèles configurés en base de données.

Ce script montre comment :
1. Charger un modèle depuis la BD avec build_litellm_model_from_db()
2. Créer un agent avec ce modèle
3. Utiliser l'agent avec un outil (fonction get_weather)
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Ajouter le répertoire parent au path pour l'import
sys.path.insert(0, str(Path(__file__).parent.parent))

from agents import Agent, Runner, function_tool

from app.chatkit.agent_registry import build_litellm_model_from_db


@function_tool
def get_weather(city: str):
    """Récupère la météo pour une ville donnée."""
    print(f"[debug] getting weather for {city}")
    return f"The weather in {city} is sunny."


async def main(model_name: str):
    """
    Fonction principale qui crée et exécute un agent avec LitellmModel.

    Args:
        model_name: Nom du modèle à utiliser (doit exister en BD)
    """
    print(f"Chargement du modèle '{model_name}' depuis la base de données...")

    # Charger le modèle depuis la BD
    model = build_litellm_model_from_db(model_name)

    if model is None:
        print(f"❌ Erreur: Impossible de charger le modèle '{model_name}'")
        print("\nVérifiez que:")
        print("1. Le modèle existe en base de données")
        print("2. Un provider est configuré pour ce modèle")
        print("3. Les credentials du provider sont valides")
        return

    print(f"✅ Modèle chargé avec succès")

    # Créer l'agent avec le modèle
    agent = Agent(
        name="Assistant",
        instructions="You only respond in haikus.",
        model=model,
        tools=[get_weather],
    )

    print("\nExécution de l'agent...")
    print("-" * 50)

    # Exécuter l'agent
    result = await Runner.run(agent, "What's the weather in Tokyo?")

    print("-" * 50)
    print("\nRésultat:")
    print(result.final_output)

    # Afficher les statistiques d'utilisation si disponibles
    if hasattr(result, "context_wrapper") and hasattr(
        result.context_wrapper, "usage"
    ):
        usage = result.context_wrapper.usage
        print("\n📊 Statistiques d'utilisation:")
        print(f"  - Tokens d'entrée: {usage.input_tokens}")
        print(f"  - Tokens de sortie: {usage.output_tokens}")
        print(f"  - Total: {usage.total_tokens}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Exemple d'utilisation de LitellmModel avec les modèles de la BD"
    )
    parser.add_argument(
        "--model",
        type=str,
        required=False,
        help="Nom du modèle à utiliser (ex: 'gpt-4', 'claude-3-5-sonnet')",
    )
    args = parser.parse_args()

    model_name = args.model
    if not model_name:
        model_name = input("Entrez le nom du modèle à utiliser: ")

    if not model_name.strip():
        print("❌ Erreur: Nom de modèle requis")
        sys.exit(1)

    # Exécuter l'exemple
    asyncio.run(main(model_name))
