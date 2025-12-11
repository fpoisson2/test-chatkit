import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

// Context types
type ModalContextValue = {
  // Create Modal State
  isCreateModalOpen: boolean;
  createWorkflowKind: "local" | "hosted";
  createWorkflowName: string;
  createWorkflowRemoteId: string;
  createWorkflowError: string | null;
  isCreatingWorkflow: boolean;

  // Deploy Modal State
  isDeployModalOpen: boolean;
  deployToProduction: boolean;
  isDeploying: boolean;

  // Appearance Modal State
  isAppearanceModalOpen: boolean;

  // Generation Modal State
  isGenerationModalOpen: boolean;
  isGenerating: boolean;
  generationTaskId: string | null;
  generationError: string | null;

  // Create Modal Methods
  openCreateModal: (kind?: "local" | "hosted") => void;
  closeCreateModal: () => void;
  setCreateWorkflowKind: (kind: "local" | "hosted") => void;
  setCreateWorkflowName: (name: string) => void;
  setCreateWorkflowRemoteId: (id: string) => void;
  setCreateWorkflowError: (error: string | null) => void;
  setIsCreatingWorkflow: (creating: boolean) => void;

  // Deploy Modal Methods
  openDeployModal: (toProduction?: boolean) => void;
  closeDeployModal: () => void;
  setDeployToProduction: (toProduction: boolean) => void;
  setIsDeploying: (deploying: boolean) => void;

  // Appearance Modal Methods
  openAppearanceModal: () => void;
  closeAppearanceModal: () => void;

  // Generation Modal Methods
  openGenerationModal: () => void;
  closeGenerationModal: () => void;
  setIsGenerating: (generating: boolean) => void;
  setGenerationTaskId: (taskId: string | null) => void;
  setGenerationError: (error: string | null) => void;
};

const ModalContext = createContext<ModalContextValue | null>(null);

export const useModalContext = () => {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error("useModalContext must be used within ModalProvider");
  }
  return context;
};

type ModalProviderProps = {
  children: ReactNode;
};

export const ModalProvider = ({ children }: ModalProviderProps) => {
  // Create Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createWorkflowKind, setCreateWorkflowKind] = useState<"local" | "hosted">("local");
  const [createWorkflowName, setCreateWorkflowName] = useState("");
  const [createWorkflowRemoteId, setCreateWorkflowRemoteId] = useState("");
  const [createWorkflowError, setCreateWorkflowError] = useState<string | null>(null);
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false);

  // Deploy Modal State
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [deployToProduction, setDeployToProduction] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);

  // Appearance Modal State
  const [isAppearanceModalOpen, setIsAppearanceModalOpen] = useState(false);

  // Generation Modal State
  const [isGenerationModalOpen, setIsGenerationModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationTaskId, setGenerationTaskId] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Create Modal Methods
  const openCreateModal = useCallback((kind: "local" | "hosted" = "local") => {
    setCreateWorkflowKind(kind);
    setCreateWorkflowName("");
    setCreateWorkflowRemoteId("");
    setCreateWorkflowError(null);
    setIsCreateModalOpen(true);
  }, []);

  const closeCreateModal = useCallback(() => {
    setIsCreateModalOpen(false);
    setCreateWorkflowError(null);
  }, []);

  // Deploy Modal Methods
  const openDeployModal = useCallback((toProduction: boolean = false) => {
    setDeployToProduction(toProduction);
    setIsDeployModalOpen(true);
  }, []);

  const closeDeployModal = useCallback(() => {
    setIsDeployModalOpen(false);
    setDeployToProduction(false);
  }, []);

  // Appearance Modal Methods
  const openAppearanceModal = useCallback(() => {
    setIsAppearanceModalOpen(true);
  }, []);

  const closeAppearanceModal = useCallback(() => {
    setIsAppearanceModalOpen(false);
  }, []);

  // Generation Modal Methods
  const openGenerationModal = useCallback(() => {
    setGenerationError(null);
    setGenerationTaskId(null);
    setIsGenerationModalOpen(true);
  }, []);

  const closeGenerationModal = useCallback(() => {
    setIsGenerationModalOpen(false);
    setGenerationError(null);
    setGenerationTaskId(null);
    setIsGenerating(false);
  }, []);

  const value = useMemo<ModalContextValue>(
    () => ({
      // Create Modal State
      isCreateModalOpen,
      createWorkflowKind,
      createWorkflowName,
      createWorkflowRemoteId,
      createWorkflowError,
      isCreatingWorkflow,

      // Deploy Modal State
      isDeployModalOpen,
      deployToProduction,
      isDeploying,

      // Appearance Modal State
      isAppearanceModalOpen,

      // Generation Modal State
      isGenerationModalOpen,
      isGenerating,
      generationTaskId,
      generationError,

      // Create Modal Methods
      openCreateModal,
      closeCreateModal,
      setCreateWorkflowKind,
      setCreateWorkflowName,
      setCreateWorkflowRemoteId,
      setCreateWorkflowError,
      setIsCreatingWorkflow,

      // Deploy Modal Methods
      openDeployModal,
      closeDeployModal,
      setDeployToProduction,
      setIsDeploying,

      // Appearance Modal Methods
      openAppearanceModal,
      closeAppearanceModal,

      // Generation Modal Methods
      openGenerationModal,
      closeGenerationModal,
      setIsGenerating,
      setGenerationTaskId,
      setGenerationError,
    }),
    [
      isCreateModalOpen,
      createWorkflowKind,
      createWorkflowName,
      createWorkflowRemoteId,
      createWorkflowError,
      isCreatingWorkflow,
      isDeployModalOpen,
      deployToProduction,
      isDeploying,
      isAppearanceModalOpen,
      isGenerationModalOpen,
      isGenerating,
      generationTaskId,
      generationError,
      openCreateModal,
      closeCreateModal,
      openDeployModal,
      closeDeployModal,
      openAppearanceModal,
      closeAppearanceModal,
      openGenerationModal,
      closeGenerationModal,
    ],
  );

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
};
