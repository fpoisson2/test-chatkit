/**
 * useWorkflowDeployment
 *
 * Phase 6: Complex function extraction
 *
 * Hook for deploying workflow versions to production.
 * Handles deployment flow, auto-save before deploy, and state management.
 *
 * Responsibilities:
 * - Resolve which version to promote
 * - Save pending changes before deployment
 * - Deploy version to production/published
 * - Update local state after deployment
 * - Handle loading/error states
 *
 * This hook encapsulates ~105 lines of complex logic from WorkflowBuilderPage
 * (handleConfirmDeploy function)
 */

import { useCallback } from "react";
import type { WorkflowVersionResponse } from "../types";
import { useSaveContext } from "../contexts/SaveContext";
import { useModalContext } from "../contexts/ModalContext";
import { useGraphContext } from "../contexts/GraphContext";
import { useWorkflowContext } from "../contexts/WorkflowContext";
import { useDeployToProduction } from "../../../hooks/useWorkflows";

type TranslationFunction = (key: string, params?: Record<string, unknown>) => string;

type LoadVersionsFn = (
  workflowId: number,
  preferredVersionId: number | null,
  options?: { preserveViewport?: boolean; background?: boolean },
) => Promise<boolean>;

type LoadWorkflowsFn = (options?: {
  selectWorkflowId?: number | null;
  selectVersionId?: number | null;
  excludeWorkflowId?: number | null;
  suppressLoadingState?: boolean;
}) => Promise<void>;

type UseWorkflowDeploymentParams = {
  authHeader: Record<string, string>;
  token: string | null;
  t: TranslationFunction;
  handleSave: () => Promise<void>;
  buildGraphPayload: () => WorkflowVersionResponse["graph"];
  loadVersions: LoadVersionsFn;
  loadWorkflows: LoadWorkflowsFn;
  resolveVersionIdToPromote: (
    preferDraft?: boolean,
    options?: { selectedId?: number | null },
  ) => number | null;
};

type UseWorkflowDeploymentReturn = {
  handleConfirmDeploy: () => Promise<void>;
};

/**
 * Hook for deploying workflow versions to production
 *
 * @example
 * ```typescript
 * const { handleConfirmDeploy } = useWorkflowDeployment({
 *   authHeader,
 *   t,
 *   handleSave,
 *   buildGraphPayload,
 *   loadVersions,
 *   loadWorkflows,
 *   resolveVersionIdToPromote,
 * });
 *
 * // Deploy the current/draft version
 * await handleConfirmDeploy();
 * ```
 */
export function useWorkflowDeployment(
  params: UseWorkflowDeploymentParams,
): UseWorkflowDeploymentReturn {
  const {
    authHeader,
    token,
    t,
    handleSave,
    buildGraphPayload,
    loadVersions,
    loadWorkflows,
    resolveVersionIdToPromote,
  } = params;

  // Access contexts
  const { setSaveState, setSaveMessage, lastSavedSnapshotRef } = useSaveContext();
  const { deployToProduction, setIsDeploying, closeDeployModal } = useModalContext();
  const { hasPendingChangesRef, updateHasPendingChanges } = useGraphContext();
  const {
    selectedWorkflowId,
    setSelectedVersionId,
    draftVersionIdRef,
    draftVersionSummaryRef,
  } = useWorkflowContext();

  // React Query mutation
  const deployToProductionMutation = useDeployToProduction();

  /**
   * Deploy version to production or published status
   * Migrated to use React Query mutation with optimistic updates
   */
  const handleConfirmDeploy = useCallback(async () => {
    if (!selectedWorkflowId) {
      return;
    }

    let versionIdToPromote = resolveVersionIdToPromote();
    if (!versionIdToPromote) {
      setSaveState("error");
      setSaveMessage(t("workflowBuilder.deploy.missingTarget"));
      return;
    }

    setIsDeploying(true);

    // Always save before deployment to ensure latest changes are persisted
    await handleSave();

    // Check if save succeeded using ref (avoids stale closure)
    if (hasPendingChangesRef.current) {
      setIsDeploying(false);
      setSaveState("error");
      setSaveMessage(t("workflowBuilder.deploy.pendingChangesError"));
      return;
    }

    // Re-resolve version ID after save (draft may have changed)
    versionIdToPromote = resolveVersionIdToPromote(true) ?? versionIdToPromote;
    if (!versionIdToPromote) {
      setIsDeploying(false);
      setSaveState("error");
      setSaveMessage(t("workflowBuilder.deploy.missingTarget"));
      return;
    }

    const graphPayload = buildGraphPayload();
    const graphSnapshot = JSON.stringify(graphPayload);

    setSaveState("saving");
    setSaveMessage(t("workflowBuilder.deploy.promoting"));

    try {
      // Use React Query mutation for deployment
      const promoted = await deployToProductionMutation.mutateAsync({
        token,
        workflowId: selectedWorkflowId,
        versionId: versionIdToPromote,
      });

      // Clear draft refs if we promoted the draft
      if (draftVersionIdRef.current === versionIdToPromote) {
        draftVersionIdRef.current = null;
        draftVersionSummaryRef.current = null;
      }

      setSelectedVersionId(promoted.id);

      // Reload versions and workflows (React Query handles cache invalidation)
      await loadVersions(selectedWorkflowId, promoted.id);
      await loadWorkflows({ selectWorkflowId: selectedWorkflowId, selectVersionId: promoted.id });

      lastSavedSnapshotRef.current = graphSnapshot;
      updateHasPendingChanges(false);

      setSaveState("saved");
      setSaveMessage(
        deployToProduction
          ? t("workflowBuilder.deploy.successProduction")
          : t("workflowBuilder.deploy.successPublished"),
      );

      setTimeout(() => setSaveState("idle"), 1500);
      closeDeployModal();
      setIsDeploying(false);
    } catch (error) {
      // Handle deployment error
      const errorMessage =
        error instanceof Error
          ? error.message
          : t("workflowBuilder.deploy.publishError");

      setIsDeploying(false);
      setSaveState("error");
      setSaveMessage(errorMessage);
    }
  }, [
    token,
    selectedWorkflowId,
    resolveVersionIdToPromote,
    setSaveState,
    setSaveMessage,
    t,
    setIsDeploying,
    hasPendingChangesRef,
    handleSave,
    buildGraphPayload,
    deployToProductionMutation,
    draftVersionIdRef,
    draftVersionSummaryRef,
    setSelectedVersionId,
    loadVersions,
    loadWorkflows,
    lastSavedSnapshotRef,
    updateHasPendingChanges,
    deployToProduction,
    closeDeployModal,
  ]);

  return {
    handleConfirmDeploy,
  };
}
