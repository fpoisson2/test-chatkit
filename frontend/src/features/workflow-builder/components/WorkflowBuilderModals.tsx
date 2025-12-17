import { useModalContext } from "../contexts";
import { useAuth } from "../../../auth";
import { useI18n } from "../../../i18n";
import CreateWorkflowModal from "./CreateWorkflowModal";
import DeployWorkflowModal from "./DeployWorkflowModal";
import GitHubPushModal from "./GitHubPushModal";
import WorkflowAppearanceModal from "../../workflows/WorkflowAppearanceModal";
import WorkflowGenerationModal from "./WorkflowGenerationModal";
import type { WorkflowSummary } from "../types";

/**
 * Props for modals that require external handlers
 * These will eventually be moved to contexts/hooks
 */
interface WorkflowBuilderModalsProps {
  // CreateWorkflow handlers
  onSubmitCreateWorkflow: () => Promise<void>;

  // Deploy handlers
  onConfirmDeploy: () => Promise<void>;
  deployModalTitle: string;
  deployModalDescription: string;
  deployModalSourceLabel: string;
  deployModalTargetLabel: string;
  deployModalPrimaryLabel: string;
  isPrimaryActionDisabled: boolean;
  shouldShowVersionPath: boolean;

  // Appearance modal
  appearanceModalTarget: "local" | "hosted" | null;
  onCloseAppearanceModal: () => void;

  // GitHub Push modal
  selectedWorkflow: WorkflowSummary | null;
  isGitHubModalOpen: boolean;
  onCloseGitHubModal: () => void;
}

/**
 * WorkflowBuilderModals manages all modals for the workflow builder
 * Uses ModalContext for state management
 */
export default function WorkflowBuilderModals({
  onSubmitCreateWorkflow,
  onConfirmDeploy,
  deployModalTitle,
  deployModalDescription,
  deployModalSourceLabel,
  deployModalTargetLabel,
  deployModalPrimaryLabel,
  isPrimaryActionDisabled,
  shouldShowVersionPath,
  appearanceModalTarget,
  onCloseAppearanceModal,
  selectedWorkflow,
  isGitHubModalOpen,
  onCloseGitHubModal,
}: WorkflowBuilderModalsProps) {
  const { token } = useAuth();
  const { t } = useI18n();

  const {
    // Create Modal
    isCreateModalOpen,
    createWorkflowKind,
    createWorkflowName,
    createWorkflowRemoteId,
    createWorkflowError,
    isCreatingWorkflow,
    closeCreateModal,
    setCreateWorkflowKind,
    setCreateWorkflowName,
    setCreateWorkflowRemoteId,

    // Deploy Modal
    isDeployModalOpen,
    isDeploying,
    deployToProduction,
    setDeployToProduction,
    closeDeployModal,

    // Appearance Modal
    isAppearanceModalOpen,
  } = useModalContext();

  return (
    <>
      <WorkflowAppearanceModal
        token={token ?? null}
        isOpen={isAppearanceModalOpen}
        target={appearanceModalTarget}
        onClose={onCloseAppearanceModal}
      />

      <CreateWorkflowModal
        isOpen={isCreateModalOpen}
        kind={createWorkflowKind}
        name={createWorkflowName}
        remoteId={createWorkflowRemoteId}
        error={createWorkflowError}
        isSubmitting={isCreatingWorkflow}
        onClose={closeCreateModal}
        onSubmit={onSubmitCreateWorkflow}
        onKindChange={setCreateWorkflowKind}
        onNameChange={setCreateWorkflowName}
        onRemoteIdChange={setCreateWorkflowRemoteId}
      />

      <DeployWorkflowModal
        isOpen={isDeployModalOpen}
        isDeploying={isDeploying}
        deployToProduction={deployToProduction}
        setDeployToProduction={setDeployToProduction}
        onClose={closeDeployModal}
        onConfirm={onConfirmDeploy}
        title={deployModalTitle}
        description={deployModalDescription}
        shouldShowVersionPath={shouldShowVersionPath}
        sourceLabel={deployModalSourceLabel}
        targetLabel={deployModalTargetLabel}
        productionToggleLabel={t("workflowBuilder.deploy.modal.productionToggle")}
        cancelLabel={t("workflowBuilder.deploy.modal.action.cancel")}
        primaryActionLabel={deployModalPrimaryLabel}
        isPrimaryActionDisabled={isPrimaryActionDisabled}
      />

      <WorkflowGenerationModal />

      <GitHubPushModal
        isOpen={isGitHubModalOpen}
        onClose={onCloseGitHubModal}
        workflow={selectedWorkflow}
      />
    </>
  );
}
