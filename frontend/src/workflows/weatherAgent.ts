import { Agent, AgentInputItem, Runner } from "@openai/agents";

type WorkflowInput = { input_as_text: string };

type AgentState = {
  has_all_details: boolean;
  infos_manquantes: string | null;
};

const agent = new Agent({
  name: "Agent",
  instructions: "Fournis la météo à l'utilisateur",
  model: "gpt-5",
  modelSettings: {
    reasoning: {
      effort: "minimal",
      summary: "auto",
    },
    store: true,
  },
});

export const runWorkflow = async (workflow: WorkflowInput) => {
  const state: AgentState = {
    has_all_details: false,
    infos_manquantes: null,
  };

  const conversationHistory: AgentInputItem[] = [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: workflow.input_as_text,
        },
      ],
    },
  ];

  const runner = new Runner({
    traceMetadata: {
      __trace_source__: "agent-builder",
      workflow_id: "wf_68e556bd92048190a549d12e4cf03b220dbf1b19ef9993ae",
    },
  });

  const agentResultTemp = await runner.run(agent, [...conversationHistory]);

  conversationHistory.push(
    ...agentResultTemp.newItems.map((item) => item.rawItem as AgentInputItem),
  );

  if (!agentResultTemp.finalOutput) {
    throw new Error("Agent result is undefined");
  }

  return {
    output_text: agentResultTemp.finalOutput ?? "",
    state,
    conversationHistory,
  };
};
