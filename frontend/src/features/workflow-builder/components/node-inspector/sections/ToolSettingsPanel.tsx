import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n } from "../../../../../i18n";
import {
  getAgentWeatherToolEnabled,
  getAgentWidgetValidationToolEnabled,
  getAgentWorkflowTools,
  getAgentWorkflowValidationToolEnabled,
  serializeAgentMcpToolConfig,
} from "../../../../../utils/workflows";
import { testMcpConnection } from "../../../../../utils/backend";
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
    };
    onAgentMcpToolsChange(nodeId, [...mcpTools, next]);
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

