import { useCallback } from "react";
import type { FlowNodeData } from "../types";
import { stringifyAgentParameters } from "../../../utils/workflows";

/**
 * Common node handler utilities shared across all node handler hooks
 */

export type UpdateNodeDataFn = (
  nodeId: string,
  updater: (data: FlowNodeData) => FlowNodeData,
) => void;

export const useDisplayNameHandler = (
  updateNodeData: UpdateNodeDataFn,
  humanizeSlug: (value: string) => string,
) => {
  return useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        const display = value;
        return {
          ...data,
          displayName: display,
          label: display.trim() ? display : humanizeSlug(data.slug),
        };
      });
    },
    [humanizeSlug, updateNodeData]
  );
};

/**
 * Helper to update node parameters and stringify them
 */
export const updateNodeParameters = (
  data: FlowNodeData,
  nextParameters: Record<string, unknown>,
): FlowNodeData => {
  return {
    ...data,
    parameters: nextParameters,
    parametersText: stringifyAgentParameters(nextParameters),
    parametersError: null,
  } satisfies FlowNodeData;
};
