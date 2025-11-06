import { useCallback, useRef, useState } from "react";
import type { WorkflowAppearanceTarget } from "../../workflows/WorkflowAppearanceModal";
import type { ActionMenuPlacement } from "../styles";

interface UseModalStateReturn {
  // Appearance Modal
  isAppearanceModalOpen: boolean;
  appearanceModalTarget: WorkflowAppearanceTarget | null;
  appearanceModalTriggerRef: React.MutableRefObject<HTMLButtonElement | null>;
  setAppearanceModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setAppearanceModalTarget: React.Dispatch<React.SetStateAction<WorkflowAppearanceTarget | null>>;
  handleCloseAppearanceModal: () => void;
  openAppearanceModal: (target: WorkflowAppearanceTarget, trigger?: HTMLButtonElement | null) => void;

  // Deploy Modal
  isDeployModalOpen: boolean;
  deployToProduction: boolean;
  isDeploying: boolean;
  setDeployModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDeployToProduction: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDeploying: React.Dispatch<React.SetStateAction<boolean>>;

  // Create Workflow Modal
  isCreateModalOpen: boolean;
  createWorkflowKind: "local" | "hosted";
  createWorkflowName: string;
  createWorkflowRemoteId: string;
  createWorkflowError: string | null;
  isCreatingWorkflow: boolean;
  setCreateModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCreateWorkflowKind: React.Dispatch<React.SetStateAction<"local" | "hosted">>;
  setCreateWorkflowName: React.Dispatch<React.SetStateAction<string>>;
  setCreateWorkflowRemoteId: React.Dispatch<React.SetStateAction<string>>;
  setCreateWorkflowError: React.Dispatch<React.SetStateAction<string | null>>;
  setIsCreatingWorkflow: React.Dispatch<React.SetStateAction<boolean>>;

  // Workflow Menu
  openWorkflowMenuId: string | number | null;
  workflowMenuPlacement: ActionMenuPlacement;
  setOpenWorkflowMenuId: React.Dispatch<React.SetStateAction<string | number | null>>;
  setWorkflowMenuPlacement: React.Dispatch<React.SetStateAction<ActionMenuPlacement>>;
  closeWorkflowMenu: () => void;

  // Import/Export/Mobile states
  isExporting: boolean;
  isImporting: boolean;
  isMobileActionsOpen: boolean;
  setIsExporting: React.Dispatch<React.SetStateAction<boolean>>;
  setIsImporting: React.Dispatch<React.SetStateAction<boolean>>;
  setIsMobileActionsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Hook to manage all modal and menu states in the workflow builder.
 */
export const useModalState = (
  closeWorkflowMenuCallback?: () => void,
): UseModalStateReturn => {
  // Appearance Modal
  const [isAppearanceModalOpen, setAppearanceModalOpen] = useState(false);
  const [appearanceModalTarget, setAppearanceModalTarget] =
    useState<WorkflowAppearanceTarget | null>(null);
  const appearanceModalTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Deploy Modal
  const [isDeployModalOpen, setDeployModalOpen] = useState(false);
  const [deployToProduction, setDeployToProduction] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);

  // Create Workflow Modal
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  const [createWorkflowKind, setCreateWorkflowKind] = useState<"local" | "hosted">("local");
  const [createWorkflowName, setCreateWorkflowName] = useState("");
  const [createWorkflowRemoteId, setCreateWorkflowRemoteId] = useState("");
  const [createWorkflowError, setCreateWorkflowError] = useState<string | null>(null);
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false);

  // Workflow Menu
  const [openWorkflowMenuId, setOpenWorkflowMenuId] = useState<string | number | null>(null);
  const [workflowMenuPlacement, setWorkflowMenuPlacement] =
    useState<ActionMenuPlacement>("up");

  // Import/Export/Mobile
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isMobileActionsOpen, setIsMobileActionsOpen] = useState(false);

  const closeWorkflowMenu = useCallback(() => {
    setOpenWorkflowMenuId(null);
    setWorkflowMenuPlacement("up");
    closeWorkflowMenuCallback?.();
  }, [closeWorkflowMenuCallback]);

  const handleCloseAppearanceModal = useCallback(() => {
    setAppearanceModalOpen(false);
    setAppearanceModalTarget(null);
    const trigger = appearanceModalTriggerRef.current;
    appearanceModalTriggerRef.current = null;
    if (trigger) {
      if (
        typeof window !== "undefined" &&
        typeof window.requestAnimationFrame === "function"
      ) {
        window.requestAnimationFrame(() => {
          trigger.focus();
        });
      } else {
        trigger.focus();
      }
    }
  }, []);

  const openAppearanceModal = useCallback(
    (target: WorkflowAppearanceTarget, trigger?: HTMLButtonElement | null) => {
      closeWorkflowMenu();
      setAppearanceModalTarget(target);
      setAppearanceModalOpen(true);
      appearanceModalTriggerRef.current = trigger ?? null;
    },
    [closeWorkflowMenu],
  );

  return {
    isAppearanceModalOpen,
    appearanceModalTarget,
    appearanceModalTriggerRef,
    setAppearanceModalOpen,
    setAppearanceModalTarget,
    handleCloseAppearanceModal,
    openAppearanceModal,
    isDeployModalOpen,
    deployToProduction,
    isDeploying,
    setDeployModalOpen,
    setDeployToProduction,
    setIsDeploying,
    isCreateModalOpen,
    createWorkflowKind,
    createWorkflowName,
    createWorkflowRemoteId,
    createWorkflowError,
    isCreatingWorkflow,
    setCreateModalOpen,
    setCreateWorkflowKind,
    setCreateWorkflowName,
    setCreateWorkflowRemoteId,
    setCreateWorkflowError,
    setIsCreatingWorkflow,
    openWorkflowMenuId,
    workflowMenuPlacement,
    setOpenWorkflowMenuId,
    setWorkflowMenuPlacement,
    closeWorkflowMenu,
    isExporting,
    isImporting,
    isMobileActionsOpen,
    setIsExporting,
    setIsImporting,
    setIsMobileActionsOpen,
  };
};
