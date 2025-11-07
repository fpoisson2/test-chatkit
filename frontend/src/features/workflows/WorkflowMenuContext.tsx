import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import type { ActionMenuPlacement } from "./WorkflowActionMenu";

type WorkflowMenuContextType = {
  openWorkflowMenuId: string | number | null;
  workflowMenuPlacement: ActionMenuPlacement;
  workflowMenuTriggerRef: React.MutableRefObject<HTMLButtonElement | null>;
  workflowMenuRef: React.MutableRefObject<HTMLDivElement | null>;
  setOpenWorkflowMenuId: (id: string | number | null) => void;
  setWorkflowMenuPlacement: (placement: ActionMenuPlacement) => void;
  closeWorkflowMenu: () => void;
};

const WorkflowMenuContext = createContext<WorkflowMenuContextType | null>(null);

export const WorkflowMenuProvider = ({ children }: { children: ReactNode }) => {
  const [openWorkflowMenuId, setOpenWorkflowMenuId] = useState<string | number | null>(null);
  const [workflowMenuPlacement, setWorkflowMenuPlacement] = useState<ActionMenuPlacement>("down");
  const workflowMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workflowMenuRef = useRef<HTMLDivElement | null>(null);

  // Debug: Log when provider mounts/unmounts and when state changes
  useEffect(() => {
    console.log('[WorkflowMenuProvider] MOUNTED');
    return () => {
      console.log('[WorkflowMenuProvider] UNMOUNTED');
    };
  }, []);

  useEffect(() => {
    console.log('[WorkflowMenuProvider] openWorkflowMenuId changed to:', openWorkflowMenuId);
  }, [openWorkflowMenuId]);

  const closeWorkflowMenu = useCallback(() => {
    console.log('[WorkflowMenuContext] closeWorkflowMenu called, stack:', new Error().stack);
    setOpenWorkflowMenuId(null);
    setWorkflowMenuPlacement("down");
    workflowMenuTriggerRef.current = null;
    workflowMenuRef.current = null;
  }, []);

  return (
    <WorkflowMenuContext.Provider
      value={{
        openWorkflowMenuId,
        workflowMenuPlacement,
        workflowMenuTriggerRef,
        workflowMenuRef,
        setOpenWorkflowMenuId,
        setWorkflowMenuPlacement,
        closeWorkflowMenu,
      }}
    >
      {children}
    </WorkflowMenuContext.Provider>
  );
};

export const useWorkflowMenuContext = () => {
  const context = useContext(WorkflowMenuContext);
  if (!context) {
    throw new Error("useWorkflowMenuContext must be used within WorkflowMenuProvider");
  }
  return context;
};
