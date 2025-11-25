import { useState } from "react";

import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { isUnauthorizedError } from "../utils/backend";
import {
  useCleanupStats,
  useDeleteConversations,
  useDeleteWorkflowHistory,
  useDeleteWorkflows,
  useDeleteViewports,
  useFactoryReset,
} from "../hooks";
import { FeedbackMessages, FormSection } from "../components";
import { ConfirmDialog } from "../components/admin/ConfirmDialog";

type CleanupAction =
  | "conversations"
  | "workflow-history"
  | "workflows"
  | "viewports"
  | "factory-reset"
  | null;

export const AdminCleanupPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();

  // Fetch cleanup statistics
  const { data: stats, isLoading, error: statsError, refetch } = useCleanupStats(token);

  // Mutation hooks
  const deleteConversations = useDeleteConversations();
  const deleteWorkflowHistory = useDeleteWorkflowHistory();
  const deleteWorkflows = useDeleteWorkflows();
  const deleteViewports = useDeleteViewports();
  const factoryReset = useFactoryReset();

  // Local state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<CleanupAction>(null);

  const handleError = (err: unknown) => {
    if (isUnauthorizedError(err)) {
      logout();
      setError(t("admin.cleanup.errors.sessionExpired"));
    } else {
      setError(
        err instanceof Error
          ? err.message
          : t("admin.cleanup.errors.operationFailed")
      );
    }
  };

  const handleDeleteConversations = async () => {
    setConfirmAction(null);
    setError(null);
    setSuccess(null);

    deleteConversations.mutate(
      { token },
      {
        onSuccess: (result) => {
          setSuccess(t("admin.cleanup.success.conversations", { count: result.deleted_count }));
          refetch();
        },
        onError: handleError,
      }
    );
  };

  const handleDeleteWorkflowHistory = async () => {
    setConfirmAction(null);
    setError(null);
    setSuccess(null);

    deleteWorkflowHistory.mutate(
      { token },
      {
        onSuccess: (result) => {
          setSuccess(t("admin.cleanup.success.workflowHistory", { count: result.deleted_count }));
          refetch();
        },
        onError: handleError,
      }
    );
  };

  const handleDeleteWorkflows = async () => {
    setConfirmAction(null);
    setError(null);
    setSuccess(null);

    deleteWorkflows.mutate(
      { token },
      {
        onSuccess: (result) => {
          setSuccess(t("admin.cleanup.success.workflows", { count: result.deleted_count }));
          refetch();
        },
        onError: handleError,
      }
    );
  };

  const handleDeleteViewports = async () => {
    setConfirmAction(null);
    setError(null);
    setSuccess(null);

    deleteViewports.mutate(
      { token },
      {
        onSuccess: (result) => {
          setSuccess(t("admin.cleanup.success.viewports", { count: result.deleted_count }));
          refetch();
        },
        onError: handleError,
      }
    );
  };

  const handleFactoryReset = async () => {
    setConfirmAction(null);
    setError(null);
    setSuccess(null);

    factoryReset.mutate(
      { token },
      {
        onSuccess: (result) => {
          setSuccess(t("admin.cleanup.success.factoryReset", {
            conversations: result.conversations_deleted,
            workflows: result.workflows_deleted,
            viewports: result.viewports_deleted,
          }));
          refetch();
        },
        onError: handleError,
      }
    );
  };

  const isBusy =
    isLoading ||
    deleteConversations.isPending ||
    deleteWorkflowHistory.isPending ||
    deleteWorkflows.isPending ||
    deleteViewports.isPending ||
    factoryReset.isPending;

  const getConfirmConfig = () => {
    switch (confirmAction) {
      case "conversations":
        return {
          title: t("admin.cleanup.confirm.conversations.title"),
          message: t("admin.cleanup.confirm.conversations.message", { count: stats?.conversations_count ?? 0 }),
          onConfirm: handleDeleteConversations,
        };
      case "workflow-history":
        return {
          title: t("admin.cleanup.confirm.workflowHistory.title"),
          message: t("admin.cleanup.confirm.workflowHistory.message", { count: stats?.workflow_old_versions_count ?? 0 }),
          onConfirm: handleDeleteWorkflowHistory,
        };
      case "workflows":
        return {
          title: t("admin.cleanup.confirm.workflows.title"),
          message: t("admin.cleanup.confirm.workflows.message", { count: stats?.workflows_count ?? 0 }),
          onConfirm: handleDeleteWorkflows,
        };
      case "viewports":
        return {
          title: t("admin.cleanup.confirm.viewports.title"),
          message: t("admin.cleanup.confirm.viewports.message", { count: stats?.viewports_count ?? 0 }),
          onConfirm: handleDeleteViewports,
        };
      case "factory-reset":
        return {
          title: t("admin.cleanup.confirm.factoryReset.title"),
          message: t("admin.cleanup.confirm.factoryReset.message"),
          onConfirm: handleFactoryReset,
        };
      default:
        return null;
    }
  };

  const confirmConfig = getConfirmConfig();

  return (
    <>
      <FeedbackMessages
        error={error || (statsError instanceof Error ? statsError.message : null)}
        success={success}
        onDismissError={() => setError(null)}
        onDismissSuccess={() => setSuccess(null)}
      />

      <div className="admin-grid">
        {/* Statistics */}
        <FormSection
          title={t("admin.cleanup.stats.title")}
          subtitle={t("admin.cleanup.stats.subtitle")}
        >
          <div className="flex flex-col gap-4">
            {isLoading ? (
              <p className="text-muted">{t("common.loading")}</p>
            ) : stats ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-surface-elevated rounded-lg border text-center">
                  <p className="text-2xl font-bold">{stats.conversations_count}</p>
                  <p className="text-sm text-muted">{t("admin.cleanup.stats.conversations")}</p>
                </div>
                <div className="p-4 bg-surface-elevated rounded-lg border text-center">
                  <p className="text-2xl font-bold">{stats.workflows_count}</p>
                  <p className="text-sm text-muted">{t("admin.cleanup.stats.workflows")}</p>
                </div>
                <div className="p-4 bg-surface-elevated rounded-lg border text-center">
                  <p className="text-2xl font-bold">{stats.workflow_old_versions_count}</p>
                  <p className="text-sm text-muted">{t("admin.cleanup.stats.oldVersions")}</p>
                </div>
                <div className="p-4 bg-surface-elevated rounded-lg border text-center">
                  <p className="text-2xl font-bold">{stats.viewports_count}</p>
                  <p className="text-sm text-muted">{t("admin.cleanup.stats.viewports")}</p>
                </div>
              </div>
            ) : null}
          </div>
        </FormSection>

        {/* Cleanup Actions */}
        <FormSection
          title={t("admin.cleanup.actions.title")}
          subtitle={t("admin.cleanup.actions.subtitle")}
        >
          <div className="flex flex-col gap-4">
            {/* Delete Conversations */}
            <div className="flex items-center justify-between p-4 bg-surface-elevated rounded-lg border">
              <div>
                <h3 className="font-medium">{t("admin.cleanup.actions.conversations.title")}</h3>
                <p className="text-sm text-muted">{t("admin.cleanup.actions.conversations.description")}</p>
              </div>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setConfirmAction("conversations")}
                disabled={isBusy || !stats?.conversations_count}
              >
                {t("admin.cleanup.actions.delete")}
              </button>
            </div>

            {/* Delete Workflow History */}
            <div className="flex items-center justify-between p-4 bg-surface-elevated rounded-lg border">
              <div>
                <h3 className="font-medium">{t("admin.cleanup.actions.workflowHistory.title")}</h3>
                <p className="text-sm text-muted">{t("admin.cleanup.actions.workflowHistory.description")}</p>
              </div>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setConfirmAction("workflow-history")}
                disabled={isBusy || !stats?.workflow_old_versions_count}
              >
                {t("admin.cleanup.actions.delete")}
              </button>
            </div>

            {/* Delete All Workflows */}
            <div className="flex items-center justify-between p-4 bg-surface-elevated rounded-lg border">
              <div>
                <h3 className="font-medium">{t("admin.cleanup.actions.workflows.title")}</h3>
                <p className="text-sm text-muted">{t("admin.cleanup.actions.workflows.description")}</p>
              </div>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setConfirmAction("workflows")}
                disabled={isBusy || !stats?.workflows_count}
              >
                {t("admin.cleanup.actions.delete")}
              </button>
            </div>

            {/* Delete Viewports */}
            <div className="flex items-center justify-between p-4 bg-surface-elevated rounded-lg border">
              <div>
                <h3 className="font-medium">{t("admin.cleanup.actions.viewports.title")}</h3>
                <p className="text-sm text-muted">{t("admin.cleanup.actions.viewports.description")}</p>
              </div>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setConfirmAction("viewports")}
                disabled={isBusy || !stats?.viewports_count}
              >
                {t("admin.cleanup.actions.delete")}
              </button>
            </div>
          </div>
        </FormSection>

        {/* Factory Reset */}
        <FormSection
          title={t("admin.cleanup.factoryReset.title")}
          subtitle={t("admin.cleanup.factoryReset.subtitle")}
        >
          <div className="flex flex-col gap-4">
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-700 dark:text-red-300">
                {t("admin.cleanup.factoryReset.warning")}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirmAction("factory-reset")}
              disabled={isBusy}
            >
              {t("admin.cleanup.factoryReset.button")}
            </button>
          </div>
        </FormSection>
      </div>

      {/* Confirmation Dialog */}
      {confirmConfig && (
        <ConfirmDialog
          title={confirmConfig.title}
          message={confirmConfig.message}
          confirmLabel={t("admin.cleanup.confirm.confirmButton")}
          cancelLabel={t("admin.cleanup.confirm.cancelButton")}
          onConfirm={confirmConfig.onConfirm}
          onCancel={() => setConfirmAction(null)}
          variant="danger"
        />
      )}
    </>
  );
};

export default AdminCleanupPage;
