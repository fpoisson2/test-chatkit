import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../../../../../i18n";
import {
  getAgentWeatherToolEnabled,
  getAgentWidgetValidationToolEnabled,
  getAgentWorkflowTools,
  getAgentWorkflowValidationToolEnabled,
  getAgentMcpSseConfig,
} from "../../../../../utils/workflows";
import type { FlowNode, WorkflowSummary, McpSseToolConfig } from "../../../types";
import { ToggleRow } from "../components/ToggleRow";
import styles from "../NodeInspector.module.css";
import { ApiError } from "../../../../../utils/backend";
import type {
  McpOAuthSessionStatus,
  McpOAuthStartResponse,
} from "../../../../../utils/backend";

type McpTestResult = {
  status: string;
  detail?: string;
  status_code?: number;
  tool_names?: unknown;
};

type ToolSettingsPanelProps = {
  nodeId: string;
  parameters: FlowNode["data"]["parameters"];
  workflows: WorkflowSummary[];
  currentWorkflowId: number | null;
  onAgentWeatherToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWidgetValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowToolToggle: (nodeId: string, slug: string, enabled: boolean) => void;
  onAgentMcpSseConfigChange: (
    nodeId: string,
    config: McpSseToolConfig | null,
  ) => void;
  onTestMcpSseConnection: (config: McpSseToolConfig) => Promise<McpTestResult>;
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
  onAgentWeatherToolChange,
  onAgentWidgetValidationToolChange,
  onAgentWorkflowValidationToolChange,
  onAgentWorkflowToolToggle,
  onAgentMcpSseConfigChange,
  onTestMcpSseConnection,
  onStartMcpOAuth,
  onPollMcpOAuth,
  onCancelMcpOAuth,
}: ToolSettingsPanelProps) => {
  const { t } = useI18n();

  const weatherFunctionEnabled = getAgentWeatherToolEnabled(parameters);
  const widgetValidationFunctionEnabled = getAgentWidgetValidationToolEnabled(parameters);
  const workflowValidationFunctionEnabled =
    getAgentWorkflowValidationToolEnabled(parameters);

  const workflowToolConfigs = getAgentWorkflowTools(parameters);
  const workflowToolSlugs = workflowToolConfigs.map((config) => config.slug);

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

  const mcpConfig = getAgentMcpSseConfig(parameters);
  const mcpUrlValue = mcpConfig?.url ?? "";
  const mcpAuthorizationValue = mcpConfig?.authorization ?? "";
  const mcpClientIdValue = mcpConfig?.oauth_client_id ?? "";
  const mcpScopeValue = mcpConfig?.oauth_scope ?? "";

  const [mcpUrlDraft, setMcpUrlDraft] = useState(mcpUrlValue);
  const [mcpAuthorizationDraft, setMcpAuthorizationDraft] = useState(
    mcpAuthorizationValue,
  );
  const [mcpClientIdDraft, setMcpClientIdDraft] = useState(mcpClientIdValue);
  const [mcpScopeDraft, setMcpScopeDraft] = useState(mcpScopeValue);

  const [mcpTestState, setMcpTestState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    message: string;
    statusLabel: string | null;
    toolNames: string[];
  }>({ status: "idle", message: "", statusLabel: null, toolNames: [] });

  const [oauthFeedback, setOauthFeedback] = useState<{
    status: "idle" | "starting" | "pending" | "success" | "error";
    message: string | null;
    stateId: string | null;
  }>({ status: "idle", message: null, stateId: null });

  const latestOauthStatusRef = useRef(oauthFeedback.status);
  const latestOauthStateRef = useRef<string | null>(oauthFeedback.stateId);
  const onCancelMcpOAuthRef = useRef(onCancelMcpOAuth);

  useEffect(() => {
    setMcpUrlDraft(mcpUrlValue);
  }, [mcpUrlValue]);

  useEffect(() => {
    setMcpAuthorizationDraft(mcpAuthorizationValue);
  }, [mcpAuthorizationValue]);

  useEffect(() => {
    if (!mcpUrlDraft.trim()) {
      setMcpTestState((state) =>
        state.status === "idle"
          ? state
          : { status: "idle", message: "", statusLabel: null, toolNames: [] },
      );
    }
  }, [mcpUrlDraft]);

  useEffect(() => {
    latestOauthStatusRef.current = oauthFeedback.status;
    latestOauthStateRef.current = oauthFeedback.stateId;
  }, [oauthFeedback.status, oauthFeedback.stateId]);

  useEffect(() => {
    onCancelMcpOAuthRef.current = onCancelMcpOAuth;
  }, [onCancelMcpOAuth]);

  useEffect(() => {
    return () => {
      if (
        latestOauthStatusRef.current === "pending" &&
        latestOauthStateRef.current &&
        onCancelMcpOAuthRef.current
      ) {
        void onCancelMcpOAuthRef.current(latestOauthStateRef.current).catch(() => {});
      }
    };
  }, []);

  const handleMcpUrlChange = useCallback(
    (value: string) => {
      setMcpUrlDraft(value);
      onAgentMcpSseConfigChange(nodeId, {
        url: value,
        authorization: mcpAuthorizationDraft,
      });
    },
    [nodeId, onAgentMcpSseConfigChange, mcpAuthorizationDraft],
  );

  const applyAuthorizationValue = useCallback(
    (value: string) => {
      setMcpAuthorizationDraft(value);
      onAgentMcpSseConfigChange(nodeId, {
        url: mcpUrlDraft,
        authorization: value,
      });
    },
    [mcpUrlDraft, nodeId, onAgentMcpSseConfigChange],
  );

  const handleMcpAuthorizationChange = useCallback(
    (value: string) => {
      applyAuthorizationValue(value);
    },
    [applyAuthorizationValue],
  );

  const handleTestConnection = useCallback(async () => {
    const url = mcpUrlDraft.trim();
    if (!url) {
      setMcpTestState({
        status: "error",
        message: t("workflowBuilder.agentInspector.mcpTestStatus.invalidConfig"),
        statusLabel: "invalidConfig",
        toolNames: [],
      });
      return;
    }

    setMcpTestState({
      status: "loading",
      message: t("workflowBuilder.agentInspector.mcpTestStatus.loading"),
      statusLabel: "loading",
      toolNames: [],
    });

    try {
      const result = await onTestMcpSseConnection({
        url,
        authorization: mcpAuthorizationDraft,
      });

      const rawNames = Array.isArray(result.tool_names)
        ? result.tool_names
            .map((name) => (typeof name === "string" ? name.trim() : ""))
            .filter((name): name is string => Boolean(name))
        : [];

      const translationKey = `workflowBuilder.agentInspector.mcpTestStatus.${result.status}`;
      let message = t(translationKey, {
        count: rawNames.length,
        statusCode: result.status_code ?? "",
        detail: result.detail ?? "",
      });
      if (message === translationKey) {
        message = result.detail ?? result.status;
      }

      setMcpTestState({
        status: result.status === "ok" ? "success" : "error",
        message,
        statusLabel: result.status,
        toolNames: rawNames,
      });
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : t("workflowBuilder.agentInspector.mcpTestStatus.errorUnknown");
      setMcpTestState({
        status: "error",
        message: t("workflowBuilder.agentInspector.mcpTestStatus.error", { detail }),
        statusLabel: "exception",
        toolNames: [],
      });
    }
  }, [mcpAuthorizationDraft, mcpUrlDraft, onTestMcpSseConnection, t]);

  const buildAuthorizationFromToken = useCallback(
    (token: Record<string, unknown> | null | undefined): string | null => {
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
    },
    [],
  );

  const handleStartOAuth = useCallback(async () => {
    const url = mcpUrlDraft.trim();
    if (!url) {
      setOauthFeedback({
        status: "error",
        message: t("workflowBuilder.agentInspector.mcpTestStatus.invalidConfig"),
        stateId: null,
      });
      return;
    }

    const previousState = latestOauthStateRef.current;
    if (previousState && onCancelMcpOAuth) {
      void onCancelMcpOAuth(previousState).catch(() => {});
    }

    setOauthFeedback({
      status: "starting",
      message: t("workflowBuilder.agentInspector.mcpOAuthStatus.starting"),
      stateId: null,
    });

    try {
      const result = await onStartMcpOAuth({
        url,
        clientId: mcpClientIdDraft.trim() || null,
        scope: mcpScopeDraft.trim() || null,
      });

      const popup =
        typeof window !== "undefined"
          ? window.open(result.authorization_url, "_blank", "noopener")
          : null;

      if (!popup) {
        setOauthFeedback({
          status: "error",
          message: t(
            "workflowBuilder.agentInspector.mcpOAuthStatus.windowBlocked",
          ),
          stateId: null,
        });
        if (onCancelMcpOAuth) {
          void onCancelMcpOAuth(result.state).catch(() => {});
        }
        return;
      }

      popup.focus?.();

      setOauthFeedback({
        status: "pending",
        message: t("workflowBuilder.agentInspector.mcpOAuthStatus.pending"),
        stateId: result.state,
      });
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : t("workflowBuilder.agentInspector.mcpOAuthStatus.unknownError");
      const message = detail
        ? t("workflowBuilder.agentInspector.mcpOAuthStatus.errorWithDetail", {
            detail,
          })
        : t("workflowBuilder.agentInspector.mcpOAuthStatus.error");
      setOauthFeedback({ status: "error", message, stateId: null });
    }
  }, [
    mcpUrlDraft,
    mcpClientIdDraft,
    mcpScopeDraft,
    onStartMcpOAuth,
    onCancelMcpOAuth,
    t,
  ]);

  useEffect(() => {
    const sessionState = oauthFeedback.stateId;
    if (oauthFeedback.status !== "pending" || !sessionState) {
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
            const next = await onPollMcpOAuth(sessionState);
            handleResult(next);
          } catch (error) {
            if (cancelled) {
              return;
            }
            let message: string;
            if (error instanceof ApiError && error.status === 404) {
              message = t(
                "workflowBuilder.agentInspector.mcpOAuthStatus.sessionExpired",
              );
            } else {
              const detail =
                error instanceof Error
                  ? error.message
                  : t(
                      "workflowBuilder.agentInspector.mcpOAuthStatus.unknownError",
                    );
              message = t(
                "workflowBuilder.agentInspector.mcpOAuthStatus.errorWithDetail",
                { detail },
              );
            }
            setOauthFeedback({ status: "error", message, stateId: null });
            if (onCancelMcpOAuth) {
              void onCancelMcpOAuth(sessionState).catch(() => {});
            }
          }
        }, 1500);
        return;
      }

      if (result.status === "ok") {
        const authorization = buildAuthorizationFromToken(result.token);
        if (authorization) {
          applyAuthorizationValue(authorization);
          setOauthFeedback({
            status: "success",
            message: t(
              "workflowBuilder.agentInspector.mcpOAuthStatus.success",
            ),
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

      if (onCancelMcpOAuth) {
        void onCancelMcpOAuth(result.state).catch(() => {});
      }
      timeoutHandle = null;
    };

    (async () => {
      try {
        const initial = await onPollMcpOAuth(sessionState);
        handleResult(initial);
      } catch (error) {
        if (cancelled) {
          return;
        }
        let message: string;
        if (error instanceof ApiError && error.status === 404) {
          message = t(
            "workflowBuilder.agentInspector.mcpOAuthStatus.sessionExpired",
          );
        } else {
          const detail =
            error instanceof Error
              ? error.message
              : t("workflowBuilder.agentInspector.mcpOAuthStatus.unknownError");
          message = t(
            "workflowBuilder.agentInspector.mcpOAuthStatus.errorWithDetail",
            { detail },
          );
        }
        setOauthFeedback({ status: "error", message, stateId: null });
        if (onCancelMcpOAuth) {
          void onCancelMcpOAuth(sessionState).catch(() => {});
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    };
  }, [
    oauthFeedback.status,
    oauthFeedback.stateId,
    onPollMcpOAuth,
    onCancelMcpOAuth,
    buildAuthorizationFromToken,
    applyAuthorizationValue,
    t,
  ]);

  return (
    <div className={styles.nodeInspectorPanelInnerAccentTight}>
      <strong className={styles.nodeInspectorSectionTitleSmall}>Function tool</strong>
      <ToggleRow
        label="Autoriser la fonction météo Python"
        checked={weatherFunctionEnabled}
        onChange={(next) => onAgentWeatherToolChange(nodeId, next)}
        help="Ajoute l'outil fetch_weather pour récupérer la météo via le backend."
      />
      <ToggleRow
        label="Autoriser la fonction de validation de widget"
        checked={widgetValidationFunctionEnabled}
        onChange={(next) => onAgentWidgetValidationToolChange(nodeId, next)}
        help="Ajoute l'outil validate_widget pour vérifier une définition de widget ChatKit."
      />
      <ToggleRow
        label="Autoriser la fonction de validation de workflow"
        checked={workflowValidationFunctionEnabled}
        onChange={(next) => onAgentWorkflowValidationToolChange(nodeId, next)}
        help="Ajoute l'outil validate_workflow_graph pour vérifier un graphe de workflow."
      />
      <div className={styles.nodeInspectorPanelInner}>
        <strong className={styles.nodeInspectorSectionTitleSmall}>
          {t("workflowBuilder.agentInspector.mcpSectionTitle")}
        </strong>
        <p className={styles.nodeInspectorHintTextTight}>
          {t("workflowBuilder.agentInspector.mcpSectionDescription")}
        </p>
        <label className={styles.nodeInspectorField}>
          <span className={styles.nodeInspectorLabel}>
            {t("workflowBuilder.agentInspector.mcpUrlLabel")}
          </span>
          <input
            type="url"
            value={mcpUrlDraft}
            onChange={(event) => handleMcpUrlChange(event.target.value)}
            placeholder="https://"
            autoComplete="off"
          />
        </label>
        <label className={styles.nodeInspectorField}>
          <span className={styles.nodeInspectorLabel}>
            {t("workflowBuilder.agentInspector.mcpClientIdLabel")}
          </span>
          <input
            type="text"
            value={mcpClientIdDraft}
            onChange={(event) => setMcpClientIdDraft(event.target.value)}
            placeholder={t(
              "workflowBuilder.agentInspector.mcpClientIdPlaceholder",
            )}
            autoComplete="off"
          />
        </label>
        <label className={styles.nodeInspectorField}>
          <span className={styles.nodeInspectorLabel}>
            {t("workflowBuilder.agentInspector.mcpScopeLabel")}
          </span>
          <input
            type="text"
            value={mcpScopeDraft}
            onChange={(event) => setMcpScopeDraft(event.target.value)}
            placeholder={t(
              "workflowBuilder.agentInspector.mcpScopePlaceholder",
            )}
            autoComplete="off"
          />
          <p className={styles.nodeInspectorHintTextTight}>
            {t("workflowBuilder.agentInspector.mcpScopeHelp")}
          </p>
        </label>
        <label className={styles.nodeInspectorField}>
          <span className={styles.nodeInspectorLabel}>
            {t("workflowBuilder.agentInspector.mcpAuthorizationLabel")}
          </span>
          <input
            type="password"
            value={mcpAuthorizationDraft}
            onChange={(event) => handleMcpAuthorizationChange(event.target.value)}
            placeholder={t("workflowBuilder.agentInspector.mcpAuthorizationPlaceholder")}
            autoComplete="off"
          />
          <p className={styles.nodeInspectorHintTextTight}>
            {t("workflowBuilder.agentInspector.mcpAuthorizationHelp")}
          </p>
        </label>
        <div className={styles.nodeInspectorField}>
          <button
            type="button"
            className="btn"
            onClick={handleStartOAuth}
            disabled={
              !mcpUrlDraft.trim() ||
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
            disabled={mcpTestState.status === "loading"}
          >
            {t("workflowBuilder.agentInspector.mcpTestButton")}
          </button>
        </div>
        {oauthFeedback.status !== "idle" && oauthFeedback.message ? (
          <div
            role="status"
            className={
              oauthFeedback.status === "error"
                ? styles.nodeInspectorErrorTextSmall
                : styles.nodeInspectorInfoMessage
            }
          >
            {oauthFeedback.message}
          </div>
        ) : null}
        {mcpTestState.status !== "idle" ? (
          <div
            role="status"
            className={
              mcpTestState.status === "error"
                ? styles.nodeInspectorErrorTextSmall
                : styles.nodeInspectorInfoMessage
            }
          >
            {mcpTestState.message}
          </div>
        ) : null}
        {mcpTestState.status === "success" && mcpTestState.toolNames.length > 0 ? (
          <div className={styles.nodeInspectorInfoMessage}>
            {t("workflowBuilder.agentInspector.mcpTestStatus.toolListLabel")}: {mcpTestState.toolNames.join(", ")}
          </div>
        ) : null}
      </div>
      <div>
        <strong className={styles.nodeInspectorSectionTitleSmall}>
          {t("workflowBuilder.agentInspector.workflowToolsTitle")}
        </strong>
        <p className={styles.nodeInspectorHintTextTight}>
          {t("workflowBuilder.agentInspector.workflowToolsDescription")}
        </p>
        {availableNestedWorkflows.length > 0 ? (
          <div className={styles.nodeInspectorToggleGroup}>
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
                />
              );
            })}
          </div>
        ) : (
          <p className={styles.nodeInspectorEmptyLabel}>
            {t("workflowBuilder.agentInspector.workflowToolsEmpty")}
          </p>
        )}
        {missingWorkflowToolSlugs.length > 0 ? (
          <div className={styles.nodeInspectorInfoMessage}>
            {missingWorkflowToolSlugs.map((slug) => (
              <div key={slug}>
                {t("workflowBuilder.agentInspector.workflowToolsMissing", { slug })}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

