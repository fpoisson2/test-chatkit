import { useCallback, type MutableRefObject } from "react";
import type { FlowNode, FlowEdge } from "../types";

export interface UseElementDeletionParams {
  nodesRef: MutableRefObject<FlowNode[]>;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedEdgeId: (id: string | null) => void;
  setEdges: React.Dispatch<React.SetStateAction<FlowEdge[]>>;
  removeElements: (params: { nodeIds?: string[]; edgeIds?: string[] }) => void;
  updateHasPendingChanges: (value: boolean) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}

export interface UseElementDeletionReturn {
  handleRemoveNode: (nodeId: string) => void;
  handleRemoveEdge: (edgeId: string) => void;
}

/**
 * Hook for managing element deletion (nodes and edges)
 */
export const useElementDeletion = ({
  nodesRef,
  selectedNodeId,
  selectedEdgeId,
  setSelectedNodeId,
  setSelectedEdgeId,
  setEdges,
  removeElements,
  updateHasPendingChanges,
  t,
}: UseElementDeletionParams): UseElementDeletionReturn => {
  const handleRemoveNode = useCallback(
    (nodeId: string) => {
      const node = nodesRef.current.find((currentNode) => currentNode.id === nodeId);
      let confirmed = true;
      if (node) {
        const trimmedDisplayName =
          typeof node.data.displayName === "string" ? node.data.displayName.trim() : "";
        const displayName = trimmedDisplayName || node.data.slug || nodeId;
        confirmed = window.confirm(t("workflowBuilder.deleteBlock.confirm", { name: displayName }));
      } else {
        confirmed = window.confirm(t("workflowBuilder.deleteSelection.confirmSingle"));
      }
      if (!confirmed) {
        return;
      }
      removeElements({ nodeIds: [nodeId] });
      updateHasPendingChanges(true);
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
    },
    [nodesRef, removeElements, selectedNodeId, t, updateHasPendingChanges, setSelectedNodeId],
  );

  const handleRemoveEdge = useCallback(
    (edgeId: string) => {
      removeElements({ edgeIds: [edgeId] });
      setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== edgeId));
      updateHasPendingChanges(true);
      if (selectedEdgeId === edgeId) {
        setSelectedEdgeId(null);
      }
    },
    [removeElements, selectedEdgeId, setEdges, updateHasPendingChanges, setSelectedEdgeId],
  );

  return {
    handleRemoveNode,
    handleRemoveEdge,
  };
};
