import { useMemo } from "react";

import { useI18n } from "../../../../../i18n";
import {
  getAgentWeatherToolEnabled,
  getAgentWidgetValidationToolEnabled,
  getAgentWorkflowTools,
  getAgentWorkflowValidationToolEnabled,
} from "../../../../../utils/workflows";
import type { FlowNode, WorkflowSummary } from "../../../types";
import { ToggleRow } from "../components/ToggleRow";
import styles from "../NodeInspector.module.css";

type ToolSettingsPanelProps = {
  nodeId: string;
  parameters: FlowNode["data"]["parameters"];
  workflows: WorkflowSummary[];
  currentWorkflowId: number | null;
  onAgentWeatherToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWidgetValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowToolToggle: (nodeId: string, slug: string, enabled: boolean) => void;
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

