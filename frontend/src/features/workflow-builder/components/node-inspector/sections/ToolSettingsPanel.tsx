import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n } from "../../../../../i18n";
import {
  getAgentWeatherToolEnabled,
  getAgentWidgetValidationToolEnabled,
  getAgentWorkflowTools,
  getAgentWorkflowValidationToolEnabled,
  isPlainRecord,
  serializeAgentMcpToolConfig,
} from "../../../../../utils/workflows";
import {
  completeMcpOAuth,
  createMcpCredential,
  deleteMcpCredential,
  startMcpOAuth,
  testMcpConnection,
} from "../../../../../utils/backend";
import type {
  AgentMcpRequireApprovalMode,
  AgentMcpToolConfig,
  AgentMcpToolValidation,
  AgentMcpTransport,
  FlowNode,
  WorkflowSummary,
} from "../../../types";
import { ToggleRow } from "../components/ToggleRow";
import styles from "../NodeInspector.module.css";

type ToolSettingsPanelProps = {
  nodeId: string;
  authToken: string | null;
  parameters: FlowNode["data"]["parameters"];
  workflows: WorkflowSummary[];
  currentWorkflowId: number | null;
  mcpTools: AgentMcpToolConfig[];
  mcpValidation: AgentMcpToolValidation[];
  onAgentMcpToolsChange: (nodeId: string, configs: AgentMcpToolConfig[]) => void;
  onAgentWeatherToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWidgetValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowToolToggle: (nodeId: string, slug: string, enabled: boolean) => void;
};

type CredentialFormState = {
  apiKey: string;
  oauthAuthorizationUrl: string;
  oauthTokenUrl: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScope: string;
  oauthCode: string;
  oauthState: string | null;
  saving: boolean;
  oauthStarting: boolean;
  oauthCompleting: boolean;
  deleting: boolean;
  error: string | null;
};

type McpConnectionState = {
  status: "idle" | "testing" | "success" | "error";
  message: string | null;
};

export const ToolSettingsPanel = ({
  nodeId,
  authToken,
  parameters,
  workflows,
  currentWorkflowId,
  mcpTools,
  mcpValidation,
  onAgentMcpToolsChange,
  onAgentWeatherToolChange,
  onAgentWidgetValidationToolChange,
  onAgentWorkflowValidationToolChange,
  onAgentWorkflowToolToggle,
}: ToolSettingsPanelProps) => {
  const { t } = useI18n();

  const [connectionStates, setConnectionStates] = useState<
    Record<string, McpConnectionState>
  >({});
  const [credentialForms, setCredentialForms] = useState<
    Record<string, CredentialFormState>
  >({});

  useEffect(() => {
    setConnectionStates((prev) => {
      const ids = new Set(mcpTools.map((tool) => tool.id));
      let changed = false;
      const next: Record<string, McpConnectionState> = {};
      for (const tool of mcpTools) {
        const existing = prev[tool.id];
        if (existing) {
          next[tool.id] = existing;
        } else {
          next[tool.id] = { status: "idle", message: null };
          changed = true;
        }
      }
      for (const key of Object.keys(prev)) {
        if (!ids.has(key)) {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [mcpTools]);

  useEffect(() => {
    setCredentialForms((prev) => {
      const ids = new Set(mcpTools.map((tool) => tool.id));
      let changed = false;
      const next: Record<string, CredentialFormState> = {};
      for (const tool of mcpTools) {
        const existing = prev[tool.id];
        if (existing) {
          next[tool.id] = existing;
        } else {
          next[tool.id] = {
            apiKey: "",
            oauthAuthorizationUrl: "",
            oauthTokenUrl: "",
            oauthClientId: "",
            oauthClientSecret: "",
            oauthScope: "",
            oauthCode: "",
            oauthState: null,
            saving: false,
            oauthStarting: false,
            oauthCompleting: false,
            deleting: false,
            error: null,
          };
          changed = true;
        }
      }
      for (const key of Object.keys(prev)) {
        if (!ids.has(key)) {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [mcpTools]);

  const setConnectionState = useCallback(
    (toolId: string, state: McpConnectionState) => {
      setConnectionStates((prev) => {
        const current = prev[toolId];
        if (
          current &&
          current.status === state.status &&
          current.message === state.message
        ) {
          return prev;
        }
        return { ...prev, [toolId]: state };
      });
    },
    [],
  );

  const updateCredentialForm = useCallback(
    (toolId: string, updates: Partial<CredentialFormState>) => {
      setCredentialForms((prev) => {
        const current = prev[toolId];
        if (!current) {
          return prev;
        }
        const nextState: CredentialFormState = { ...current, ...updates };
        return { ...prev, [toolId]: nextState };
      });
    },
    [],
  );

  const resetConnectionState = useCallback(
    (toolId: string) => {
      setConnectionStates((prev) => {
        const current = prev[toolId];
        if (!current || (current.status === "idle" && current.message === null)) {
          return prev;
        }
        return { ...prev, [toolId]: { status: "idle", message: null } };
      });
    },
    [],
  );

  const removeConnectionState = useCallback((toolId: string) => {
    setConnectionStates((prev) => {
      if (!(toolId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[toolId];
      return next;
    });
  }, []);

  const removeCredentialForm = useCallback((toolId: string) => {
    setCredentialForms((prev) => {
      if (!(toolId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[toolId];
      return next;
    });
  }, []);

  const handleTestConnection = useCallback(
    async (tool: AgentMcpToolConfig) => {
      setConnectionState(tool.id, {
        status: "testing",
        message: t("workflowBuilder.agentInspector.mcpTestConnectionInProgress"),
      });

      try {
        const response = await testMcpConnection({
          token: authToken,
          payload: serializeAgentMcpToolConfig(tool),
        });
        const fallbackSuccess = t(
          "workflowBuilder.agentInspector.mcpTestConnectionSuccessGeneric",
        );
        const fallbackError = t(
          "workflowBuilder.agentInspector.mcpTestConnectionUnexpectedError",
        );

        if (response.ok) {
          setConnectionState(tool.id, {
            status: "success",
            message: response.message?.trim() || fallbackSuccess,
          });
        } else {
          setConnectionState(tool.id, {
            status: "error",
            message: response.message?.trim() || fallbackError,
          });
        }
      } catch (error) {
        const fallbackMessage =
          error instanceof Error && error.message
            ? error.message
            : t("workflowBuilder.agentInspector.mcpTestConnectionUnexpectedError");
        setConnectionState(tool.id, {
          status: "error",
          message: fallbackMessage,
        });
      }
    },
    [authToken, setConnectionState, t],
  );

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

  const mcpValidationMap = useMemo(() => {
    const map = new Map<string, AgentMcpToolValidation["errors"]>();
    mcpValidation.forEach((entry) => {
      map.set(entry.id, entry.errors);
    });
    return map;
  }, [mcpValidation]);

  const normalizeMultiline = (value: string): string => value.replace(/\r\n/g, "\n");

  const handleMcpToolChange = (
    toolId: string,
    updates: Partial<AgentMcpToolConfig>,
  ) => {
    const next = mcpTools.map((tool) =>
      tool.id === toolId ? { ...tool, ...updates } : tool,
    );
    onAgentMcpToolsChange(nodeId, next);
    resetConnectionState(toolId);
  };

  const handleMcpToolRemove = (toolId: string) => {
    const next = mcpTools.filter((tool) => tool.id !== toolId);
    onAgentMcpToolsChange(nodeId, next);
    removeConnectionState(toolId);
    removeCredentialForm(toolId);
  };

  const handleAddMcpTool = () => {
    const next: AgentMcpToolConfig = {
      id: `mcp-${Date.now()}`,
      transport: "hosted",
      serverLabel: "",
      serverUrl: "",
      connectorId: "",
      authorization: "",
      headersText: "",
      allowedToolsText: "",
      requireApprovalMode: "never",
      requireApprovalCustom: "",
      description: "",
      url: "",
      command: "",
      argsText: "",
      envText: "",
      cwd: "",
      credentialId: null,
      credentialLabel: "",
      credentialHint: "",
      credentialStatus: "disconnected",
      credentialAuthType: null,
    };
    onAgentMcpToolsChange(nodeId, [...mcpTools, next]);
  };

  const getSerializedMcpConfig = useCallback(
    (tool: AgentMcpToolConfig): Record<string, unknown> => {
      const serialized = serializeAgentMcpToolConfig(tool);
      const candidates = [serialized.mcp, serialized.config, serialized.server];
      for (const candidate of candidates) {
        if (isPlainRecord(candidate)) {
          return candidate as Record<string, unknown>;
        }
      }
      return {};
    },
    [],
  );

  const handleSaveApiKeyCredential = async (tool: AgentMcpToolConfig) => {
    const form = credentialForms[tool.id];
    if (!form) {
      return;
    }

    const trimmedKey = form.apiKey.trim();
    if (!trimmedKey) {
      updateCredentialForm(tool.id, {
        error: t("workflowBuilder.agentInspector.mcpCredentialApiKeyMissing"),
      });
      return;
    }

    updateCredentialForm(tool.id, { saving: true, error: null });

    try {
      const configPayload = getSerializedMcpConfig(tool);
      const headers = isPlainRecord(configPayload.headers)
        ? (configPayload.headers as Record<string, unknown>)
        : undefined;
      const env = isPlainRecord(configPayload.env)
        ? (configPayload.env as Record<string, unknown>)
        : undefined;
      const label =
        tool.credentialLabel.trim() ||
        tool.serverLabel.trim() ||
        tool.serverUrl.trim() ||
        t("workflowBuilder.agentInspector.mcpCredentialDefaultLabel");

      const response = await createMcpCredential({
        token: authToken,
        payload: {
          label,
          provider: null,
          authType: "api_key",
          authorization: trimmedKey,
          headers: headers ?? undefined,
          env: env ?? undefined,
        },
      });

      handleMcpToolChange(tool.id, {
        authorization: "",
        credentialId: response.id,
        credentialLabel: response.label,
        credentialHint: response.secret_hint ?? "",
        credentialStatus: response.connected ? "connected" : "disconnected",
        credentialAuthType: "api_key",
      });

      updateCredentialForm(tool.id, {
        apiKey: "",
        saving: false,
        error: null,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("workflowBuilder.agentInspector.mcpCredentialGenericError");
      updateCredentialForm(tool.id, { saving: false, error: message });
    }
  };

  const handleStartOAuthCredential = async (tool: AgentMcpToolConfig) => {
    const form = credentialForms[tool.id];
    if (!form) {
      return;
    }

    const authUrl = form.oauthAuthorizationUrl.trim();
    const tokenUrl = form.oauthTokenUrl.trim();
    const clientId = form.oauthClientId.trim();
    if (!authUrl || !tokenUrl || !clientId) {
      updateCredentialForm(tool.id, {
        error: t("workflowBuilder.agentInspector.mcpCredentialOAuthMissing"),
      });
      return;
    }

    updateCredentialForm(tool.id, { oauthStarting: true, error: null });

    try {
      let credentialId = tool.credentialId;
      const configPayload = getSerializedMcpConfig(tool);
      const headers = isPlainRecord(configPayload.headers)
        ? (configPayload.headers as Record<string, unknown>)
        : undefined;
      const env = isPlainRecord(configPayload.env)
        ? (configPayload.env as Record<string, unknown>)
        : undefined;
      const label =
        tool.credentialLabel.trim() ||
        tool.serverLabel.trim() ||
        tool.serverUrl.trim() ||
        t("workflowBuilder.agentInspector.mcpCredentialDefaultLabel");

      if (!credentialId || tool.credentialAuthType !== "oauth") {
        const response = await createMcpCredential({
          token: authToken,
          payload: {
            label,
            provider: null,
            authType: "oauth",
            headers: headers ?? undefined,
            env: env ?? undefined,
            oauth: {
              authorization_url: authUrl,
              token_url: tokenUrl,
              client_id: clientId,
              client_secret: form.oauthClientSecret.trim() || undefined,
              scope: form.oauthScope.trim() || undefined,
            },
          },
        });

        credentialId = response.id;
        handleMcpToolChange(tool.id, {
          credentialId,
          credentialLabel: response.label,
          credentialHint: response.secret_hint ?? "",
          credentialStatus: response.connected ? "connected" : "disconnected",
          credentialAuthType: "oauth",
        });
      }

      if (!credentialId) {
        throw new Error(
          t("workflowBuilder.agentInspector.mcpCredentialGenericError"),
        );
      }

      const scopeList = form.oauthScope
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      const redirectUri = `${window.location.origin}/mcp/oauth/callback`;

      const start = await startMcpOAuth({
        token: authToken,
        credentialId,
        redirectUri,
        scope: scopeList.length > 0 ? scopeList : undefined,
      });

      handleMcpToolChange(tool.id, {
        credentialId,
        credentialStatus: "pending",
        credentialAuthType: "oauth",
      });

      updateCredentialForm(tool.id, {
        oauthState: start.state,
        oauthStarting: false,
        error: null,
      });

      window.open(start.authorization_url, "_blank", "noopener,noreferrer");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("workflowBuilder.agentInspector.mcpCredentialGenericError");
      updateCredentialForm(tool.id, { oauthStarting: false, error: message });
    }
  };

  const handleCompleteOAuthCredential = async (tool: AgentMcpToolConfig) => {
    const form = credentialForms[tool.id];
    if (!form || !tool.credentialId) {
      return;
    }

    const code = form.oauthCode.trim();
    if (!code) {
      updateCredentialForm(tool.id, {
        error: t("workflowBuilder.agentInspector.mcpCredentialOAuthCodeMissing"),
      });
      return;
    }

    updateCredentialForm(tool.id, { oauthCompleting: true, error: null });

    try {
      const redirectUri = `${window.location.origin}/mcp/oauth/callback`;
      const response = await completeMcpOAuth({
        token: authToken,
        credentialId: tool.credentialId,
        code,
        state: form.oauthState,
        redirectUri,
      });

      handleMcpToolChange(tool.id, {
        credentialId: response.id,
        credentialLabel: response.label,
        credentialHint: response.secret_hint ?? "",
        credentialStatus: response.connected ? "connected" : "disconnected",
        credentialAuthType: "oauth",
      });

      updateCredentialForm(tool.id, {
        oauthCode: "",
        oauthState: null,
        oauthCompleting: false,
        error: null,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("workflowBuilder.agentInspector.mcpCredentialGenericError");
      updateCredentialForm(tool.id, { oauthCompleting: false, error: message });
    }
  };

  const handleDeleteCredential = async (tool: AgentMcpToolConfig) => {
    if (!tool.credentialId) {
      return;
    }

    updateCredentialForm(tool.id, { deleting: true, error: null });

    try {
      await deleteMcpCredential({
        token: authToken,
        credentialId: tool.credentialId,
      });

      handleMcpToolChange(tool.id, {
        credentialId: null,
        credentialHint: "",
        credentialStatus: "disconnected",
        credentialAuthType: null,
      });

      updateCredentialForm(tool.id, { deleting: false, error: null });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("workflowBuilder.agentInspector.mcpCredentialGenericError");
      updateCredentialForm(tool.id, { deleting: false, error: message });
    }
  };

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
        {mcpTools.map((tool, index) => {
          const validation = mcpValidationMap.get(tool.id) ?? {};
          const connectionError = validation.connection;
          const labelError = validation.serverLabel === "missing";
          const headersError = validation.headers === "invalid";
          const envError = validation.env === "invalid";
          const allowedToolsError = validation.allowedTools === "invalid";
          const approvalError = validation.requireApproval === "invalid";
          const connectionState =
            connectionStates[tool.id] ?? { status: "idle", message: null };
          const isTesting = connectionState.status === "testing";
          const statusClass =
            connectionState.status === "success"
              ? styles.nodeInspectorStatusSuccess
              : connectionState.status === "error"
                ? styles.nodeInspectorStatusError
                : styles.nodeInspectorStatusPending;
          const displayLabel =
            tool.serverLabel.trim() ||
            t("workflowBuilder.agentInspector.mcpServerPlaceholder", {
              index: index + 1,
            });
          const connectionMessage =
            connectionError === "missingTarget"
              ? t(
                  "workflowBuilder.agentInspector.mcpValidationMissingTarget",
                )
              : connectionError === "missingUrl"
                ? t(
                    "workflowBuilder.agentInspector.mcpValidationMissingUrl",
                  )
                : connectionError === "missingCommand"
                  ? t(
                      "workflowBuilder.agentInspector.mcpValidationMissingCommand",
                    )
                  : null;
          const credentialForm =
            credentialForms[tool.id] ?? {
              apiKey: "",
              oauthAuthorizationUrl: "",
              oauthTokenUrl: "",
              oauthClientId: "",
              oauthClientSecret: "",
              oauthScope: "",
              oauthCode: "",
              oauthState: null,
              saving: false,
              oauthStarting: false,
              oauthCompleting: false,
              deleting: false,
              error: null,
            };
          const credentialStatusLabel = t(
            `workflowBuilder.agentInspector.mcpCredentialStatus.${tool.credentialStatus}`,
          );

          return (
            <div key={tool.id} className={styles.nodeInspectorPanelInnerAccent}>
              <div className={styles.nodeInspectorInlineStack}>
                <strong className={styles.nodeInspectorSectionTitleSmall}>
                  {t("workflowBuilder.agentInspector.mcpServerHeading", {
                    label: displayLabel,
                  })}
                </strong>
                <button
                  type="button"
                  className={styles.nodeInspectorRemoveLink}
                  onClick={() => handleMcpToolRemove(tool.id)}
                >
                  {t("workflowBuilder.agentInspector.mcpDeleteServer")}
                </button>
              </div>

              <label className={styles.nodeInspectorField}>
                <span className={styles.nodeInspectorLabel}>
                  {t("workflowBuilder.agentInspector.mcpServerLabel")}
                </span>
                <input
                  type="text"
                  value={tool.serverLabel}
                  onChange={(event) =>
                    handleMcpToolChange(tool.id, {
                      serverLabel: event.target.value,
                    })
                  }
                  className={
                    labelError ? styles.nodeInspectorInputError : undefined
                  }
                />
                {labelError ? (
                  <p className={styles.nodeInspectorErrorTextSmall}>
                    {t(
                      "workflowBuilder.agentInspector.mcpValidationMissingLabel",
                    )}
                  </p>
                ) : null}
              </label>

              <label className={styles.nodeInspectorField}>
                <span className={styles.nodeInspectorLabel}>
                  {t("workflowBuilder.agentInspector.mcpTransportLabel")}
                </span>
                <select
                  value={tool.transport}
                  onChange={(event) =>
                    handleMcpToolChange(tool.id, {
                      transport: event.target.value as AgentMcpTransport,
                    })
                  }
                >
                  <option value="hosted">
                    {t("workflowBuilder.agentInspector.mcpTransportHosted")}
                  </option>
                  <option value="http">
                    {t("workflowBuilder.agentInspector.mcpTransportHttp")}
                  </option>
                  <option value="sse">
                    {t("workflowBuilder.agentInspector.mcpTransportSse")}
                  </option>
                  <option value="stdio">
                    {t("workflowBuilder.agentInspector.mcpTransportStdio")}
                  </option>
                </select>
              </label>

              <div className={styles.nodeInspectorField}>
                <span className={styles.nodeInspectorLabel}>
                  {t("workflowBuilder.agentInspector.mcpCredentialLabel")}
                </span>
                <input
                  type="text"
                  value={tool.credentialLabel}
                  onChange={(event) =>
                    handleMcpToolChange(tool.id, {
                      credentialLabel: event.target.value,
                    })
                  }
                />
                <p className={styles.nodeInspectorHintTextTight}>
                  {t("workflowBuilder.agentInspector.mcpCredentialStatusLabel", {
                    status: credentialStatusLabel,
                  })}
                </p>
                {tool.credentialHint ? (
                  <p className={styles.nodeInspectorHintTextTight}>
                    {t("workflowBuilder.agentInspector.mcpCredentialHint", {
                      hint: tool.credentialHint,
                    })}
                  </p>
                ) : null}
              </div>

              <label className={styles.nodeInspectorField}>
                <span className={styles.nodeInspectorLabel}>
                  {t("workflowBuilder.agentInspector.mcpCredentialApiKeyLabel")}
                </span>
                <input
                  type="password"
                  value={credentialForm.apiKey}
                  onChange={(event) =>
                    updateCredentialForm(tool.id, { apiKey: event.target.value })
                  }
                  placeholder={t(
                    "workflowBuilder.agentInspector.mcpCredentialApiKeyPlaceholder",
                  )}
                />
                <div className={styles.nodeInspectorInlineStack}>
                  <button
                    type="button"
                    className={styles.nodeInspectorSecondaryButton}
                    onClick={() => handleSaveApiKeyCredential(tool)}
                    disabled={credentialForm.saving}
                  >
                    {credentialForm.saving
                      ? t("workflowBuilder.agentInspector.mcpCredentialSaving")
                      : t("workflowBuilder.agentInspector.mcpCredentialSave")}
                  </button>
                  <button
                    type="button"
                    className={styles.nodeInspectorSecondaryButton}
                    onClick={() => handleDeleteCredential(tool)}
                    disabled={!tool.credentialId || credentialForm.deleting}
                  >
                    {credentialForm.deleting
                      ? t("workflowBuilder.agentInspector.mcpCredentialDeleting")
                      : t("workflowBuilder.agentInspector.mcpCredentialDelete")}
                  </button>
                </div>
              </label>

              <div className={styles.nodeInspectorField}>
                <span className={styles.nodeInspectorLabel}>
                  {t("workflowBuilder.agentInspector.mcpCredentialOauthLabel")}
                </span>
                <input
                  type="url"
                  value={credentialForm.oauthAuthorizationUrl}
                  onChange={(event) =>
                    updateCredentialForm(tool.id, {
                      oauthAuthorizationUrl: event.target.value,
                    })
                  }
                  placeholder={t(
                    "workflowBuilder.agentInspector.mcpCredentialOauthAuthorizationUrl",
                  )}
                />
                <input
                  type="url"
                  value={credentialForm.oauthTokenUrl}
                  onChange={(event) =>
                    updateCredentialForm(tool.id, {
                      oauthTokenUrl: event.target.value,
                    })
                  }
                  placeholder={t(
                    "workflowBuilder.agentInspector.mcpCredentialOauthTokenUrl",
                  )}
                />
                <input
                  type="text"
                  value={credentialForm.oauthClientId}
                  onChange={(event) =>
                    updateCredentialForm(tool.id, {
                      oauthClientId: event.target.value,
                    })
                  }
                  placeholder={t(
                    "workflowBuilder.agentInspector.mcpCredentialOauthClientId",
                  )}
                />
                <input
                  type="password"
                  value={credentialForm.oauthClientSecret}
                  onChange={(event) =>
                    updateCredentialForm(tool.id, {
                      oauthClientSecret: event.target.value,
                    })
                  }
                  placeholder={t(
                    "workflowBuilder.agentInspector.mcpCredentialOauthClientSecret",
                  )}
                />
                <textarea
                  value={credentialForm.oauthScope}
                  onChange={(event) =>
                    updateCredentialForm(tool.id, {
                      oauthScope: normalizeMultiline(event.target.value),
                    })
                  }
                  placeholder={t(
                    "workflowBuilder.agentInspector.mcpCredentialOauthScope",
                  )}
                  rows={3}
                />
                <div className={styles.nodeInspectorInlineStack}>
                  <button
                    type="button"
                    className={styles.nodeInspectorSecondaryButton}
                    onClick={() => handleStartOAuthCredential(tool)}
                    disabled={credentialForm.oauthStarting}
                  >
                    {credentialForm.oauthStarting
                      ? t("workflowBuilder.agentInspector.mcpCredentialOauthStarting")
                      : t("workflowBuilder.agentInspector.mcpCredentialOauthStart")}
                  </button>
                </div>
                <input
                  type="text"
                  value={credentialForm.oauthCode}
                  onChange={(event) =>
                    updateCredentialForm(tool.id, {
                      oauthCode: event.target.value,
                    })
                  }
                  placeholder={t(
                    "workflowBuilder.agentInspector.mcpCredentialOauthCodePlaceholder",
                  )}
                />
                <div className={styles.nodeInspectorInlineStack}>
                  <button
                    type="button"
                    className={styles.nodeInspectorSecondaryButton}
                    onClick={() => handleCompleteOAuthCredential(tool)}
                    disabled={credentialForm.oauthCompleting}
                  >
                    {credentialForm.oauthCompleting
                      ? t(
                          "workflowBuilder.agentInspector.mcpCredentialOauthCompleting",
                        )
                      : t(
                          "workflowBuilder.agentInspector.mcpCredentialOauthComplete",
                        )}
                  </button>
                </div>
              </div>

              {credentialForm.error ? (
                <p className={styles.nodeInspectorStatusMessage + " " + styles.nodeInspectorStatusError}>
                  {credentialForm.error}
                </p>
              ) : null}

              {tool.transport === "hosted" ? (
                <>
                  <label className={styles.nodeInspectorField}>
                    <span className={styles.nodeInspectorLabel}>
                      {t("workflowBuilder.agentInspector.mcpServerUrl")}
                    </span>
                    <input
                      type="url"
                      value={tool.serverUrl}
                      onChange={(event) =>
                        handleMcpToolChange(tool.id, {
                          serverUrl: event.target.value,
                        })
                      }
                      className={
                        connectionError === "missingTarget"
                          ? styles.nodeInspectorInputError
                          : undefined
                      }
                    />
                  </label>
                  <label className={styles.nodeInspectorField}>
                    <span className={styles.nodeInspectorLabel}>
                      {t("workflowBuilder.agentInspector.mcpConnectorId")}
                    </span>
                    <input
                      type="text"
                      value={tool.connectorId}
                      onChange={(event) =>
                        handleMcpToolChange(tool.id, {
                          connectorId: event.target.value,
                        })
                      }
                      className={
                        connectionError === "missingTarget"
                          ? styles.nodeInspectorInputError
                          : undefined
                      }
                    />
                  </label>
                  {connectionMessage ? (
                    <p className={styles.nodeInspectorErrorTextSmall}>
                      {connectionMessage}
                    </p>
                  ) : null}
                  <label className={styles.nodeInspectorField}>
                    <span className={styles.nodeInspectorLabel}>
                      {t("workflowBuilder.agentInspector.mcpAuthorization")}
                    </span>
                    <input
                      type="text"
                      value={tool.authorization}
                      onChange={(event) =>
                        handleMcpToolChange(tool.id, {
                          authorization: event.target.value,
                        })
                      }
                    />
                    <p className={styles.nodeInspectorHintTextTight}>
                      {t("workflowBuilder.agentInspector.mcpAuthorizationHint")}
                    </p>
                  </label>
                  <label className={styles.nodeInspectorField}>
                    <span className={styles.nodeInspectorLabel}>
                      {t("workflowBuilder.agentInspector.mcpHeaders")}
                    </span>
                    <textarea
                      className={`${styles.nodeInspectorTextarea}${
                        headersError ? ` ${styles.nodeInspectorInputError}` : ""
                      }`}
                      value={tool.headersText}
                      onChange={(event) =>
                        handleMcpToolChange(tool.id, {
                          headersText: normalizeMultiline(event.target.value),
                        })
                      }
                    />
                    <p className={styles.nodeInspectorHintTextTight}>
                      {t("workflowBuilder.agentInspector.mcpHeadersHint")}
                    </p>
                    {headersError ? (
                      <p className={styles.nodeInspectorErrorTextSmall}>
                        {t(
                          "workflowBuilder.agentInspector.mcpValidationInvalidHeaders",
                        )}
                      </p>
                    ) : null}
                  </label>
                </>
              ) : null}

              {tool.transport === "http" || tool.transport === "sse" ? (
                <>
                  <label className={styles.nodeInspectorField}>
                    <span className={styles.nodeInspectorLabel}>
                      {tool.transport === "sse"
                        ? t("workflowBuilder.agentInspector.mcpSseUrl")
                        : t("workflowBuilder.agentInspector.mcpHttpUrl")}
                    </span>
                    <input
                      type="url"
                      value={tool.url}
                      onChange={(event) =>
                        handleMcpToolChange(tool.id, {
                          url: event.target.value,
                        })
                      }
                      className={
                        connectionError === "missingUrl"
                          ? styles.nodeInspectorInputError
                          : undefined
                      }
                    />
                    {connectionMessage ? (
                      <p className={styles.nodeInspectorErrorTextSmall}>
                        {connectionMessage}
                      </p>
                    ) : null}
                  </label>
                  <label className={styles.nodeInspectorField}>
                    <span className={styles.nodeInspectorLabel}>
                      {t("workflowBuilder.agentInspector.mcpHeaders")}
                    </span>
                    <textarea
                      className={`${styles.nodeInspectorTextarea}${
                        headersError ? ` ${styles.nodeInspectorInputError}` : ""
                      }`}
                      value={tool.headersText}
                      onChange={(event) =>
                        handleMcpToolChange(tool.id, {
                          headersText: normalizeMultiline(event.target.value),
                        })
                      }
                    />
                    <p className={styles.nodeInspectorHintTextTight}>
                      {t("workflowBuilder.agentInspector.mcpHeadersHint")}
                    </p>
                    {headersError ? (
                      <p className={styles.nodeInspectorErrorTextSmall}>
                        {t(
                          "workflowBuilder.agentInspector.mcpValidationInvalidHeaders",
                        )}
                      </p>
                    ) : null}
                  </label>
                </>
              ) : null}

              {tool.transport === "stdio" ? (
                <>
                  <label className={styles.nodeInspectorField}>
                    <span className={styles.nodeInspectorLabel}>
                      {t("workflowBuilder.agentInspector.mcpStdioCommand")}
                    </span>
                    <input
                      type="text"
                      value={tool.command}
                      onChange={(event) =>
                        handleMcpToolChange(tool.id, {
                          command: event.target.value,
                        })
                      }
                      className={
                        connectionError === "missingCommand"
                          ? styles.nodeInspectorInputError
                          : undefined
                      }
                    />
                    {connectionMessage ? (
                      <p className={styles.nodeInspectorErrorTextSmall}>
                        {connectionMessage}
                      </p>
                    ) : null}
                  </label>
                  <label className={styles.nodeInspectorField}>
                    <span className={styles.nodeInspectorLabel}>
                      {t("workflowBuilder.agentInspector.mcpStdioArgs")}
                    </span>
                    <textarea
                      className={styles.nodeInspectorTextarea}
                      value={tool.argsText}
                      onChange={(event) =>
                        handleMcpToolChange(tool.id, {
                          argsText: normalizeMultiline(event.target.value),
                        })
                      }
                    />
                    <p className={styles.nodeInspectorHintTextTight}>
                      {t("workflowBuilder.agentInspector.mcpStdioArgsHint")}
                    </p>
                  </label>
                  <label className={styles.nodeInspectorField}>
                    <span className={styles.nodeInspectorLabel}>
                      {t("workflowBuilder.agentInspector.mcpStdioEnv")}
                    </span>
                    <textarea
                      className={`${styles.nodeInspectorTextarea}${
                        envError ? ` ${styles.nodeInspectorInputError}` : ""
                      }`}
                      value={tool.envText}
                      onChange={(event) =>
                        handleMcpToolChange(tool.id, {
                          envText: normalizeMultiline(event.target.value),
                        })
                      }
                    />
                    <p className={styles.nodeInspectorHintTextTight}>
                      {t("workflowBuilder.agentInspector.mcpStdioEnvHint")}
                    </p>
                    {envError ? (
                      <p className={styles.nodeInspectorErrorTextSmall}>
                        {t(
                          "workflowBuilder.agentInspector.mcpValidationInvalidEnv",
                        )}
                      </p>
                    ) : null}
                  </label>
                  <label className={styles.nodeInspectorField}>
                    <span className={styles.nodeInspectorLabel}>
                      {t("workflowBuilder.agentInspector.mcpStdioCwd")}
                    </span>
                    <input
                      type="text"
                      value={tool.cwd}
                      onChange={(event) =>
                        handleMcpToolChange(tool.id, {
                          cwd: event.target.value,
                        })
                      }
                    />
                  </label>
                </>
              ) : null}

              <div className={styles.nodeInspectorField}>
                <button
                  type="button"
                  className={styles.nodeInspectorSecondaryButton}
                  onClick={() => handleTestConnection(tool)}
                  disabled={isTesting}
                >
                  {isTesting
                    ? t(
                        "workflowBuilder.agentInspector.mcpTestConnectionWorking",
                      )
                    : t("workflowBuilder.agentInspector.mcpTestConnection")}
                </button>
                {connectionState.message ? (
                  <p
                    className={`${styles.nodeInspectorStatusMessage} ${statusClass}`}
                  >
                    {connectionState.message}
                  </p>
                ) : null}
              </div>

              <label className={styles.nodeInspectorField}>
                <span className={styles.nodeInspectorLabel}>
                  {t("workflowBuilder.agentInspector.mcpDescription")}
                </span>
                <input
                  type="text"
                  value={tool.description}
                  onChange={(event) =>
                    handleMcpToolChange(tool.id, {
                      description: event.target.value,
                    })
                  }
                />
                <p className={styles.nodeInspectorHintTextTight}>
                  {t("workflowBuilder.agentInspector.mcpDescriptionHint")}
                </p>
              </label>

              <label className={styles.nodeInspectorField}>
                <span className={styles.nodeInspectorLabel}>
                  {t("workflowBuilder.agentInspector.mcpAllowedTools")}
                </span>
                <textarea
                  className={`${styles.nodeInspectorTextarea}${
                    allowedToolsError ? ` ${styles.nodeInspectorInputError}` : ""
                  }`}
                  value={tool.allowedToolsText}
                  onChange={(event) =>
                    handleMcpToolChange(tool.id, {
                      allowedToolsText: normalizeMultiline(event.target.value),
                    })
                  }
                />
                <p className={styles.nodeInspectorHintTextTight}>
                  {t("workflowBuilder.agentInspector.mcpAllowedToolsHint")}
                </p>
                {allowedToolsError ? (
                  <p className={styles.nodeInspectorErrorTextSmall}>
                    {t(
                      "workflowBuilder.agentInspector.mcpValidationInvalidAllowedTools",
                    )}
                  </p>
                ) : null}
              </label>

              <label className={styles.nodeInspectorField}>
                <span className={styles.nodeInspectorLabel}>
                  {t("workflowBuilder.agentInspector.mcpRequireApproval")}
                </span>
                <select
                  value={tool.requireApprovalMode}
                  onChange={(event) =>
                    handleMcpToolChange(tool.id, {
                      requireApprovalMode:
                        event.target.value as AgentMcpRequireApprovalMode,
                    })
                  }
                >
                  <option value="never">
                    {t("workflowBuilder.agentInspector.mcpRequireApprovalNever")}
                  </option>
                  <option value="always">
                    {t("workflowBuilder.agentInspector.mcpRequireApprovalAlways")}
                  </option>
                  <option value="custom">
                    {t("workflowBuilder.agentInspector.mcpRequireApprovalCustom")}
                  </option>
                </select>
              </label>

              {tool.requireApprovalMode === "custom" ? (
                <label className={styles.nodeInspectorField}>
                  <span className={styles.nodeInspectorSubLabel}>
                    {t(
                      "workflowBuilder.agentInspector.mcpRequireApprovalCustomLabel",
                    )}
                  </span>
                  <textarea
                    className={`${styles.nodeInspectorTextarea}${
                      approvalError ? ` ${styles.nodeInspectorInputError}` : ""
                    }`}
                    value={tool.requireApprovalCustom}
                    onChange={(event) =>
                      handleMcpToolChange(tool.id, {
                        requireApprovalCustom: normalizeMultiline(
                          event.target.value,
                        ),
                      })
                    }
                  />
                  <p className={styles.nodeInspectorHintTextTight}>
                    {t(
                      "workflowBuilder.agentInspector.mcpRequireApprovalCustomHint",
                    )}
                  </p>
                  {approvalError ? (
                    <p className={styles.nodeInspectorErrorTextSmall}>
                      {t(
                        "workflowBuilder.agentInspector.mcpValidationInvalidRequireApproval",
                      )}
                    </p>
                  ) : null}
                </label>
              ) : null}
            </div>
          );
        })}
        {mcpTools.length === 0 ? (
          <p className={styles.nodeInspectorEmptyLabel}>
            {t("workflowBuilder.agentInspector.mcpEmptyState")}
          </p>
        ) : null}
        <button
          type="button"
          className={styles.nodeInspectorAddButton}
          onClick={handleAddMcpTool}
        >
          {t("workflowBuilder.agentInspector.mcpAddServer")}
        </button>
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

