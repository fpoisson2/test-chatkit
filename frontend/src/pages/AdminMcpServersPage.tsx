import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelMcpOAuthSession,
  isUnauthorizedError,
  mcpServersApi,
  pollMcpOAuthSession,
  probeMcpServer,
  startMcpOAuthNegotiation,
  type McpOAuthPersistencePlan,
  type McpOAuthSessionStatus,
  type McpServerPayload,
  type McpServerSummary,
  type McpTestConnectionResponse,
} from "../utils/backend";
import { useAuth } from "../auth";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { ResponsiveTable, type Column } from "../components";
import { useI18n } from "../i18n";

const emptyFormState = () => ({
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
});

type McpServerFormState = ReturnType<typeof emptyFormState>;

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
  form: McpServerFormState,
  current: McpServerSummary | null,
): McpServerPayload | { error: string } => {
  const payload: McpServerPayload = {};
  const label = form.label.trim();
  const serverUrl = form.serverUrl.trim();

  if (!label) {
    return { error: "label" };
  }
  if (!serverUrl) {
    return { error: "serverUrl" };
  }

  payload.label = label;
  payload.server_url = serverUrl;
  payload.is_active = Boolean(form.isActive);

  const assignOptionalSecret = (
    key: "authorization" | "access_token" | "refresh_token" | "oauth_client_secret",
    value: string,
  ) => {
    const trimmed = value.trim();
    if (trimmed) {
      payload[key] = trimmed;
    }
  };

  const assignOptionalField = (
    key:
      | "oauth_client_id"
      | "oauth_scope"
      | "oauth_authorization_endpoint"
      | "oauth_token_endpoint"
      | "oauth_redirect_uri",
    value: string,
    currentValue: string | null | undefined,
  ) => {
    const trimmed = value.trim();
    if (trimmed) {
      payload[key] = trimmed;
    } else if (currentValue && current) {
      payload[key] = null;
    }
  };

  assignOptionalSecret("authorization", form.authorization);
  assignOptionalSecret("access_token", form.accessToken);
  assignOptionalSecret("refresh_token", form.refreshToken);
  assignOptionalSecret("oauth_client_secret", form.oauthClientSecret);

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

  const metadataDraft = form.oauthMetadata.trim();
  if (metadataDraft) {
    try {
      const parsed = JSON.parse(metadataDraft);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { error: "metadata" };
      }
      payload.oauth_metadata = parsed as Record<string, unknown>;
    } catch (error) {
      return { error: "metadata" };
    }
  } else if (current?.oauth_metadata && current) {
    payload.oauth_metadata = null;
  }

  return payload;
};

export const AdminMcpServersPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();
  const [servers, setServers] = useState<McpServerSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formState, setFormState] = useState<McpServerFormState>(emptyFormState);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [probeFeedback, setProbeFeedback] = useState<string | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [oauthFeedback, setOauthFeedback] = useState<OAuthFeedbackState>(
    initialOAuthFeedback,
  );
  const oauthPlanRef = useRef<McpOAuthPersistencePlan | null>(null);
  const pendingStateRef = useRef<string | null>(null);

  const currentServer = useMemo(
    () => servers.find((server) => server.id === editingId) ?? null,
    [servers, editingId],
  );

  const resetForm = useCallback(() => {
    setFormState(emptyFormState());
    setEditingId(null);
    setProbeFeedback(null);
    setProbeError(null);
    setOauthFeedback(initialOAuthFeedback);
    oauthPlanRef.current = null;
  }, []);

  const applyServerToForm = useCallback((server: McpServerSummary) => {
    setFormState({
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
      oauthMetadata: server.oauth_metadata
        ? JSON.stringify(server.oauth_metadata, null, 2)
        : "",
      isActive: Boolean(server.is_active),
    });
    setProbeFeedback(null);
    setProbeError(null);
    setOauthFeedback(initialOAuthFeedback);
    oauthPlanRef.current = null;
  }, []);

  const loadServers = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await mcpServersApi.list(token);
      setServers(result);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.mcpServers.errors.sessionExpired"));
      } else {
        setError(
          err instanceof Error
            ? err.message
            : t("admin.mcpServers.errors.loadFailed"),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [logout, t, token]);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  useEffect(() => {
    pendingStateRef.current = oauthFeedback.stateId;
  }, [oauthFeedback.stateId]);

  useEffect(() => {
    return () => {
      const pendingState = pendingStateRef.current;
      if (pendingState) {
        void cancelMcpOAuthSession({ token: token ?? null, state: pendingState }).catch(
          () => {},
        );
      }
    };
  }, [token]);

  const persistOAuthTokens = useCallback(
    async ({
      serverId,
      tokenPayload,
      plan,
    }: {
      serverId: number | null;
      tokenPayload: Record<string, unknown>;
      plan: McpOAuthPersistencePlan | null;
    }): Promise<
      | { ok: true; server: McpServerSummary | null }
      | { ok: false; message: string }
    > => {
      if (!token) {
        return { ok: false, message: t("admin.mcpServers.errors.sessionExpired") };
      }

      const planPayload: McpServerPayload = { ...(plan?.payload ?? {}) };
      const existingServer =
        serverId != null ? servers.find((item) => item.id === serverId) ?? null : null;

      if (!planPayload.label && existingServer?.label) {
        planPayload.label = existingServer.label;
      }
      if (!planPayload.server_url && existingServer?.server_url) {
        planPayload.server_url = existingServer.server_url;
      }
      if (planPayload.is_active === undefined && existingServer) {
        planPayload.is_active = Boolean(existingServer.is_active);
      }
      if (!planPayload.transport && existingServer?.transport) {
        planPayload.transport = existingServer.transport ?? undefined;
      }

      const resolvedLabel =
        typeof planPayload.label === "string" ? planPayload.label.trim() : "";
      const resolvedUrl =
        typeof planPayload.server_url === "string" ? planPayload.server_url.trim() : "";

      if (!resolvedLabel || !resolvedUrl) {
        return {
          ok: false,
          message: t("admin.mcpServers.oauth.errorMissingDraft"),
        };
      }

      const accessToken =
        extractStringFromTokenPayload(tokenPayload, ["access_token", "accesstoken", "access-token"]) || "";
      const refreshToken =
        extractStringFromTokenPayload(tokenPayload, ["refresh_token", "refreshtoken", "refresh-token"]) || "";
      const tokenType =
        extractStringFromTokenPayload(tokenPayload, ["token_type", "tokentype", "type"]) || "";
      const explicitAuthorization =
        extractStringFromTokenPayload(tokenPayload, [
          "authorization",
          "authorization_header",
          "authorizationheader",
        ]) || "";

      const shouldRefreshTools =
        plan?.refreshToolsOnSuccess === undefined
          ? true
          : Boolean(plan.refreshToolsOnSuccess);

      const payload: McpServerPayload = {
        ...planPayload,
        label: resolvedLabel,
        server_url: resolvedUrl,
        refresh_tools: shouldRefreshTools,
      };

      if (accessToken) {
        payload.access_token = accessToken;
      }

      const resolvedAuthorization = (() => {
        if (explicitAuthorization) {
          return explicitAuthorization;
        }
        if (!accessToken) {
          return "";
        }
        const scheme = tokenType || "Bearer";
        return `${scheme} ${accessToken}`.trim();
      })();

      if (resolvedAuthorization) {
        payload.authorization = resolvedAuthorization;
      }

      if (refreshToken) {
        payload.refresh_token = refreshToken;
      }

      const shouldStoreMetadata = plan?.storeTokenMetadata ?? true;
      const planMetadata = planPayload.oauth_metadata;

      if (shouldStoreMetadata) {
        const existingMetadata = existingServer?.oauth_metadata;
        const baseMetadata = (() => {
          if (planMetadata && typeof planMetadata === "object" && !Array.isArray(planMetadata)) {
            return planMetadata;
          }
          if (
            existingMetadata &&
            typeof existingMetadata === "object" &&
            !Array.isArray(existingMetadata)
          ) {
            return existingMetadata;
          }
          return undefined;
        })();

        payload.oauth_metadata = {
          ...(baseMetadata ?? {}),
          token: tokenPayload,
        };
      } else if (planMetadata !== undefined) {
        payload.oauth_metadata = planMetadata ?? null;
      }

      try {
        let persisted: McpServerSummary | null = null;

        if (serverId != null) {
          const updated = await mcpServersApi.update(token, serverId, payload);
          persisted = updated;
          setServers((prev) =>
            prev.map((item) => (item.id === updated.id ? updated : item)),
          );
          if (editingId === serverId) {
            applyServerToForm(updated);
          }
        } else {
          const created = await mcpServersApi.create(token, payload);
          persisted = created;
          setServers((prev) => {
            const others = prev.filter((item) => item.id !== created.id);
            return [...others, created].sort((a, b) =>
              a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
            );
          });
          setEditingId(created.id);
          applyServerToForm(created);
        }

        return { ok: true, server: persisted };
      } catch (err) {
        if (isUnauthorizedError(err)) {
          logout();
          return { ok: false, message: t("admin.mcpServers.errors.sessionExpired") };
        }
        const message =
          err instanceof Error
            ? err.message
            : t("admin.mcpServers.oauth.errorGeneric");
        return { ok: false, message };
      }
    },
    [
      applyServerToForm,
      editingId,
      logout,
      servers,
      setEditingId,
      t,
      token,
    ],
  );

  const handleOAuthResult = useCallback(
    async (result: McpOAuthSessionStatus) => {
      if (result.status === "pending") {
        return;
      }

      pendingStateRef.current = null;

      if (result.status === "ok") {
        const plan = oauthPlanRef.current;
        const fallbackServerId = plan?.serverId ?? oauthFeedback.serverId ?? null;
        let persistedServerId: number | null = fallbackServerId;

        if (result.token && typeof result.token === "object") {
          const outcome = await persistOAuthTokens({
            serverId: fallbackServerId,
            tokenPayload: result.token as Record<string, unknown>,
            plan: plan ?? null,
          });

          if (!outcome.ok) {
            const message = outcome.message;
            setOauthFeedback({
              status: "error",
              message,
              stateId: null,
              serverId: fallbackServerId,
            });
            setError(message);
            return;
          }

          persistedServerId = outcome.server?.id ?? fallbackServerId ?? null;
        }

        setOauthFeedback({
          status: "success",
          message: t("admin.mcpServers.oauth.success"),
          stateId: null,
          serverId: persistedServerId,
        });
        setSuccess(t("admin.mcpServers.feedback.oauthSuccess"));
        setError(null);
        setProbeFeedback(null);
        setProbeError(null);
        oauthPlanRef.current = null;
        void loadServers();
      } else {
        const detail =
          "error" in result && typeof result.error === "string"
            ? result.error
            : undefined;
        const message = detail
          ? t("admin.mcpServers.oauth.errorWithDetail", { detail })
          : t("admin.mcpServers.oauth.errorGeneric");
        setOauthFeedback({
          status: "error",
          message,
          stateId: null,
          serverId: oauthFeedback.serverId ?? null,
        });
        if (detail) {
          setError(message);
        }
      }
    },
    [
      loadServers,
      oauthFeedback.serverId,
      persistOAuthTokens,
      t,
    ],
  );

  useEffect(() => {
    if (oauthFeedback.status !== "pending" || !oauthFeedback.stateId) {
      return undefined;
    }

    let cancelled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (!token) {
        return;
      }
      try {
        const plan = oauthPlanRef.current;
        const result = await pollMcpOAuthSession({
          token,
          state: oauthFeedback.stateId as string,
          persistence: plan
            ? { ...plan, serverId: plan.serverId ?? oauthFeedback.serverId ?? undefined }
            : undefined,
        });
        if (cancelled) {
          return;
        }
        if (result.status === "pending") {
          timeoutHandle = setTimeout(() => {
            timeoutHandle = null;
            void poll();
          }, 1500);
          return;
        }
        await handleOAuthResult(result);
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (isUnauthorizedError(err)) {
          logout();
          setError(t("admin.mcpServers.errors.sessionExpired"));
        } else {
          const message =
            err instanceof Error
              ? err.message
              : t("admin.mcpServers.oauth.errorGeneric");
          setOauthFeedback({
            status: "error",
            message,
            stateId: null,
            serverId: oauthFeedback.serverId,
          });
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    };
  }, [
    handleOAuthResult,
    logout,
    oauthFeedback,
    t,
    token,
  ]);

  const handleCreate = useCallback(() => {
    resetForm();
    setSuccess(null);
    setError(null);
  }, [resetForm]);

  const handleEdit = useCallback(
    (server: McpServerSummary) => {
      setEditingId(server.id);
      applyServerToForm(server);
      setSuccess(null);
      setError(null);
    },
    [applyServerToForm],
  );

  const handleDelete = useCallback(
    async (server: McpServerSummary) => {
      if (!token) {
        return;
      }
      const confirmation = window.confirm(
        t("admin.mcpServers.confirm.delete", { label: server.label }),
      );
      if (!confirmation) {
        return;
      }

      setDeletingId(server.id);
      setError(null);
      setSuccess(null);
      try {
        await mcpServersApi.delete(token, server.id);
        setServers((prev) => prev.filter((item) => item.id !== server.id));
        if (editingId === server.id) {
          resetForm();
        }
        setSuccess(t("admin.mcpServers.feedback.deleted", { label: server.label }));
      } catch (err) {
        if (isUnauthorizedError(err)) {
          logout();
          setError(t("admin.mcpServers.errors.sessionExpired"));
        } else {
          setError(
            err instanceof Error
              ? err.message
              : t("admin.mcpServers.errors.deleteFailed"),
          );
        }
      } finally {
        setDeletingId(null);
      }
    },
    [editingId, logout, resetForm, t, token],
  );

  const handleRefreshTools = useCallback(
    async (server: McpServerSummary) => {
      if (!token) {
        return;
      }
      setRefreshingId(server.id);
      setError(null);
      setSuccess(null);
      try {
        const updated = await mcpServersApi.update(token, server.id, {
          refresh_tools: true,
        });
        setServers((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
        setSuccess(t("admin.mcpServers.feedback.toolsRefreshed", { label: server.label }));
        if (editingId === server.id) {
          applyServerToForm(updated);
        }
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
    },
    [applyServerToForm, editingId, logout, t, token],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!token) {
        return;
      }
      setIsSaving(true);
      setError(null);
      setSuccess(null);
      setProbeFeedback(null);
      setProbeError(null);

      const basePayload = buildPayloadFromForm(formState, currentServer);
      if ("error" in basePayload) {
        const errorKey = basePayload.error;
        if (errorKey === "label") {
          setError(t("admin.mcpServers.errors.labelRequired"));
        } else if (errorKey === "serverUrl") {
          setError(t("admin.mcpServers.errors.serverUrlRequired"));
        } else if (errorKey === "metadata") {
          setError(t("admin.mcpServers.errors.invalidMetadata"));
        }
        setIsSaving(false);
        return;
      }

      try {
        if (editingId == null) {
          const created = await mcpServersApi.create(token, basePayload);
          setServers((prev) => [...prev, created]);
          setEditingId(created.id);
          applyServerToForm(created);
          setSuccess(t("admin.mcpServers.feedback.created", { label: created.label }));
        } else {
          const updated = await mcpServersApi.update(token, editingId, basePayload);
          setServers((prev) =>
            prev.map((item) => (item.id === updated.id ? updated : item)),
          );
          applyServerToForm(updated);
          setSuccess(t("admin.mcpServers.feedback.updated", { label: updated.label }));
        }
      } catch (err) {
        if (isUnauthorizedError(err)) {
          logout();
          setError(t("admin.mcpServers.errors.sessionExpired"));
        } else {
          setError(
            err instanceof Error
              ? err.message
              : t("admin.mcpServers.errors.saveFailed"),
          );
        }
      } finally {
        setIsSaving(false);
      }
    },
    [
      applyServerToForm,
      currentServer,
      editingId,
      formState,
      logout,
      t,
      token,
    ],
  );

  const handleTestConnection = useCallback(async () => {
    if (!token) {
      return;
    }
    setProbeFeedback(null);
    setProbeError(null);
    setIsTesting(true);

    const basePayload = buildPayloadFromForm(formState, currentServer);
    if ("error" in basePayload) {
      const errorKey = basePayload.error;
      if (errorKey === "label") {
        setProbeError(t("admin.mcpServers.errors.labelRequired"));
      } else if (errorKey === "serverUrl") {
        setProbeError(t("admin.mcpServers.errors.serverUrlRequired"));
      } else if (errorKey === "metadata") {
        setProbeError(t("admin.mcpServers.errors.invalidMetadata"));
      }
      setIsTesting(false);
      return;
    }

    try {
      const response = await probeMcpServer(token, {
        serverId: editingId ?? undefined,
        url: basePayload.server_url ?? formState.serverUrl.trim(),
        authorization: basePayload.authorization ?? formState.authorization.trim(),
      });
      handleProbeResponse(response);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setProbeError(t("admin.mcpServers.errors.sessionExpired"));
      } else {
        const message =
          err instanceof Error
            ? err.message
            : t("admin.mcpServers.errors.testFailed");
        setProbeError(message);
      }
    } finally {
      setIsTesting(false);
    }
  }, [
    currentServer,
    editingId,
    formState,
    logout,
    t,
    token,
  ]);

  const handleProbeResponse = (response: McpTestConnectionResponse) => {
    if (response.status === "ok") {
      const names = Array.isArray(response.tool_names) ? response.tool_names : [];
      setProbeFeedback(
        names.length
          ? t("admin.mcpServers.test.successWithTools", {
              count: names.length,
              tools: names.join(", "),
            })
          : t("admin.mcpServers.test.success"),
      );
      setProbeError(null);
      if (typeof response.server_id === "number") {
        void loadServers();
      }
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
    const basePayload = buildPayloadFromForm(formState, currentServer);
    if ("error" in basePayload) {
      const errorKey = basePayload.error;
      if (errorKey === "label") {
        setError(t("admin.mcpServers.errors.labelRequired"));
      } else if (errorKey === "serverUrl") {
        setError(t("admin.mcpServers.errors.serverUrlRequired"));
      } else if (errorKey === "metadata") {
        setError(t("admin.mcpServers.errors.invalidMetadata"));
      }
      return;
    }

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
        url: basePayload.server_url ?? formState.serverUrl.trim(),
        clientId: (basePayload.oauth_client_id ?? formState.oauthClientId.trim()) || null,
        scope: (basePayload.oauth_scope ?? formState.oauthScope.trim()) || null,
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
      void loadServers();
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
    formState,
    logout,
    oauthFeedback.stateId,
    t,
    token,
    loadServers,
  ]);

  const currentAuthorizationHint = currentServer?.authorization_hint;
  const currentAccessTokenHint = currentServer?.access_token_hint;
  const currentRefreshTokenHint = currentServer?.refresh_token_hint;
  const currentClientSecretHint = currentServer?.oauth_client_secret_hint;

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
      <AdminTabs activeTab="mcp-servers" />
      <ManagementPageLayout>
        <header className="admin-page-header">
          <div>
            <h1 className="admin-page-title">{t("admin.mcpServers.page.title")}</h1>
            <p className="admin-page-subtitle">{t("admin.mcpServers.page.subtitle")}</p>
          </div>
          <button type="button" className="button" onClick={handleCreate}>
            {t("admin.mcpServers.actions.startCreate")}
          </button>
        </header>

        {error && <div className="alert alert--danger">{error}</div>}
        {success && <div className="alert alert--success">{success}</div>}

        <div className="admin-grid">
          <section className="admin-card admin-card--wide">
            <div>
              <h2 className="admin-card__title">{t("admin.mcpServers.list.title")}</h2>
              <p className="admin-card__subtitle">
                {t("admin.mcpServers.list.subtitle")}
              </p>
            </div>
            {loading ? (
              <p>{t("admin.mcpServers.list.loading")}</p>
            ) : servers.length === 0 ? (
              <p>{t("admin.mcpServers.list.empty")}</p>
            ) : (
              <ResponsiveTable
                columns={mcpServerColumns}
                data={servers}
                keyExtractor={(server) => server.id.toString()}
                mobileCardView={true}
              />
            )}
          </section>

          <section className="admin-card">
            <div>
              <h2 className="admin-card__title">
                {editingId == null
                  ? t("admin.mcpServers.form.createTitle")
                  : t("admin.mcpServers.form.editTitle", {
                      label: currentServer?.label ?? "",
                    })}
              </h2>
              <p className="admin-card__subtitle">
                {editingId == null
                  ? t("admin.mcpServers.form.createSubtitle")
                  : t("admin.mcpServers.form.editSubtitle")}
              </p>
            </div>
            <form className="admin-form" onSubmit={handleSubmit}>
              <label className="label">
                {t("admin.mcpServers.form.labelLabel")}
                <input
                  className="input"
                  type="text"
                  required
                  value={formState.label}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, label: event.target.value }))
                  }
                  placeholder={t("admin.mcpServers.form.labelPlaceholder")}
                />
              </label>

              <label className="label">
                {t("admin.mcpServers.form.serverUrlLabel")}
                <input
                  className="input"
                  type="url"
                  required
                  value={formState.serverUrl}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      serverUrl: event.target.value,
                    }))
                  }
                  placeholder={t("admin.mcpServers.form.serverUrlPlaceholder")}
                />
              </label>

              <label className="label">
                <span>{t("admin.mcpServers.form.authorizationLabel")}</span>
                <input
                  className="input"
                  type="text"
                  value={formState.authorization}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      authorization: event.target.value,
                    }))
                  }
                  placeholder={t("admin.mcpServers.form.authorizationPlaceholder")}
                />
                {currentAuthorizationHint && (
                  <span className="form-hint">
                    {t("admin.mcpServers.form.authorizationHint", {
                      hint: currentAuthorizationHint,
                    })}
                  </span>
                )}
              </label>

              <div className="admin-form__row">
                <label className="label">
                  {t("admin.mcpServers.form.accessTokenLabel")}
                  <input
                    className="input"
                    type="text"
                    value={formState.accessToken}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        accessToken: event.target.value,
                      }))
                    }
                    placeholder={t("admin.mcpServers.form.accessTokenPlaceholder")}
                  />
                  {currentAccessTokenHint && (
                    <span className="form-hint">
                      {t("admin.mcpServers.form.accessTokenHint", {
                        hint: currentAccessTokenHint,
                      })}
                    </span>
                  )}
                </label>

                <label className="label">
                  {t("admin.mcpServers.form.refreshTokenLabel")}
                  <input
                    className="input"
                    type="text"
                    value={formState.refreshToken}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        refreshToken: event.target.value,
                      }))
                    }
                    placeholder={t("admin.mcpServers.form.refreshTokenPlaceholder")}
                  />
                  {currentRefreshTokenHint && (
                    <span className="form-hint">
                      {t("admin.mcpServers.form.refreshTokenHint", {
                        hint: currentRefreshTokenHint,
                      })}
                    </span>
                  )}
                </label>
              </div>

              <label className="label">
                {t("admin.mcpServers.form.oauthClientIdLabel")}
                <input
                  className="input"
                  type="text"
                  value={formState.oauthClientId}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      oauthClientId: event.target.value,
                    }))
                  }
                  placeholder={t("admin.mcpServers.form.oauthClientIdPlaceholder")}
                />
              </label>

              <label className="label">
                {t("admin.mcpServers.form.oauthClientSecretLabel")}
                <input
                  className="input"
                  type="password"
                  value={formState.oauthClientSecret}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      oauthClientSecret: event.target.value,
                    }))
                  }
                  placeholder={t("admin.mcpServers.form.oauthClientSecretPlaceholder")}
                />
                {currentClientSecretHint && (
                  <span className="form-hint">
                    {t("admin.mcpServers.form.oauthClientSecretHint", {
                      hint: currentClientSecretHint,
                    })}
                  </span>
                )}
              </label>

              <label className="label">
                {t("admin.mcpServers.form.oauthScopeLabel")}
                <input
                  className="input"
                  type="text"
                  value={formState.oauthScope}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      oauthScope: event.target.value,
                    }))
                  }
                  placeholder={t("admin.mcpServers.form.oauthScopePlaceholder")}
                />
              </label>

              <div className="admin-form__row">
                <label className="label">
                  {t("admin.mcpServers.form.oauthAuthorizationEndpointLabel")}
                  <input
                    className="input"
                    type="url"
                    value={formState.oauthAuthorizationEndpoint}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        oauthAuthorizationEndpoint: event.target.value,
                      }))
                    }
                    placeholder={t(
                      "admin.mcpServers.form.oauthAuthorizationEndpointPlaceholder",
                    )}
                  />
                </label>

                <label className="label">
                  {t("admin.mcpServers.form.oauthTokenEndpointLabel")}
                  <input
                    className="input"
                    type="url"
                    value={formState.oauthTokenEndpoint}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        oauthTokenEndpoint: event.target.value,
                      }))
                    }
                    placeholder={t(
                      "admin.mcpServers.form.oauthTokenEndpointPlaceholder",
                    )}
                  />
                </label>
              </div>

              <label className="label">
                {t("admin.mcpServers.form.oauthRedirectUriLabel")}
                <input
                  className="input"
                  type="url"
                  value={formState.oauthRedirectUri}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      oauthRedirectUri: event.target.value,
                    }))
                  }
                  placeholder={t(
                    "admin.mcpServers.form.oauthRedirectUriPlaceholder",
                  )}
                />
              </label>

              <label className="label">
                {t("admin.mcpServers.form.oauthMetadataLabel")}
                <textarea
                  className="textarea"
                  rows={4}
                  value={formState.oauthMetadata}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      oauthMetadata: event.target.value,
                    }))
                  }
                  placeholder={t("admin.mcpServers.form.oauthMetadataPlaceholder")}
                />
                <span className="form-hint">
                  {t("admin.mcpServers.form.oauthMetadataHint")}
                </span>
              </label>

              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={formState.isActive}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      isActive: event.target.checked,
                    }))
                  }
                />
                <span>{t("admin.mcpServers.form.isActiveLabel")}</span>
              </label>

              <div className="admin-form__actions">
                <button
                  type="submit"
                  className="button"
                  disabled={isSaving}
                >
                  {isSaving
                    ? t("admin.mcpServers.form.saving")
                    : editingId == null
                    ? t("admin.mcpServers.form.createSubmit")
                    : t("admin.mcpServers.form.updateSubmit")}
                </button>
                {editingId != null && (
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={resetForm}
                  >
                    {t("admin.mcpServers.form.cancelEdit")}
                  </button>
                )}
              </div>

              <div className="admin-form__actions">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={handleStartOAuth}
                  disabled={oauthFeedback.status === "starting" || oauthFeedback.status === "pending"}
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
          </section>
        </div>
      </ManagementPageLayout>
    </>
  );
};
