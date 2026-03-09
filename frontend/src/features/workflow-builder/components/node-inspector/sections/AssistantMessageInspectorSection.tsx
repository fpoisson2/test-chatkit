import { useI18n } from "../../../../../i18n";
import { RichMessageField } from "../components/RichMessageField";
import styles from "../NodeInspector.module.css";

type AssistantMessageInspectorSectionProps = {
  nodeId: string;
  stepSlug: string;
  workflowId: number | null;
  isActiveVersion: boolean;
  assistantMessage: string;
  assistantMessageStreamEnabled: boolean;
  assistantMessageStreamDelay: number;
  onAssistantMessageChange: (nodeId: string, value: string) => void;
  onAssistantMessageStreamEnabledChange: (nodeId: string, value: boolean) => void;
  onAssistantMessageStreamDelayChange: (nodeId: string, value: string) => void;
};

export const AssistantMessageInspectorSection = ({
  nodeId,
  stepSlug,
  workflowId,
  isActiveVersion,
  assistantMessage,
  assistantMessageStreamEnabled,
  assistantMessageStreamDelay,
  onAssistantMessageChange,
  onAssistantMessageStreamEnabledChange,
  onAssistantMessageStreamDelayChange,
}: AssistantMessageInspectorSectionProps) => {
  const { t } = useI18n();

  return (
    <>
      <RichMessageField
        value={assistantMessage}
        onChange={(value) => onAssistantMessageChange(nodeId, value)}
        label={t("workflowBuilder.assistantMessageInspector.messageLabel")}
        hint={t("workflowBuilder.assistantMessageInspector.messageHint")}
        placeholder={t("workflowBuilder.assistantMessageInspector.messagePlaceholder")}
        rows={4}
        contentType="assistant_message"
        workflowId={workflowId}
        stepSlug={stepSlug}
        isActiveVersion={isActiveVersion}
      />

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.assistantMessageInspector.streamingLabel")}
        </span>
        <div className={styles.nodeInspectorInlineStack}>
          <input
            type="checkbox"
            checked={assistantMessageStreamEnabled}
            onChange={(event) => onAssistantMessageStreamEnabledChange(nodeId, event.target.checked)}
          />
          <div className={styles.nodeInspectorStackText}>
            <strong>{t("workflowBuilder.assistantMessageInspector.streamingTitle")}</strong>
            <p className={styles.nodeInspectorHintTextTight}>
              {t("workflowBuilder.assistantMessageInspector.streamingDescription")}
            </p>
          </div>
        </div>
      </label>

      {assistantMessageStreamEnabled ? (
        <label className={styles.nodeInspectorField}>
          <span className={styles.nodeInspectorLabel}>
            {t("workflowBuilder.assistantMessageInspector.streamDelayLabel")}
          </span>
          <input
            type="number"
            min={0}
            step={10}
            value={String(assistantMessageStreamDelay)}
            onChange={(event) => onAssistantMessageStreamDelayChange(nodeId, event.target.value)}
          />
          <p className={styles.nodeInspectorHintTextTight}>
            {t("workflowBuilder.assistantMessageInspector.streamDelayHint")}
          </p>
        </label>
      ) : null}
    </>
  );
};
