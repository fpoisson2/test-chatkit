import { useCallback, useMemo } from "react";

import { useI18n } from "../../../../../i18n";
import {
  testMcpToolConnection,
  startMcpOAuthNegotiation,
  pollMcpOAuthSession,
  cancelMcpOAuthSession,
  type AvailableModel,
} from "../../../../../utils/backend";
import type {
  FlowNode,
  VoiceAgentTool,
  VoiceAgentStartBehavior,
  VoiceAgentStopBehavior,
  WorkflowSummary,
  McpSseToolConfig,
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

type VoiceAgentInspectorSectionProps = {
  nodeId: string;
  parameters: FlowNode["data"]["parameters"];
  token: string | null;
  onAgentModelChange: (
    nodeId: string,
    selection: {
      model: string;
      providerId?: string | null;
      providerSlug?: string | null;
      store?: boolean | null;
    },
  ) => void;
  onAgentProviderChange: (
    nodeId: string,
    selection: { providerId?: string | null; providerSlug?: string | null },
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
  onTranscriptionModelChange: (nodeId: string, value: string) => void;
  onTranscriptionLanguageChange: (nodeId: string, value: string) => void;
  onTranscriptionPromptChange: (nodeId: string, value: string) => void;
  workflows: WorkflowSummary[];
  currentWorkflowId: number | null;
  availableModels: AvailableModel[];
  availableModelsLoading: boolean;
  onAgentWeatherToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWidgetValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowToolToggle: (nodeId: string, slug: string, enabled: boolean) => void;
  onAgentMcpSseConfigChange: (
    nodeId: string,
    config: McpSseToolConfig | null,
  ) => void;
};

export const VoiceAgentInspectorSection = ({
  nodeId,
  parameters,
  token,
  onAgentModelChange,
  onAgentProviderChange,
  onAgentMessageChange,
  onVoiceAgentVoiceChange,
  onVoiceAgentStartBehaviorChange,
  onVoiceAgentStopBehaviorChange,
  onVoiceAgentToolChange,
  onTranscriptionModelChange,
  onTranscriptionLanguageChange,
  onTranscriptionPromptChange,
  workflows,
  currentWorkflowId,
  availableModels,
  availableModelsLoading,
  onAgentWeatherToolChange,
  onAgentWidgetValidationToolChange,
  onAgentWorkflowValidationToolChange,
  onAgentWorkflowToolToggle,
  onAgentMcpSseConfigChange,
}: VoiceAgentInspectorSectionProps) => {
  const { t } = useI18n();
  const handleTestMcpSseConnection = useCallback(
    (config: McpSseToolConfig) => testMcpToolConnection(token ?? null, config),
    [token],
  );
  const handleStartMcpOAuth = useCallback(
    (payload: { url: string; clientId: string | null; scope: string | null }) =>
      startMcpOAuthNegotiation({
        token: token ?? null,
        url: payload.url,
        clientId: payload.clientId,
        scope: payload.scope,
      }),
    [token],
  );
  const handlePollMcpOAuth = useCallback(
    (state: string) => pollMcpOAuthSession({ token: token ?? null, state }),
    [token],
  );
  const handleCancelMcpOAuth = useCallback(
    (state: string) => cancelMcpOAuthSession({ token: token ?? null, state }),
    [token],
  );
  const {
    voiceModel,
    voiceProviderId,
    voiceProviderSlug,
    voiceId,
    instructions,
    startBehavior,
    stopBehavior,
    tools,
    transcriptionModel,
    transcriptionLanguage,
    transcriptionPrompt,
  } = useVoiceAgentInspectorState({ parameters });

  const providerOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: {
      value: string;
      id: string | null;
      slug: string | null;
      label: string;
    }[] = [];
    for (const model of availableModels) {
      const slug = model.provider_slug?.trim().toLowerCase() ?? "";
      const id = model.provider_id?.trim() ?? "";
      if (!slug && !id) {
        continue;
      }
      const key = `${id}|${slug}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const baseLabel = slug || id || t("workflowBuilder.agentInspector.providerPlaceholder");
      const label = slug && id ? `${slug} (${id})` : baseLabel;
      options.push({ value: key, id: id || null, slug: slug || null, label });
    }
    const trimmedSlug = voiceProviderSlug.trim();
    const trimmedId = voiceProviderId.trim();
    if ((trimmedSlug || trimmedId) && !seen.has(`${trimmedId}|${trimmedSlug}`)) {
      const baseLabel = trimmedSlug || trimmedId;
      const label = trimmedSlug && trimmedId ? `${trimmedSlug} (${trimmedId})` : baseLabel;
      options.push({
        value: `${trimmedId}|${trimmedSlug}`,
        id: trimmedId || null,
        slug: trimmedSlug || null,
        label: baseLabel ? label : t("workflowBuilder.agentInspector.providerPlaceholder"),
      });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [availableModels, t, voiceProviderId, voiceProviderSlug]);

  const selectedProviderValue = useMemo(() => {
    if (!voiceProviderId && !voiceProviderSlug) {
      return "";
    }
    const matchById = providerOptions.find(
      (option) => voiceProviderId && option.id === voiceProviderId,
    );
    if (matchById) {
      return matchById.value;
    }
    const matchBySlug = providerOptions.find(
      (option) => voiceProviderSlug && option.slug === voiceProviderSlug,
    );
    if (matchBySlug) {
      return matchBySlug.value;
    }
    if (voiceProviderId || voiceProviderSlug) {
      return `${voiceProviderId.trim()}|${voiceProviderSlug.trim()}`;
    }
    return "";
  }, [providerOptions, voiceProviderId, voiceProviderSlug]);

  return (
    <>
      <label className={styles.nodeInspectorInlineField}>
        <span className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.agentInspector.providerLabel")}
        </span>
        <select
          value={selectedProviderValue}
          onChange={(event) => {
            const value = event.target.value;
            if (!value) {
              onAgentProviderChange(nodeId, { providerId: null, providerSlug: null });
              return;
            }
            const option = providerOptions.find((candidate) => candidate.value === value);
            onAgentProviderChange(nodeId, {
              providerId: option?.id ?? null,
              providerSlug: option?.slug ?? null,
            });
          }}
          disabled={availableModelsLoading}
        >
          <option value="">{t("workflowBuilder.agentInspector.providerPlaceholder")}</option>
          {providerOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

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

      <label className={styles.nodeInspectorInlineField}>
        <span className={styles.nodeInspectorLabel}>
          Modèle de transcription
        </span>
        <input
          type="text"
          value={transcriptionModel}
          placeholder="gpt-4o-mini-transcribe"
          onChange={(event) => onTranscriptionModelChange(nodeId, event.target.value)}
        />
      </label>

      <label className={styles.nodeInspectorInlineField}>
        <span className={styles.nodeInspectorLabel}>
          Langue de transcription
        </span>
        <input
          type="text"
          value={transcriptionLanguage}
          placeholder="fr-CA"
          onChange={(event) => onTranscriptionLanguageChange(nodeId, event.target.value)}
        />
      </label>

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          Prompt de transcription (optionnel)
        </span>
        <textarea
          rows={2}
          value={transcriptionPrompt}
          placeholder="Contexte additionnel pour améliorer la transcription..."
          onChange={(event) => onTranscriptionPromptChange(nodeId, event.target.value)}
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
          onAgentWeatherToolChange={onAgentWeatherToolChange}
          onAgentWidgetValidationToolChange={onAgentWidgetValidationToolChange}
          onAgentWorkflowValidationToolChange={onAgentWorkflowValidationToolChange}
          onAgentWorkflowToolToggle={onAgentWorkflowToolToggle}
          onAgentMcpSseConfigChange={onAgentMcpSseConfigChange}
          onTestMcpSseConnection={handleTestMcpSseConnection}
          onStartMcpOAuth={handleStartMcpOAuth}
          onPollMcpOAuth={handlePollMcpOAuth}
          onCancelMcpOAuth={handleCancelMcpOAuth}
        />
      </div>
    </>
  );
};
