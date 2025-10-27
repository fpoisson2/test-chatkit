import { useMemo } from "react";

import { useI18n } from "../../../../../i18n";
import type {
  FlowNode,
  AgentMcpToolConfig,
  VoiceAgentTool,
  VoiceAgentStartBehavior,
  VoiceAgentStopBehavior,
  WorkflowSummary,
} from "../../../types";
import {
  VOICE_AGENT_START_BEHAVIOR_OPTIONS,
  VOICE_AGENT_STOP_BEHAVIOR_OPTIONS,
  VOICE_AGENT_TOOL_DEFINITIONS,
} from "../constants";
import { ToggleRow } from "../components/ToggleRow";
import styles from "../NodeInspector.module.css";
import { useVoiceAgentInspectorState } from "../hooks/useVoiceAgentInspectorState";
import { ToolSettingsPanel } from "./ToolSettingsPanel";
import {
  getAgentMcpTools,
  validateAgentMcpTools,
} from "../../../../../utils/workflows";

type VoiceAgentInspectorSectionProps = {
  nodeId: string;
  parameters: FlowNode["data"]["parameters"];
  onAgentModelChange: (
    nodeId: string,
    selection: {
      model: string;
      providerId?: string | null;
      providerSlug?: string | null;
      store?: boolean | null;
    },
  ) => void;
  onAgentMessageChange: (nodeId: string, value: string) => void;
  onVoiceAgentVoiceChange: (nodeId: string, value: string) => void;
  onVoiceAgentStartBehaviorChange: (
    nodeId: string,
    behavior: VoiceAgentStartBehavior,
  ) => void;
  onVoiceAgentStopBehaviorChange: (
    nodeId: string,
    behavior: VoiceAgentStopBehavior,
  ) => void;
  onVoiceAgentToolChange: (nodeId: string, tool: VoiceAgentTool, enabled: boolean) => void;
  workflows: WorkflowSummary[];
  currentWorkflowId: number | null;
  onAgentWeatherToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWidgetValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowToolToggle: (nodeId: string, slug: string, enabled: boolean) => void;
  onAgentMcpToolsChange: (nodeId: string, configs: AgentMcpToolConfig[]) => void;
};

export const VoiceAgentInspectorSection = ({
  nodeId,
  parameters,
  onAgentModelChange,
  onAgentMessageChange,
  onVoiceAgentVoiceChange,
  onVoiceAgentStartBehaviorChange,
  onVoiceAgentStopBehaviorChange,
  onVoiceAgentToolChange,
  workflows,
  currentWorkflowId,
  onAgentWeatherToolChange,
  onAgentWidgetValidationToolChange,
  onAgentWorkflowValidationToolChange,
  onAgentWorkflowToolToggle,
  onAgentMcpToolsChange,
}: VoiceAgentInspectorSectionProps) => {
  const { t } = useI18n();
  const { voiceModel, voiceId, instructions, startBehavior, stopBehavior, tools } =
    useVoiceAgentInspectorState({ parameters });
  const mcpTools = useMemo(() => getAgentMcpTools(parameters), [parameters]);
  const mcpValidation = useMemo(() => validateAgentMcpTools(mcpTools), [mcpTools]);

  return (
    <>
      <label className={styles.nodeInspectorInlineField}>
        <span className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.voiceInspector.modelLabel")}
        </span>
        <input
          type="text"
          value={voiceModel}
          onChange={(event) =>
            onAgentModelChange(nodeId, {
              model: event.target.value,
              providerId: null,
              providerSlug: null,
            })
          }
        />
      </label>

      <label className={styles.nodeInspectorInlineField}>
        <span className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.voiceInspector.voiceLabel")}
        </span>
        <input
          type="text"
          value={voiceId}
          onChange={(event) => onVoiceAgentVoiceChange(nodeId, event.target.value)}
        />
      </label>

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.voiceInspector.instructionsLabel")}
        </span>
        <textarea
          rows={4}
          value={instructions}
          placeholder={t("workflowBuilder.voiceInspector.instructionsPlaceholder")}
          onChange={(event) => onAgentMessageChange(nodeId, event.target.value)}
        />
      </label>

      <label className={styles.nodeInspectorInlineField}>
        <span className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.voiceInspector.startBehaviorLabel")}
        </span>
        <select
          value={startBehavior}
          onChange={(event) =>
            onVoiceAgentStartBehaviorChange(
              nodeId,
              event.target.value as VoiceAgentStartBehavior,
            )
          }
        >
          {VOICE_AGENT_START_BEHAVIOR_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.nodeInspectorInlineField}>
        <span className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.voiceInspector.stopBehaviorLabel")}
        </span>
        <select
          value={stopBehavior}
          onChange={(event) =>
            onVoiceAgentStopBehaviorChange(
              nodeId,
              event.target.value as VoiceAgentStopBehavior,
            )
          }
        >
          {VOICE_AGENT_STOP_BEHAVIOR_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.nodeInspectorPanel}>
        <strong className={styles.nodeInspectorSectionTitle}>
          {t("workflowBuilder.voiceInspector.toolsLabel")}
        </strong>
        {VOICE_AGENT_TOOL_DEFINITIONS.map((definition) => (
          <ToggleRow
            key={definition.key}
            label={t(definition.labelKey)}
            help={definition.helpKey ? t(definition.helpKey) : undefined}
            checked={tools[definition.key] ?? false}
            onChange={(checked) => onVoiceAgentToolChange(nodeId, definition.key, checked)}
          />
        ))}
        <ToolSettingsPanel
          nodeId={nodeId}
          parameters={parameters}
          workflows={workflows}
          currentWorkflowId={currentWorkflowId}
          mcpTools={mcpTools}
          mcpValidation={mcpValidation}
          onAgentMcpToolsChange={onAgentMcpToolsChange}
          onAgentWeatherToolChange={onAgentWeatherToolChange}
          onAgentWidgetValidationToolChange={onAgentWidgetValidationToolChange}
          onAgentWorkflowValidationToolChange={onAgentWorkflowValidationToolChange}
          onAgentWorkflowToolToggle={onAgentWorkflowToolToggle}
        />
      </div>
    </>
  );
};
