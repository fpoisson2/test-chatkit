import { useCallback } from "react";
import type { AgentParameters, FlowNode, VectorStoreSummary } from "../types";
import {
  DEFAULT_END_MESSAGE,
  createParallelJoinParameters,
  createParallelSplitParameters,
  createVectorStoreNodeParameters,
  createVoiceAgentParameters,
  createWidgetNodeParameters,
  setEndMessage,
  stringifyAgentParameters,
} from "../../../utils/workflows";
import { resolveAgentParameters } from "../../../utils/agentPresets";

export type UseNodeFactoryParams = {
  addNodeToGraph: (node: FlowNode) => void;
  humanizeSlug: (value: string) => string;
  vectorStores: VectorStoreSummary[];
};

/**
 * Hook managing factory functions for creating new nodes
 * Includes: all "Add Node" handlers
 */
const useNodeFactory = ({
  addNodeToGraph,
  humanizeSlug,
  vectorStores,
}: UseNodeFactoryParams) => {
  const handleAddAgentNode = useCallback(() => {
    const slug = `agent-${Date.now()}`;
    const parameters = resolveAgentParameters(null, {});
    const newNode: FlowNode = {
      id: slug,
      position: { x: 300, y: 200 },
      data: {
        slug,
        kind: "agent",
        displayName: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
        label: humanizeSlug(slug),
      },
      draggable: true,
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddVoiceAgentNode = useCallback(() => {
    const slug = `voice-agent-${Date.now()}`;
    const parameters = createVoiceAgentParameters();
    const displayName = humanizeSlug(slug);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 300, y: 220 },
      data: {
        slug,
        kind: "voice_agent",
        displayName,
        label: displayName,
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddOutboundCallNode = useCallback(() => {
    const slug = `outbound-call-${Date.now()}`;
    const parameters: AgentParameters = {
      to_number: "",
      voice_workflow_id: null,
      sip_account_id: null,
      wait_for_completion: true,
      metadata: {},
    };
    const displayName = humanizeSlug(slug);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 300, y: 240 },
      data: {
        slug,
        kind: "outbound_call",
        displayName,
        label: displayName,
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        isPreviewActive: false,
        isPreviewDimmed: false,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddConditionNode = useCallback(() => {
    const slug = `condition-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 400, y: 260 },
      data: {
        slug,
        kind: "condition",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddWhileNode = useCallback(() => {
    const slug = `while-${Date.now()}`;
    const parameters: AgentParameters = {
      condition: "",
      max_iterations: 100,
      iteration_var: "",
    };
    const newNode: FlowNode = {
      id: slug,
      position: { x: 420, y: 280 },
      data: {
        slug,
        kind: "while",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddParallelSplitNode = useCallback(() => {
    const slug = `parallel-split-${Date.now()}`;
    const joinSlug = `parallel-join-${Date.now()}`;
    const parameters = {
      ...createParallelSplitParameters(),
      join_slug: joinSlug,
    };
    const displayName = humanizeSlug(slug);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 420, y: 200 },
      data: {
        slug,
        kind: "parallel_split",
        displayName,
        label: displayName,
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddParallelJoinNode = useCallback(() => {
    const slug = `parallel-join-${Date.now()}`;
    const parameters = createParallelJoinParameters();
    const displayName = humanizeSlug(slug);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 520, y: 220 },
      data: {
        slug,
        kind: "parallel_join",
        displayName,
        label: displayName,
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddStateNode = useCallback(() => {
    const slug = `state-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 360, y: 220 },
      data: {
        slug,
        kind: "state",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddWatchNode = useCallback(() => {
    const slug = `watch-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 380, y: 240 },
      data: {
        slug,
        kind: "watch",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddTransformNode = useCallback(() => {
    const slug = `transform-${Date.now()}`;
    const parameters: AgentParameters = { expressions: {} };
    const newNode: FlowNode = {
      id: slug,
      position: { x: 380, y: 260 },
      data: {
        slug,
        kind: "transform",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddWaitForUserInputNode = useCallback(() => {
    const slug = `wait-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 400, y: 260 },
      data: {
        slug,
        kind: "wait_for_user_input",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddAssistantMessageNode = useCallback(() => {
    const slug = `assistant-message-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 460, y: 220 },
      data: {
        slug,
        kind: "assistant_message",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddUserMessageNode = useCallback(() => {
    const slug = `user-message-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 440, y: 240 },
      data: {
        slug,
        kind: "user_message",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddVectorStoreNode = useCallback(() => {
    const slug = `json-vector-store-${Date.now()}`;
    const fallbackSlug = vectorStores[0]?.slug?.trim() ?? "";
    const parameters = createVectorStoreNodeParameters({ vector_store_slug: fallbackSlug });
    const newNode: FlowNode = {
      id: slug,
      position: { x: 420, y: 320 },
      data: {
        slug,
        kind: "json_vector_store",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug, vectorStores]);

  const handleAddWidgetNode = useCallback(() => {
    const slug = `widget-${Date.now()}`;
    const parameters = createWidgetNodeParameters();
    const newNode: FlowNode = {
      id: slug,
      position: { x: 520, y: 200 },
      data: {
        slug,
        kind: "widget",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddEndNode = useCallback(() => {
    const slug = `end-${Date.now()}`;
    const parameters = setEndMessage({}, DEFAULT_END_MESSAGE);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 640, y: 120 },
      data: {
        slug,
        kind: "end",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  return {
    handleAddAgentNode,
    handleAddVoiceAgentNode,
    handleAddOutboundCallNode,
    handleAddConditionNode,
    handleAddWhileNode,
    handleAddParallelSplitNode,
    handleAddParallelJoinNode,
    handleAddStateNode,
    handleAddWatchNode,
    handleAddTransformNode,
    handleAddWaitForUserInputNode,
    handleAddAssistantMessageNode,
    handleAddUserMessageNode,
    handleAddVectorStoreNode,
    handleAddWidgetNode,
    handleAddEndNode,
  };
};

export default useNodeFactory;
