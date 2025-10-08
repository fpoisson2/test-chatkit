"""Démo minimale d'un agent ChatKit avec un outil météo."""

from __future__ import annotations

from agents import Agent, Runner, function_tool

__all__ = ["agent", "create_agent", "get_weather"]


@function_tool
def get_weather(city: str) -> str:
    """Retourne la météo pour une ville donnée."""
    base = {
        "Paris": "Ensoleillé, 24°C",
        "Lyon": "Pluvieux, 18°C",
        "Marseille": "Vent fort, 27°C",
    }
    return base.get(city, f"Je n'ai pas trouvé la météo pour {city}.")


def create_agent() -> Agent:
    """Construit un agent météo prêt à être utilisé."""

    return Agent(
        name="Assistant météo",
        model="gpt-4.1-mini",
        instructions=(
            "Donne la météo actuelle en utilisant l'outil get_weather si besoin."
        ),
        tools=[get_weather],
    )


agent = create_agent()


if __name__ == "__main__":
    for question in (
        "Quel temps fait-il à Paris ?",
        "Et à Lyon ?",
        "Et à Londres ?",
    ):
        result = Runner.run_sync(agent, question)
        print(result.final_output)
