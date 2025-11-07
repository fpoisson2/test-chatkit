import { useCallback } from "react";
import type {
  AgentParameters,
  ParallelBranch,
  StateAssignment,
  StateAssignmentScope,
} from "../types";
import {
  setConditionMode,
  setConditionPath,
  setConditionValue,
  setParallelSplitBranches,
  setParallelSplitJoinSlug,
  setStateAssignments,
} from "../../../utils/workflows";
import { updateNodeParameters, type UpdateNodeDataFn } from "./nodeHandlerUtils";

export type UseLogicNodeHandlersParams = {
  updateNodeData: UpdateNodeDataFn;
};

/**
 * Hook managing handlers for Logic/Control flow nodes
 * Includes: condition, parallel split/join, state, transform
 */
const useLogicNodeHandlers = ({
  updateNodeData,
}: UseLogicNodeHandlersParams) => {
  // ========== Condition Node Handlers ==========

  const handleConditionPathChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "condition") {
          return data;
        }
        const nextParameters = setConditionPath(data.parameters, value);
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData],
  );

  const handleConditionModeChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "condition") {
          return data;
        }
        let nextParameters = setConditionMode(data.parameters, value);
        if (value !== "equals" && value !== "not_equals") {
          nextParameters = setConditionValue(nextParameters, "");
        }
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData],
  );

  const handleConditionValueChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "condition") {
          return data;
        }
        const nextParameters = setConditionValue(data.parameters, value);
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData],
  );

  // ========== Parallel Node Handlers ==========

  const handleParallelJoinSlugChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "parallel_split") {
          return data;
        }
        const nextParameters = setParallelSplitJoinSlug(data.parameters, value);
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData],
  );

  const handleParallelBranchesChange = useCallback(
    (nodeId: string, branches: ParallelBranch[]) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "parallel_split") {
          return data;
        }
        const nextParameters = setParallelSplitBranches(data.parameters, branches);
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData],
  );

  // ========== State Node Handlers ==========

  const handleStateAssignmentsChange = useCallback(
    (nodeId: string, scope: StateAssignmentScope, assignments: StateAssignment[]) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "state") {
          return data;
        }
        const nextParameters = setStateAssignments(data.parameters, scope, assignments);
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData],
  );

  // ========== Transform Node Handlers ==========

  const handleTransformExpressionsChange = useCallback(
    (nodeId: string, expressions: Record<string, unknown>) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "transform") {
          return data;
        }
        const nextParameters: AgentParameters = { ...(data.parameters ?? {}) };
        if (Object.keys(expressions).length > 0) {
          (nextParameters as Record<string, unknown>).expressions = expressions;
        } else {
          delete (nextParameters as Record<string, unknown>).expressions;
        }
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData],
  );

  return {
    handleConditionPathChange,
    handleConditionModeChange,
    handleConditionValueChange,
    handleParallelJoinSlugChange,
    handleParallelBranchesChange,
    handleStateAssignmentsChange,
    handleTransformExpressionsChange,
  };
};

export default useLogicNodeHandlers;
