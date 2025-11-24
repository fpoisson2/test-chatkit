import type { NodeKind } from "../types";
import type { AgentParameters } from "../../../utils/workflows";
import {
  resolveAgentParameters,
  resolveStateParameters,
} from "../../../utils/agentPresets";
import {
  resolveVoiceAgentParameters,
  resolveWidgetNodeParameters,
  resolveStartParameters,
  resolveParallelSplitParameters,
  getVectorStoreNodeConfig,
  setVectorStoreNodeConfig,
} from "../../../utils/workflows";

/**
 * Resolves node parameters based on the node kind.
 * Different node types require different parameter resolution strategies.
 *
 * @param kind - The kind of node (agent, state, widget, etc.)
 * @param slug - The unique slug identifier for the node
 * @param agentKey - The agent key (for agent nodes)
 * @param parameters - The raw parameters to resolve
 * @returns Resolved parameters with defaults and proper structure
 */
export function resolveNodeParameters(
  kind: NodeKind,
  slug: string,
  agentKey: string | null,
  parameters: AgentParameters | null
): AgentParameters {
  switch (kind) {
    case "agent":
      return resolveAgentParameters(agentKey, parameters);

    case "voice_agent":
      return resolveVoiceAgentParameters(parameters);

    case "computer_use":
      // Computer use nodes have their tools pre-configured, just preserve parameters
      return { ...(parameters ?? {}) } as AgentParameters;

    case "state":
      return resolveStateParameters(slug, parameters);

    case "json_vector_store":
      return setVectorStoreNodeConfig(
        {},
        getVectorStoreNodeConfig(parameters)
      );

    case "widget":
      return resolveWidgetNodeParameters(parameters);

    case "start":
      return resolveStartParameters(parameters);

    case "parallel_split":
      return resolveParallelSplitParameters(parameters);

    case "parallel_join":
      return { ...(parameters ?? {}) } as AgentParameters;

    default:
      // Default fallback for other node types
      return resolveAgentParameters(null, parameters);
  }
}
