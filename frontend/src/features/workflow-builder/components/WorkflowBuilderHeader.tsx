import type { ChangeEvent, MutableRefObject } from "react";
import { useI18n } from "../../../i18n";
import {
  useWorkflowContext,
  useUIContext,
  useModalContext,
} from "../contexts";
import WorkflowBuilderHeaderControls from "./WorkflowBuilderHeaderControls";
import type { WorkflowSummary } from "../types";

interface WorkflowBuilderHeaderProps {
  // Workflow data
  selectedWorkflow: WorkflowSummary | null;

  // Refs nécessaires (ne peuvent pas être dans les contextes)
  importFileInputRef: MutableRefObject<HTMLInputElement | null>;
  mobileActionsTriggerRef: MutableRefObject<HTMLButtonElement | null>;
  mobileActionsMenuRef: MutableRefObject<HTMLDivElement | null>;

  // Handlers qui nécessitent de la logique dans WorkflowBuilderPage
  onVersionChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onImportFileChange: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onTriggerImport: () => void;
  onExportWorkflow: () => void | Promise<void>;
  onOpenDeployModal: () => void;
  onOpenGenerationModal: () => void;
  onOpenGitHubModal: () => void;

  // Render props pour description et publication reminder
  renderWorkflowDescription: (className?: string) => React.ReactNode;
  renderWorkflowPublicationReminder: (className?: string) => React.ReactNode;

  // Modal management
  isMobileActionsOpen: boolean;
  onToggleMobileActions: () => void;
  closeMobileActions: (options?: { focusTrigger?: boolean }) => void;
}

/**
 * WorkflowBuilderHeader - Header component for the workflow builder
 *
 * Utilise les contextes pour accéder aux données nécessaires:
 * - WorkflowContext: versions, selectedVersionId, draftVersionId, loading
 * - UIContext: isMobileLayout, isExporting, isImporting
 * - ModalContext: isDeploying
 *
 * Réduit le nombre de props de ~50 à ~13 en utilisant les contextes.
 */
export default function WorkflowBuilderHeader({
  selectedWorkflow,
  importFileInputRef,
  mobileActionsTriggerRef,
  mobileActionsMenuRef,
  onVersionChange,
  onImportFileChange,
  onTriggerImport,
  onExportWorkflow,
  onOpenDeployModal,
  onOpenGenerationModal,
  onOpenGitHubModal,
  renderWorkflowDescription,
  renderWorkflowPublicationReminder,
  isMobileActionsOpen,
  onToggleMobileActions,
  closeMobileActions,
}: WorkflowBuilderHeaderProps) {
  const { t } = useI18n();

  // Contextes
  const {
    versions,
    selectedVersionId,
    draftVersionId,
    loading,
  } = useWorkflowContext();

  const {
    isMobileLayout,
    isExporting,
    isImporting,
  } = useUIContext();

  const {
    isDeploying,
    isGenerating,
  } = useModalContext();

  // selectedWorkflowId vient de selectedWorkflow
  const selectedWorkflowId = selectedWorkflow?.id ?? null;

  // Calcul des états disabled
  const importDisabled = loading || isImporting;
  const exportDisabled =
    loading || !selectedWorkflowId || !selectedVersionId || isExporting;
  const deployDisabled =
    loading || !selectedWorkflowId || versions.length === 0 || isDeploying;
  const generateDisabled =
    loading || !selectedWorkflowId || !selectedVersionId || isGenerating;
  const githubDisabled =
    loading || !selectedWorkflowId || !selectedVersionId;

  // Labels dynamiques
  const importLabel = isImporting
    ? t("workflowBuilder.import.inProgress")
    : t("workflowBuilder.actions.importJson");

  const exportLabel = isExporting
    ? t("workflowBuilder.export.preparing")
    : t("workflowBuilder.actions.exportJson");

  // IDs pour accessibilité
  const mobileActionsDialogId = "mobile-actions-menu";
  const mobileActionsTitleId = "mobile-actions-title";

  // Draft display name
  const draftDisplayName = t("workflowBuilder.save.draftDisplayName");

  // Workflow description et publication reminder
  const showWorkflowDescription = false;
  const showWorkflowPublicationReminder = Boolean(
    selectedWorkflow && !selectedWorkflow.active_version_id,
  );

  return (
    <WorkflowBuilderHeaderControls
      isMobileLayout={isMobileLayout}
      loading={loading}
      versions={versions}
      selectedVersionId={selectedVersionId}
      draftVersionId={draftVersionId}
      draftDisplayName={draftDisplayName}
      importDisabled={importDisabled}
      exportDisabled={exportDisabled}
      deployDisabled={deployDisabled}
      generateDisabled={generateDisabled}
      githubDisabled={githubDisabled}
      importLabel={importLabel}
      exportLabel={exportLabel}
      onVersionChange={onVersionChange}
      importFileInputRef={importFileInputRef}
      onImportFileChange={onImportFileChange}
      onTriggerImport={onTriggerImport}
      onExportWorkflow={onExportWorkflow}
      onOpenDeployModal={onOpenDeployModal}
      onOpenGenerationModal={onOpenGenerationModal}
      onOpenGitHubModal={onOpenGitHubModal}
      mobileActionsTriggerRef={mobileActionsTriggerRef}
      mobileActionsMenuRef={mobileActionsMenuRef}
      isMobileActionsOpen={isMobileActionsOpen}
      onToggleMobileActions={onToggleMobileActions}
      closeMobileActions={closeMobileActions}
      mobileActionsDialogId={mobileActionsDialogId}
      mobileActionsTitleId={mobileActionsTitleId}
      mobileActionsOpenLabel={t("workflowBuilder.mobileActions.open")}
      mobileActionsTitle={t("workflowBuilder.mobileActions.title")}
      renderWorkflowDescription={renderWorkflowDescription}
      renderWorkflowPublicationReminder={renderWorkflowPublicationReminder}
      showWorkflowDescription={showWorkflowDescription}
      showWorkflowPublicationReminder={showWorkflowPublicationReminder}
      isImporting={isImporting}
      isExporting={isExporting}
    />
  );
}
