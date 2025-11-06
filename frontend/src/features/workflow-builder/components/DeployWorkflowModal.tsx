import type { MouseEvent } from "react";

type DeployWorkflowModalProps = {
  isOpen: boolean;
  isDeploying: boolean;
  deployToProduction: boolean;
  setDeployToProduction: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  shouldShowVersionPath: boolean;
  sourceLabel: string;
  targetLabel: string;
  productionToggleLabel: string;
  cancelLabel: string;
  primaryActionLabel: string;
  isPrimaryActionDisabled: boolean;
};

export const DeployWorkflowModal = ({
  isOpen,
  isDeploying,
  deployToProduction,
  setDeployToProduction,
  onClose,
  onConfirm,
  title,
  description,
  shouldShowVersionPath,
  sourceLabel,
  targetLabel,
  productionToggleLabel,
  cancelLabel,
  primaryActionLabel,
  isPrimaryActionDisabled,
}: DeployWorkflowModalProps) => {
  if (!isOpen) {
    return null;
  }

  const handleDialogClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

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
        onClick={handleDialogClick}
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
            {title}
          </h2>
          <p style={{ margin: 0, color: "var(--text-muted)", lineHeight: 1.45 }}>{description}</p>
          {shouldShowVersionPath ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                fontWeight: 600,
                color: "var(--text-color)",
              }}
            >
              <span style={{ padding: "0.25rem 0.5rem", background: "#e2e8f0", borderRadius: "999px" }}>
                {sourceLabel}
              </span>
              <span aria-hidden="true">→</span>
              <span style={{ padding: "0.25rem 0.5rem", background: "#dcfce7", borderRadius: "999px" }}>
                {targetLabel}
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
            onChange={(event) => setDeployToProduction(event.target.checked)}
            disabled={isDeploying}
            style={{ width: "1.2rem", height: "1.2rem" }}
          />
          {productionToggleLabel}
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
            {cancelLabel}
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
            {primaryActionLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeployWorkflowModal;
