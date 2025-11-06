import type { ChangeEvent, CSSProperties } from "react";
import type { WorkflowVersionSummary, WorkflowSummary } from "../../types";
import {
  getHeaderContainerStyle,
  getHeaderNavigationButtonStyle,
  getHeaderLayoutStyle,
  getHeaderGroupStyle,
  getHeaderActionAreaStyle,
  getVersionSelectStyle,
  getDeployButtonStyle,
  getMobileActionButtonStyle,
  getActionMenuWrapperStyle,
  getActionMenuStyle,
  controlLabelStyle,
} from "../../styles";
import styles from "../../WorkflowBuilderPage.module.css";

export interface WorkflowHeaderProps {
  isMobileLayout: boolean;
  loading: boolean;
  isImporting: boolean;
  isExporting: boolean;
  isDeploying: boolean;
  selectedWorkflowId: number | null;
  selectedVersionId: number | null;
  versions: WorkflowVersionSummary[];
  selectedWorkflow: WorkflowSummary | null;
  draftVersionIdRef: React.MutableRefObject<number | null>;
  draftDisplayName: string;
  isMobileActionsOpen: boolean;
  headerStyle?: CSSProperties;
  onOpenSidebar: () => void;
  onVersionChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onTriggerImport: () => void;
  onImportFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onExportWorkflow: () => Promise<void>;
  onOpenDeployModal: () => void;
  onToggleMobileActions: () => void;
  onCloseMobileActions: () => void;
  mobileActionsTriggerRef: React.RefObject<HTMLButtonElement>;
  mobileActionsMenuRef: React.RefObject<HTMLDivElement>;
  importFileInputRef: React.RefObject<HTMLInputElement>;
  t: (key: string) => string;
}

const mobileActionsDialogId = "mobile-actions-menu";
const mobileActionsTitleId = "mobile-actions-title";

/**
 * Renders workflow description if available
 */
const renderWorkflowDescription = (
  selectedWorkflow: WorkflowSummary | null,
  className?: string,
) =>
  selectedWorkflow?.description ? (
    <div
      className={className}
      style={
        className
          ? undefined
          : { color: "var(--text-muted)", fontSize: "0.95rem" }
      }
    >
      {selectedWorkflow.description}
    </div>
  ) : null;

/**
 * Renders publication reminder if workflow has no active version
 */
const renderWorkflowPublicationReminder = (
  selectedWorkflow: WorkflowSummary | null,
  className?: string,
) =>
  selectedWorkflow && !selectedWorkflow.active_version_id ? (
    <div
      className={className}
      style={
        className
          ? undefined
          : { color: "#b45309", fontSize: "0.85rem", fontWeight: 600 }
      }
    >
      Publiez une version pour l'utiliser.
    </div>
  ) : null;

/**
 * WorkflowHeader component - displays toolbar with version selector and actions
 * Handles both mobile (menu-based) and desktop (button-based) layouts
 */
export const WorkflowHeader = ({
  isMobileLayout,
  loading,
  isImporting,
  isExporting,
  isDeploying,
  selectedWorkflowId,
  selectedVersionId,
  versions,
  selectedWorkflow,
  draftVersionIdRef,
  draftDisplayName,
  isMobileActionsOpen,
  headerStyle,
  onOpenSidebar,
  onVersionChange,
  onTriggerImport,
  onImportFileChange,
  onExportWorkflow,
  onOpenDeployModal,
  onToggleMobileActions,
  onCloseMobileActions,
  mobileActionsTriggerRef,
  mobileActionsMenuRef,
  importFileInputRef,
  t,
}: WorkflowHeaderProps) => {
  const importDisabled = loading || isImporting;
  const exportDisabled =
    loading || !selectedWorkflowId || !selectedVersionId || isExporting;
  const deployDisabled =
    loading || !selectedWorkflowId || versions.length === 0 || isDeploying;

  const importLabel = isImporting
    ? t("workflowBuilder.import.inProgress")
    : t("workflowBuilder.actions.importJson");
  const exportLabel = isExporting
    ? t("workflowBuilder.export.preparing")
    : t("workflowBuilder.actions.exportJson");

  const versionSelect = (
    <div style={getHeaderLayoutStyle(isMobileLayout)}>
      <div style={getHeaderGroupStyle(isMobileLayout)}>
        {!isMobileLayout ? (
          <label htmlFor="version-select" style={controlLabelStyle}>
            Révision
          </label>
        ) : null}
        <select
          id="version-select"
          aria-label={isMobileLayout ? "Sélectionner une révision" : undefined}
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
              const isDraft = draftVersionIdRef.current === version.id;
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

  const renderControls = () => {
    if (isMobileLayout) {
      const mobileMenuStyle = getActionMenuStyle(true, "down");
      mobileMenuStyle.right = 0;
      mobileMenuStyle.left = "auto";
      mobileMenuStyle.minWidth = "min(18rem, 85vw)";
      mobileMenuStyle.width = "min(18rem, 85vw)";
      mobileMenuStyle.padding = "1rem";
      mobileMenuStyle.gap = "0.75rem";

      const shouldShowMobileInfo =
        Boolean(selectedWorkflow?.description) ||
        Boolean(selectedWorkflow && !selectedWorkflow.active_version_id);

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
                <span className={styles.srOnly}>
                  {t("workflowBuilder.mobileActions.open")}
                </span>
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
                    {t("workflowBuilder.mobileActions.title")}
                  </span>
                  {shouldShowMobileInfo ? (
                    <div className={styles.mobileHeaderMenuInfo}>
                      {renderWorkflowDescription(
                        selectedWorkflow,
                        styles.mobileHeaderMenuInfoText,
                      )}
                      {renderWorkflowPublicationReminder(
                        selectedWorkflow,
                        styles.mobileHeaderMenuInfoWarning,
                      )}
                    </div>
                  ) : null}
                  <div className={styles.mobileHeaderMenuActions}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onTriggerImport();
                        onCloseMobileActions();
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
                        onCloseMobileActions();
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
                        onCloseMobileActions();
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

  return (
    <header style={headerStyle ?? getHeaderContainerStyle(isMobileLayout)}>
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label="Ouvrir la navigation générale"
        style={getHeaderNavigationButtonStyle(isMobileLayout)}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M3 5h14M3 10h14M3 15h14"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {renderControls()}
    </header>
  );
};
