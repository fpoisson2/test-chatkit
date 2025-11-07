import type {
  FlowNode,
  FlowNodeData,
  WorkflowSummary,
} from "../types";
import type { VectorStoreSummary } from "../../../utils/backend";
import { useDisplayNameHandler } from "./nodeHandlerUtils";
import usePromptNodeHandlers from "./usePromptNodeHandlers";
import useToolNodeHandlers from "./useToolNodeHandlers";
import useLogicNodeHandlers from "./useLogicNodeHandlers";
import useDataNodeHandlers from "./useDataNodeHandlers";
import useNodeFactory from "./useNodeFactory";

export type UseWorkflowNodeHandlersParams = {
  updateNodeData: (
    nodeId: string,
    updater: (data: FlowNodeData) => FlowNodeData,
  ) => void;
  addNodeToGraph: (node: FlowNode) => void;
  humanizeSlug: (value: string) => string;
  isReasoningModel: (model: string | null | undefined) => boolean;
  workflows: WorkflowSummary[];
  vectorStores: VectorStoreSummary[];
};

/**
 * Orchestrates all node handler hooks for the workflow builder
 * This hook composes specialized handlers for different node types
 */
const useWorkflowNodeHandlers = ({
  updateNodeData,
  addNodeToGraph,
  humanizeSlug,
  isReasoningModel,
  workflows,
  vectorStores,
}: UseWorkflowNodeHandlersParams) => {
  // Common handler for display name (used by all node types)
  const handleDisplayNameChange = useDisplayNameHandler(updateNodeData, humanizeSlug);

  // Compose specialized handler hooks
  const promptHandlers = usePromptNodeHandlers({
    updateNodeData,
    isReasoningModel,
  });

  const toolHandlers = useToolNodeHandlers({
    updateNodeData,
    workflows,
  });

  const logicHandlers = useLogicNodeHandlers({
    updateNodeData,
  });

  const dataHandlers = useDataNodeHandlers({
    updateNodeData,
  });

  const factoryHandlers = useNodeFactory({
    addNodeToGraph,
    humanizeSlug,
    vectorStores,
  });
  // Return combined handlers from all specialized hooks
  return {
    handleDisplayNameChange,
    ...promptHandlers,
    ...toolHandlers,
    ...logicHandlers,
    ...dataHandlers,
    ...factoryHandlers,
  };
};

export type WorkflowNodeHandlers = ReturnType<typeof useWorkflowNodeHandlers>;

export default useWorkflowNodeHandlers;
