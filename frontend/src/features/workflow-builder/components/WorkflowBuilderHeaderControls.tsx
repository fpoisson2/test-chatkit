import type { ChangeEvent, MutableRefObject, ReactNode } from "react";

import {
  getActionMenuStyle,
  getActionMenuWrapperStyle,
  getDeployButtonStyle,
  getHeaderActionAreaStyle,
  getHeaderGroupStyle,
  getHeaderLayoutStyle,
  getMobileActionButtonStyle,
  getVersionSelectStyle,
} from "../styles";
import styles from "../WorkflowBuilderPage.module.css";
import type { WorkflowVersionSummary } from "../types";

type WorkflowBuilderHeaderControlsProps = {
  isMobileLayout: boolean;
  loading: boolean;
  versions: WorkflowVersionSummary[];
  selectedVersionId: number | null;
  draftVersionId: number | null;
  draftDisplayName: string;
  importDisabled: boolean;
  exportDisabled: boolean;
  deployDisabled: boolean;
  importLabel: string;
  exportLabel: string;
  onVersionChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  importFileInputRef: MutableRefObject<HTMLInputElement | null>;
  onImportFileChange: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onTriggerImport: () => void;
  onExportWorkflow: () => void | Promise<void>;
  onOpenDeployModal: () => void;
  mobileActionsTriggerRef: MutableRefObject<HTMLButtonElement | null>;
  mobileActionsMenuRef: MutableRefObject<HTMLDivElement | null>;
  isMobileActionsOpen: boolean;
  onToggleMobileActions: () => void;
  closeMobileActions: (options?: { focusTrigger?: boolean }) => void;
  mobileActionsDialogId: string;
  mobileActionsTitleId: string;
  mobileActionsOpenLabel: string;
  mobileActionsTitle: string;
  renderWorkflowDescription: (className?: string) => ReactNode;
  renderWorkflowPublicationReminder: (className?: string) => ReactNode;
  showWorkflowDescription: boolean;
  showWorkflowPublicationReminder: boolean;
  isImporting: boolean;
  isExporting: boolean;
};

const WorkflowBuilderHeaderControls = ({
  isMobileLayout,
  loading,
  versions,
  selectedVersionId,
  draftVersionId,
  draftDisplayName,
  importDisabled,
  exportDisabled,
  deployDisabled,
  importLabel,
  exportLabel,
  onVersionChange,
  importFileInputRef,
  onImportFileChange,
  onTriggerImport,
  onExportWorkflow,
  onOpenDeployModal,
  mobileActionsTriggerRef,
  mobileActionsMenuRef,
  isMobileActionsOpen,
  onToggleMobileActions,
  closeMobileActions,
  mobileActionsDialogId,
  mobileActionsTitleId,
  mobileActionsOpenLabel,
  mobileActionsTitle,
  renderWorkflowDescription,
  renderWorkflowPublicationReminder,
  showWorkflowDescription,
  showWorkflowPublicationReminder,
  isImporting,
  isExporting,
}: WorkflowBuilderHeaderControlsProps) => {
  const versionSelect = (
    <div style={getHeaderLayoutStyle(isMobileLayout)}>
      <div style={getHeaderGroupStyle(isMobileLayout)}>
        <select
          id="version-select"
          aria-label="Sélectionner une révision"
          value={selectedVersionId ? String(selectedVersionId) : ""}
          onChange={onVersionChange}
          disabled={loading || versions.length === 0}
          style={getVersionSelectStyle(isMobileLayout, {
            disabled: loading || versions.length === 0,
          })}
        >
          {versions.length === 0 ? (
            <option value="">Aucune version disponible</option>
          ) : (
            versions.map((version) => {
              const isDraft = draftVersionId === version.id;
              const displayName = version.name?.trim() || null;
              const labelParts: string[] = [];
              if (isDraft) {
                labelParts.push(displayName ?? draftDisplayName);
              } else {
                labelParts.push(`v${version.version}`);
                if (
                  displayName &&
                  (!version.is_active || displayName.toLowerCase() !== "production")
                ) {
                  labelParts.push(displayName);
                }
              }
              if (version.is_active) {
                labelParts.push("Production");
              }
              return (
                <option key={version.id} value={version.id}>
                  {labelParts.join(" · ")}
                </option>
              );
            })
          )}
        </select>
      </div>
    </div>
  );

  const importInput = (
    <input
      ref={importFileInputRef}
      type="file"
      accept="application/json"
      hidden
      onChange={(event) => {
        void onImportFileChange(event);
      }}
    />
  );

  if (isMobileLayout) {
    const mobileMenuStyle = getActionMenuStyle(true, "down");
    mobileMenuStyle.right = 0;
    mobileMenuStyle.left = "auto";
    mobileMenuStyle.minWidth = "min(18rem, 85vw)";
    mobileMenuStyle.width = "min(18rem, 85vw)";
    mobileMenuStyle.padding = "1rem";
    mobileMenuStyle.gap = "0.75rem";
    const shouldShowMobileInfo =
      showWorkflowDescription || showWorkflowPublicationReminder;

    return (
      <>
        {versionSelect}
        <div style={getHeaderActionAreaStyle(true)}>
          <div style={{ ...getActionMenuWrapperStyle(true), width: "auto" }}>
            <button
              type="button"
              ref={mobileActionsTriggerRef}
              onClick={onToggleMobileActions}
              aria-haspopup="menu"
              aria-expanded={isMobileActionsOpen}
              aria-controls={mobileActionsDialogId}
              style={{
                width: "2.75rem",
                height: "2.75rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--surface-border)",
                background: "var(--surface-strong)",
                color: "var(--text-color)",
                display: "grid",
                placeItems: "center",
                fontSize: "1.5rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <span aria-hidden="true">⋯</span>
              <span className={styles.srOnly}>{mobileActionsOpenLabel}</span>
            </button>
            {isMobileActionsOpen ? (
              <div
                id={mobileActionsDialogId}
                role="menu"
                aria-labelledby={mobileActionsTitleId}
                ref={mobileActionsMenuRef}
                style={mobileMenuStyle}
                className={styles.mobileHeaderMenu}
              >
                <span id={mobileActionsTitleId} className={styles.srOnly}>
                  {mobileActionsTitle}
                </span>
                {shouldShowMobileInfo ? (
                  <div className={styles.mobileHeaderMenuInfo}>
                    {showWorkflowDescription
                      ? renderWorkflowDescription(styles.mobileHeaderMenuInfoText)
                      : null}
                    {showWorkflowPublicationReminder
                      ? renderWorkflowPublicationReminder(
                          styles.mobileHeaderMenuInfoWarning,
                        )
                      : null}
                  </div>
                ) : null}
                <div className={styles.mobileHeaderMenuActions}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onTriggerImport();
                      closeMobileActions();
                    }}
                    disabled={importDisabled}
                    aria-busy={isImporting}
                    style={getMobileActionButtonStyle({ disabled: importDisabled })}
                  >
                    {importLabel}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      void onExportWorkflow();
                      closeMobileActions();
                    }}
                    disabled={exportDisabled}
                    aria-busy={isExporting}
                    style={getMobileActionButtonStyle({ disabled: exportDisabled })}
                  >
                    {exportLabel}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onOpenDeployModal();
                      closeMobileActions();
                    }}
                    disabled={deployDisabled}
                    style={getMobileActionButtonStyle({ disabled: deployDisabled })}
                  >
                    Déployer
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {importInput}
      </>
    );
  }

  return (
    <>
      {versionSelect}
      <div style={getHeaderActionAreaStyle(false)}>
        <button
          type="button"
          onClick={onTriggerImport}
          disabled={importDisabled}
          aria-busy={isImporting}
          style={getDeployButtonStyle(false, {
            disabled: importDisabled,
          })}
        >
          {importLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            void onExportWorkflow();
          }}
          disabled={exportDisabled}
          aria-busy={isExporting}
          style={getDeployButtonStyle(false, {
            disabled: exportDisabled,
          })}
        >
          {exportLabel}
        </button>
        <button
          type="button"
          onClick={onOpenDeployModal}
          disabled={deployDisabled}
          style={getDeployButtonStyle(false, {
            disabled: deployDisabled,
          })}
        >
          Déployer
        </button>
      </div>
      {importInput}
    </>
  );
};

export default WorkflowBuilderHeaderControls;
