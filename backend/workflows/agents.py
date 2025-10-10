from agents import function_tool, Agent, ModelSettings, TResponseInputItem, Runner, RunConfig
from openai.types.shared.reasoning import Reasoning
from pydantic import BaseModel

# Tool definitions
@function_tool
def get_weather(city: str, country: str) -> dict:
  """Retourne des informations météo fictives pour une ville donnée."""
  sample_data = {
    ("paris", "france"): {
      "condition": "partiellement nuageux",
      "temperature_c": 18,
      "humidity": 0.62,
      "wind_kmh": 12,
    },
    ("lyon", "france"): {
      "condition": "ensoleillé",
      "temperature_c": 21,
      "humidity": 0.54,
      "wind_kmh": 9,
    },
    ("marseille", "france"): {
      "condition": "ciel dégagé",
      "temperature_c": 24,
      "humidity": 0.48,
      "wind_kmh": 16,
    },
    ("montreal", "canada"): {
      "condition": "averses légères",
      "temperature_c": 12,
      "humidity": 0.71,
      "wind_kmh": 20,
    },
    ("san francisco", "etats-unis"): {
      "condition": "brouillard côtier",
      "temperature_c": 15,
      "humidity": 0.86,
      "wind_kmh": 18,
    },
  }

  key = (city.strip().lower(), country.strip().lower())
  forecast = sample_data.get(
    key,
    {
      "condition": "temps stable",
      "temperature_c": 20,
      "humidity": 0.6,
      "wind_kmh": 10,
    },
  )

  temperature_c = forecast["temperature_c"]
  return {
    "city": city,
    "country": country,
    "condition": forecast["condition"],
    "temperature_c": temperature_c,
    "temperature_f": round((temperature_c * 9 / 5) + 32, 1),
    "humidity": forecast["humidity"],
    "wind_kmh": forecast["wind_kmh"],
    "source": "service météo de démonstration",
  }

agent = Agent(
  name="Agent",
  instructions="Fournis la météo à l'utilisateur",
  model="gpt-5",
  tools=[
    get_weather
  ],
  model_settings=ModelSettings(
    parallel_tool_calls=True,
    store=True,
    reasoning=Reasoning(
      effort="minimal",
      summary="auto"
    )
  )
)


class WorkflowInput(BaseModel):
  input_as_text: str


# Main code entrypoint
async def run_workflow(workflow_input: WorkflowInput):
  state = {
    "has_all_details": False,
    "infos_manquantes": None
  }
  workflow = workflow_input.model_dump()
  conversation_history: list[TResponseInputItem] = [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": workflow["input_as_text"]
        }
      ]
    }
  ]
  agent_result_temp = await Runner.run(
    agent,
    input=[
      *conversation_history
    ],
    run_config=RunConfig(trace_metadata={
      "__trace_source__": "agent-builder",
      "workflow_id": "wf_68e556bd92048190a549d12e4cf03b220dbf1b19ef9993ae"
    })
  )

  conversation_history.extend([item.to_input_item() for item in agent_result_temp.new_items])

  agent_result = {
    "output_text": agent_result_temp.final_output_as(str)
  }
  return agent_result
