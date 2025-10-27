import { useCallback, useEffect, useMemo, useState } from "react";

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

  const [mcpUrlDraft, setMcpUrlDraft] = useState(mcpUrlValue);
  const [mcpAuthorizationDraft, setMcpAuthorizationDraft] = useState(
    mcpAuthorizationValue,
  );

  const [mcpTestState, setMcpTestState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    message: string;
    statusLabel: string | null;
    toolNames: string[];
  }>({ status: "idle", message: "", statusLabel: null, toolNames: [] });

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

  const handleMcpAuthorizationChange = useCallback(
    (value: string) => {
      setMcpAuthorizationDraft(value);
      onAgentMcpSseConfigChange(nodeId, {
        url: mcpUrlDraft,
        authorization: value,
      });
    },
    [nodeId, onAgentMcpSseConfigChange, mcpUrlDraft],
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
        <button
          type="button"
          className="btn"
          onClick={handleTestConnection}
          disabled={mcpTestState.status === "loading"}
        >
          {t("workflowBuilder.agentInspector.mcpTestButton")}
        </button>
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

