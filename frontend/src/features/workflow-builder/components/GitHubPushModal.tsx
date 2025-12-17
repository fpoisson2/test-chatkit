/**
 * Modal for pushing a workflow to GitHub.
 * Allows selecting a repo sync configuration and file path.
 */
import { useState, useEffect } from "react";
import type { MouseEvent } from "react";
import { useI18n } from "../../../i18n";
import { useAuth } from "../../../auth";
import {
  useGitHubRepoSyncs,
  usePushWorkflowToGitHub,
} from "../../../hooks/useGitHubIntegrations";
import type { WorkflowSummary } from "../types";

interface GitHubPushModalProps {
  isOpen: boolean;
  onClose: () => void;
  workflow: WorkflowSummary | null;
}

export default function GitHubPushModal({
  isOpen,
  onClose,
  workflow,
}: GitHubPushModalProps) {
  const { t } = useI18n();
  const { token } = useAuth();

  const { data: repoSyncs = [], isLoading: loadingRepoSyncs } =
    useGitHubRepoSyncs(token);

  const pushMutation = usePushWorkflowToGitHub();

  const [selectedRepoSyncId, setSelectedRepoSyncId] = useState<number | null>(
    null
  );
  const [filePath, setFilePath] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const activeRepoSyncs = repoSyncs.filter((rs) => rs.is_active);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen && workflow) {
      setSelectedRepoSyncId(activeRepoSyncs[0]?.id ?? null);
      setFilePath(`workflows/${workflow.slug}.json`);
      setCommitMessage("");
      setError(null);
    }
  }, [isOpen, workflow, activeRepoSyncs]);

  // Update file path when repo sync changes
  useEffect(() => {
    if (selectedRepoSyncId && workflow) {
      const repoSync = repoSyncs.find((rs) => rs.id === selectedRepoSyncId);
      if (repoSync) {
        // Extract directory from pattern
        const pattern = repoSync.file_pattern;
        let directory = "";
        if (pattern.includes("/")) {
          directory = pattern.split("/")[0];
          if (directory.includes("*")) {
            directory = "";
          }
        }
        const newPath = directory
          ? `${directory}/${workflow.slug}.json`
          : `${workflow.slug}.json`;
        setFilePath(newPath);
      }
    }
  }, [selectedRepoSyncId, workflow, repoSyncs]);

  if (!isOpen || !workflow) {
    return null;
  }

  const handleDialogClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  const handlePush = async () => {
    if (!workflow || !selectedRepoSyncId) return;

    setError(null);
    try {
      await pushMutation.mutateAsync({
        token,
        payload: {
          workflow_id: workflow.id,
          repo_sync_id: selectedRepoSyncId,
          file_path: filePath,
          commit_message: commitMessage || undefined,
        },
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("workflowBuilder.github.pushError")
      );
    }
  };

  const selectedRepoSync = repoSyncs.find(
    (rs) => rs.id === selectedRepoSyncId
  );

  const isPushDisabled =
    !selectedRepoSyncId || !filePath.trim() || pushMutation.isPending;

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
        aria-labelledby="github-push-dialog-title"
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
            id="github-push-dialog-title"
            style={{
              fontSize: "1.35rem",
              fontWeight: 700,
              color: "var(--color-text-strong)",
              margin: 0,
            }}
          >
            {t("workflowBuilder.github.pushTitle")}
          </h2>
        </div>

        {activeRepoSyncs.length === 0 ? (
          <div
            style={{
              padding: "1rem",
              background: "var(--surface-subtle)",
              borderRadius: "0.5rem",
              textAlign: "center",
            }}
          >
            <p style={{ marginBottom: "0.5rem", color: "var(--text-color)" }}>
              {t("workflowBuilder.github.noRepoSyncs")}
            </p>
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", margin: 0 }}>
              {t("workflowBuilder.github.configureInAdmin")}
            </p>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <label
                htmlFor="repo-sync-select"
                style={{
                  fontWeight: 600,
                  color: "var(--text-color)",
                }}
              >
                {t("workflowBuilder.github.selectRepo")}
              </label>
              <select
                id="repo-sync-select"
                value={selectedRepoSyncId ?? ""}
                onChange={(e) =>
                  setSelectedRepoSyncId(Number(e.target.value) || null)
                }
                disabled={loadingRepoSyncs}
                style={{
                  width: "100%",
                  padding: "0.6rem",
                  borderRadius: "0.75rem",
                  border: "1px solid var(--surface-border)",
                  background: "var(--surface-strong)",
                  color: "var(--text-color)",
                  fontSize: "0.95rem",
                }}
              >
                {activeRepoSyncs.map((repoSync) => (
                  <option key={repoSync.id} value={repoSync.id}>
                    {repoSync.repo_full_name} ({repoSync.branch})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <label
                htmlFor="file-path-input"
                style={{
                  fontWeight: 600,
                  color: "var(--text-color)",
                }}
              >
                {t("workflowBuilder.github.filePath")}
              </label>
              <input
                id="file-path-input"
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="workflows/my-workflow.json"
                style={{
                  width: "100%",
                  padding: "0.6rem",
                  borderRadius: "0.75rem",
                  border: "1px solid var(--surface-border)",
                  background: "var(--surface-strong)",
                  color: "var(--text-color)",
                  fontSize: "0.95rem",
                }}
              />
              {selectedRepoSync && (
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.8rem",
                    color: "var(--text-muted)",
                  }}
                >
                  {t("workflowBuilder.github.patternHint", {
                    pattern: selectedRepoSync.file_pattern,
                  })}
                </p>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <label
                htmlFor="commit-message-input"
                style={{
                  fontWeight: 600,
                  color: "var(--text-color)",
                }}
              >
                {t("workflowBuilder.github.commitMessage")}
              </label>
              <input
                id="commit-message-input"
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder={t("workflowBuilder.github.commitPlaceholder", {
                  name: workflow.display_name || workflow.slug,
                })}
                style={{
                  width: "100%",
                  padding: "0.6rem",
                  borderRadius: "0.75rem",
                  border: "1px solid var(--surface-border)",
                  background: "var(--surface-strong)",
                  color: "var(--text-color)",
                  fontSize: "0.95rem",
                }}
              />
            </div>

            {error && (
              <div
                style={{
                  padding: "0.75rem",
                  background: "var(--color-error-subtle)",
                  color: "var(--color-error)",
                  borderRadius: "0.75rem",
                  fontSize: "0.875rem",
                }}
              >
                {error}
              </div>
            )}
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={pushMutation.isPending}
            style={{
              padding: "0.6rem 1.2rem",
              borderRadius: "0.75rem",
              border: "1px solid var(--surface-border)",
              background: "var(--surface-strong)",
              color: "var(--text-color)",
              fontWeight: 600,
              cursor: pushMutation.isPending ? "not-allowed" : "pointer",
              opacity: pushMutation.isPending ? 0.5 : 1,
            }}
          >
            {t("workflowBuilder.github.cancel")}
          </button>
          {activeRepoSyncs.length > 0 && (
            <button
              type="button"
              onClick={handlePush}
              disabled={isPushDisabled}
              style={{
                padding: "0.6rem 1.2rem",
                borderRadius: "0.75rem",
                border: "none",
                background: "var(--accent-color-primary)",
                color: "#fff",
                fontWeight: 700,
                cursor: isPushDisabled ? "not-allowed" : "pointer",
                opacity: isPushDisabled ? 0.7 : 1,
              }}
            >
              {pushMutation.isPending
                ? t("workflowBuilder.github.pushing")
                : t("workflowBuilder.github.push")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
