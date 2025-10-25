import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../../../../../i18n";
import type {
  StartHostedWorkflowOption,
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
  startHostedWorkflows: StartHostedWorkflowOption[];
  startTelephonyRoutes: string[];
  startTelephonyWorkflow: StartTelephonyWorkflowReference;
  startTelephonyRealtime: StartTelephonyRealtimeOverrides;
  onStartAutoRunChange: (nodeId: string, value: boolean) => void;
  onStartAutoRunMessageChange: (nodeId: string, value: string) => void;
  onStartAutoRunAssistantMessageChange: (nodeId: string, value: string) => void;
  onStartHostedWorkflowsChange: (
    nodeId: string,
    workflows: StartHostedWorkflowOption[],
  ) => void;
  onStartTelephonyRoutesChange: (nodeId: string, routes: string[]) => void;
  onStartTelephonyWorkflowChange: (
    nodeId: string,
    reference: { id?: number | null; slug?: string | null },
  ) => void;
  onStartTelephonyRealtimeChange: (
    nodeId: string,
    overrides: Partial<StartTelephonyRealtimeOverrides>,
  ) => void;
};

const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

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
  startHostedWorkflows,
  startTelephonyRoutes,
  startTelephonyWorkflow,
  startTelephonyRealtime,
  onStartAutoRunChange,
  onStartAutoRunMessageChange,
  onStartAutoRunAssistantMessageChange,
  onStartHostedWorkflowsChange,
  onStartTelephonyRoutesChange,
  onStartTelephonyWorkflowChange,
  onStartTelephonyRealtimeChange,
}: StartInspectorSectionProps) => {
  const { t } = useI18n();

  const [routesInput, setRoutesInput] = useState(() => startTelephonyRoutes.join("\n"));
  const [workflowSlugInput, setWorkflowSlugInput] = useState(startTelephonyWorkflow.slug);
  const [workflowIdInput, setWorkflowIdInput] = useState(
    startTelephonyWorkflow.id != null ? String(startTelephonyWorkflow.id) : "",
  );
  const [realtimeModelInput, setRealtimeModelInput] = useState(startTelephonyRealtime.model);
  const [realtimeVoiceInput, setRealtimeVoiceInput] = useState(startTelephonyRealtime.voice);
  const [realtimeStartModeInput, setRealtimeStartModeInput] = useState<
    VoiceAgentStartBehavior | ""
  >(startTelephonyRealtime.start_mode ?? "");
  const [realtimeStopModeInput, setRealtimeStopModeInput] = useState<VoiceAgentStopBehavior | "">(
    startTelephonyRealtime.stop_mode ?? "",
  );
  const [hostedEntries, setHostedEntries] = useState<StartHostedWorkflowOption[]>(
    startHostedWorkflows.map((entry) => ({
      slug: entry.slug,
      label: entry.label,
      workflow_id: entry.workflow_id,
      description: entry.description ?? "",
    })),
  );

  useEffect(() => {
    setRoutesInput(startTelephonyRoutes.join("\n"));
  }, [startTelephonyRoutes]);

  useEffect(() => {
    setWorkflowSlugInput(startTelephonyWorkflow.slug);
    setWorkflowIdInput(startTelephonyWorkflow.id != null ? String(startTelephonyWorkflow.id) : "");
  }, [startTelephonyWorkflow.id, startTelephonyWorkflow.slug]);

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
    setHostedEntries(
      startHostedWorkflows.map((entry) => ({
        slug: entry.slug,
        label: entry.label,
        workflow_id: entry.workflow_id,
        description: entry.description ?? "",
      })),
    );
  }, [startHostedWorkflows]);

  const normalizedRoutes = useMemo(
    () =>
      routesInput
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    [routesInput],
  );

  const invalidRoutes = useMemo(
    () => normalizedRoutes.filter((route) => !E164_PATTERN.test(route)),
    [normalizedRoutes],
  );

  const hasRealtimeOverrides = useMemo(() => {
    const trimmedModel = realtimeModelInput.trim();
    const trimmedVoice = realtimeVoiceInput.trim();
    return (
      trimmedModel.length > 0 ||
      trimmedVoice.length > 0 ||
      Boolean(realtimeStartModeInput) ||
      Boolean(realtimeStopModeInput)
    );
  }, [
    realtimeModelInput,
    realtimeVoiceInput,
    realtimeStartModeInput,
    realtimeStopModeInput,
  ]);

  const requireWorkflowSlug = normalizedRoutes.length > 0 || hasRealtimeOverrides;
  const slugError = requireWorkflowSlug && !workflowSlugInput.trim();

  const workflowIdParsed = useMemo(() => parseWorkflowId(workflowIdInput), [workflowIdInput]);
  const workflowIdHasError = Boolean(workflowIdInput.trim()) && workflowIdParsed === null;

  const hostedSlugCounts = useMemo(() => {
    const counts = new Map<string, number>();
    hostedEntries.forEach((entry) => {
      const slug = entry.slug.trim();
      if (!slug) {
        return;
      }
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    });
    return counts;
  }, [hostedEntries]);

  const updateHostedEntries = (updater: (current: StartHostedWorkflowOption[]) => StartHostedWorkflowOption[]) => {
    setHostedEntries((current) => {
      const next = updater(current);
      onStartHostedWorkflowsChange(nodeId, next.map((entry) => ({ ...entry })));
      return next;
    });
  };

  const handleHostedFieldChange = (
    index: number,
    field: keyof StartHostedWorkflowOption,
    value: string,
  ) => {
    updateHostedEntries((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    );
  };

  const handleHostedWorkflowRemove = (index: number) => {
    updateHostedEntries((current) => current.filter((_, entryIndex) => entryIndex !== index));
  };

  const handleHostedWorkflowAdd = () => {
    updateHostedEntries((current) => [
      ...current,
      { slug: "", label: "", workflow_id: "", description: "" },
    ]);
  };

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
          {t("workflowBuilder.startInspector.hostedSectionTitle")}
        </span>
        <p className={styles.nodeInspectorSectionDescription}>
          {t("workflowBuilder.startInspector.hostedSectionDescription")}
        </p>
      </div>

      {hostedEntries.length === 0 ? (
        <p className={styles.nodeInspectorEmptyLabel}>
          {t("workflowBuilder.startInspector.hostedEmpty")}
        </p>
      ) : null}

      {hostedEntries.map((entry, index) => {
        const trimmedSlug = entry.slug.trim();
        const slugMissing = trimmedSlug.length === 0;
        const slugDuplicate =
          trimmedSlug.length > 0 && (hostedSlugCounts.get(trimmedSlug) ?? 0) > 1;
        const slugHasError = slugMissing || slugDuplicate;
        const workflowIdTrimmed = entry.workflow_id.trim();
        const workflowIdMissing = workflowIdTrimmed.length === 0;

        return (
          <div
            key={`hosted-workflow-${index}-${trimmedSlug || "new"}`}
            className={styles.nodeInspectorPanelInner}
          >
            <label className={styles.nodeInspectorField}>
              <span className={styles.nodeInspectorLabel}>
                {t("workflowBuilder.startInspector.hostedSlugLabel")}
              </span>
              <input
                type="text"
                value={entry.slug}
                placeholder={t("workflowBuilder.startInspector.hostedSlugPlaceholder")}
                onChange={(event) =>
                  handleHostedFieldChange(index, "slug", event.target.value)
                }
                className={slugHasError ? styles.nodeInspectorInputError : undefined}
              />
              <p className={styles.nodeInspectorHintTextTight}>
                {t("workflowBuilder.startInspector.hostedSlugHelp")}
              </p>
              {slugMissing ? (
                <p className={styles.nodeInspectorErrorTextSmall}>
                  {t("workflowBuilder.startInspector.hostedSlugErrorRequired")}
                </p>
              ) : null}
              {!slugMissing && slugDuplicate ? (
                <p className={styles.nodeInspectorErrorTextSmall}>
                  {t("workflowBuilder.startInspector.hostedSlugErrorDuplicate")}
                </p>
              ) : null}
            </label>

            <label className={styles.nodeInspectorField}>
              <span className={styles.nodeInspectorLabel}>
                {t("workflowBuilder.startInspector.hostedLabelLabel")}
              </span>
              <input
                type="text"
                value={entry.label}
                placeholder={t("workflowBuilder.startInspector.hostedLabelPlaceholder")}
                onChange={(event) =>
                  handleHostedFieldChange(index, "label", event.target.value)
                }
              />
            </label>

            <label className={styles.nodeInspectorField}>
              <span className={styles.nodeInspectorLabel}>
                {t("workflowBuilder.startInspector.hostedWorkflowIdLabel")}
              </span>
              <input
                type="text"
                value={entry.workflow_id}
                placeholder={t(
                  "workflowBuilder.startInspector.hostedWorkflowIdPlaceholder",
                )}
                onChange={(event) =>
                  handleHostedFieldChange(index, "workflow_id", event.target.value)
                }
                className={workflowIdMissing ? styles.nodeInspectorInputError : undefined}
              />
              <p className={styles.nodeInspectorHintTextTight}>
                {t("workflowBuilder.startInspector.hostedWorkflowIdHelp")}
              </p>
              {workflowIdMissing ? (
                <p className={styles.nodeInspectorErrorTextSmall}>
                  {t("workflowBuilder.startInspector.hostedWorkflowIdError")}
                </p>
              ) : null}
            </label>

            <label className={styles.nodeInspectorField}>
              <span className={styles.nodeInspectorLabel}>
                {t("workflowBuilder.startInspector.hostedDescriptionLabel")}
              </span>
              <textarea
                value={entry.description}
                rows={2}
                placeholder={t(
                  "workflowBuilder.startInspector.hostedDescriptionPlaceholder",
                )}
                className={styles.nodeInspectorTextarea}
                onChange={(event) =>
                  handleHostedFieldChange(index, "description", event.target.value)
                }
              />
            </label>

            <div className={styles.nodeInspectorSectionFooter}>
              <button
                type="button"
                className="btn danger"
                onClick={() => handleHostedWorkflowRemove(index)}
              >
                {t("workflowBuilder.startInspector.hostedRemoveButton")}
              </button>
            </div>
          </div>
        );
      })}

      <div>
        <button type="button" className="btn" onClick={handleHostedWorkflowAdd}>
          {t("workflowBuilder.startInspector.hostedAddButton")}
        </button>
      </div>

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
        {slugError ? (
          <p className={styles.nodeInspectorErrorTextSmall}>
            {t("workflowBuilder.startInspector.telephonyWorkflowSlugError")}
          </p>
        ) : null}
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
  );
};
