import { useCallback, useState, useRef } from "react";
import type { WorkflowAppearanceTarget } from "../../workflows/WorkflowAppearanceModal";
import { useModalContext } from "../contexts/ModalContext";

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

  // Deploy Modal
  isDeployModalOpen: boolean;
  handleOpenDeployModal: () => void;
  handleCloseDeployModal: () => void;

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
  const {
    // Appearance Modal
    isAppearanceModalOpen,
    openAppearanceModal: openAppearanceModalFromContext,
    closeAppearanceModal: closeAppearanceModalFromContext,

    // Create Modal
    isCreateModalOpen,
    openCreateModal,
    closeCreateModal,

    // Deploy Modal
    isDeployModalOpen,
    openDeployModal,
    closeDeployModal,
  } = useModalContext();

  // Appearance Modal State
  const [appearanceModalTarget, setAppearanceModalTarget] = useState<WorkflowAppearanceTarget | null>(null);
  const appearanceModalTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Mobile Actions State
  const [isMobileActionsOpen, setIsMobileActionsOpen] = useState(false);
  const mobileActionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileActionsMenuRef = useRef<HTMLDivElement | null>(null);

  // Appearance Modal Handlers
  const handleCloseAppearanceModal = useCallback(() => {
    closeAppearanceModalFromContext();
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
  }, [closeAppearanceModalFromContext]);

  const openAppearanceModal = useCallback(
    (target: WorkflowAppearanceTarget, trigger?: HTMLButtonElement | null) => {
      closeWorkflowMenu();
      setAppearanceModalTarget(target);
      openAppearanceModalFromContext();
      appearanceModalTriggerRef.current = trigger ?? null;
    },
    [closeWorkflowMenu, openAppearanceModalFromContext],
  );

  // Create Modal Handlers
  const handleOpenCreateModal = useCallback(() => {
    openCreateModal();
  }, [openCreateModal]);

  const handleCloseCreateModal = useCallback(() => {
    if (isCreatingWorkflow) {
      return;
    }
    closeCreateModal();
  }, [closeCreateModal, isCreatingWorkflow]);

  // Deploy Modal Handlers
  const handleOpenDeployModal = useCallback(() => {
    openDeployModal();
  }, [openDeployModal]);

  const handleCloseDeployModal = useCallback(() => {
    if (isDeploying) {
      return;
    }
    closeDeployModal();
  }, [closeDeployModal, isDeploying]);

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

    // Deploy Modal
    isDeployModalOpen,
    handleOpenDeployModal,
    handleCloseDeployModal,

    // Mobile Actions
    isMobileActionsOpen,
    toggleMobileActions,
    closeMobileActions,
    mobileActionsTriggerRef,
    mobileActionsMenuRef,
    setIsMobileActionsOpen,
  };
}
