from agents import function_tool, Agent, ModelSettings, TResponseInputItem, Runner, RunConfig
from openai.types.shared.reasoning import Reasoning
from pydantic import BaseModel

# Tool definitions
@function_tool
def get_weather(city: str, country: str):
  pass

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
