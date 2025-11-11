import { useCallback, type MutableRefObject } from "react";
import type { FlowNode, FlowEdge } from "../types";
import type { HistoryState } from "./useWorkflowHistory";

export interface UseNodeInteractionsParams {
  isMobileLayout: boolean;
  selectNode: (id: string) => void;
  selectEdge: (id: string) => void;
  applySelection: (params: { nodeIds?: string[]; edgeIds?: string[]; primaryNodeId?: string; primaryEdgeId?: string }) => void;
  setIsPropertiesPanelOpen: (open: boolean) => void;
  isNodeDragInProgressRef: MutableRefObject<boolean>;
  historyRef: MutableRefObject<HistoryState>;
  lastTappedElementRef: MutableRefObject<{
    kind: "node" | "edge";
    id: string;
    tapCount: number;
  } | null>;
}

export interface UseNodeInteractionsReturn {
  handleNodeClick: (_: unknown, node: FlowNode) => void;
  handleEdgeClick: (_: unknown, edge: FlowEdge) => void;
  handleNodeDragStart: () => void;
  handleNodeDragStop: () => void;
}

/**
 * Hook for managing node and edge interactions (click, drag)
 */
export const useNodeInteractions = ({
  isMobileLayout,
  selectNode,
  selectEdge,
  applySelection,
  setIsPropertiesPanelOpen,
  isNodeDragInProgressRef,
  historyRef,
  lastTappedElementRef,
}: UseNodeInteractionsParams): UseNodeInteractionsReturn => {
  const handleNodeClick = useCallback(
    (_: unknown, node: FlowNode) => {
      const lastTapped = lastTappedElementRef.current;
      const isSameElement = lastTapped?.kind === "node" && lastTapped.id === node.id;
      const nextTapCount = isSameElement ? Math.min(lastTapped.tapCount + 1, 2) : 1;
      lastTappedElementRef.current = { kind: "node", id: node.id, tapCount: nextTapCount };
      selectNode(node.id);
      // On mobile, applySelection is not called by ReactFlow, so we call it manually to apply visual styling
      if (isMobileLayout) {
        applySelection({ nodeIds: [node.id], primaryNodeId: node.id });
      }
      if (isMobileLayout && isSameElement && nextTapCount >= 2) {
        setIsPropertiesPanelOpen(true);
      }
    },
    [isMobileLayout, selectNode, applySelection, setIsPropertiesPanelOpen, lastTappedElementRef],
  );

  const handleEdgeClick = useCallback(
    (_: unknown, edge: FlowEdge) => {
      const lastTapped = lastTappedElementRef.current;
      const isSameElement = lastTapped?.kind === "edge" && lastTapped.id === edge.id;
      const nextTapCount = isSameElement ? Math.min(lastTapped.tapCount + 1, 2) : 1;
      lastTappedElementRef.current = { kind: "edge", id: edge.id, tapCount: nextTapCount };
      selectEdge(edge.id);
      // On mobile, applySelection is not called by ReactFlow, so we call it manually to apply visual styling
      if (isMobileLayout) {
        applySelection({ edgeIds: [edge.id], primaryEdgeId: edge.id });
      }
      if (isMobileLayout && isSameElement && nextTapCount >= 2) {
        setIsPropertiesPanelOpen(true);
      }
    },
    [isMobileLayout, selectEdge, applySelection, setIsPropertiesPanelOpen, lastTappedElementRef],
  );

  const handleNodeDragStart = useCallback(() => {
    isNodeDragInProgressRef.current = true;
  }, [isNodeDragInProgressRef]);

  const handleNodeDragStop = useCallback(() => {
    isNodeDragInProgressRef.current = false;
    const history = historyRef.current;
    const pending = history.pendingSnapshot;
    if (!pending) {
      return;
    }
    const HISTORY_LIMIT = 100; // Match the limit from WorkflowBuilderUtils
    if (history.last == null) {
      history.last = pending;
    } else if (history.last !== pending) {
      history.past = [...history.past, history.last].slice(-HISTORY_LIMIT);
      history.future = [];
      history.last = pending;
    }
    history.pendingSnapshot = null;
  }, [historyRef]);

  return {
    handleNodeClick,
    handleEdgeClick,
    handleNodeDragStart,
    handleNodeDragStop,
  };
};
