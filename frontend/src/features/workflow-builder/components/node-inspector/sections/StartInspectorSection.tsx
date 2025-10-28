import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../../../../../i18n";
import type { TelephonySipServer } from "../../../../../utils/backend";
import type {
  StartTelephonyRealtimeOverrides,
  StartTelephonyWorkflowReference,
} from "../../../../../utils/workflows";
import type { VoiceAgentStartBehavior, VoiceAgentStopBehavior } from "../../../types";
import {
  VOICE_AGENT_START_BEHAVIOR_OPTIONS,
  VOICE_AGENT_STOP_BEHAVIOR_OPTIONS,
} from "../constants";
import { ToggleRow } from "../components/ToggleRow";
import styles from "../NodeInspector.module.css";

type StartInspectorSectionProps = {
  nodeId: string;
  startAutoRun: boolean;
  startAutoRunMessage: string;
  startAutoRunAssistantMessage: string;
  startTelephonyRoutes: string[];
  startTelephonyWorkflow: StartTelephonyWorkflowReference;
  startTelephonySipServerId: string;
  startTelephonyRealtime: StartTelephonyRealtimeOverrides;
  onStartAutoRunChange: (nodeId: string, value: boolean) => void;
  onStartAutoRunMessageChange: (nodeId: string, value: string) => void;
  onStartAutoRunAssistantMessageChange: (nodeId: string, value: string) => void;
  onStartTelephonyRoutesChange: (nodeId: string, routes: string[]) => void;
  onStartTelephonyWorkflowChange: (
    nodeId: string,
    reference: { id?: number | null; slug?: string | null },
  ) => void;
  onStartTelephonySipServerChange: (nodeId: string, serverId: string) => void;
  onStartTelephonyRealtimeChange: (
    nodeId: string,
    overrides: Partial<StartTelephonyRealtimeOverrides>,
  ) => void;
  sipServers: TelephonySipServer[];
  sipServersLoading: boolean;
  sipServersError: string | null;
};

const TELEPHONY_INPUT_PATTERN = /^[0-9+#*\s().-]+$/;

const sanitizeTelephonyRoute = (value: string): string =>
  value
    .split("")
    .filter((char) => /\d/.test(char) || char === "+" || char === "#" || char === "*")
    .join("");

const isValidTelephonyRoute = (candidate: string): boolean => {
  const trimmed = candidate.trim();
  if (!trimmed) {
    return false;
  }

  if (!TELEPHONY_INPUT_PATTERN.test(trimmed)) {
    return false;
  }

  const sanitized = sanitizeTelephonyRoute(trimmed);
  if (!sanitized) {
    return false;
  }

  return /\d/.test(sanitized);
};

const parseWorkflowId = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

export const StartInspectorSection = ({
  nodeId,
  startAutoRun,
  startAutoRunMessage,
  startAutoRunAssistantMessage,
  startTelephonyRoutes,
  startTelephonyWorkflow,
  startTelephonySipServerId,
  startTelephonyRealtime,
  onStartAutoRunChange,
  onStartAutoRunMessageChange,
  onStartAutoRunAssistantMessageChange,
  onStartTelephonyRoutesChange,
  onStartTelephonyWorkflowChange,
  onStartTelephonySipServerChange,
  onStartTelephonyRealtimeChange,
  sipServers,
  sipServersLoading,
  sipServersError,
}: StartInspectorSectionProps) => {
  const { t } = useI18n();

  const [routesInput, setRoutesInput] = useState(() => startTelephonyRoutes.join("\n"));
  const [workflowSlugInput, setWorkflowSlugInput] = useState(startTelephonyWorkflow.slug);
  const [workflowIdInput, setWorkflowIdInput] = useState(
    startTelephonyWorkflow.id != null ? String(startTelephonyWorkflow.id) : "",
  );
  const [sipServerInput, setSipServerInput] = useState(startTelephonySipServerId);
  const [realtimeModelInput, setRealtimeModelInput] = useState(startTelephonyRealtime.model);
  const [realtimeVoiceInput, setRealtimeVoiceInput] = useState(startTelephonyRealtime.voice);
  const [realtimeStartModeInput, setRealtimeStartModeInput] = useState<
    VoiceAgentStartBehavior | ""
  >(startTelephonyRealtime.start_mode ?? "");
  const [realtimeStopModeInput, setRealtimeStopModeInput] = useState<VoiceAgentStopBehavior | "">(
    startTelephonyRealtime.stop_mode ?? "",
  );
  const [showTelephonyAdvanced, setShowTelephonyAdvanced] = useState(() => {
    const hasWorkflowReference = Boolean(
      startTelephonyWorkflow.slug.trim() || startTelephonyWorkflow.id != null,
    );
    return (
      hasWorkflowReference ||
      Boolean(startTelephonyRealtime.model.trim()) ||
      Boolean(startTelephonyRealtime.voice.trim()) ||
      Boolean(startTelephonyRealtime.start_mode) ||
      Boolean(startTelephonyRealtime.stop_mode)
    );
  });

  useEffect(() => {
    setRoutesInput(startTelephonyRoutes.join("\n"));
  }, [startTelephonyRoutes]);

  useEffect(() => {
    setWorkflowSlugInput(startTelephonyWorkflow.slug);
    setWorkflowIdInput(startTelephonyWorkflow.id != null ? String(startTelephonyWorkflow.id) : "");
  }, [startTelephonyWorkflow.id, startTelephonyWorkflow.slug]);

  useEffect(() => {
    setSipServerInput(startTelephonySipServerId);
  }, [startTelephonySipServerId]);

  useEffect(() => {
    setRealtimeModelInput(startTelephonyRealtime.model);
    setRealtimeVoiceInput(startTelephonyRealtime.voice);
    setRealtimeStartModeInput(startTelephonyRealtime.start_mode ?? "");
    setRealtimeStopModeInput(startTelephonyRealtime.stop_mode ?? "");
  }, [
    startTelephonyRealtime.model,
    startTelephonyRealtime.voice,
    startTelephonyRealtime.start_mode,
    startTelephonyRealtime.stop_mode,
  ]);

  useEffect(() => {
    const hasWorkflowReference = Boolean(
      startTelephonyWorkflow.slug.trim() || startTelephonyWorkflow.id != null,
    );
    if (
      hasWorkflowReference ||
      Boolean(startTelephonyRealtime.model.trim()) ||
      Boolean(startTelephonyRealtime.voice.trim()) ||
      Boolean(startTelephonyRealtime.start_mode) ||
      Boolean(startTelephonyRealtime.stop_mode)
    ) {
      setShowTelephonyAdvanced(true);
    }
  }, [
    startTelephonyRealtime.model,
    startTelephonyRealtime.voice,
    startTelephonyRealtime.start_mode,
    startTelephonyRealtime.stop_mode,
    startTelephonyWorkflow.id,
    startTelephonyWorkflow.slug,
  ]);

  const normalizedRoutes = useMemo(
    () =>
      routesInput
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    [routesInput],
  );

  const invalidRoutes = useMemo(
    () => normalizedRoutes.filter((route) => !isValidTelephonyRoute(route)),
    [normalizedRoutes],
  );

  const sipServerOptions = useMemo(
    () =>
      sipServers.map((server) => ({
        id: server.id,
        label: server.label?.trim() || server.id,
        description: server.trunk_uri,
      })),
    [sipServers],
  );

  const sipServerDatalistId = useMemo(() => `sip-server-${nodeId}`, [nodeId]);

  const workflowIdParsed = useMemo(() => parseWorkflowId(workflowIdInput), [workflowIdInput]);
  const workflowIdHasError = Boolean(workflowIdInput.trim()) && workflowIdParsed === null;

  const hasStartAutoRunUserMessage = startAutoRunMessage.trim().length > 0;
  const hasStartAutoRunAssistantMessage = startAutoRunAssistantMessage.trim().length > 0;

  const emitWorkflowChange = (slugValue: string, idValue: string) => {
    onStartTelephonyWorkflowChange(nodeId, {
      slug: slugValue,
      id: parseWorkflowId(idValue),
    });
  };

  return (
    <>
      <ToggleRow
        label={t("workflowBuilder.startInspector.autoRunLabel")}
        checked={startAutoRun}
        onChange={(next) => onStartAutoRunChange(nodeId, next)}
        help={t("workflowBuilder.startInspector.autoRunHelp")}
      />

      {startAutoRun ? (
        <>
          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              {t("workflowBuilder.startInspector.autoRunUserMessageLabel")}
            </span>
            <textarea
              value={startAutoRunMessage}
              onChange={(event) => onStartAutoRunMessageChange(nodeId, event.target.value)}
              rows={3}
              placeholder={t("workflowBuilder.startInspector.autoRunUserMessagePlaceholder")}
              className={styles.nodeInspectorTextarea}
              disabled={hasStartAutoRunAssistantMessage}
            />
            <p className={styles.nodeInspectorHintTextTight}>
              {t("workflowBuilder.startInspector.autoRunUserMessageHint")}
            </p>
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              {t("workflowBuilder.startInspector.autoRunAssistantMessageLabel")}
            </span>
            <textarea
              value={startAutoRunAssistantMessage}
              onChange={(event) =>
                onStartAutoRunAssistantMessageChange(nodeId, event.target.value)
              }
              rows={3}
              placeholder={t(
                "workflowBuilder.startInspector.autoRunAssistantMessagePlaceholder",
              )}
              className={styles.nodeInspectorTextarea}
              disabled={hasStartAutoRunUserMessage}
            />
            <p className={styles.nodeInspectorHintTextTight}>
              {t("workflowBuilder.startInspector.autoRunAssistantMessageHint")}
            </p>
          </label>
        </>
      ) : null}

      <div className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorSectionTitle}>
          {t("workflowBuilder.startInspector.telephonySectionTitle")}
        </span>
        <p className={styles.nodeInspectorSectionDescription}>
          {t("workflowBuilder.startInspector.telephonySectionDescription")}
        </p>
      </div>

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.startInspector.telephonyRoutesLabel")}
        </span>
        <textarea
          value={routesInput}
          onChange={(event) => {
            const value = event.target.value;
            setRoutesInput(value);
            const nextRoutes = value
              .split(/\r?\n/)
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0);
            onStartTelephonyRoutesChange(nodeId, nextRoutes);
          }}
          rows={3}
          placeholder={t("workflowBuilder.startInspector.telephonyRoutesPlaceholder")}
          className={styles.nodeInspectorTextarea}
        />
        <p className={styles.nodeInspectorHintTextTight}>
          {t("workflowBuilder.startInspector.telephonyRoutesHelp")}
        </p>
        {invalidRoutes.length > 0 ? (
          <p className={styles.nodeInspectorErrorTextSmall}>
            {t("workflowBuilder.startInspector.telephonyRoutesError", {
              list: invalidRoutes.join(", "),
            })}
          </p>
        ) : null}
      </label>

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.startInspector.telephonySipServerLabel")}
        </span>
        <input
          type="text"
          value={sipServerInput}
          list={sipServerDatalistId}
          onChange={(event) => {
            const value = event.target.value;
            setSipServerInput(value);
            onStartTelephonySipServerChange(nodeId, value);
          }}
          placeholder={t("workflowBuilder.startInspector.telephonySipServerPlaceholder")}
        />
        <datalist id={sipServerDatalistId}>
          {sipServerOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
              {option.description ? ` (${option.description})` : ""}
            </option>
          ))}
        </datalist>
        <p className={styles.nodeInspectorHintTextTight}>
          {t("workflowBuilder.startInspector.telephonySipServerHint")}
        </p>
        {sipServersLoading ? (
          <p className={styles.nodeInspectorHintTextTight}>
            {t("workflowBuilder.startInspector.telephonySipServerLoading")}
          </p>
        ) : null}
        {sipServersError ? (
          <p className={styles.nodeInspectorErrorTextSmall}>
            {t("workflowBuilder.startInspector.telephonySipServerError")}
          </p>
        ) : null}
      </label>

      <div className={styles.nodeInspectorField}>
        <button
          type="button"
          className={styles.nodeInspectorSecondaryButton}
          onClick={() => setShowTelephonyAdvanced((current) => !current)}
        >
          {showTelephonyAdvanced
            ? t("workflowBuilder.startInspector.telephonyAdvancedHide")
            : t("workflowBuilder.startInspector.telephonyAdvancedShow")}
        </button>
        <p className={styles.nodeInspectorHintTextTight}>
          {t("workflowBuilder.startInspector.telephonyAdvancedDescription")}
        </p>
      </div>

      {showTelephonyAdvanced ? (
        <>
          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              {t("workflowBuilder.startInspector.telephonyWorkflowSlugLabel")}
            </span>
            <input
              type="text"
              value={workflowSlugInput}
              onChange={(event) => {
                const value = event.target.value;
                setWorkflowSlugInput(value);
                emitWorkflowChange(value, workflowIdInput);
              }}
            />
            <p className={styles.nodeInspectorHintTextTight}>
              {t("workflowBuilder.startInspector.telephonyWorkflowSlugHelp")}
            </p>
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              {t("workflowBuilder.startInspector.telephonyWorkflowIdLabel")}
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={workflowIdInput}
              onChange={(event) => {
                const value = event.target.value;
                setWorkflowIdInput(value);
                emitWorkflowChange(workflowSlugInput, value);
              }}
            />
            <p className={styles.nodeInspectorHintTextTight}>
              {t("workflowBuilder.startInspector.telephonyWorkflowIdHelp")}
            </p>
            {workflowIdHasError ? (
              <p className={styles.nodeInspectorErrorTextSmall}>
                {t("workflowBuilder.startInspector.telephonyWorkflowIdError")}
              </p>
            ) : null}
          </label>

          <div className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorSectionTitle}>
              {t("workflowBuilder.startInspector.telephonyRealtimeTitle")}
            </span>
            <p className={styles.nodeInspectorSectionDescription}>
              {t("workflowBuilder.startInspector.telephonyRealtimeDescription")}
            </p>
          </div>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              {t("workflowBuilder.startInspector.telephonyRealtimeModelLabel")}
            </span>
            <input
              type="text"
              value={realtimeModelInput}
              onChange={(event) => {
                const value = event.target.value;
                setRealtimeModelInput(value);
                onStartTelephonyRealtimeChange(nodeId, { model: value });
              }}
            />
            <p className={styles.nodeInspectorHintTextTight}>
              {t("workflowBuilder.startInspector.telephonyRealtimeModelHelp")}
            </p>
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              {t("workflowBuilder.startInspector.telephonyRealtimeVoiceLabel")}
            </span>
            <input
              type="text"
              value={realtimeVoiceInput}
              onChange={(event) => {
                const value = event.target.value;
                setRealtimeVoiceInput(value);
                onStartTelephonyRealtimeChange(nodeId, { voice: value });
              }}
            />
            <p className={styles.nodeInspectorHintTextTight}>
              {t("workflowBuilder.startInspector.telephonyRealtimeVoiceHelp")}
            </p>
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              {t("workflowBuilder.startInspector.telephonyRealtimeStartLabel")}
            </span>
            <select
              value={realtimeStartModeInput}
              onChange={(event) => {
                const value = event.target.value as VoiceAgentStartBehavior | "";
                setRealtimeStartModeInput(value);
                onStartTelephonyRealtimeChange(nodeId, {
                  start_mode: value ? (value as VoiceAgentStartBehavior) : null,
                });
              }}
            >
              <option value="">
                {t("workflowBuilder.startInspector.telephonyRealtimeStartDefault")}
              </option>
              {VOICE_AGENT_START_BEHAVIOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              {t("workflowBuilder.startInspector.telephonyRealtimeStopLabel")}
            </span>
            <select
              value={realtimeStopModeInput}
              onChange={(event) => {
                const value = event.target.value as VoiceAgentStopBehavior | "";
                setRealtimeStopModeInput(value);
                onStartTelephonyRealtimeChange(nodeId, {
                  stop_mode: value ? (value as VoiceAgentStopBehavior) : null,
                });
              }}
            >
              <option value="">
                {t("workflowBuilder.startInspector.telephonyRealtimeStopDefault")}
              </option>
              {VOICE_AGENT_STOP_BEHAVIOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
    </>
  );
};
