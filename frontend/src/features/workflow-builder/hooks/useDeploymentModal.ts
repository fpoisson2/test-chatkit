import { useCallback, useMemo, type MutableRefObject } from "react";
import type { WorkflowVersionSummary } from "../types";

export interface UseDeploymentModalParams {
  selectedVersionId: number | null;
  selectedVersionIdRef: MutableRefObject<number | null>;
  draftVersionIdRef: MutableRefObject<number | null>;
  versions: WorkflowVersionSummary[];
  isDeploying: boolean;
  t: (key: string, params?: Record<string, unknown>) => string;
}

export interface UseDeploymentModalReturn {
  resolveVersionIdToPromote: (
    preferDraft?: boolean,
    options?: { selectedId?: number | null }
  ) => number | null;
  versionIdToPromote: number | null;
  versionSummaryForPromotion: WorkflowVersionSummary | null;
  isPromotingDraft: boolean;
  deployModalTitle: string;
  deployModalDescription: string;
  deployModalSourceLabel: string;
  deployModalTargetLabel: string;
  deployModalPrimaryLabel: string;
  isPrimaryActionDisabled: boolean;
}

/**
 * Hook for managing deployment modal logic and labels
 */
export const useDeploymentModal = ({
  selectedVersionId,
  selectedVersionIdRef,
  draftVersionIdRef,
  versions,
  isDeploying,
  t,
}: UseDeploymentModalParams): UseDeploymentModalReturn => {
  const resolveVersionIdToPromote = useCallback(
    (
      preferDraft = false,
      options: { selectedId?: number | null } = {},
    ): number | null => {
      const draftId = draftVersionIdRef.current;
      const selectedId = Object.prototype.hasOwnProperty.call(options, "selectedId")
        ? options.selectedId ?? null
        : selectedVersionIdRef.current;

      if (preferDraft) {
        return draftId ?? selectedId ?? null;
      }

      if (selectedId != null) {
        return selectedId;
      }

      return draftId ?? null;
    },
    [draftVersionIdRef, selectedVersionIdRef],
  );

  const versionIdToPromote = useMemo(
    () => resolveVersionIdToPromote(false, { selectedId: selectedVersionId }),
    [resolveVersionIdToPromote, selectedVersionId],
  );

  const versionSummaryForPromotion = useMemo(() => {
    if (versionIdToPromote == null) {
      return null;
    }
    return versions.find((version) => version.id === versionIdToPromote) ?? null;
  }, [versionIdToPromote, versions]);

  const isPromotingDraft = Boolean(
    versionSummaryForPromotion && draftVersionIdRef.current === versionSummaryForPromotion.id,
  );

  const deployModalTitle = versionSummaryForPromotion
    ? isPromotingDraft
      ? t("workflowBuilder.deploy.modal.titlePublishDraft")
      : t("workflowBuilder.deploy.modal.titlePromoteSelected")
    : t("workflowBuilder.deploy.modal.titleMissing");

  const deployModalDescription = versionSummaryForPromotion
    ? isPromotingDraft
      ? t("workflowBuilder.deploy.modal.descriptionPublishDraft")
      : t("workflowBuilder.deploy.modal.descriptionPromoteSelected", {
          version: versionSummaryForPromotion.version,
        })
    : t("workflowBuilder.deploy.modal.descriptionMissing");

  const deployModalSourceLabel = versionSummaryForPromotion
    ? isPromotingDraft
      ? t("workflowBuilder.deploy.modal.path.draft")
      : t("workflowBuilder.deploy.modal.path.selectedWithVersion", {
          version: versionSummaryForPromotion.version,
        })
    : t("workflowBuilder.deploy.modal.path.draft");

  const deployModalTargetLabel = versionSummaryForPromotion
    ? isPromotingDraft
      ? t("workflowBuilder.deploy.modal.path.newVersion")
      : t("workflowBuilder.deploy.modal.path.production")
    : t("workflowBuilder.deploy.modal.path.production");

  const deployModalPrimaryLabel = versionSummaryForPromotion
    ? isPromotingDraft
      ? t("workflowBuilder.deploy.modal.action.publish")
      : t("workflowBuilder.deploy.modal.action.deploy")
    : t("workflowBuilder.deploy.modal.action.publish");

  const isPrimaryActionDisabled = !versionSummaryForPromotion || isDeploying;

  return {
    resolveVersionIdToPromote,
    versionIdToPromote,
    versionSummaryForPromotion,
    isPromotingDraft,
    deployModalTitle,
    deployModalDescription,
    deployModalSourceLabel,
    deployModalTargetLabel,
    deployModalPrimaryLabel,
    isPrimaryActionDisabled,
  };
};
