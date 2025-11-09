#!/usr/bin/env python3
"""
Exemple d'utilisation de LitellmModel avec l'outil météo (weather tool).

Ce script montre comment :
1. Charger un modèle depuis la base de données ChatKit
2. Créer une instance LitellmModel via le proxy LiteLLM
3. Utiliser l'agent avec l'outil météo pour récupérer les conditions actuelles

Prérequis :
- Le serveur LiteLLM proxy doit être démarré (docker-compose up -d litellm)
- Un modèle doit être configuré en base de données avec provider "litellm"
- Les variables d'environnement doivent être configurées (.env)

Utilisation :
    python backend/examples/litellm_weather_agent.py
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

# Ajouter le répertoire backend au path pour les imports
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from agents import Agent
from app.chatkit.agent_registry import build_litellm_model_from_db
from app.tool_builders.weather import build_weather_tool

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


async def main():
    """
    Exemple principal montrant l'utilisation de LitellmModel avec l'outil météo.
    """
    # 1. Charger le modèle depuis la base de données
    # Le nom du modèle doit correspondre à un modèle configuré dans ChatKit
    # avec un provider "litellm"
    model_name = "openai/gpt-4"  # Ou tout autre modèle configuré dans litellm_config.yaml

    logger.info(f"Chargement du modèle '{model_name}' depuis la base de données...")
    litellm_model = build_litellm_model_from_db(model_name)

    if litellm_model is None:
        logger.error(
            f"Impossible de charger le modèle '{model_name}'. "
            f"Vérifiez que :\n"
            f"  1. Le modèle existe en base de données\n"
            f"  2. Il est associé à un provider 'litellm'\n"
            f"  3. Le provider a une clé API configurée\n"
            f"  4. Le serveur LiteLLM est démarré (docker-compose up -d litellm)"
        )
        return

    logger.info(f"✓ Modèle '{model_name}' chargé avec succès")

    # 2. Créer l'outil météo
    logger.info("Construction de l'outil météo...")
    weather_tool = build_weather_tool("fetch_weather")

    if weather_tool is None:
        logger.error("Impossible de construire l'outil météo")
        return

    logger.info(f"✓ Outil météo créé : {weather_tool.name}")

    # 3. Créer l'agent avec le modèle et l'outil
    logger.info("Création de l'agent météo...")
    agent = Agent(
        name="Agent Météo",
        model=litellm_model,
        tools=[weather_tool],
        instructions=(
            "Tu es un assistant météo. Utilise l'outil fetch_weather pour "
            "récupérer les conditions météorologiques actuelles. "
            "Réponds de manière concise et amicale."
        ),
    )

    logger.info("✓ Agent créé avec succès")

    # 4. Tester l'agent avec une requête météo
    test_cities = [
        ("Paris", "France"),
        ("Tokyo", "Japan"),
        ("New York", "USA"),
    ]

    for city, country in test_cities:
        logger.info(f"\n{'='*60}")
        logger.info(f"Test : Météo à {city}, {country}")
        logger.info(f"{'='*60}")

        query = f"Quelle est la météo actuelle à {city}, {country} ?"
        logger.info(f"Question : {query}")

        try:
            # Exécuter l'agent
            result = await agent.run(query)

            logger.info(f"\nRéponse de l'agent :")
            logger.info(f"{result.messages[-1].content}")

            # Afficher les appels d'outils si présents
            if hasattr(result, "tool_calls") and result.tool_calls:
                logger.info(f"\nOutils utilisés : {len(result.tool_calls)}")
                for i, tool_call in enumerate(result.tool_calls, 1):
                    logger.info(f"  {i}. {tool_call.get('name', 'unknown')}")

        except Exception as e:
            logger.error(f"Erreur lors de l'exécution : {type(e).__name__}: {e}")

    logger.info(f"\n{'='*60}")
    logger.info("Tests terminés avec succès !")
    logger.info(f"{'='*60}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("\nInterrompu par l'utilisateur")
    except Exception as e:
        logger.error(f"Erreur fatale : {type(e).__name__}: {e}", exc_info=True)
        sys.exit(1)
