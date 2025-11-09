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
import { makeApiEndpointCandidates } from "../../../utils/backend";
import { backendUrl } from "../WorkflowBuilderUtils";
import type { WorkflowVersionResponse } from "../types";
import { useSaveContext } from "../contexts/SaveContext";
import { useModalContext } from "../contexts/ModalContext";
import { useGraphContext } from "../contexts/GraphContext";
import { useWorkflowContext } from "../contexts/WorkflowContext";

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
  const { hasPendingChanges, updateHasPendingChanges } = useGraphContext();
  const {
    selectedWorkflowId,
    setSelectedVersionId,
    draftVersionIdRef,
    draftVersionSummaryRef,
  } = useWorkflowContext();

  /**
   * Deploy version to production or published status
   * Extracted from WorkflowBuilderPage.tsx lines 2412-2516 (~105 lines)
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

    // Save pending changes before deployment
    if (hasPendingChanges) {
      await handleSave();

      if (hasPendingChanges) {
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
    }

    const graphPayload = buildGraphPayload();
    const graphSnapshot = JSON.stringify(graphPayload);

    setSaveState("saving");
    setSaveMessage(t("workflowBuilder.deploy.promoting"));

    const promoteCandidates = makeApiEndpointCandidates(
      backendUrl,
      `/api/workflows/${selectedWorkflowId}/production`,
    );

    let lastError: Error | null = null;

    for (const url of promoteCandidates) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({ version_id: versionIdToPromote }),
        });

        if (!response.ok) {
          throw new Error(
            t("workflowBuilder.deploy.promoteFailedWithStatus", { status: response.status }),
          );
        }

        const promoted: WorkflowVersionResponse = await response.json();

        // Clear draft refs if we promoted the draft
        if (draftVersionIdRef.current === versionIdToPromote) {
          draftVersionIdRef.current = null;
          draftVersionSummaryRef.current = null;
        }

        setSelectedVersionId(promoted.id);

        // Reload versions and workflows
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
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError =
          error instanceof Error
            ? error
            : new Error(t("workflowBuilder.deploy.promoteError"));
      }
    }

    // All attempts failed
    setIsDeploying(false);
    setSaveState("error");
    setSaveMessage(lastError?.message ?? t("workflowBuilder.deploy.publishError"));
  }, [
    selectedWorkflowId,
    resolveVersionIdToPromote,
    setSaveState,
    setSaveMessage,
    t,
    setIsDeploying,
    hasPendingChanges,
    handleSave,
    buildGraphPayload,
    authHeader,
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
