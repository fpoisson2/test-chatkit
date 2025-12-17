/**
 * Admin page for GitHub integrations.
 * Allows users to connect their GitHub account via OAuth
 * and configure workflow synchronization with repositories.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import {
  githubApi,
  isUnauthorizedError,
  type GitHubIntegration,
  type GitHubRepo,
  type GitHubRepoSync,
} from "../utils/backend";
import {
  useGitHubIntegrations,
  useDeleteGitHubIntegration,
  useGitHubRepos,
  useGitHubRepoSyncs,
  useCreateGitHubRepoSync,
  useUpdateGitHubRepoSync,
  useDeleteGitHubRepoSync,
  useTriggerGitHubSync,
  useGitHubSyncTaskStatus,
  useCreateGitHubWebhook,
  useDeleteGitHubWebhook,
  githubKeys,
} from "../hooks/useGitHubIntegrations";
import { useAuth } from "../auth";
import { Modal } from "../components/Modal";
import {
  ResponsiveTable,
  type Column,
  FeedbackMessages,
  FormField,
  FormSection,
  LoadingSpinner,
} from "../components";
import { useI18n } from "../i18n";

// Form schema for repo sync configuration
const repoSyncSchema = z.object({
  integrationId: z.number().min(1, "Select an integration"),
  repoFullName: z.string().min(1, "Select a repository"),
  branch: z.string().min(1, "Branch is required"),
  filePattern: z.string().min(1, "File pattern is required"),
  syncDirection: z.enum(["pull_only", "push_only", "bidirectional"]),
  autoSyncEnabled: z.boolean(),
});

type RepoSyncFormData = z.infer<typeof repoSyncSchema>;

const emptyRepoSyncForm: RepoSyncFormData = {
  integrationId: 0,
  repoFullName: "",
  branch: "main",
  filePattern: "workflows/*.json",
  syncDirection: "bidirectional",
  autoSyncEnabled: true,
};

type OAuthFeedbackState = {
  status: "idle" | "starting" | "pending" | "success" | "error";
  message: string | null;
  stateId: string | null;
};

const initialOAuthFeedback: OAuthFeedbackState = {
  status: "idle",
  message: null,
  stateId: null,
};

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  } catch {
    return value;
  }
};

export const AdminGitHubIntegrationsPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // Query hooks
  const { data: integrations = [], isLoading: loadingIntegrations } =
    useGitHubIntegrations(token);
  const { data: repoSyncs = [], isLoading: loadingRepoSyncs } =
    useGitHubRepoSyncs(token);

  // Mutation hooks
  const deleteIntegration = useDeleteGitHubIntegration();
  const createRepoSync = useCreateGitHubRepoSync();
  const updateRepoSync = useUpdateGitHubRepoSync();
  const deleteRepoSync = useDeleteGitHubRepoSync();
  const triggerSync = useTriggerGitHubSync();
  const createWebhook = useCreateGitHubWebhook();
  const deleteWebhook = useDeleteGitHubWebhook();

  // State for selected integration (to load repos)
  const [selectedIntegrationId, setSelectedIntegrationId] = useState<number | null>(null);
  const { data: repos = [], isLoading: loadingRepos } = useGitHubRepos(
    token,
    selectedIntegrationId
  );

  // Form state
  const {
    register,
    handleSubmit: handleFormSubmit,
    formState: { errors: formErrors },
    reset,
    setValue,
    watch,
  } = useForm<RepoSyncFormData>({
    resolver: zodResolver(repoSyncSchema),
    defaultValues: emptyRepoSyncForm,
  });

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [oauthFeedback, setOauthFeedback] =
    useState<OAuthFeedbackState>(initialOAuthFeedback);
  const [isRepoSyncModalOpen, setIsRepoSyncModalOpen] = useState(false);
  const [editingRepoSyncId, setEditingRepoSyncId] = useState<number | null>(null);
  const [activeSyncTaskId, setActiveSyncTaskId] = useState<string | null>(null);

  // Polling refs
  const pendingOAuthStateRef = useRef<string | null>(null);

  // Sync task polling
  const { data: syncTaskStatus } = useGitHubSyncTaskStatus(token, activeSyncTaskId, {
    refetchInterval: 2000,
  });

  // Watch for sync task completion
  useEffect(() => {
    if (syncTaskStatus?.status === "completed") {
      setSuccess(t("admin.github.sync.completed"));
      setActiveSyncTaskId(null);
      // Refresh repo syncs to show updated last_sync_at
      queryClient.invalidateQueries({ queryKey: githubKeys.repoSyncs() });
    } else if (syncTaskStatus?.status === "failed") {
      setError(syncTaskStatus.error_message || t("admin.github.sync.failed"));
      setActiveSyncTaskId(null);
      // Also refresh on failure to show any status updates
      queryClient.invalidateQueries({ queryKey: githubKeys.repoSyncs() });
    }
  }, [syncTaskStatus, t, queryClient]);

  // Watch integration ID to load repos
  const watchedIntegrationId = watch("integrationId");
  useEffect(() => {
    if (watchedIntegrationId && watchedIntegrationId !== selectedIntegrationId) {
      setSelectedIntegrationId(watchedIntegrationId);
    }
  }, [watchedIntegrationId, selectedIntegrationId]);

  const resetForm = useCallback(() => {
    reset(emptyRepoSyncForm);
    setEditingRepoSyncId(null);
    setSelectedIntegrationId(null);
  }, [reset]);

  // OAuth flow
  const handleStartOAuth = useCallback(async () => {
    if (!token) {
      return;
    }

    setOauthFeedback({
      status: "starting",
      message: t("admin.github.oauth.starting"),
      stateId: null,
    });
    setError(null);
    setSuccess(null);

    try {
      const result = await githubApi.startOAuth(token);

      // Open popup for GitHub authorization
      if (typeof window !== "undefined") {
        const popup = window.open(result.authorization_url, "_blank", "width=600,height=700");
        popup?.focus?.();
      }

      setOauthFeedback({
        status: "pending",
        message: t("admin.github.oauth.pending"),
        stateId: result.state,
      });
      pendingOAuthStateRef.current = result.state;
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.github.errors.sessionExpired"));
      } else {
        const message =
          err instanceof Error ? err.message : t("admin.github.oauth.errorGeneric");
        setError(message);
        setOauthFeedback({
          status: "error",
          message,
          stateId: null,
        });
      }
    }
  }, [token, logout, t]);

  // OAuth polling
  useEffect(() => {
    const currentState = pendingOAuthStateRef.current;
    if (!currentState || !token || oauthFeedback.status !== "pending") {
      return;
    }

    let isCancelled = false;

    const poll = async () => {
      while (!isCancelled && pendingOAuthStateRef.current === currentState) {
        try {
          const status = await githubApi.pollOAuthStatus(currentState);

          if (status.status === "completed") {
            if (isCancelled) {
              return;
            }

            setOauthFeedback({
              status: "success",
              message: t("admin.github.oauth.success"),
              stateId: null,
            });
            setSuccess(t("admin.github.oauth.success"));
            pendingOAuthStateRef.current = null;
            break;
          }

          if (status.status === "failed") {
            if (isCancelled) {
              return;
            }

            const errMsg = status.error || t("admin.github.oauth.errorGeneric");
            setOauthFeedback({
              status: "error",
              message: errMsg,
              stateId: null,
            });
            setError(errMsg);
            pendingOAuthStateRef.current = null;
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 1500));
        } catch (err) {
          if (isCancelled) {
            return;
          }

          if (isUnauthorizedError(err)) {
            logout();
            setError(t("admin.github.errors.sessionExpired"));
          } else {
            const errMsg =
              err instanceof Error ? err.message : t("admin.github.oauth.errorGeneric");
            setOauthFeedback({
              status: "error",
              message: errMsg,
              stateId: null,
            });
          }
          pendingOAuthStateRef.current = null;
          break;
        }
      }
    };

    void poll();

    return () => {
      isCancelled = true;
    };
  }, [oauthFeedback.status, token, logout, t]);

  // Delete integration
  const handleDeleteIntegration = async (integration: GitHubIntegration) => {
    if (
      !window.confirm(
        t("admin.github.confirm.deleteIntegration", { username: integration.github_username })
      )
    ) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      await deleteIntegration.mutateAsync({
        token,
        integrationId: integration.id,
      });
      setSuccess(
        t("admin.github.feedback.integrationDeleted", {
          username: integration.github_username,
        })
      );
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.github.errors.sessionExpired"));
      } else {
        setError(
          err instanceof Error ? err.message : t("admin.github.errors.deleteFailed")
        );
      }
    }
  };

  // Create/Edit repo sync modal
  const handleCreateRepoSync = () => {
    resetForm();
    if (integrations.length > 0) {
      setValue("integrationId", integrations[0].id);
      setSelectedIntegrationId(integrations[0].id);
    }
    setError(null);
    setSuccess(null);
    setIsRepoSyncModalOpen(true);
  };

  const handleEditRepoSync = (sync: GitHubRepoSync) => {
    reset({
      integrationId: sync.integration_id,
      repoFullName: sync.repo_full_name,
      branch: sync.branch,
      filePattern: sync.file_pattern,
      syncDirection: sync.sync_direction as RepoSyncFormData["syncDirection"],
      autoSyncEnabled: sync.auto_sync_enabled,
    });
    setSelectedIntegrationId(sync.integration_id);
    setEditingRepoSyncId(sync.id);
    setError(null);
    setSuccess(null);
    setIsRepoSyncModalOpen(true);
  };

  const handleSubmitRepoSync = async (data: RepoSyncFormData) => {
    setError(null);
    setSuccess(null);

    try {
      if (editingRepoSyncId == null) {
        await createRepoSync.mutateAsync({
          token,
          payload: {
            integration_id: data.integrationId,
            repo_full_name: data.repoFullName,
            branch: data.branch,
            file_pattern: data.filePattern,
            sync_direction: data.syncDirection,
            auto_sync_enabled: data.autoSyncEnabled,
          },
        });
        setSuccess(t("admin.github.feedback.repoSyncCreated"));
      } else {
        await updateRepoSync.mutateAsync({
          token,
          syncId: editingRepoSyncId,
          payload: {
            branch: data.branch,
            file_pattern: data.filePattern,
            sync_direction: data.syncDirection,
            auto_sync_enabled: data.autoSyncEnabled,
          },
        });
        setSuccess(t("admin.github.feedback.repoSyncUpdated"));
      }
      setIsRepoSyncModalOpen(false);
      resetForm();
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.github.errors.sessionExpired"));
      } else {
        setError(
          err instanceof Error ? err.message : t("admin.github.errors.saveFailed")
        );
      }
    }
  };

  const handleDeleteRepoSync = async (sync: GitHubRepoSync) => {
    if (
      !window.confirm(
        t("admin.github.confirm.deleteRepoSync", { repo: sync.repo_full_name })
      )
    ) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      await deleteRepoSync.mutateAsync({ token, syncId: sync.id });
      setSuccess(
        t("admin.github.feedback.repoSyncDeleted", { repo: sync.repo_full_name })
      );
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.github.errors.sessionExpired"));
      } else {
        setError(
          err instanceof Error ? err.message : t("admin.github.errors.deleteFailed")
        );
      }
    }
  };

  // Trigger sync
  const handleTriggerSync = async (
    sync: GitHubRepoSync,
    operation: "pull" | "push" | "sync"
  ) => {
    setError(null);
    setSuccess(null);

    try {
      const result = await triggerSync.mutateAsync({
        token,
        syncId: sync.id,
        operation,
      });
      setActiveSyncTaskId(result.task_id);
      setSuccess(t("admin.github.sync.started"));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.github.errors.sessionExpired"));
      } else {
        setError(
          err instanceof Error ? err.message : t("admin.github.errors.syncFailed")
        );
      }
    }
  };

  // Webhook management
  const handleCreateWebhook = async (sync: GitHubRepoSync) => {
    setError(null);
    setSuccess(null);

    try {
      await createWebhook.mutateAsync({ token, syncId: sync.id });
      setSuccess(t("admin.github.feedback.webhookCreated"));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.github.errors.sessionExpired"));
      } else {
        setError(
          err instanceof Error ? err.message : t("admin.github.errors.webhookFailed")
        );
      }
    }
  };

  const handleDeleteWebhook = async (sync: GitHubRepoSync) => {
    setError(null);
    setSuccess(null);

    try {
      await deleteWebhook.mutateAsync({ token, syncId: sync.id });
      setSuccess(t("admin.github.feedback.webhookDeleted"));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.github.errors.sessionExpired"));
      } else {
        setError(
          err instanceof Error ? err.message : t("admin.github.errors.webhookFailed")
        );
      }
    }
  };

  const handleCloseModal = useCallback(() => {
    setIsRepoSyncModalOpen(false);
    resetForm();
  }, [resetForm]);

  // Table columns for integrations
  const integrationColumns = useMemo<Column<GitHubIntegration>[]>(
    () => [
      {
        key: "username",
        label: t("admin.github.integrations.columns.username"),
        render: (integration) => (
          <div>
            <strong>{integration.github_username}</strong>
            <div className="admin-table__hint">ID: {integration.github_user_id}</div>
          </div>
        ),
      },
      {
        key: "scopes",
        label: t("admin.github.integrations.columns.scopes"),
        render: (integration) => <code>{integration.scopes}</code>,
      },
      {
        key: "status",
        label: t("admin.github.integrations.columns.status"),
        render: (integration) =>
          integration.is_active
            ? t("admin.github.integrations.status.active")
            : t("admin.github.integrations.status.inactive"),
      },
      {
        key: "created",
        label: t("admin.github.integrations.columns.created"),
        render: (integration) => formatDateTime(integration.created_at),
      },
      {
        key: "actions",
        label: t("admin.github.integrations.columns.actions"),
        render: (integration) => (
          <div className="admin-table__actions">
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={deleteIntegration.isPending}
              onClick={() => handleDeleteIntegration(integration)}
            >
              {t("admin.github.actions.disconnect")}
            </button>
          </div>
        ),
      },
    ],
    [deleteIntegration.isPending, handleDeleteIntegration, t]
  );

  // Table columns for repo syncs
  const repoSyncColumns = useMemo<Column<GitHubRepoSync>[]>(
    () => [
      {
        key: "repo",
        label: t("admin.github.repoSyncs.columns.repo"),
        render: (sync) => (
          <div>
            <strong>{sync.repo_full_name}</strong>
            <div className="admin-table__hint">
              {t("admin.github.repoSyncs.branchHint", { branch: sync.branch })}
            </div>
          </div>
        ),
      },
      {
        key: "pattern",
        label: t("admin.github.repoSyncs.columns.pattern"),
        render: (sync) => <code>{sync.file_pattern}</code>,
      },
      {
        key: "direction",
        label: t("admin.github.repoSyncs.columns.direction"),
        render: (sync) => t(`admin.github.repoSyncs.direction.${sync.sync_direction}`),
      },
      {
        key: "webhook",
        label: t("admin.github.repoSyncs.columns.webhook"),
        render: (sync) =>
          sync.webhook_id
            ? t("admin.github.repoSyncs.webhook.enabled")
            : t("admin.github.repoSyncs.webhook.disabled"),
      },
      {
        key: "lastSync",
        label: t("admin.github.repoSyncs.columns.lastSync"),
        render: (sync) =>
          sync.last_sync_at
            ? formatDateTime(sync.last_sync_at)
            : t("admin.github.repoSyncs.neverSynced"),
      },
      {
        key: "actions",
        label: t("admin.github.repoSyncs.columns.actions"),
        render: (sync) => {
          const isSyncing =
            activeSyncTaskId !== null &&
            syncTaskStatus?.status !== "completed" &&
            syncTaskStatus?.status !== "failed";

          return (
            <div className="admin-table__actions">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => handleEditRepoSync(sync)}
              >
                {t("admin.github.actions.edit")}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                disabled={isSyncing}
                onClick={() => handleTriggerSync(sync, "sync")}
              >
                {isSyncing
                  ? t("admin.github.actions.syncing")
                  : t("admin.github.actions.sync")}
              </button>
              {!sync.webhook_id ? (
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={createWebhook.isPending}
                  onClick={() => handleCreateWebhook(sync)}
                >
                  {t("admin.github.actions.enableWebhook")}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={deleteWebhook.isPending}
                  onClick={() => handleDeleteWebhook(sync)}
                >
                  {t("admin.github.actions.disableWebhook")}
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={deleteRepoSync.isPending}
                onClick={() => handleDeleteRepoSync(sync)}
              >
                {t("admin.github.actions.delete")}
              </button>
            </div>
          );
        },
      },
    ],
    [
      activeSyncTaskId,
      createWebhook.isPending,
      deleteRepoSync.isPending,
      deleteWebhook.isPending,
      handleCreateWebhook,
      handleDeleteRepoSync,
      handleDeleteWebhook,
      handleEditRepoSync,
      handleTriggerSync,
      syncTaskStatus,
      t,
    ]
  );

  const isSavingRepoSync = createRepoSync.isPending || updateRepoSync.isPending;
  const isEditing = editingRepoSyncId != null;
  const modalTitle = isEditing
    ? t("admin.github.form.editTitle")
    : t("admin.github.form.createTitle");
  const submitLabel = isEditing
    ? t("admin.github.form.updateSubmit")
    : t("admin.github.form.createSubmit");
  const formId = "admin-github-repo-sync-form";

  return (
    <>
      <FeedbackMessages
        error={error}
        success={success}
        onDismissError={() => setError(null)}
        onDismissSuccess={() => setSuccess(null)}
      />

      <div className="admin-grid">
        {/* GitHub Integrations Section */}
        <FormSection
          title={t("admin.github.integrations.title")}
          subtitle={t("admin.github.integrations.subtitle")}
          className="admin-card--wide"
          headerAction={
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleStartOAuth}
              disabled={
                oauthFeedback.status === "starting" ||
                oauthFeedback.status === "pending"
              }
            >
              {oauthFeedback.status === "starting"
                ? t("admin.github.oauth.starting")
                : oauthFeedback.status === "pending"
                ? t("admin.github.oauth.pending")
                : t("admin.github.actions.connect")}
            </button>
          }
        >
          {oauthFeedback.message && oauthFeedback.status !== "idle" && (
            <div
              className={`alert ${
                oauthFeedback.status === "error"
                  ? "alert--danger"
                  : oauthFeedback.status === "success"
                  ? "alert--success"
                  : "alert--info"
              }`}
              style={{ marginBottom: "1rem" }}
            >
              {oauthFeedback.message}
            </div>
          )}

          {loadingIntegrations ? (
            <LoadingSpinner text={t("admin.github.integrations.loading")} />
          ) : integrations.length === 0 ? (
            <p className="admin-card__subtitle">
              {t("admin.github.integrations.empty")}
            </p>
          ) : (
            <ResponsiveTable
              columns={integrationColumns}
              data={integrations}
              keyExtractor={(integration) => integration.id.toString()}
              mobileCardView={true}
            />
          )}
        </FormSection>

        {/* Repository Syncs Section */}
        <FormSection
          title={t("admin.github.repoSyncs.title")}
          subtitle={t("admin.github.repoSyncs.subtitle")}
          className="admin-card--wide"
          headerAction={
            integrations.length > 0 ? (
              <button
                type="button"
                className="management-header__icon-button"
                aria-label={t("admin.github.actions.addRepoSync")}
                title={t("admin.github.actions.addRepoSync")}
                onClick={handleCreateRepoSync}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M10 4v12M4 10h12"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ) : undefined
          }
        >
          {loadingRepoSyncs ? (
            <LoadingSpinner text={t("admin.github.repoSyncs.loading")} />
          ) : repoSyncs.length === 0 ? (
            <p className="admin-card__subtitle">
              {integrations.length === 0
                ? t("admin.github.repoSyncs.emptyNoIntegration")
                : t("admin.github.repoSyncs.empty")}
            </p>
          ) : (
            <ResponsiveTable
              columns={repoSyncColumns}
              data={repoSyncs}
              keyExtractor={(sync) => sync.id.toString()}
              mobileCardView={true}
            />
          )}
        </FormSection>
      </div>

      {/* Repo Sync Modal */}
      {isRepoSyncModalOpen && (
        <Modal
          title={modalTitle}
          onClose={handleCloseModal}
          size="md"
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleCloseModal}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                form={formId}
                disabled={isSavingRepoSync}
              >
                {isSavingRepoSync ? t("admin.github.form.saving") : submitLabel}
              </button>
            </>
          }
        >
          <form
            id={formId}
            className="admin-form"
            onSubmit={handleFormSubmit(handleSubmitRepoSync)}
          >
            {!isEditing && (
              <>
                <FormField
                  label={t("admin.github.form.integrationLabel")}
                  error={formErrors.integrationId?.message}
                >
                  <select
                    className="input"
                    {...register("integrationId", { valueAsNumber: true })}
                  >
                    <option value={0}>
                      {t("admin.github.form.selectIntegration")}
                    </option>
                    {integrations.map((integration) => (
                      <option key={integration.id} value={integration.id}>
                        {integration.github_username}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField
                  label={t("admin.github.form.repoLabel")}
                  error={formErrors.repoFullName?.message}
                >
                  <select className="input" {...register("repoFullName")}>
                    <option value="">
                      {loadingRepos
                        ? t("admin.github.form.loadingRepos")
                        : t("admin.github.form.selectRepo")}
                    </option>
                    {repos.map((repo: GitHubRepo) => (
                      <option key={repo.full_name} value={repo.full_name}>
                        {repo.full_name}
                      </option>
                    ))}
                  </select>
                </FormField>
              </>
            )}

            <FormField
              label={t("admin.github.form.branchLabel")}
              error={formErrors.branch?.message}
            >
              <input
                className="input"
                type="text"
                {...register("branch")}
                placeholder="main"
              />
            </FormField>

            <FormField
              label={t("admin.github.form.patternLabel")}
              hint={t("admin.github.form.patternHint")}
              error={formErrors.filePattern?.message}
            >
              <input
                className="input"
                type="text"
                {...register("filePattern")}
                placeholder="workflows/*.json"
              />
            </FormField>

            <FormField
              label={t("admin.github.form.directionLabel")}
              error={formErrors.syncDirection?.message}
            >
              <select className="input" {...register("syncDirection")}>
                <option value="bidirectional">
                  {t("admin.github.repoSyncs.direction.bidirectional")}
                </option>
                <option value="pull_only">
                  {t("admin.github.repoSyncs.direction.pull_only")}
                </option>
                <option value="push_only">
                  {t("admin.github.repoSyncs.direction.push_only")}
                </option>
              </select>
            </FormField>

            <label className="checkbox-field">
              <input type="checkbox" {...register("autoSyncEnabled")} />
              <span>{t("admin.github.form.autoSyncLabel")}</span>
            </label>
          </form>
        </Modal>
      )}
    </>
  );
};
