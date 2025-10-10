"""Workflow Agent Builder minimal en Python pour fournir la météo."""

from __future__ import annotations

from typing import Any

from agents import Agent, ModelSettings, Runner, RunConfig, TResponseInputItem
from openai.types.shared.reasoning import Reasoning
from pydantic import BaseModel

agent = Agent(
    name="Agent météo",
    instructions=(
        "Tu es un assistant météo francophone. Fournis un résumé clair des conditions actuelles "
        "(température, vent, précipitations, indice UV) pour la ville demandée. "
        "Dès qu'une ville est précisée, appelle l'outil client `get_weather` avec `city` et, si présent, `country`. "
        "Si l'utilisateur ne précise pas la période, suppose qu'il veut la météo actuelle. "
        "Présente les températures en degrés Celsius par défaut, sauf demande contraire explicite. "
        "Ne pose de questions complémentaires que si la ville n'est pas clairement identifiée."
    ),
    model="gpt-5",
    model_settings=ModelSettings(
        store=True,
        reasoning=Reasoning(
            effort="minimal",
            summary="auto",
        ),
    ),
)


class WorkflowInput(BaseModel):
    """Schéma d'entrée exposé par le workflow ChatKit."""

    input_as_text: str


async def run_workflow(workflow_input: WorkflowInput) -> dict[str, Any]:
    """Point d'entrée principal exécuté par Agent Builder."""

    state = {
        "has_all_details": False,
        "infos_manquantes": None,
    }
    workflow = workflow_input.model_dump()
    conversation_history: list[TResponseInputItem] = [
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": workflow["input_as_text"],
                },
            ],
        },
    ]

    agent_result_temp = await Runner.run(
        agent,
        input=conversation_history,
        run_config=RunConfig(
            trace_metadata={
                "__trace_source__": "agent-builder",
                "workflow_id": "wf_68e556bd92048190a549d12e4cf03b220dbf1b19ef9993ae",
            },
        ),
    )

    new_items = getattr(agent_result_temp, "new_items", None)
    if new_items:
        for item in new_items:
            raw_item = getattr(item, "raw_item", None)
            if raw_item:
                conversation_history.append(raw_item)

    final_output = getattr(agent_result_temp, "final_output", None)
    if not final_output:
        raise RuntimeError("Agent result is undefined")

    return {
        "output_text": final_output,
        "state": state,
        "conversation_history": conversation_history,
    }
