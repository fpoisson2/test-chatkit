import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  cancelMcpOAuthSession,
  isUnauthorizedError,
  pollMcpOAuthSession,
  probeMcpServer,
  startMcpOAuthNegotiation,
  type McpOAuthPersistencePlan,
  type McpOAuthSessionStatus,
  type McpServerPayload,
  type McpServerSummary,
  type McpTestConnectionResponse,
} from "../utils/backend";
import {
  useMcpServers,
  useCreateMcpServer,
  useUpdateMcpServer,
  useDeleteMcpServer,
} from "../hooks";
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
import { adminMcpServerSchema, type AdminMcpServerFormData } from "../schemas/admin";

const emptyFormState: AdminMcpServerFormData = {
  label: "",
  serverUrl: "",
  authorization: "",
  accessToken: "",
  refreshToken: "",
  oauthClientId: "",
  oauthClientSecret: "",
  oauthScope: "",
  oauthAuthorizationEndpoint: "",
  oauthTokenEndpoint: "",
  oauthRedirectUri: "",
  oauthMetadata: "",
  isActive: true,
};

type OAuthFeedbackState = {
  status: "idle" | "starting" | "pending" | "success" | "error";
  message: string | null;
  stateId: string | null;
  serverId: number | null;
};

const initialOAuthFeedback: OAuthFeedbackState = {
  status: "idle",
  message: null,
  stateId: null,
  serverId: null,
};

const formatDateTime = (value: string | null): string => {
  if (!value) {
    return "";
  }
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  } catch (error) {
    return value;
  }
};

const extractToolNames = (server: McpServerSummary): string[] => {
  const cache = server.tools_cache;
  if (!cache || typeof cache !== "object") {
    return [];
  }
  const rawNames = (cache as { tool_names?: unknown }).tool_names;
  if (!Array.isArray(rawNames)) {
    return [];
  }
  return rawNames.filter((name): name is string => typeof name === "string" && !!name);
};

const extractStringFromTokenPayload = (
  payload: unknown,
  candidateKeys: string[],
): string | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

  const normalizedCandidates = candidateKeys
    .map((key) => normalizeKey(key))
    .filter((key) => key.length > 0)
    .sort((a, b) => b.length - a.length);

  const visited = new Set<object>();
  type StackEntry = { value: unknown; matchedCandidate: string | null };
  const stack: StackEntry[] = [{ value: payload, matchedCandidate: null }];

  while (stack.length > 0) {
    const { value, matchedCandidate } = stack.pop()!;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed && matchedCandidate) {
        return trimmed;
      }
      continue;
    }

    if (!value || typeof value !== "object") {
      continue;
    }

    if (visited.has(value as object)) {
      continue;
    }
    visited.add(value as object);

    if (Array.isArray(value)) {
      for (const item of value) {
        stack.push({ value: item, matchedCandidate });
      }
      continue;
    }

    const record = value as Record<string, unknown>;
    for (const [rawKey, child] of Object.entries(record)) {
      if (!rawKey) {
        stack.push({ value: child, matchedCandidate });
        continue;
      }

      const normalizedKey = normalizeKey(rawKey);
      const candidateMatch = normalizedCandidates.find((candidate) => {
        if (candidate === normalizedKey) {
          return true;
        }
        if (!normalizedKey || !candidate) {
          return false;
        }
        if (normalizedKey.length > candidate.length) {
          return normalizedKey.includes(candidate);
        }
        return candidate.includes(normalizedKey);
      });

      const nextMatch = candidateMatch ?? matchedCandidate;

      if (typeof child === "string") {
        const trimmed = child.trim();
        if (trimmed && nextMatch) {
          return trimmed;
        }
        continue;
      }

      stack.push({ value: child, matchedCandidate: nextMatch });
    }
  }

  return null;
};

const buildPayloadFromForm = (
  form: AdminMcpServerFormData,
  current: McpServerSummary | null,
): McpServerPayload => {
  const payload: McpServerPayload = {
    label: form.label,
    server_url: form.serverUrl,
    is_active: form.isActive,
  };

  // Add optional secrets if provided
  if (form.authorization?.trim()) {
    payload.authorization = form.authorization.trim();
  }
  if (form.accessToken?.trim()) {
    payload.access_token = form.accessToken.trim();
  }
  if (form.refreshToken?.trim()) {
    payload.refresh_token = form.refreshToken.trim();
  }
  if (form.oauthClientSecret?.trim()) {
    payload.oauth_client_secret = form.oauthClientSecret.trim();
  }

  // Add optional fields or set to null if clearing
  const assignOptionalField = (
    key:
      | "oauth_client_id"
      | "oauth_scope"
      | "oauth_authorization_endpoint"
      | "oauth_token_endpoint"
      | "oauth_redirect_uri",
    value: string | undefined,
    currentValue: string | null | undefined,
  ) => {
    const trimmed = value?.trim();
    if (trimmed) {
      payload[key] = trimmed;
    } else if (currentValue && current) {
      payload[key] = null;
    }
  };

  assignOptionalField("oauth_client_id", form.oauthClientId, current?.oauth_client_id);
  assignOptionalField("oauth_scope", form.oauthScope, current?.oauth_scope);
  assignOptionalField(
    "oauth_authorization_endpoint",
    form.oauthAuthorizationEndpoint,
    current?.oauth_authorization_endpoint,
  );
  assignOptionalField(
    "oauth_token_endpoint",
    form.oauthTokenEndpoint,
    current?.oauth_token_endpoint,
  );
  assignOptionalField(
    "oauth_redirect_uri",
    form.oauthRedirectUri,
    current?.oauth_redirect_uri,
  );

  // Handle JSON metadata
  const metadataDraft = form.oauthMetadata?.trim();
  if (metadataDraft) {
    const parsed = JSON.parse(metadataDraft);
    payload.oauth_metadata = parsed as Record<string, unknown>;
  } else if (current?.oauth_metadata && current) {
    payload.oauth_metadata = null;
  }

  return payload;
};

export const AdminMcpServersPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();

  // React Query hooks
  const { data: servers = [], isLoading: loading, error: serversError } = useMcpServers(token);
  const createServer = useCreateMcpServer();
  const updateServer = useUpdateMcpServer();
  const deleteServer = useDeleteMcpServer();

  // React Hook Form
  const {
    register,
    handleSubmit: handleFormSubmit,
    formState: { errors: formErrors },
    watch,
    reset,
    getValues,
  } = useForm<AdminMcpServerFormData>({
    resolver: zodResolver(adminMcpServerSchema),
    defaultValues: emptyFormState,
  });

  // Local UI state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [probeFeedback, setProbeFeedback] = useState<string | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [oauthFeedback, setOauthFeedback] = useState<OAuthFeedbackState>(
    initialOAuthFeedback,
  );
  const [isModalOpen, setIsModalOpen] = useState(false);
  const oauthPlanRef = useRef<McpOAuthPersistencePlan | null>(null);
  const pendingStateRef = useRef<string | null>(null);

  const isSaving = createServer.isPending || updateServer.isPending;
  const deletingId = deleteServer.variables?.serverId ?? null;

  const currentServer = useMemo(
    () => servers.find((server) => server.id === editingId) ?? null,
    [servers, editingId],
  );

  const resetForm = useCallback(() => {
    reset(emptyFormState);
    setEditingId(null);
    setProbeFeedback(null);
    setProbeError(null);
    setOauthFeedback(initialOAuthFeedback);
    oauthPlanRef.current = null;
  }, [reset]);

  const applyServerToForm = useCallback((server: McpServerSummary) => {
    reset({
      label: server.label ?? "",
      serverUrl: server.server_url ?? "",
      authorization: "",
      accessToken: "",
      refreshToken: "",
      oauthClientId: server.oauth_client_id ?? "",
      oauthClientSecret: "",
      oauthScope: server.oauth_scope ?? "",
      oauthAuthorizationEndpoint: server.oauth_authorization_endpoint ?? "",
      oauthTokenEndpoint: server.oauth_token_endpoint ?? "",
      oauthRedirectUri: server.oauth_redirect_uri ?? "",
      oauthMetadata: server.oauth_metadata ? JSON.stringify(server.oauth_metadata, null, 2) : "",
      isActive: server.is_active ?? true,
    });
    setEditingId(server.id);
  }, [reset]);

  const handleCreate = () => {
    resetForm();
    setError(null);
    setSuccess(null);
    setIsModalOpen(true);
  };

  const handleEdit = (server: McpServerSummary) => {
    applyServerToForm(server);
    setError(null);
    setSuccess(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (server: McpServerSummary) => {
    if (!window.confirm(t("admin.mcpServers.confirm.delete", { label: server.label }))) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      await deleteServer.mutateAsync({ token, serverId: server.id });
      setSuccess(t("admin.mcpServers.feedback.deleted", { label: server.label }));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.mcpServers.errors.sessionExpired"));
      } else {
        setError(
          err instanceof Error ? err.message : t("admin.mcpServers.errors.deleteFailed"),
        );
      }
    }
  };


  const handleRefreshTools = async (server: McpServerSummary) => {
    setRefreshingId(server.id);
    setError(null);
    setSuccess(null);

    try {
      await updateServer.mutateAsync({
        token,
        serverId: server.id,
        payload: { refresh_tools: true },
      });
      setSuccess(t("admin.mcpServers.feedback.refreshed", { label: server.label }));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.mcpServers.errors.sessionExpired"));
      } else {
        setError(
          err instanceof Error
            ? err.message
            : t("admin.mcpServers.errors.refreshFailed"),
        );
      }
    } finally {
      setRefreshingId(null);
    }
  };

  const handleSubmit = async (data: AdminMcpServerFormData) => {
    setError(null);
    setSuccess(null);

    try {
      const payload = buildPayloadFromForm(data, currentServer);

      if (editingId == null) {
        const created = await createServer.mutateAsync({ token, payload });
        setSuccess(t("admin.mcpServers.feedback.created", { label: created.label }));
        setIsModalOpen(false);
        resetForm();
      } else {
        const updated = await updateServer.mutateAsync({ token, serverId: editingId, payload });
        setSuccess(t("admin.mcpServers.feedback.updated", { label: updated.label }));
        setIsModalOpen(false);
        resetForm();
      }
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.mcpServers.errors.sessionExpired"));
      } else {
        setError(
          err instanceof Error ? err.message : t("admin.mcpServers.errors.saveFailed"),
        );
      }
    }
  };

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    resetForm();
  }, [resetForm]);

  const handleTestConnection = async () => {
    if (!token) {
      return;
    }

    setIsTesting(true);
    setProbeFeedback(null);
    setProbeError(null);
    setError(null);
    setSuccess(null);

    const formData = getValues();

    let response: McpTestConnectionResponse;
    try {
      response = await probeMcpServer({
        token,
        url: formData.serverUrl,
        authorization: formData.authorization || null,
        accessToken: formData.accessToken || null,
      });
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.mcpServers.errors.sessionExpired"));
      } else {
        setProbeError(
          err instanceof Error ? err.message : t("admin.mcpServers.test.errorGeneric"),
        );
      }
      setIsTesting(false);
      return;
    }

    setIsTesting(false);

    if (response.success) {
      const names = response.tool_names ?? [];
      setProbeFeedback(
        names.length
          ? t("admin.mcpServers.test.successWithTools", {
              count: names.length,
              tools: names.join(", "),
            })
          : t("admin.mcpServers.test.success"),
      );
      setProbeError(null);
    } else {
      const detail = response.detail || t("admin.mcpServers.test.errorGeneric");
      setProbeError(detail);
      setProbeFeedback(null);
    }
  };

  const handleStartOAuth = useCallback(async () => {
    if (!token) {
      return;
    }
    const formData = getValues();
    const basePayload = buildPayloadFromForm(formData, currentServer);

    const previousState = oauthFeedback.stateId;
    if (previousState) {
      void cancelMcpOAuthSession({ token, state: previousState }).catch(() => {});
    }

    setOauthFeedback({
      status: "starting",
      message: t("admin.mcpServers.oauth.starting"),
      stateId: null,
      serverId: editingId,
    });
    setError(null);
    setSuccess(null);

    const persistencePlan: McpOAuthPersistencePlan = {
      serverId: editingId ?? undefined,
      payload: basePayload,
      refreshToolsOnSuccess: true,
      storeTokenMetadata: true,
    };

    oauthPlanRef.current = persistencePlan;

    try {
      const result = await startMcpOAuthNegotiation({
        token,
        url: basePayload.server_url ?? formData.serverUrl.trim(),
        clientId: (basePayload.oauth_client_id ?? formData.oauthClientId?.trim()) || null,
        scope: (basePayload.oauth_scope ?? formData.oauthScope?.trim()) || null,
        persistence: persistencePlan,
      });

      const serverId = result.server_id ?? editingId ?? null;
      if (serverId != null) {
        oauthPlanRef.current = { ...persistencePlan, serverId };
        setEditingId(serverId);
      }

      if (typeof window !== "undefined") {
        const popup = window.open(result.authorization_url, "_blank");
        popup?.focus?.();
      }

      setOauthFeedback({
        status: "pending",
        message: t("admin.mcpServers.oauth.pending"),
        stateId: result.state,
        serverId,
      });
      pendingStateRef.current = result.state;
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.mcpServers.errors.sessionExpired"));
      } else {
        const message =
          err instanceof Error
            ? err.message
            : t("admin.mcpServers.oauth.errorGeneric");
        setError(message);
        setOauthFeedback({
          status: "error",
          message,
          stateId: null,
          serverId: editingId,
        });
      }
    }
  }, [
    currentServer,
    editingId,
    getValues,
    logout,
    oauthFeedback.stateId,
    t,
    token,
  ]);

  // OAuth polling
  useEffect(() => {
    const currentState = pendingStateRef.current;
    if (!currentState || !token || oauthFeedback.status !== "pending") {
      return;
    }

    let isCancelled = false;

    const poll = async () => {
      while (!isCancelled && pendingStateRef.current === currentState) {
        try {
          const status: McpOAuthSessionStatus = await pollMcpOAuthSession({
            token,
            state: currentState,
          });

          if (status.status === "completed") {
            if (isCancelled) {
              return;
            }

            const plan = oauthPlanRef.current;
            if (plan) {
              const { access_token, refresh_token, metadata } = status;
              const accessTokenDraft = access_token
                ? extractStringFromTokenPayload(access_token, [
                    "access_token",
                    "accessToken",
                    "token",
                  ]) ?? ""
                : "";

              const refreshTokenDraft = refresh_token
                ? extractStringFromTokenPayload(refresh_token, [
                    "refresh_token",
                    "refreshToken",
                  ]) ?? ""
                : "";

              reset((prev) => ({
                ...prev,
                accessToken: accessTokenDraft,
                refreshToken: refreshTokenDraft,
                oauthMetadata: metadata ? JSON.stringify(metadata, null, 2) : "",
              }));
            }

            setOauthFeedback({
              status: "success",
              message: t("admin.mcpServers.oauth.success"),
              stateId: null,
              serverId: oauthFeedback.serverId,
            });
            pendingStateRef.current = null;
            break;
          }

          if (status.status === "failed") {
            if (isCancelled) {
              return;
            }

            const errMsg = status.error || t("admin.mcpServers.oauth.errorGeneric");
            setOauthFeedback({
              status: "error",
              message: errMsg,
              stateId: null,
              serverId: oauthFeedback.serverId,
            });
            pendingStateRef.current = null;
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 1500));
        } catch (err) {
          if (isCancelled) {
            return;
          }

          if (isUnauthorizedError(err)) {
            logout();
            setError(t("admin.mcpServers.errors.sessionExpired"));
          } else {
            const errMsg =
              err instanceof Error
                ? err.message
                : t("admin.mcpServers.oauth.errorGeneric");
            setOauthFeedback({
              status: "error",
              message: errMsg,
              stateId: null,
              serverId: oauthFeedback.serverId,
            });
          }
          pendingStateRef.current = null;
          break;
        }
      }
    };

    void poll();

    return () => {
      isCancelled = true;
    };
  }, [
    oauthFeedback.status,
    oauthFeedback.serverId,
    token,
    logout,
    t,
    reset,
  ]);

  const currentAuthorizationHint = currentServer?.authorization_hint;
  const currentAccessTokenHint = currentServer?.access_token_hint;
  const currentRefreshTokenHint = currentServer?.refresh_token_hint;
  const currentClientSecretHint = currentServer?.oauth_client_secret_hint;

  const isEditing = editingId != null;
  const watchedLabel = watch("label");
  const modalTitle = isEditing
    ? t("admin.mcpServers.form.editTitle", {
        label: currentServer?.label ?? watchedLabel ?? "",
      })
    : t("admin.mcpServers.form.createTitle");
  const modalSubtitle = isEditing
    ? t("admin.mcpServers.form.editSubtitle")
    : t("admin.mcpServers.form.createSubtitle");
  const submitLabel = isEditing
    ? t("admin.mcpServers.form.updateSubmit")
    : t("admin.mcpServers.form.createSubmit");
  const cancelLabel = isEditing
    ? t("admin.mcpServers.form.cancelEdit")
    : t("admin.mcpServers.form.cancel");
  const formId = "admin-mcp-server-modal-form";

  const mcpServerColumns = useMemo<Column<McpServerSummary>[]>(
    () => [
      {
        key: "label",
        label: t("admin.mcpServers.list.columns.label"),
        render: (server) => (
          <div>
            <strong>{server.label}</strong>
            {server.authorization_hint && (
              <div className="admin-table__hint">
                {t("admin.mcpServers.list.authorizationHint", {
                  hint: server.authorization_hint,
                })}
              </div>
            )}
          </div>
        ),
      },
      {
        key: "url",
        label: t("admin.mcpServers.list.columns.url"),
        render: (server) => <code>{server.server_url}</code>,
      },
      {
        key: "tools",
        label: t("admin.mcpServers.list.columns.tools"),
        render: (server) => {
          const toolNames = extractToolNames(server);
          return toolNames.length
            ? t("admin.mcpServers.list.toolsWithNames", {
                count: toolNames.length,
                tools: toolNames.join(", "),
              })
            : t("admin.mcpServers.list.toolsEmpty");
        },
      },
      {
        key: "updated",
        label: t("admin.mcpServers.list.columns.updated"),
        render: (server) =>
          server.tools_cache_updated_at
            ? formatDateTime(server.tools_cache_updated_at)
            : t("admin.mcpServers.list.neverRefreshed"),
      },
      {
        key: "status",
        label: t("admin.mcpServers.list.columns.status"),
        render: (server) =>
          server.is_active
            ? t("admin.mcpServers.list.status.active")
            : t("admin.mcpServers.list.status.inactive"),
      },
      {
        key: "actions",
        label: t("admin.mcpServers.list.columns.actions"),
        render: (server) => {
          const isRefreshing = refreshingId === server.id;
          const isDeleting = deletingId === server.id;
          return (
            <div className="admin-table__actions">
              <button
                type="button"
                className="button button--small"
                onClick={() => handleEdit(server)}
              >
                {t("admin.mcpServers.actions.edit")}
              </button>
              <button
                type="button"
                className="button button--secondary button--small"
                disabled={isRefreshing}
                onClick={() => handleRefreshTools(server)}
              >
                {isRefreshing
                  ? t("admin.mcpServers.actions.refreshing")
                  : t("admin.mcpServers.actions.refreshTools")}
              </button>
              <button
                type="button"
                className="button button--danger button--small"
                disabled={isDeleting}
                onClick={() => handleDelete(server)}
              >
                {isDeleting
                  ? t("admin.mcpServers.actions.deleting")
                  : t("admin.mcpServers.actions.delete")}
              </button>
            </div>
          );
        },
      },
    ],
    [
      deletingId,
      handleDelete,
      handleEdit,
      handleRefreshTools,
      refreshingId,
      t,
    ],
  );

  return (
    <>
      <FeedbackMessages
        error={error}
        success={success}
        onDismissError={() => setError(null)}
        onDismissSuccess={() => setSuccess(null)}
      />

      <div className="admin-grid">
        <FormSection
          title={t("admin.mcpServers.list.title")}
          subtitle={t("admin.mcpServers.list.subtitle")}
          className="admin-card--wide"
          headerAction={
            <button
              type="button"
              className="management-header__icon-button"
              aria-label="Ajouter un serveur MCP"
              title="Ajouter un serveur MCP"
              onClick={handleCreate}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M10 4v12M4 10h12"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          }
        >
          {loading ? (
            <LoadingSpinner text={t("admin.mcpServers.list.loading")} />
          ) : servers.length === 0 ? (
            <p className="admin-card__subtitle">{t("admin.mcpServers.list.empty")}</p>
          ) : (
            <ResponsiveTable
              columns={mcpServerColumns}
              data={servers}
              keyExtractor={(server) => server.id.toString()}
              mobileCardView={true}
            />
          )}
        </FormSection>

      </div>

      {isModalOpen ? (
        <Modal
          title={modalTitle}
          onClose={handleCloseModal}
          size="lg"
          footer={
            <>
              <button
                type="button"
                className="button button--ghost"
                onClick={handleCloseModal}
              >
                {cancelLabel}
              </button>
              <button
                type="submit"
                className="button"
                form={formId}
                disabled={isSaving}
              >
                {isSaving ? t("admin.mcpServers.form.saving") : submitLabel}
              </button>
            </>
          }
        >
          <form id={formId} className="admin-form" onSubmit={handleFormSubmit(handleSubmit)}>
            {modalSubtitle ? (
              <p className="admin-card__subtitle">{modalSubtitle}</p>
            ) : null}

            <FormField
              label={t("admin.mcpServers.form.labelLabel")}
              error={formErrors.label?.message}
            >
              <input
                className="input"
                type="text"
                {...register("label")}
                placeholder={t("admin.mcpServers.form.labelPlaceholder")}
              />
            </FormField>

            <FormField
              label={t("admin.mcpServers.form.serverUrlLabel")}
              error={formErrors.serverUrl?.message}
            >
              <input
                className="input"
                type="url"
                {...register("serverUrl")}
                placeholder={t("admin.mcpServers.form.serverUrlPlaceholder")}
              />
            </FormField>

            <FormField
              label={t("admin.mcpServers.form.authorizationLabel")}
              hint={
                currentAuthorizationHint
                  ? t("admin.mcpServers.form.authorizationHint", {
                      hint: currentAuthorizationHint,
                    })
                  : undefined
              }
            >
              <input
                className="input"
                type="text"
                {...register("authorization")}
                placeholder={t("admin.mcpServers.form.authorizationPlaceholder")}
              />
            </FormField>

            <div className="admin-form__row">
              <FormField
                label={t("admin.mcpServers.form.accessTokenLabel")}
                hint={
                  currentAccessTokenHint
                    ? t("admin.mcpServers.form.accessTokenHint", {
                        hint: currentAccessTokenHint,
                      })
                    : undefined
                }
              >
                <input
                  className="input"
                  type="text"
                  {...register("accessToken")}
                  placeholder={t("admin.mcpServers.form.accessTokenPlaceholder")}
                />
              </FormField>

              <FormField
                label={t("admin.mcpServers.form.refreshTokenLabel")}
                hint={
                  currentRefreshTokenHint
                    ? t("admin.mcpServers.form.refreshTokenHint", {
                        hint: currentRefreshTokenHint,
                      })
                    : undefined
                }
              >
                <input
                  className="input"
                  type="text"
                  {...register("refreshToken")}
                  placeholder={t("admin.mcpServers.form.refreshTokenPlaceholder")}
                />
              </FormField>
            </div>

            <FormField label={t("admin.mcpServers.form.oauthClientIdLabel")}>
              <input
                className="input"
                type="text"
                {...register("oauthClientId")}
                placeholder={t("admin.mcpServers.form.oauthClientIdPlaceholder")}
              />
            </FormField>

            <FormField
              label={t("admin.mcpServers.form.oauthClientSecretLabel")}
              hint={
                currentClientSecretHint
                  ? t("admin.mcpServers.form.oauthClientSecretHint", {
                      hint: currentClientSecretHint,
                    })
                  : undefined
              }
            >
              <input
                className="input"
                type="password"
                {...register("oauthClientSecret")}
                placeholder={t("admin.mcpServers.form.oauthClientSecretPlaceholder")}
              />
            </FormField>

            <FormField label={t("admin.mcpServers.form.oauthScopeLabel")}>
              <input
                className="input"
                type="text"
                {...register("oauthScope")}
                placeholder={t("admin.mcpServers.form.oauthScopePlaceholder")}
              />
            </FormField>

            <div className="admin-form__row">
              <FormField label={t("admin.mcpServers.form.oauthAuthorizationEndpointLabel")}>
                <input
                  className="input"
                  type="url"
                  {...register("oauthAuthorizationEndpoint")}
                  placeholder={t(
                    "admin.mcpServers.form.oauthAuthorizationEndpointPlaceholder",
                  )}
                />
              </FormField>

              <FormField label={t("admin.mcpServers.form.oauthTokenEndpointLabel")}>
                <input
                  className="input"
                  type="url"
                  {...register("oauthTokenEndpoint")}
                  placeholder={t(
                    "admin.mcpServers.form.oauthTokenEndpointPlaceholder",
                  )}
                />
              </FormField>
            </div>

            <FormField label={t("admin.mcpServers.form.oauthRedirectUriLabel")}>
              <input
                className="input"
                type="url"
                {...register("oauthRedirectUri")}
                placeholder={t(
                  "admin.mcpServers.form.oauthRedirectUriPlaceholder",
                )}
              />
            </FormField>

            <FormField
              label={t("admin.mcpServers.form.oauthMetadataLabel")}
              error={formErrors.oauthMetadata?.message}
              hint={t("admin.mcpServers.form.oauthMetadataHint")}
            >
              <textarea
                className="textarea"
                rows={4}
                {...register("oauthMetadata")}
                placeholder={t("admin.mcpServers.form.oauthMetadataPlaceholder")}
              />
            </FormField>

            <label className="checkbox-field">
              <input type="checkbox" {...register("isActive")} />
              <span>{t("admin.mcpServers.form.isActiveLabel")}</span>
            </label>

            <div className="admin-form__actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={handleStartOAuth}
                disabled={
                  oauthFeedback.status === "starting" || oauthFeedback.status === "pending"
                }
              >
                {oauthFeedback.status === "starting"
                  ? t("admin.mcpServers.oauth.starting")
                  : t("admin.mcpServers.form.oauthButton")}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={handleTestConnection}
                disabled={isTesting}
              >
                {isTesting
                  ? t("admin.mcpServers.test.running")
                  : t("admin.mcpServers.form.testButton")}
              </button>
            </div>

            {oauthFeedback.message && (
              <div
                className={`alert ${
                  oauthFeedback.status === "error"
                    ? "alert--danger"
                    : oauthFeedback.status === "success"
                    ? "alert--success"
                    : "alert--info"
                }`}
              >
                {oauthFeedback.message}
              </div>
            )}

            {probeFeedback && (
              <div className="alert alert--success">{probeFeedback}</div>
            )}
            {probeError && <div className="alert alert--danger">{probeError}</div>}
          </form>
        </Modal>
      ) : null}

    </>
  );
};
