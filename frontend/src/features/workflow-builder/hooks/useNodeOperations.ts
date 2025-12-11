import { useCallback, type MutableRefObject } from "react";
import type { ReactFlowInstance, Viewport } from "@xyflow/react";
import type { FlowNode, FlowNodeData } from "../types";

export interface UseNodeOperationsParams {
  setNodes: React.Dispatch<React.SetStateAction<FlowNode[]>>;
  decorateNode: (node: FlowNode) => FlowNode;
  applySelection: (params: { nodeIds: string[]; primaryNodeId: string }) => void;
  minViewportZoom: number;
  reactFlowInstanceRef: MutableRefObject<ReactFlowInstance | null>;
  reactFlowWrapperRef: MutableRefObject<HTMLDivElement | null>;
  viewportRef: MutableRefObject<Viewport>;
  updateViewportState: (nextViewport: Viewport | null | undefined, options?: { persist?: boolean }) => void;
}

export interface UseNodeOperationsReturn {
  updateNodeData: (nodeId: string, updater: (data: FlowNodeData) => FlowNodeData) => void;
  addNodeToGraph: (node: FlowNode) => void;
  centerViewportOnNode: (node: FlowNode) => void;
}

/**
 * Hook for managing node operations (add, update, center viewport)
 */
export const useNodeOperations = ({
  setNodes,
  decorateNode,
  applySelection,
  minViewportZoom,
  reactFlowInstanceRef,
  reactFlowWrapperRef,
  viewportRef,
  updateViewportState,
}: UseNodeOperationsParams): UseNodeOperationsReturn => {
  const updateNodeData = useCallback(
    (nodeId: string, updater: (data: FlowNodeData) => FlowNodeData) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }
          const nextData = updater(node.data);
          return decorateNode({
            ...node,
            data: nextData,
          });
        })
      );
    },
    [decorateNode, setNodes]
  );

  const centerViewportOnNode = useCallback(
    (node: FlowNode) => {
      const instance = reactFlowInstanceRef.current;
      if (!instance) {
        return;
      }

      const position = node.position ?? { x: 0, y: 0 };
      const currentViewport = instance.getViewport?.() ?? viewportRef.current;
      const currentZoom = currentViewport?.zoom ?? 1;
      const targetZoom = Math.max(currentZoom, minViewportZoom);

      try {
        instance.setCenter(position.x, position.y, {
          zoom: targetZoom,
          duration: 200,
        });
      } catch (error) {
        console.error(error);
      }

      const scheduleUpdate = (shouldPersist: boolean) => {
        const latestViewport = instance.getViewport?.();
        if (latestViewport) {
          updateViewportState(latestViewport, { persist: shouldPersist });
          return;
        }

        const wrapper = reactFlowWrapperRef.current;
        if (!wrapper) {
          return;
        }

        const { clientWidth, clientHeight } = wrapper;
        if (!clientWidth || !clientHeight) {
          return;
        }

        updateViewportState(
          {
            x: clientWidth / 2 - position.x * targetZoom,
            y: clientHeight / 2 - position.y * targetZoom,
            zoom: targetZoom,
          },
          { persist: shouldPersist },
        );
      };

      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => scheduleUpdate(false));
        window.setTimeout(() => scheduleUpdate(true), 220);
      } else {
        scheduleUpdate(false);
        setTimeout(() => scheduleUpdate(true), 220);
      }
    },
    [minViewportZoom, reactFlowInstanceRef, reactFlowWrapperRef, updateViewportState, viewportRef],
  );

  const addNodeToGraph = useCallback(
    (node: FlowNode) => {
      const prepared = decorateNode({
        ...node,
        selected: true,
      });

      setNodes((current) => {
        const cleared = current.map((existing) =>
          decorateNode({
            ...existing,
            selected: false,
          }),
        );
        return [...cleared, prepared];
      });

      applySelection({ nodeIds: [node.id], primaryNodeId: node.id });
      centerViewportOnNode(prepared);
    },
    [applySelection, centerViewportOnNode, decorateNode, setNodes]
  );

  return {
    updateNodeData,
    addNodeToGraph,
    centerViewportOnNode,
  };
};
