import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, Server, Wrench } from "lucide-react";

import { useAuth } from "../../../../../auth";
import { Modal } from "../../../../../components/Modal";
import { useI18n } from "../../../../../i18n";
import {
  mcpServersApi,
  probeMcpServer,
  ApiError,
  type McpOAuthSessionStatus,
  type McpOAuthStartResponse,
  type McpServerSummary,
  type McpServerPayload,
} from "../../../../../utils/backend";
import {
  getAgentMcpServers,
  getAgentWeatherToolEnabled,
  getAgentWidgetValidationToolEnabled,
  getAgentWorkflowTools,
  getAgentWorkflowValidationToolEnabled,
} from "../../../../../utils/workflows";
import type {
  FlowNode,
  WorkflowSummary,
  McpSseToolConfig,
} from "../../../types";
import { ToggleRow } from "../components/ToggleRow";
import { AccordionSection, Field } from "../ui-components";
import legacyStyles from "../NodeInspector.module.css";
import v2Styles from "./AgentInspectorSectionV2.module.css";

type PersistedServerSelection = {
  toolNames: string[];
  authorizationOverride?: string;
};

type ServerProbeState = {
  status: "idle" | "loading" | "success" | "error";
  message: string | null;
  toolNames: string[];
};

const normalizeToolName = (value: string): string => value.trim();

const uniqueToolNames = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeToolName(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const extractToolNamesFromSummary = (summary: McpServerSummary): string[] => {
  const cache = summary.tools_cache;
  if (!cache || typeof cache !== "object") {
    return [];
  }
  const rawNames = (cache as { tool_names?: unknown }).tool_names;
  if (!Array.isArray(rawNames)) {
    return [];
  }
  return uniqueToolNames(
    rawNames.filter((name): name is string => typeof name === "string" && !!name),
  );
};

const buildSelectionMap = (
  configs: McpSseToolConfig[],
): Map<number, PersistedServerSelection> => {
  const map = new Map<number, PersistedServerSelection>();
  for (const config of configs) {
    if (!config || typeof config.serverId !== "number") {
      continue;
    }
    const entry: PersistedServerSelection = {
      toolNames: uniqueToolNames(config.toolNames ?? []),
    };
    if (config.authorizationOverride) {
      entry.authorizationOverride = config.authorizationOverride;
    }
    map.set(config.serverId, entry);
  }
  return map;
};

const mapToConfigs = (
  map: Map<number, PersistedServerSelection>,
): McpSseToolConfig[] =>
  Array.from(map.entries()).map(([serverId, selection]) => {
    const payload: McpSseToolConfig = {
      serverId,
      toolNames: [...selection.toolNames],
    };
    if (selection.authorizationOverride?.trim()) {
      payload.authorizationOverride = selection.authorizationOverride.trim();
    }
    return payload;
  });

const buildAuthorizationFromToken = (
  token: Record<string, unknown> | null | undefined,
): string | null => {
  if (!token || typeof token !== "object") {
    return null;
  }
  const accessTokenRaw = token.access_token;
  const tokenTypeRaw = token.token_type;
  const accessToken =
    typeof accessTokenRaw === "string" ? accessTokenRaw.trim() : "";
  if (!accessToken) {
    return null;
  }
  const tokenType =
    typeof tokenTypeRaw === "string" ? tokenTypeRaw.trim() : "";
  if (tokenType) {
    return `${tokenType} ${accessToken}`.trim();
  }
  return `Bearer ${accessToken}`;
};

const emptyModalFormState = () => ({
  label: "",
  serverUrl: "",
  authorization: "",
  accessToken: "",
  refreshToken: "",
  oauthClientId: "",
  oauthClientSecret: "",
  oauthScope: "",
});

type McpServerModalFormState = ReturnType<typeof emptyModalFormState>;

type OAuthFeedbackState = {
  status: "idle" | "starting" | "pending" | "success" | "error";
  message: string | null;
  stateId: string | null;
};

type McpServerModalProps = {
  open: boolean;
  token: string | null;
  onClose: () => void;
  onCreated: (server: McpServerSummary) => void;
  onStartOAuth: (
    payload: { url: string; clientId: string | null; scope: string | null },
  ) => Promise<McpOAuthStartResponse>;
  onPollOAuth: (state: string) => Promise<McpOAuthSessionStatus>;
  onCancelOAuth?: (state: string) => Promise<unknown>;
};

const McpServerModal = ({
  open,
  token,
  onClose,
  onCreated,
  onStartOAuth,
  onPollOAuth,
  onCancelOAuth,
}: McpServerModalProps) => {
  const { t } = useI18n();
  const [formState, setFormState] = useState<McpServerModalFormState>(
    emptyModalFormState,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeState, setProbeState] = useState<ServerProbeState>({
    status: "idle",
    message: null,
    toolNames: [],
  });
  const [oauthFeedback, setOauthFeedback] = useState<OAuthFeedbackState>({
    status: "idle",
    message: null,
    stateId: null,
  });
  const latestOauthStatus = useRef(oauthFeedback.status);
  const latestOauthState = useRef<string | null>(oauthFeedback.stateId);
  const cancelOAuthRef = useRef(onCancelOAuth);

  useEffect(() => {
    latestOauthStatus.current = oauthFeedback.status;
    latestOauthState.current = oauthFeedback.stateId;
  }, [oauthFeedback.status, oauthFeedback.stateId]);

  useEffect(() => {
    cancelOAuthRef.current = onCancelOAuth;
  }, [onCancelOAuth]);

  useEffect(() => {
    if (!open) {
      setFormState(emptyModalFormState());
      setError(null);
      setProbeState({ status: "idle", message: null, toolNames: [] });
      setOauthFeedback({ status: "idle", message: null, stateId: null });
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (
        latestOauthStatus.current === "pending" &&
        latestOauthState.current &&
        cancelOAuthRef.current
      ) {
        void cancelOAuthRef.current(latestOauthState.current).catch(() => {});
      }
    };
  }, []);

  if (!open) {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const label = formState.label.trim();
    const serverUrl = formState.serverUrl.trim();
    if (!label || !serverUrl) {
      setError(t("workflowBuilder.agentInspector.mcpServersModalMissingFields"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload: McpServerPayload = {
        label,
        server_url: serverUrl,
        authorization: formState.authorization.trim() || undefined,
        access_token: formState.accessToken.trim() || undefined,
        refresh_token: formState.refreshToken.trim() || undefined,
        oauth_client_id: formState.oauthClientId.trim() || undefined,
        oauth_client_secret: formState.oauthClientSecret.trim() || undefined,
        oauth_scope: formState.oauthScope.trim() || undefined,
      };

      const created = await mcpServersApi.create(token, payload);
      onCreated(created);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(detail || t("workflowBuilder.agentInspector.mcpServersModalError"));
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    const url = formState.serverUrl.trim();
    if (!url) {
      setProbeState({
        status: "error",
        message: t("workflowBuilder.agentInspector.mcpTestStatus.invalidConfig"),
        toolNames: [],
      });
      return;
    }
    setProbeState({
      status: "loading",
      message: t("workflowBuilder.agentInspector.mcpServersProbeLoading"),
      toolNames: [],
    });
    try {
      const authDraft = formState.authorization.trim();
      const result = await probeMcpServer(token ?? null, {
        url,
        authorization: authDraft ? authDraft : undefined,
      });
      const names = Array.isArray(result.tool_names)
        ? result.tool_names
            .map((name) => (typeof name === "string" ? name.trim() : ""))
            .filter((name): name is string => Boolean(name))
        : [];
      const translationKey = `workflowBuilder.agentInspector.mcpTestStatus.${result.status}`;
      let message = t(translationKey, {
        count: names.length,
        statusCode: result.status_code ?? "",
        detail: result.detail ?? "",
      });
      if (message === translationKey) {
        message = result.detail ?? result.status;
      }
      setProbeState({
        status: result.status === "ok" ? "success" : "error",
        message,
        toolNames: names,
      });
    } catch (err) {
      const detail =
        err instanceof Error
          ? err.message
          : t("workflowBuilder.agentInspector.mcpServersProbeError");
      setProbeState({
        status: "error",
        message: detail,
        toolNames: [],
      });
    }
  };

  const handleStartOAuth = async () => {
    const url = formState.serverUrl.trim();
    if (!url) {
      setOauthFeedback({
        status: "error",
        message: t("workflowBuilder.agentInspector.mcpTestStatus.invalidConfig"),
        stateId: null,
      });
      return;
    }

    const previousState = latestOauthState.current;
    if (previousState && cancelOAuthRef.current) {
      void cancelOAuthRef.current(previousState).catch(() => {});
    }

    setOauthFeedback({
      status: "starting",
      message: t("workflowBuilder.agentInspector.mcpOAuthStatus.starting"),
      stateId: null,
    });

    try {
      const result = await onStartOAuth({
        url,
        clientId: formState.oauthClientId.trim() || null,
        scope: formState.oauthScope.trim() || null,
      });

      if (typeof window !== "undefined") {
        const popup = window.open(result.authorization_url, "_blank");
        popup?.focus?.();
      }

      setOauthFeedback({
        status: "pending",
        message: t("workflowBuilder.agentInspector.mcpOAuthStatus.pending"),
        stateId: result.state,
      });
    } catch (err) {
      const detail =
        err instanceof Error
          ? err.message
          : t("workflowBuilder.agentInspector.mcpOAuthStatus.unknownError");
      const message = detail
        ? t("workflowBuilder.agentInspector.mcpOAuthStatus.errorWithDetail", {
            detail,
          })
        : t("workflowBuilder.agentInspector.mcpOAuthStatus.error");
      setOauthFeedback({ status: "error", message, stateId: null });
    }
  };

  useEffect(() => {
    const state = oauthFeedback.stateId;
    if (oauthFeedback.status !== "pending" || !state) {
      return undefined;
    }

    let cancelled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const handleResult = (result: McpOAuthSessionStatus) => {
      if (cancelled) {
        return;
      }

      if (result.status === "pending") {
        timeoutHandle = setTimeout(async () => {
          timeoutHandle = null;
          try {
            const next = await onPollOAuth(state);
            handleResult(next);
          } catch (err) {
            if (cancelled) {
              return;
            }
            const detail =
              err instanceof ApiError && err.status === 404
                ? t("workflowBuilder.agentInspector.mcpOAuthStatus.sessionExpired")
                : err instanceof Error
                ? err.message
                : t("workflowBuilder.agentInspector.mcpOAuthStatus.unknownError");
            setOauthFeedback({
              status: "error",
              message: t(
                "workflowBuilder.agentInspector.mcpOAuthStatus.errorWithDetail",
                { detail },
              ),
              stateId: null,
            });
            if (cancelOAuthRef.current) {
              void cancelOAuthRef.current(state).catch(() => {});
            }
          }
        }, 1500);
        return;
      }

      if (result.status === "ok") {
        const authorization = buildAuthorizationFromToken(result.token);
        if (authorization) {
          setFormState((prev) => ({ ...prev, authorization }));
          setOauthFeedback({
            status: "success",
            message: t("workflowBuilder.agentInspector.mcpOAuthStatus.success"),
            stateId: null,
          });
        } else {
          setOauthFeedback({
            status: "error",
            message: t(
              "workflowBuilder.agentInspector.mcpOAuthStatus.noAccessToken",
            ),
            stateId: null,
          });
        }
      } else {
        const detail =
          typeof result.error === "string" ? result.error : undefined;
        const message = detail
          ? t("workflowBuilder.agentInspector.mcpOAuthStatus.errorWithDetail", {
              detail,
            })
          : t("workflowBuilder.agentInspector.mcpOAuthStatus.error");
        setOauthFeedback({ status: "error", message, stateId: null });
      }

      if (cancelOAuthRef.current) {
        void cancelOAuthRef.current(result.state).catch(() => {});
      }
      timeoutHandle = null;
    };

    (async () => {
      try {
        const initial = await onPollOAuth(state);
        handleResult(initial);
      } catch (err) {
        if (cancelled) {
          return;
        }
        const detail =
          err instanceof ApiError && err.status === 404
            ? t("workflowBuilder.agentInspector.mcpOAuthStatus.sessionExpired")
            : err instanceof Error
            ? err.message
            : t("workflowBuilder.agentInspector.mcpOAuthStatus.unknownError");
        setOauthFeedback({
          status: "error",
          message: t(
            "workflowBuilder.agentInspector.mcpOAuthStatus.errorWithDetail",
            { detail },
          ),
          stateId: null,
        });
        if (cancelOAuthRef.current) {
          void cancelOAuthRef.current(state).catch(() => {});
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    };
  }, [oauthFeedback.status, oauthFeedback.stateId, onPollOAuth, t]);

  const footer = (
    <div className={legacyStyles.nodeInspectorModalFooter}>
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        {t("workflowBuilder.agentInspector.mcpServersModalCancel")}
      </button>
      <button type="submit" form="mcp-server-modal-form" className="btn" disabled={saving}>
        {saving
          ? t("workflowBuilder.agentInspector.mcpServersModalSaving")
          : t("workflowBuilder.agentInspector.mcpServersModalSubmit")}
      </button>
    </div>
  );

  return (
    <Modal
      title={t("workflowBuilder.agentInspector.mcpServersModalTitle")}
      onClose={onClose}
      footer={footer}
      size="lg"
    >
      <form
        id="mcp-server-modal-form"
        className={legacyStyles.nodeInspectorModalForm}
        onSubmit={handleSubmit}
      >
        <label className={legacyStyles.nodeInspectorField}>
          <span className={legacyStyles.nodeInspectorLabel}>
            {t("workflowBuilder.agentInspector.mcpServersModalLabel")}
          </span>
          <input
            type="text"
            value={formState.label}
            onChange={(event) =>
              setFormState((prev) => ({ ...prev, label: event.target.value }))
            }
            autoComplete="off"
          />
        </label>
        <label className={legacyStyles.nodeInspectorField}>
          <span className={legacyStyles.nodeInspectorLabel}>
            {t("workflowBuilder.agentInspector.mcpServersModalUrl")}
          </span>
          <input
            type="url"
            value={formState.serverUrl}
            onChange={(event) =>
              setFormState((prev) => ({ ...prev, serverUrl: event.target.value }))
            }
            placeholder="https://"
            autoComplete="off"
          />
        </label>
        <label className={legacyStyles.nodeInspectorField}>
          <span className={legacyStyles.nodeInspectorLabel}>
            {t("workflowBuilder.agentInspector.mcpAuthorizationLabel")}
          </span>
          <input
            type="password"
            value={formState.authorization}
            onChange={(event) =>
              setFormState((prev) => ({
                ...prev,
                authorization: event.target.value,
              }))
            }
            placeholder={t(
              "workflowBuilder.agentInspector.mcpAuthorizationPlaceholder",
            )}
            autoComplete="off"
          />
        </label>
        <div className={legacyStyles.nodeInspectorFieldGroup}>
          <label className={legacyStyles.nodeInspectorField}>
            <span className={legacyStyles.nodeInspectorLabel}>
              {t("workflowBuilder.agentInspector.mcpClientIdLabel")}
            </span>
            <input
              type="text"
              value={formState.oauthClientId}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  oauthClientId: event.target.value,
                }))
              }
              placeholder={t(
                "workflowBuilder.agentInspector.mcpClientIdPlaceholder",
              )}
              autoComplete="off"
            />
          </label>
          <label className={legacyStyles.nodeInspectorField}>
            <span className={legacyStyles.nodeInspectorLabel}>
              {t("workflowBuilder.agentInspector.mcpScopeLabel")}
            </span>
            <input
              type="text"
              value={formState.oauthScope}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  oauthScope: event.target.value,
                }))
              }
              placeholder={t(
                "workflowBuilder.agentInspector.mcpScopePlaceholder",
              )}
              autoComplete="off"
            />
          </label>
          <label className={legacyStyles.nodeInspectorField}>
            <span className={legacyStyles.nodeInspectorLabel}>
              {t("workflowBuilder.agentInspector.mcpServersModalClientSecret")}
            </span>
            <input
              type="password"
              value={formState.oauthClientSecret}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  oauthClientSecret: event.target.value,
                }))
              }
              autoComplete="off"
            />
          </label>
        </div>
        <div className={legacyStyles.nodeInspectorFieldGroup}>
          <label className={legacyStyles.nodeInspectorField}>
            <span className={legacyStyles.nodeInspectorLabel}>
              {t("workflowBuilder.agentInspector.mcpServersModalAccessToken")}
            </span>
            <input
              type="password"
              value={formState.accessToken}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  accessToken: event.target.value,
                }))
              }
              autoComplete="off"
            />
          </label>
          <label className={legacyStyles.nodeInspectorField}>
            <span className={legacyStyles.nodeInspectorLabel}>
              {t("workflowBuilder.agentInspector.mcpServersModalRefreshToken")}
            </span>
            <input
              type="password"
              value={formState.refreshToken}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  refreshToken: event.target.value,
                }))
              }
              autoComplete="off"
            />
          </label>
        </div>
        <div className={legacyStyles.nodeInspectorField}>
          <div className={legacyStyles.nodeInspectorButtonRow}>
            <button
              type="button"
              className="btn"
              onClick={handleStartOAuth}
              disabled={
                !formState.serverUrl.trim() ||
                oauthFeedback.status === "starting" ||
                oauthFeedback.status === "pending"
              }
            >
              {t("workflowBuilder.agentInspector.mcpOAuthButton")}
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleTestConnection}
              disabled={probeState.status === "loading"}
            >
              {t("workflowBuilder.agentInspector.mcpServersProbeButton")}
            </button>
          </div>
          {oauthFeedback.status !== "idle" && oauthFeedback.message ? (
            <div
              role="status"
              className={
                oauthFeedback.status === "error"
                  ? legacyStyles.nodeInspectorErrorTextSmall
                  : legacyStyles.nodeInspectorInfoMessage
              }
            >
              {oauthFeedback.message}
            </div>
          ) : null}
          {probeState.status !== "idle" && probeState.message ? (
            <div
              role="status"
              className={
                probeState.status === "error"
                  ? legacyStyles.nodeInspectorErrorTextSmall
                  : legacyStyles.nodeInspectorInfoMessage
              }
            >
              {probeState.message}
            </div>
          ) : null}
        </div>
        {error ? (
          <div className={legacyStyles.nodeInspectorErrorTextSmall}>{error}</div>
        ) : null}
      </form>
    </Modal>
  );
};

type ToolSettingsPanelProps = {
  nodeId: string;
  parameters: FlowNode["data"]["parameters"];
  workflows: WorkflowSummary[];
  currentWorkflowId: number | null;
  variant?: "legacy" | "v2";
  onAgentWeatherToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWidgetValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowToolToggle: (nodeId: string, slug: string, enabled: boolean) => void;
  onAgentMcpServersChange?: (
    nodeId: string,
    configs: McpSseToolConfig[],
  ) => void;
  onStartMcpOAuth: (
    payload: { url: string; clientId: string | null; scope: string | null },
  ) => Promise<McpOAuthStartResponse>;
  onPollMcpOAuth: (state: string) => Promise<McpOAuthSessionStatus>;
  onCancelMcpOAuth?: (state: string) => Promise<unknown>;
};

export const ToolSettingsPanel = ({
  nodeId,
  parameters,
  workflows,
  currentWorkflowId,
  variant = "legacy",
  onAgentWeatherToolChange,
  onAgentWidgetValidationToolChange,
  onAgentWorkflowValidationToolChange,
  onAgentWorkflowToolToggle,
  onAgentMcpServersChange,
  onStartMcpOAuth,
  onPollMcpOAuth,
  onCancelMcpOAuth,
}: ToolSettingsPanelProps) => {
  const { t } = useI18n();
  const { token } = useAuth();

  const persistedServerConfigs = useMemo(
    () => getAgentMcpServers(parameters),
    [parameters],
  );

  const [selectedServers, setSelectedServers] = useState<
    Map<number, PersistedServerSelection>
  >(() => buildSelectionMap(persistedServerConfigs));
  const [manualToolDrafts, setManualToolDrafts] = useState<Record<number, string>>({});
  const [probeStates, setProbeStates] = useState<Record<number, ServerProbeState>>({});
  const [servers, setServers] = useState<McpServerSummary[]>([]);
  const [serversLoading, setServersLoading] = useState(false);
  const [serversError, setServersError] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  useEffect(() => {
    setSelectedServers((previous) => {
      const next = buildSelectionMap(persistedServerConfigs);
      if (next.size === previous.size) {
        let unchanged = true;
        for (const [serverId, selection] of next.entries()) {
          const current = previous.get(serverId);
          if (!current) {
            unchanged = false;
            break;
          }
          const currentAuth = current.authorizationOverride ?? "";
          const nextAuth = selection.authorizationOverride ?? "";
          if (
            currentAuth !== nextAuth ||
            current.toolNames.length !== selection.toolNames.length ||
            current.toolNames.some((name, index) => selection.toolNames[index] !== name)
          ) {
            unchanged = false;
            break;
          }
        }
        if (unchanged) {
          return previous;
        }
      }
      return next;
    });
  }, [persistedServerConfigs]);

  const refreshServers = useCallback(
    async (withSpinner = false) => {
      if (withSpinner) {
        setServersLoading(true);
      }
      setServersError(null);
      try {
        const result = await mcpServersApi.list(token ?? null);
        setServers(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t("workflowBuilder.agentInspector.mcpServersLoadError");
        setServersError(message);
      } finally {
        if (withSpinner) {
          setServersLoading(false);
        }
      }
    },
    [token, t],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (cancelled) {
        return;
      }
      await refreshServers(true);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshServers]);

  useEffect(() => {
    if (servers.length === 0) {
      return;
    }
    setSelectedServers((previous) => {
      let changed = false;
      const next = new Map(previous);
      for (const server of servers) {
        const availableNames = new Set(extractToolNamesFromSummary(server));
        if (availableNames.size === 0) {
          continue;
        }
        const current = next.get(server.id);
        if (!current || current.toolNames.length === 0) {
          continue;
        }
        const filtered = current.toolNames.filter((name) => availableNames.has(name));
        if (filtered.length !== current.toolNames.length) {
          changed = true;
          next.set(server.id, {
            ...current,
            toolNames: filtered,
          });
        }
      }
      if (!changed) {
        return previous;
      }
      if (onAgentMcpServersChange) {
        onAgentMcpServersChange(nodeId, mapToConfigs(next));
      }
      return next;
    });
  }, [servers, nodeId, onAgentMcpServersChange]);

  const handleServerToggle = useCallback(
    (server: McpServerSummary, enabled: boolean) => {
      setSelectedServers((previous) => {
        const isSelected = previous.has(server.id);
        if ((enabled && isSelected) || (!enabled && !isSelected)) {
          return previous;
        }
        const next = new Map(previous);
        if (enabled) {
          next.set(server.id, previous.get(server.id) ?? { toolNames: [] });
        } else {
          next.delete(server.id);
        }
        if (onAgentMcpServersChange) {
          onAgentMcpServersChange(nodeId, mapToConfigs(next));
        }
        return next;
      });
      if (!enabled) {
        setManualToolDrafts((drafts) => {
          if (!(server.id in drafts)) {
            return drafts;
          }
          const nextDrafts = { ...drafts };
          delete nextDrafts[server.id];
          return nextDrafts;
        });
      }
    },
    [nodeId, onAgentMcpServersChange],
  );

  const handleRestrictionToggle = useCallback(
    (serverId: number, restrict: boolean, availableNames: string[]) => {
      setSelectedServers((previous) => {
        const current = previous.get(serverId) ?? { toolNames: [] };
        const next = new Map(previous);
        next.set(serverId, {
          ...current,
          toolNames: restrict
            ? uniqueToolNames(
                current.toolNames.length > 0
                  ? current.toolNames
                  : availableNames,
              )
            : [],
        });
        if (onAgentMcpServersChange) {
          onAgentMcpServersChange(nodeId, mapToConfigs(next));
        }
        return next;
      });
    },
    [nodeId, onAgentMcpServersChange],
  );

  const handleToolToggle = useCallback(
    (
      serverId: number,
      toolName: string,
      availableNames: string[],
      enabled: boolean,
    ) => {
      const normalized = normalizeToolName(toolName);
      if (!normalized) {
        return;
      }
      setSelectedServers((previous) => {
        const current = previous.get(serverId) ?? { toolNames: [] };
        let nextNames: string[];
        if (current.toolNames.length === 0) {
          if (enabled) {
            return previous;
          }
          nextNames = uniqueToolNames(
            availableNames.filter((name) => normalizeToolName(name) !== normalized),
          );
        } else if (enabled) {
          nextNames = uniqueToolNames([...current.toolNames, normalized]);
        } else {
          nextNames = current.toolNames.filter((name) => name !== normalized);
        }
        const next = new Map(previous);
        next.set(serverId, { ...current, toolNames: nextNames });
        if (onAgentMcpServersChange) {
          onAgentMcpServersChange(nodeId, mapToConfigs(next));
        }
        return next;
      });
    },
    [nodeId, onAgentMcpServersChange],
  );

  const handleManualToolDraftChange = useCallback((serverId: number, value: string) => {
    setManualToolDrafts((drafts) => ({ ...drafts, [serverId]: value }));
  }, []);

  const handleManualToolAdd = useCallback(
    (serverId: number) => {
      const rawDraft = manualToolDrafts[serverId] ?? "";
      const normalized = normalizeToolName(rawDraft);
      if (!normalized) {
        return;
      }
      setManualToolDrafts((drafts) => ({ ...drafts, [serverId]: "" }));
      setSelectedServers((previous) => {
        const current = previous.get(serverId) ?? { toolNames: [] };
        const nextNames =
          current.toolNames.length === 0
            ? [normalized]
            : uniqueToolNames([...current.toolNames, normalized]);
        const next = new Map(previous);
        next.set(serverId, { ...current, toolNames: nextNames });
        if (onAgentMcpServersChange) {
          onAgentMcpServersChange(nodeId, mapToConfigs(next));
        }
        return next;
      });
    },
    [manualToolDrafts, nodeId, onAgentMcpServersChange],
  );

  const handleManualToolRemove = useCallback(
    (serverId: number, toolName: string) => {
      const normalized = normalizeToolName(toolName);
      if (!normalized) {
        return;
      }
      setSelectedServers((previous) => {
        const current = previous.get(serverId);
        if (!current || current.toolNames.length === 0) {
          return previous;
        }
        if (!current.toolNames.includes(normalized)) {
          return previous;
        }
        const nextNames = current.toolNames.filter((name) => name !== normalized);
        const next = new Map(previous);
        next.set(serverId, { ...current, toolNames: nextNames });
        if (onAgentMcpServersChange) {
          onAgentMcpServersChange(nodeId, mapToConfigs(next));
        }
        return next;
      });
    },
    [nodeId, onAgentMcpServersChange],
  );

  const handleAuthorizationOverrideChange = useCallback(
    (serverId: number, value: string) => {
      setSelectedServers((previous) => {
        const current = previous.get(serverId) ?? { toolNames: [] };
        const next = new Map(previous);
        if (value.trim()) {
          next.set(serverId, { ...current, authorizationOverride: value });
        } else {
          const { authorizationOverride: _ignored, ...rest } = current;
          next.set(serverId, rest);
        }
        if (onAgentMcpServersChange) {
          onAgentMcpServersChange(nodeId, mapToConfigs(next));
        }
        return next;
      });
    },
    [nodeId, onAgentMcpServersChange],
  );

  const getProbeState = useCallback(
    (serverId: number): ServerProbeState =>
      probeStates[serverId] ?? { status: "idle", message: null, toolNames: [] },
    [probeStates],
  );

  const handleProbeServer = useCallback(
    async (server: McpServerSummary) => {
      setProbeStates((previous) => ({
        ...previous,
        [server.id]: {
          status: "loading",
          message: t("workflowBuilder.agentInspector.mcpServersProbeLoading"),
          toolNames: [],
        },
      }));
      try {
        const response = await probeMcpServer(token ?? null, {
          serverId: server.id,
          url: server.server_url,
        });
        const names = Array.isArray(response.tool_names)
          ? uniqueToolNames(
              response.tool_names.filter(
                (name): name is string => typeof name === "string" && !!name,
              ),
            )
          : [];
        setProbeStates((previous) => ({
          ...previous,
          [server.id]: {
            status: response.status === "ok" ? "success" : "error",
            message:
              response.status === "ok"
                ? t("workflowBuilder.agentInspector.mcpServersProbeSuccess", {
                    count: names.length,
                  })
                : response.detail ??
                  t("workflowBuilder.agentInspector.mcpServersProbeError"),
            toolNames: names,
          },
        }));
        await refreshServers();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t("workflowBuilder.agentInspector.mcpServersProbeError");
        setProbeStates((previous) => ({
          ...previous,
          [server.id]: { status: "error", message, toolNames: [] },
        }));
      }
    },
    [token, refreshServers, t],
  );

  const handleServerCreated = useCallback(
    async (server: McpServerSummary) => {
      setIsCreateModalOpen(false);
      await refreshServers();
      setSelectedServers((previous) => {
        if (previous.has(server.id)) {
          return previous;
        }
        const next = new Map(previous);
        next.set(server.id, { toolNames: [] });
        if (onAgentMcpServersChange) {
          onAgentMcpServersChange(nodeId, mapToConfigs(next));
        }
        return next;
      });
    },
    [nodeId, onAgentMcpServersChange, refreshServers],
  );

  const weatherFunctionEnabled = getAgentWeatherToolEnabled(parameters);
  const widgetValidationFunctionEnabled = getAgentWidgetValidationToolEnabled(parameters);
  const workflowValidationFunctionEnabled =
    getAgentWorkflowValidationToolEnabled(parameters);

  const hasFunctionToolEnabled =
    weatherFunctionEnabled ||
    widgetValidationFunctionEnabled ||
    workflowValidationFunctionEnabled;

  const workflowToolConfigs = getAgentWorkflowTools(parameters);
  const workflowToolSlugs = workflowToolConfigs.map((config) => config.slug);
  const hasWorkflowToolEnabled = workflowToolSlugs.length > 0;

  const hasSelectedMcpServers = selectedServers.size > 0;

  const availableNestedWorkflows = useMemo(
    () => workflows.filter((workflow) => workflow.id !== currentWorkflowId),
    [workflows, currentWorkflowId],
  );

  const workflowToolSlugSet = useMemo(
    () => new Set(workflowToolSlugs),
    [workflowToolSlugs],
  );

  const availableWorkflowToolSlugs = useMemo(
    () => new Set(availableNestedWorkflows.map((workflow) => workflow.slug)),
    [availableNestedWorkflows],
  );

  const missingWorkflowToolSlugs = useMemo(
    () =>
      workflowToolSlugs.filter((slug) => !availableWorkflowToolSlugs.has(slug)),
    [workflowToolSlugs, availableWorkflowToolSlugs],
  );

  
  const modal = isCreateModalOpen ? (
    <McpServerModal
      open={isCreateModalOpen}
      token={token ?? null}
      onClose={() => setIsCreateModalOpen(false)}
      onCreated={handleServerCreated}
      onStartOAuth={onStartMcpOAuth}
      onPollOAuth={onPollMcpOAuth}
      onCancelOAuth={onCancelMcpOAuth}
    />
  ) : null;

  if (variant === "legacy") {
    return (
      <>
        <div className={legacyStyles.nodeInspectorPanelSpacious}>
          <div className={legacyStyles.nodeInspectorPanelInnerAccentTight}>
            <strong className={legacyStyles.nodeInspectorSectionTitleSmall}>
              {t("workflowBuilder.agentInspector.functionToolsTitle")}
            </strong>
            <ToggleRow
              label={t("workflowBuilder.agentInspector.weatherToolLabel")}
              checked={weatherFunctionEnabled}
              onChange={(next) => onAgentWeatherToolChange(nodeId, next)}
              help={t("workflowBuilder.agentInspector.weatherToolHelp")}
            />
            <ToggleRow
              label={t("workflowBuilder.agentInspector.widgetValidationLabel")}
              checked={widgetValidationFunctionEnabled}
              onChange={(next) => onAgentWidgetValidationToolChange(nodeId, next)}
              help={t("workflowBuilder.agentInspector.widgetValidationHelp")}
            />
            <ToggleRow
              label={t("workflowBuilder.agentInspector.workflowValidationLabel")}
              checked={workflowValidationFunctionEnabled}
              onChange={(next) => onAgentWorkflowValidationToolChange(nodeId, next)}
              help={t("workflowBuilder.agentInspector.workflowValidationHelp")}
            />
          </div>

          <div className={legacyStyles.nodeInspectorPanelInner}>
            <strong className={legacyStyles.nodeInspectorSectionTitleSmall}>
              {t("workflowBuilder.agentInspector.mcpServersTitle")}
            </strong>
            <p className={legacyStyles.nodeInspectorHintTextTight}>
              {t("workflowBuilder.agentInspector.mcpServersDescription")}
            </p>
            <div className={legacyStyles.nodeInspectorButtonRow}>
              <button
                type="button"
                className="btn"
                onClick={() => setIsCreateModalOpen(true)}
              >
                {t("workflowBuilder.agentInspector.mcpServersAddButton")}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  void refreshServers(true);
                }}
                disabled={serversLoading}
              >
                {serversLoading
                  ? t("workflowBuilder.agentInspector.mcpServersRefreshing")
                  : t("workflowBuilder.agentInspector.mcpServersRefreshButton")}
              </button>
            </div>
            {serversError ? (
              <div className={legacyStyles.nodeInspectorErrorTextSmall}>{serversError}</div>
            ) : null}
            {servers.length === 0 && !serversLoading ? (
              <p className={legacyStyles.nodeInspectorEmptyLabel}>
                {t("workflowBuilder.agentInspector.mcpServersEmpty")}
              </p>
            ) : null}
            {serversLoading && servers.length === 0 ? (
              <p className={legacyStyles.nodeInspectorHintTextTight}>
                {t("workflowBuilder.agentInspector.mcpServersLoading")}
              </p>
            ) : null}
            <div className={legacyStyles.mcpServerList}>
              {servers.map((server) => {
                const selection = selectedServers.get(server.id);
                const availableNames = extractToolNamesFromSummary(server);
                const isRestricted = Boolean(selection && selection.toolNames.length > 0);
                const manualDraft = manualToolDrafts[server.id] ?? "";
                const probe = getProbeState(server.id);
                const customNames =
                  selection && selection.toolNames.length > 0
                    ? selection.toolNames.filter((name) => !availableNames.includes(name))
                    : [];

                return (
                  <div key={server.id} className={legacyStyles.mcpServerCard}>
                    <label className={legacyStyles.mcpServerHeader}>
                      <input
                        type="checkbox"
                        checked={Boolean(selection)}
                        onChange={(event) =>
                          handleServerToggle(server, event.target.checked)
                        }
                      />
                      <div>
                        <div className={legacyStyles.mcpServerLabel}>{server.label}</div>
                        <div className={legacyStyles.nodeInspectorHintTextTight}>
                          {server.server_url}
                        </div>
                        {server.authorization_hint ? (
                          <div className={legacyStyles.nodeInspectorHintTextMuted}>
                            {t(
                              "workflowBuilder.agentInspector.mcpServersAuthorizationStored",
                              { hint: server.authorization_hint },
                            )}
                          </div>
                        ) : null}
                        {server.tools_cache_updated_at ? (
                          <div className={legacyStyles.nodeInspectorHintTextMuted}>
                            {t(
                              "workflowBuilder.agentInspector.mcpServersCacheUpdated",
                              { value: server.tools_cache_updated_at },
                            )}
                          </div>
                        ) : null}
                      </div>
                    </label>
                    {selection ? (
                      <div className={legacyStyles.mcpServerDetails}>
                        <label className={legacyStyles.nodeInspectorField}>
                          <span className={legacyStyles.nodeInspectorLabel}>
                            {t(
                              "workflowBuilder.agentInspector.mcpServersAuthorizationOverrideLabel",
                            )}
                          </span>
                          <input
                            type="password"
                            value={selection.authorizationOverride ?? ""}
                            onChange={(event) =>
                              handleAuthorizationOverrideChange(
                                server.id,
                                event.target.value,
                              )
                            }
                            placeholder={server.authorization_hint ?? undefined}
                            autoComplete="off"
                          />
                        </label>
                        <ToggleRow
                          label={t(
                            "workflowBuilder.agentInspector.mcpServersRestrictToggle",
                          )}
                          checked={isRestricted}
                          onChange={(next) =>
                            handleRestrictionToggle(server.id, next, availableNames)
                          }
                          help={t(
                            "workflowBuilder.agentInspector.mcpServersRestrictHelp",
                          )}
                        />
                        {availableNames.length > 0 ? (
                          <div className={legacyStyles.mcpToolChipGroup}>
                            {availableNames.map((name) => {
                              const isChecked =
                                !isRestricted || selection.toolNames.includes(name);
                              return (
                                <label
                                  key={name}
                                  className={
                                    isChecked
                                      ? `${legacyStyles.mcpToolChip} ${legacyStyles.mcpToolChipSelected}`
                                      : legacyStyles.mcpToolChip
                                  }
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(event) =>
                                      handleToolToggle(
                                        server.id,
                                        name,
                                        availableNames,
                                        event.target.checked,
                                      )
                                    }
                                  />
                                  <span>{name}</span>
                                </label>
                              );
                            })}
                          </div>
                        ) : (
                          <p className={legacyStyles.nodeInspectorHintTextTight}>
                            {t("workflowBuilder.agentInspector.mcpServersNoTools")}
                          </p>
                        )}
                        {customNames.length > 0 ? (
                          <div className={legacyStyles.mcpToolChipGroup}>
                            {customNames.map((name) => (
                              <button
                                key={name}
                                type="button"
                                className={legacyStyles.mcpCustomToolChip}
                                onClick={() => handleManualToolRemove(server.id, name)}
                              >
                                {name}
                                <span
                                  className={legacyStyles.mcpCustomToolChipRemove}
                                  aria-hidden="true"
                                >
                                  ×
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        <div className={legacyStyles.nodeInspectorInlineField}>
                          <span className={legacyStyles.nodeInspectorLabel}>
                            {t("workflowBuilder.agentInspector.mcpServersAddToolLabel")}
                          </span>
                          <input
                            type="text"
                            value={manualDraft}
                            onChange={(event) =>
                              handleManualToolDraftChange(server.id, event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                handleManualToolAdd(server.id);
                              }
                            }}
                            placeholder={t(
                              "workflowBuilder.agentInspector.mcpServersAddToolPlaceholder",
                            )}
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => handleManualToolAdd(server.id)}
                            disabled={!manualDraft.trim()}
                          >
                            {t("workflowBuilder.agentInspector.mcpServersAddToolButton")}
                          </button>
                        </div>
                        <div className={legacyStyles.nodeInspectorField}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => handleProbeServer(server)}
                            disabled={probe.status === "loading"}
                          >
                            {t("workflowBuilder.agentInspector.mcpServersProbeButton")}
                          </button>
                          {probe.status !== "idle" && probe.message ? (
                            <div
                              role="status"
                              className={
                                probe.status === "error"
                                  ? legacyStyles.nodeInspectorErrorTextSmall
                                  : legacyStyles.nodeInspectorInfoMessage
                              }
                            >
                              {probe.message}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <strong className={legacyStyles.nodeInspectorSectionTitleSmall}>
              {t("workflowBuilder.agentInspector.workflowToolsTitle")}
            </strong>
            <p className={legacyStyles.nodeInspectorHintTextTight}>
              {t("workflowBuilder.agentInspector.workflowToolsDescription")}
            </p>
            {availableNestedWorkflows.length > 0 ? (
              <div className={legacyStyles.nodeInspectorToggleGroup}>
                {availableNestedWorkflows.map((workflow) => {
                  const slug = workflow.slug;
                  const label = workflow.display_name?.trim() || slug;
                  return (
                    <ToggleRow
                      key={workflow.id}
                      label={label}
                      checked={workflowToolSlugSet.has(slug)}
                      onChange={(next) => onAgentWorkflowToolToggle(nodeId, slug, next)}
                      help={t(
                        "workflowBuilder.agentInspector.workflowToolsToggleHelp",
                        { slug },
                      )}
                    />
                  );
                })}
              </div>
            ) : (
              <p className={legacyStyles.nodeInspectorEmptyLabel}>
                {t("workflowBuilder.agentInspector.workflowToolsEmpty")}
              </p>
            )}
            {missingWorkflowToolSlugs.length > 0 ? (
              <div className={legacyStyles.nodeInspectorInfoMessage}>
                {missingWorkflowToolSlugs.map((slug) => (
                  <div key={slug}>
                    {t("workflowBuilder.agentInspector.workflowToolsMissing", { slug })}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {modal}
      </>
    );
  }

  return (
    <>
      <AccordionSection
        id="function-tools"
        title={t("workflowBuilder.agentInspector.functionToolsTitle")}
        icon={Wrench}
        expandedByDefault={hasFunctionToolEnabled}
        showToggle={false}
      >
        <div className={v2Styles.sectionHeader}>
          <p className={v2Styles.sectionDescription}>
            {t("workflowBuilder.agentInspector.functionToolsDescription")}
          </p>
        </div>

        <div className={v2Styles.toggleGroup}>
          <ToggleRow
            label={t("workflowBuilder.agentInspector.weatherToolLabel")}
            checked={weatherFunctionEnabled}
            onChange={(next) => onAgentWeatherToolChange(nodeId, next)}
            help={t("workflowBuilder.agentInspector.weatherToolHelp")}
            className={v2Styles.toggleRow}
          />
          <ToggleRow
            label={t("workflowBuilder.agentInspector.widgetValidationLabel")}
            checked={widgetValidationFunctionEnabled}
            onChange={(next) => onAgentWidgetValidationToolChange(nodeId, next)}
            help={t("workflowBuilder.agentInspector.widgetValidationHelp")}
            className={v2Styles.toggleRow}
          />
          <ToggleRow
            label={t("workflowBuilder.agentInspector.workflowValidationLabel")}
            checked={workflowValidationFunctionEnabled}
            onChange={(next) => onAgentWorkflowValidationToolChange(nodeId, next)}
            help={t("workflowBuilder.agentInspector.workflowValidationHelp")}
            className={v2Styles.toggleRow}
          />
        </div>
      </AccordionSection>

      <AccordionSection
        id="mcp-servers"
        title={t("workflowBuilder.agentInspector.mcpServersTitle")}
        icon={Server}
        expandedByDefault={hasSelectedMcpServers}
        showToggle={false}
      >
        <div className={v2Styles.sectionHeader}>
          <p className={v2Styles.sectionDescription}>
            {t("workflowBuilder.agentInspector.mcpServersDescription")}
          </p>
        </div>

        <div className={v2Styles.buttonRow}>
          <button
            type="button"
            className="btn"
            onClick={() => setIsCreateModalOpen(true)}
          >
            {t("workflowBuilder.agentInspector.mcpServersAddButton")}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              void refreshServers(true);
            }}
            disabled={serversLoading}
          >
            {serversLoading
              ? t("workflowBuilder.agentInspector.mcpServersRefreshing")
              : t("workflowBuilder.agentInspector.mcpServersRefreshButton")}
          </button>
        </div>

        {serversError ? (
          <div className={v2Styles.errorMessage}>{serversError}</div>
        ) : null}

        {servers.length === 0 && !serversLoading ? (
          <div className={v2Styles.statusMessage}>
            {t("workflowBuilder.agentInspector.mcpServersEmpty")}
          </div>
        ) : null}

        {serversLoading && servers.length === 0 ? (
          <div className={v2Styles.statusMessage}>
            {t("workflowBuilder.agentInspector.mcpServersLoading")}
          </div>
        ) : null}

        <div className={v2Styles.mcpServerList}>
          {servers.map((server) => {
            const selection = selectedServers.get(server.id);
            const availableNames = extractToolNamesFromSummary(server);
            const isRestricted = Boolean(selection && selection.toolNames.length > 0);
            const manualDraft = manualToolDrafts[server.id] ?? "";
            const probe = getProbeState(server.id);
            const customNames =
              selection && selection.toolNames.length > 0
                ? selection.toolNames.filter((name) => !availableNames.includes(name))
                : [];

            return (
              <div key={server.id} className={v2Styles.mcpServerCard}>
                <label className={v2Styles.mcpServerHeader}>
                  <input
                    type="checkbox"
                    checked={Boolean(selection)}
                    onChange={(event) =>
                      handleServerToggle(server, event.target.checked)
                    }
                  />
                  <div className={v2Styles.mcpServerHeading}>
                    <div className={v2Styles.mcpServerLabel}>{server.label}</div>
                    <div className={v2Styles.mutedText}>{server.server_url}</div>
                    {server.authorization_hint ? (
                      <div className={v2Styles.mutedTextSmall}>
                        {t(
                          "workflowBuilder.agentInspector.mcpServersAuthorizationStored",
                          { hint: server.authorization_hint },
                        )}
                      </div>
                    ) : null}
                    {server.tools_cache_updated_at ? (
                      <div className={v2Styles.mutedTextSmall}>
                        {t(
                          "workflowBuilder.agentInspector.mcpServersCacheUpdated",
                          { value: server.tools_cache_updated_at },
                        )}
                      </div>
                    ) : null}
                  </div>
                </label>

                {selection ? (
                  <div className={v2Styles.mcpServerDetails}>
                    <Field
                      label={t(
                        "workflowBuilder.agentInspector.mcpServersAuthorizationOverrideLabel",
                      )}
                      className={v2Styles.field}
                    >
                      <input
                        type="password"
                        value={selection.authorizationOverride ?? ""}
                        onChange={(event) =>
                          handleAuthorizationOverrideChange(
                            server.id,
                            event.target.value,
                          )
                        }
                        placeholder={server.authorization_hint ?? undefined}
                        autoComplete="off"
                      />
                    </Field>

                    <ToggleRow
                      label={t("workflowBuilder.agentInspector.mcpServersRestrictToggle")}
                      checked={isRestricted}
                      onChange={(next) =>
                        handleRestrictionToggle(server.id, next, availableNames)
                      }
                      help={t("workflowBuilder.agentInspector.mcpServersRestrictHelp")}
                      className={v2Styles.toggleRow}
                    />

                    {availableNames.length > 0 ? (
                      <div className={v2Styles.chipGroup}>
                        {availableNames.map((name) => {
                          const isChecked =
                            !isRestricted || selection.toolNames.includes(name);
                          return (
                            <label
                              key={name}
                              className={
                                isChecked
                                  ? `${v2Styles.chip} ${v2Styles.chipSelected}`
                                  : v2Styles.chip
                              }
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(event) =>
                                  handleToolToggle(
                                    server.id,
                                    name,
                                    availableNames,
                                    event.target.checked,
                                  )
                                }
                              />
                              <span>{name}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <p className={v2Styles.mutedText}>
                        {t("workflowBuilder.agentInspector.mcpServersNoTools")}
                      </p>
                    )}

                    {customNames.length > 0 ? (
                      <div className={v2Styles.chipGroup}>
                        {customNames.map((name) => (
                          <button
                            key={name}
                            type="button"
                            className={v2Styles.customChip}
                            onClick={() => handleManualToolRemove(server.id, name)}
                          >
                            {name}
                            <span className={v2Styles.customChipRemove} aria-hidden="true">
                              ×
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <Field
                      label={t("workflowBuilder.agentInspector.mcpServersAddToolLabel")}
                      className={v2Styles.field}
                    >
                      <div className={v2Styles.inlineField}>
                        <input
                          type="text"
                          value={manualDraft}
                          onChange={(event) =>
                            handleManualToolDraftChange(server.id, event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              handleManualToolAdd(server.id);
                            }
                          }}
                          placeholder={t(
                            "workflowBuilder.agentInspector.mcpServersAddToolPlaceholder",
                          )}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => handleManualToolAdd(server.id)}
                          disabled={!manualDraft.trim()}
                        >
                          {t("workflowBuilder.agentInspector.mcpServersAddToolButton")}
                        </button>
                      </div>
                    </Field>

                    <div className={v2Styles.inlineField}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => handleProbeServer(server)}
                        disabled={probe.status === "loading"}
                      >
                        {t("workflowBuilder.agentInspector.mcpServersProbeButton")}
                      </button>
                      {probe.status !== "idle" && probe.message ? (
                        <div
                          role="status"
                          className={
                            probe.status === "error"
                              ? v2Styles.errorMessage
                              : v2Styles.statusMessage
                          }
                        >
                          {probe.message}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </AccordionSection>

      <AccordionSection
        id="workflow-tools"
        title={t("workflowBuilder.agentInspector.workflowToolsTitle")}
        icon={GitBranch}
        expandedByDefault={hasWorkflowToolEnabled}
        showToggle={false}
      >
        <div className={v2Styles.sectionHeader}>
          <p className={v2Styles.sectionDescription}>
            {t("workflowBuilder.agentInspector.workflowToolsDescription")}
          </p>
        </div>

        {availableNestedWorkflows.length > 0 ? (
          <div className={v2Styles.toggleGroup}>
            {availableNestedWorkflows.map((workflow) => {
              const slug = workflow.slug;
              const label = workflow.display_name?.trim() || slug;
              return (
                <ToggleRow
                  key={workflow.id}
                  label={label}
                  checked={workflowToolSlugSet.has(slug)}
                  onChange={(next) => onAgentWorkflowToolToggle(nodeId, slug, next)}
                  help={t("workflowBuilder.agentInspector.workflowToolsToggleHelp", { slug })}
                  className={v2Styles.toggleRow}
                />
              );
            })}
          </div>
        ) : (
          <div className={v2Styles.statusMessage}>
            {t("workflowBuilder.agentInspector.workflowToolsEmpty")}
          </div>
        )}

        {missingWorkflowToolSlugs.length > 0 ? (
          <div className={v2Styles.noticeCard}>
            {missingWorkflowToolSlugs.map((slug) => (
              <div key={slug}>
                {t("workflowBuilder.agentInspector.workflowToolsMissing", { slug })}
              </div>
            ))}
          </div>
        ) : null}
      </AccordionSection>
      {modal}
    </>
  );
};

