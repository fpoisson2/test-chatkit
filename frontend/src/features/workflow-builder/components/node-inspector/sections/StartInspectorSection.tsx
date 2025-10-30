import { useI18n } from "../../../../../i18n";
import { ToggleRow } from "../components/ToggleRow";
import styles from "../NodeInspector.module.css";

type StartInspectorSectionProps = {
  nodeId: string;
  startAutoRun: boolean;
  startAutoRunMessage: string;
  startAutoRunAssistantMessage: string;
  startTelephonyIsSipWorkflow: boolean;
  startTelephonyRingTimeout: number;
  onStartAutoRunChange: (nodeId: string, value: boolean) => void;
  onStartAutoRunMessageChange: (nodeId: string, value: string) => void;
  onStartAutoRunAssistantMessageChange: (nodeId: string, value: string) => void;
  onStartTelephonyIsSipWorkflowChange: (nodeId: string, value: boolean) => void;
  onStartTelephonyRingTimeoutChange: (nodeId: string, value: number) => void;
};

export const StartInspectorSection = ({
  nodeId,
  startAutoRun,
  startAutoRunMessage,
  startAutoRunAssistantMessage,
  startTelephonyIsSipWorkflow,
  startTelephonyRingTimeout,
  onStartAutoRunChange,
  onStartAutoRunMessageChange,
  onStartAutoRunAssistantMessageChange,
  onStartTelephonyIsSipWorkflowChange,
  onStartTelephonyRingTimeoutChange,
}: StartInspectorSectionProps) => {
  const { t } = useI18n();

  const hasStartAutoRunUserMessage = startAutoRunMessage.trim().length > 0;
  const hasStartAutoRunAssistantMessage = startAutoRunAssistantMessage.trim().length > 0;

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

      <ToggleRow
        label={t("workflowBuilder.startInspector.telephonyIsSipWorkflowLabel")}
        checked={startTelephonyIsSipWorkflow}
        onChange={(next) => onStartTelephonyIsSipWorkflowChange(nodeId, next)}
        help={t("workflowBuilder.startInspector.telephonyIsSipWorkflowHelp")}
      />

      {startTelephonyIsSipWorkflow ? (
        <label className={styles.nodeInspectorInlineField}>
          <span className={styles.nodeInspectorLabel}>
            {t("workflowBuilder.startInspector.telephonyRingTimeoutLabel")}
          </span>
          <input
            type="number"
            min="0"
            max="30"
            step="0.5"
            value={startTelephonyRingTimeout}
            onChange={(event) => {
              const value = parseFloat(event.target.value);
              if (!isNaN(value) && value >= 0) {
                onStartTelephonyRingTimeoutChange(nodeId, value);
              }
            }}
            placeholder="0"
          />
          <p className={styles.nodeInspectorHintTextTight}>
            {t("workflowBuilder.startInspector.telephonyRingTimeoutHelp")}
          </p>
        </label>
      ) : null}
    </>
  );
};
