import { useEffect } from "react";

import { useI18n } from "../../../../../i18n";
import type { StartTelephonyWorkflowReference } from "../../../../../utils/workflows";
import { ToggleRow } from "../components/ToggleRow";
import styles from "../NodeInspector.module.css";

type StartInspectorSectionProps = {
  nodeId: string;
  startAutoRun: boolean;
  startAutoRunMessage: string;
  startAutoRunAssistantMessage: string;
  startTelephonyWorkflow: StartTelephonyWorkflowReference;
  startTelephonyEnabled: boolean;
  currentWorkflowSlug: string;
  currentWorkflowId: number | null;
  onStartAutoRunChange: (nodeId: string, value: boolean) => void;
  onStartAutoRunMessageChange: (nodeId: string, value: string) => void;
  onStartAutoRunAssistantMessageChange: (nodeId: string, value: string) => void;
  onStartTelephonyWorkflowChange: (
    nodeId: string,
    reference: { id?: number | null; slug?: string | null },
  ) => void;
  onStartTelephonyWorkflowToggle: (nodeId: string, enabled: boolean) => void;
};

export const StartInspectorSection = ({
  nodeId,
  startAutoRun,
  startAutoRunMessage,
  startAutoRunAssistantMessage,
  startTelephonyWorkflow,
  startTelephonyEnabled,
  currentWorkflowSlug,
  currentWorkflowId,
  onStartAutoRunChange,
  onStartAutoRunMessageChange,
  onStartAutoRunAssistantMessageChange,
  onStartTelephonyWorkflowChange,
  onStartTelephonyWorkflowToggle,
}: StartInspectorSectionProps) => {
  const { t } = useI18n();

  const hasStartAutoRunUserMessage = startAutoRunMessage.trim().length > 0;
  const hasStartAutoRunAssistantMessage = startAutoRunAssistantMessage.trim().length > 0;

  useEffect(() => {
    if (!startTelephonyEnabled) {
      return;
    }

    const targetSlug = currentWorkflowSlug.trim();
    const currentSlug = startTelephonyWorkflow.slug.trim();
    const targetId = currentWorkflowId ?? null;
    const currentId = startTelephonyWorkflow.id ?? null;

    const slugMismatch = targetSlug && targetSlug !== currentSlug;
    const idMismatch = targetId !== null && targetId !== currentId;

    if (!slugMismatch && !idMismatch) {
      return;
    }

    onStartTelephonyWorkflowChange(nodeId, {
      slug: targetSlug || undefined,
      id: targetId ?? undefined,
    });
  }, [
    currentWorkflowId,
    currentWorkflowSlug,
    nodeId,
    onStartTelephonyWorkflowChange,
    startTelephonyEnabled,
    startTelephonyWorkflow.id,
    startTelephonyWorkflow.slug,
  ]);

  const normalizedWorkflowSlug = currentWorkflowSlug.trim();
  const toggleDisabled = normalizedWorkflowSlug.length === 0;

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

      <ToggleRow
        label={t("workflowBuilder.startInspector.telephonySipToggleLabel")}
        checked={startTelephonyEnabled}
        disabled={toggleDisabled}
        onChange={(next) => {
          onStartTelephonyWorkflowToggle(nodeId, next);
          if (next) {
            onStartTelephonyWorkflowChange(nodeId, {
              slug: normalizedWorkflowSlug || undefined,
              id: currentWorkflowId ?? undefined,
            });
          }
        }}
        help={t("workflowBuilder.startInspector.telephonySipToggleHelp")}
      />

      {toggleDisabled ? (
        <p className={styles.nodeInspectorHintTextTight}>
          {t("workflowBuilder.startInspector.telephonySipToggleDisabledHint")}
        </p>
      ) : null}
    </>
  );
};
