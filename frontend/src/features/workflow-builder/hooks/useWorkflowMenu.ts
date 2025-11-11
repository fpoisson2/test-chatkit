import { useCallback, useRef, useState, type MutableRefObject } from "react";
import type { ActionMenuPlacement } from "../styles";

export interface UseWorkflowMenuReturn {
  workflowMenuPlacement: ActionMenuPlacement;
  setWorkflowMenuPlacement: (placement: ActionMenuPlacement) => void;
  workflowMenuTriggerRef: MutableRefObject<HTMLButtonElement | null>;
  workflowMenuRef: MutableRefObject<HTMLDivElement | null>;
  closeWorkflowMenu: () => void;
}

/**
 * Hook for managing workflow menu state and refs
 */
export const useWorkflowMenu = (
  setOpenWorkflowMenuId: (id: number | null) => void,
): UseWorkflowMenuReturn => {
  const [workflowMenuPlacement, setWorkflowMenuPlacement] =
    useState<ActionMenuPlacement>("up");
  const workflowMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workflowMenuRef = useRef<HTMLDivElement | null>(null);

  const closeWorkflowMenu = useCallback(() => {
    setOpenWorkflowMenuId(null);
    setWorkflowMenuPlacement("up");
    workflowMenuTriggerRef.current = null;
    workflowMenuRef.current = null;
  }, [setOpenWorkflowMenuId]);

  return {
    workflowMenuPlacement,
    setWorkflowMenuPlacement,
    workflowMenuTriggerRef,
    workflowMenuRef,
    closeWorkflowMenu,
  };
};
