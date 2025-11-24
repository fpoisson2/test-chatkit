import { useMemo } from "react";
import type { BlockLibraryItem } from "../components/BlockLibrary";
import type { NodeKind } from "../types";
import { labelForKind, NODE_COLORS } from "../utils";

export interface NodeHandlers {
  handleAddAgentNode: () => void;
  handleAddVoiceAgentNode: () => void;
  handleAddOutboundCallNode: () => void;
  handleAddComputerUseNode: () => void;
  handleAddConditionNode: () => void;
  handleAddWhileNode: () => void;
  handleAddParallelSplitNode: () => void;
  handleAddParallelJoinNode: () => void;
  handleAddStateNode: () => void;
  handleAddWatchNode: () => void;
  handleAddTransformNode: () => void;
  handleAddWaitForUserInputNode: () => void;
  handleAddAssistantMessageNode: () => void;
  handleAddUserMessageNode: () => void;
  handleAddVectorStoreNode: () => void;
  handleAddWidgetNode: () => void;
  handleAddEndNode: () => void;
}

export interface UseBlockLibraryItemsParams {
  nodeHandlers: NodeHandlers;
  t: (key: string) => string;
}

/**
 * Hook for generating block library items configuration
 */
export const useBlockLibraryItems = ({
  nodeHandlers,
  t,
}: UseBlockLibraryItemsParams): BlockLibraryItem[] => {
  return useMemo<BlockLibraryItem[]>(() => {
    const definitions: Array<{
      key: string;
      kind: NodeKind;
      shortLabel: string;
      onClick: () => void;
    }> = [
      { key: "agent", kind: "agent", shortLabel: "A", onClick: nodeHandlers.handleAddAgentNode },
      {
        key: "voice-agent",
        kind: "voice_agent",
        shortLabel: "AV",
        onClick: nodeHandlers.handleAddVoiceAgentNode,
      },
      {
        key: "outbound-call",
        kind: "outbound_call",
        shortLabel: "AS",
        onClick: nodeHandlers.handleAddOutboundCallNode,
      },
      {
        key: "computer-use",
        kind: "computer_use",
        shortLabel: "CU",
        onClick: nodeHandlers.handleAddComputerUseNode,
      },
      {
        key: "condition",
        kind: "condition",
        shortLabel: "C",
        onClick: nodeHandlers.handleAddConditionNode,
      },
      {
        key: "while",
        kind: "while",
        shortLabel: "W",
        onClick: nodeHandlers.handleAddWhileNode,
      },
      {
        key: "parallel-split",
        kind: "parallel_split",
        shortLabel: "SP",
        onClick: nodeHandlers.handleAddParallelSplitNode,
      },
      {
        key: "parallel-join",
        kind: "parallel_join",
        shortLabel: "JP",
        onClick: nodeHandlers.handleAddParallelJoinNode,
      },
      { key: "state", kind: "state", shortLabel: "É", onClick: nodeHandlers.handleAddStateNode },
      { key: "watch", kind: "watch", shortLabel: "W", onClick: nodeHandlers.handleAddWatchNode },
      {
        key: "transform",
        kind: "transform",
        shortLabel: "T",
        onClick: nodeHandlers.handleAddTransformNode,
      },
      {
        key: "wait-for-user-input",
        kind: "wait_for_user_input",
        shortLabel: "AU",
        onClick: nodeHandlers.handleAddWaitForUserInputNode,
      },
      {
        key: "assistant-message",
        kind: "assistant_message",
        shortLabel: "MA",
        onClick: nodeHandlers.handleAddAssistantMessageNode,
      },
      {
        key: "user-message",
        kind: "user_message",
        shortLabel: "MU",
        onClick: nodeHandlers.handleAddUserMessageNode,
      },
      {
        key: "json-vector-store",
        kind: "json_vector_store",
        shortLabel: "VS",
        onClick: nodeHandlers.handleAddVectorStoreNode,
      },
      { key: "widget", kind: "widget", shortLabel: "W", onClick: nodeHandlers.handleAddWidgetNode },
      { key: "end", kind: "end", shortLabel: "F", onClick: nodeHandlers.handleAddEndNode },
    ];

    return definitions.map((definition) => ({
      ...definition,
      label: labelForKind(definition.kind, t),
      color: NODE_COLORS[definition.kind],
    }));
  }, [
    t,
    nodeHandlers.handleAddAgentNode,
    nodeHandlers.handleAddVoiceAgentNode,
    nodeHandlers.handleAddOutboundCallNode,
    nodeHandlers.handleAddComputerUseNode,
    nodeHandlers.handleAddConditionNode,
    nodeHandlers.handleAddWhileNode,
    nodeHandlers.handleAddParallelSplitNode,
    nodeHandlers.handleAddParallelJoinNode,
    nodeHandlers.handleAddStateNode,
    nodeHandlers.handleAddWatchNode,
    nodeHandlers.handleAddTransformNode,
    nodeHandlers.handleAddWaitForUserInputNode,
    nodeHandlers.handleAddAssistantMessageNode,
    nodeHandlers.handleAddUserMessageNode,
    nodeHandlers.handleAddVectorStoreNode,
    nodeHandlers.handleAddWidgetNode,
    nodeHandlers.handleAddEndNode,
  ]);
};
