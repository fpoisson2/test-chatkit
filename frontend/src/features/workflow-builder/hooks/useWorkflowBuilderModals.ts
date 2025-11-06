import { useCallback, useState, useRef } from "react";
import type { WorkflowAppearanceTarget } from "../../workflows/WorkflowAppearanceModal";

interface UseWorkflowBuilderModalsProps {
  closeWorkflowMenu: () => void;
  isCreatingWorkflow: boolean;
  isDeploying: boolean;
}

interface UseWorkflowBuilderModalsReturn {
  // Appearance Modal
  isAppearanceModalOpen: boolean;
  appearanceModalTarget: WorkflowAppearanceTarget | null;
  appearanceModalTriggerRef: React.MutableRefObject<HTMLButtonElement | null>;
  handleCloseAppearanceModal: () => void;
  openAppearanceModal: (target: WorkflowAppearanceTarget, trigger?: HTMLButtonElement | null) => void;
  setAppearanceModalTarget: React.Dispatch<React.SetStateAction<WorkflowAppearanceTarget | null>>;

  // Create Modal
  isCreateModalOpen: boolean;
  handleOpenCreateModal: () => void;
  handleCloseCreateModal: () => void;
  setCreateModalOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Deploy Modal
  isDeployModalOpen: boolean;
  handleOpenDeployModal: () => void;
  handleCloseDeployModal: () => void;
  setDeployModalOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Mobile Actions
  isMobileActionsOpen: boolean;
  toggleMobileActions: () => void;
  closeMobileActions: (options?: { focusTrigger?: boolean }) => void;
  mobileActionsTriggerRef: React.MutableRefObject<HTMLButtonElement | null>;
  mobileActionsMenuRef: React.MutableRefObject<HTMLDivElement | null>;
  setIsMobileActionsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useWorkflowBuilderModals({
  closeWorkflowMenu,
  isCreatingWorkflow,
  isDeploying,
}: UseWorkflowBuilderModalsProps): UseWorkflowBuilderModalsReturn {
  // Appearance Modal State
  const [isAppearanceModalOpen, setAppearanceModalOpen] = useState(false);
  const [appearanceModalTarget, setAppearanceModalTarget] = useState<WorkflowAppearanceTarget | null>(null);
  const appearanceModalTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Create Modal State
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);

  // Deploy Modal State
  const [isDeployModalOpen, setDeployModalOpen] = useState(false);

  // Mobile Actions State
  const [isMobileActionsOpen, setIsMobileActionsOpen] = useState(false);
  const mobileActionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileActionsMenuRef = useRef<HTMLDivElement | null>(null);

  // Appearance Modal Handlers
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

  // Create Modal Handlers
  const handleOpenCreateModal = useCallback(() => {
    setCreateModalOpen(true);
  }, []);

  const handleCloseCreateModal = useCallback(() => {
    if (isCreatingWorkflow) {
      return;
    }
    setCreateModalOpen(false);
  }, [isCreatingWorkflow]);

  // Deploy Modal Handlers
  const handleOpenDeployModal = useCallback(() => {
    setDeployModalOpen(true);
  }, []);

  const handleCloseDeployModal = useCallback(() => {
    if (isDeploying) {
      return;
    }
    setDeployModalOpen(false);
  }, [isDeploying]);

  // Mobile Actions Handlers
  const toggleMobileActions = useCallback(() => {
    setIsMobileActionsOpen((previous) => !previous);
  }, []);

  const closeMobileActions = useCallback(
    (options: { focusTrigger?: boolean } = {}) => {
      setIsMobileActionsOpen(false);
      if (options.focusTrigger && mobileActionsTriggerRef.current) {
        mobileActionsTriggerRef.current.focus();
      }
    },
    [],
  );

  return {
    // Appearance Modal
    isAppearanceModalOpen,
    appearanceModalTarget,
    appearanceModalTriggerRef,
    handleCloseAppearanceModal,
    openAppearanceModal,
    setAppearanceModalTarget,

    // Create Modal
    isCreateModalOpen,
    handleOpenCreateModal,
    handleCloseCreateModal,
    setCreateModalOpen,

    // Deploy Modal
    isDeployModalOpen,
    handleOpenDeployModal,
    handleCloseDeployModal,
    setDeployModalOpen,

    // Mobile Actions
    isMobileActionsOpen,
    toggleMobileActions,
    closeMobileActions,
    mobileActionsTriggerRef,
    mobileActionsMenuRef,
    setIsMobileActionsOpen,
  };
}
