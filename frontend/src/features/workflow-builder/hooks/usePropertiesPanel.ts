import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { FlowNode, FlowEdge } from "../types";

export interface UsePropertiesPanelParams {
  isMobileLayout: boolean;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  selectedNode: FlowNode | null;
  selectedEdge: FlowEdge | null;
  isPropertiesPanelOpen: boolean;
  setIsPropertiesPanelOpen: (open: boolean) => void;
  isNodeDragInProgressRef: MutableRefObject<boolean>;
  handleClearSelection: () => void;
}

export interface UsePropertiesPanelReturn {
  handleClosePropertiesPanel: () => void;
  handleOpenPropertiesPanel: () => void;
  propertiesPanelToggleRef: MutableRefObject<HTMLButtonElement | null>;
  propertiesPanelCloseButtonRef: MutableRefObject<HTMLButtonElement | null>;
  lastTappedElementRef: MutableRefObject<{
    kind: "node" | "edge";
    id: string;
    tapCount: number;
  } | null>;
  previousSelectedElementRef: MutableRefObject<string | null>;
}

/**
 * Hook for managing the properties panel (open/close/focus)
 */
export const usePropertiesPanel = ({
  isMobileLayout,
  selectedNodeId,
  selectedEdgeId,
  selectedNode,
  selectedEdge,
  isPropertiesPanelOpen,
  setIsPropertiesPanelOpen,
  isNodeDragInProgressRef,
  handleClearSelection,
}: UsePropertiesPanelParams): UsePropertiesPanelReturn => {
  const propertiesPanelToggleRef = useRef<HTMLButtonElement | null>(null);
  const propertiesPanelCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastTappedElementRef = useRef<{
    kind: "node" | "edge";
    id: string;
    tapCount: number;
  } | null>(null);
  const previousSelectedElementRef = useRef<string | null>(null);

  const handleClosePropertiesPanel = useCallback(() => {
    if (isMobileLayout) {
      setIsPropertiesPanelOpen(false);
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          propertiesPanelToggleRef.current?.focus();
        }, 0);
      } else {
        propertiesPanelToggleRef.current?.focus();
      }
      return;
    }
    handleClearSelection();
  }, [handleClearSelection, isMobileLayout, setIsPropertiesPanelOpen]);

  const handleOpenPropertiesPanel = useCallback(() => {
    if (!selectedNode && !selectedEdge) {
      return;
    }
    setIsPropertiesPanelOpen(true);
  }, [selectedEdge, selectedNode, setIsPropertiesPanelOpen]);

  const selectedElementKey = selectedNodeId ?? selectedEdgeId ?? null;

  // Manage panel visibility based on selection
  useEffect(() => {
    if (!selectedElementKey) {
      setIsPropertiesPanelOpen(false);
      lastTappedElementRef.current = null;
      previousSelectedElementRef.current = selectedElementKey;
      return;
    }

    const isNewSelection = previousSelectedElementRef.current !== selectedElementKey;
    if (isNewSelection) {
      const matchesLastTap =
        (selectedNodeId &&
          lastTappedElementRef.current?.kind === "node" &&
          lastTappedElementRef.current.id === selectedNodeId) ||
        (selectedEdgeId &&
          lastTappedElementRef.current?.kind === "edge" &&
          lastTappedElementRef.current.id === selectedEdgeId);

      if (!matchesLastTap) {
        lastTappedElementRef.current = null;
      } else if (lastTappedElementRef.current) {
        lastTappedElementRef.current = {
          ...lastTappedElementRef.current,
          tapCount: 1,
        };
      }
    }

    if (isMobileLayout) {
      if (isNewSelection) {
        setIsPropertiesPanelOpen(false);
      }
    } else if (isNewSelection && !isNodeDragInProgressRef.current) {
      setIsPropertiesPanelOpen(true);
    }

    previousSelectedElementRef.current = selectedElementKey;
  }, [
    isMobileLayout,
    selectedEdgeId,
    selectedElementKey,
    selectedNodeId,
    setIsPropertiesPanelOpen,
    isNodeDragInProgressRef,
  ]);

  // Open panel on desktop when element is selected
  useEffect(() => {
    if (!isMobileLayout) {
      if (selectedElementKey) {
        setIsPropertiesPanelOpen(true);
      }
    }
  }, [isMobileLayout, selectedElementKey, setIsPropertiesPanelOpen]);

  // Focus close button when panel opens on mobile
  useEffect(() => {
    if (!isMobileLayout || !isPropertiesPanelOpen) {
      return;
    }
    propertiesPanelCloseButtonRef.current?.focus();
  }, [isMobileLayout, isPropertiesPanelOpen]);

  return {
    handleClosePropertiesPanel,
    handleOpenPropertiesPanel,
    propertiesPanelToggleRef,
    propertiesPanelCloseButtonRef,
    lastTappedElementRef,
    previousSelectedElementRef,
  };
};
