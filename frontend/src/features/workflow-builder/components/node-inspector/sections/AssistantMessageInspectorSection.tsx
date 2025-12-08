import { Maximize2 } from "lucide-react";
import { useState } from "react";

import { useI18n } from "../../../../i18n";
import { AssistantMessageModal } from "../components/AssistantMessageModal";
import styles from "../NodeInspector.module.css";

type AssistantMessageInspectorSectionProps = {
  nodeId: string;
  assistantMessage: string;
  assistantMessageStreamEnabled: boolean;
  assistantMessageStreamDelay: number;
  onAssistantMessageChange: (nodeId: string, value: string) => void;
  onAssistantMessageStreamEnabledChange: (nodeId: string, value: boolean) => void;
  onAssistantMessageStreamDelayChange: (nodeId: string, value: string) => void;
};

export const AssistantMessageInspectorSection = ({
  nodeId,
  assistantMessage,
  assistantMessageStreamEnabled,
  assistantMessageStreamDelay,
  onAssistantMessageChange,
  onAssistantMessageStreamEnabledChange,
  onAssistantMessageStreamDelayChange,
}: AssistantMessageInspectorSectionProps) => {
  const { t } = useI18n();
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.assistantMessageInspector.messageLabel")}
        </span>
        <div className={styles.nodeInspectorTextareaWithAction}>
          <textarea
            value={assistantMessage}
            onChange={(event) => onAssistantMessageChange(nodeId, event.target.value)}
            rows={4}
            placeholder={t("workflowBuilder.assistantMessageInspector.messagePlaceholder")}
            className={styles.nodeInspectorTextarea}
          />
          <button
            type="button"
            className={styles.nodeInspectorExpandButton}
            onClick={() => setIsModalOpen(true)}
            title={t("workflowBuilder.assistantMessageInspector.modal.expand")}
            aria-label={t("workflowBuilder.assistantMessageInspector.modal.expand")}
          >
            <Maximize2 size={16} />
          </button>
        </div>
        <p className={styles.nodeInspectorHintTextTight}>
          {t("workflowBuilder.assistantMessageInspector.messageHint")}
        </p>
      </label>

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

      <AssistantMessageModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        value={assistantMessage}
        onChange={(value) => onAssistantMessageChange(nodeId, value)}
      />
    </>
  );
};
