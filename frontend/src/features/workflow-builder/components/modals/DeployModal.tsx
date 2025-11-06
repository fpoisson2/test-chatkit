import type { WorkflowVersionSummary } from "../../types";

interface DeployModalProps {
  isOpen: boolean;
  isDeploying: boolean;
  deployToProduction: boolean;
  versionSummaryForPromotion: WorkflowVersionSummary | null;
  isPromotingDraft: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onProductionToggle: (checked: boolean) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}

/**
 * Modal for deploying/publishing workflow versions
 */
export const DeployModal = ({
  isOpen,
  isDeploying,
  deployToProduction,
  versionSummaryForPromotion,
  isPromotingDraft,
  onClose,
  onConfirm,
  onProductionToggle,
  t,
}: DeployModalProps) => {
  if (!isOpen) {
    return null;
  }

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

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        zIndex: 30,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="deploy-dialog-title"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "460px",
          background: "var(--surface-strong)",
          borderRadius: "1rem",
          boxShadow: "var(--shadow-card)",
          padding: "1.75rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <h2
            id="deploy-dialog-title"
            style={{
              fontSize: "1.35rem",
              fontWeight: 700,
              color: "var(--color-text-strong)",
              margin: 0,
            }}
          >
            {deployModalTitle}
          </h2>
          <p style={{ margin: 0, color: "var(--text-muted)", lineHeight: 1.45 }}>
            {deployModalDescription}
          </p>
          {versionSummaryForPromotion ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                fontWeight: 600,
                color: "var(--text-color)",
              }}
            >
              <span
                style={{
                  padding: "0.25rem 0.5rem",
                  background: "#e2e8f0",
                  borderRadius: "999px",
                }}
              >
                {deployModalSourceLabel}
              </span>
              <span aria-hidden="true">→</span>
              <span
                style={{
                  padding: "0.25rem 0.5rem",
                  background: "#dcfce7",
                  borderRadius: "999px",
                }}
              >
                {deployModalTargetLabel}
              </span>
            </div>
          ) : null}
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            fontWeight: 600,
            color: "var(--text-color)",
          }}
        >
          <input
            type="checkbox"
            checked={deployToProduction}
            onChange={(event) => onProductionToggle(event.target.checked)}
            disabled={isDeploying}
            style={{ width: "1.2rem", height: "1.2rem" }}
          />
          {t("workflowBuilder.deploy.modal.productionToggle")}
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeploying}
            style={{
              padding: "0.6rem 1.2rem",
              borderRadius: "0.75rem",
              border: "1px solid var(--surface-border)",
              background: "var(--surface-strong)",
              color: "var(--text-color)",
              fontWeight: 600,
              cursor: isDeploying ? "not-allowed" : "pointer",
              opacity: isDeploying ? 0.5 : 1,
            }}
          >
            {t("workflowBuilder.deploy.modal.action.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPrimaryActionDisabled}
            style={{
              padding: "0.6rem 1.2rem",
              borderRadius: "0.75rem",
              border: "none",
              background: "#2563eb",
              color: "#fff",
              fontWeight: 700,
              cursor: isPrimaryActionDisabled ? "not-allowed" : "pointer",
              opacity: isPrimaryActionDisabled ? 0.7 : 1,
            }}
          >
            {deployModalPrimaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
