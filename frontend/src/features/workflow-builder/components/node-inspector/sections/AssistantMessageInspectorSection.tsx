import { Maximize2, Radio } from "lucide-react";
import { useCallback, useState } from "react";

import { useAuth } from "../../../../../auth";
import { useI18n } from "../../../../../i18n";
import { workflowsApi } from "../../../../../utils/backend";
import { AssistantMessageModal } from "../components/AssistantMessageModal";
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
  const { token } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<"idle" | "success" | "error">("idle");

  const handlePublishLive = useCallback(async () => {
    if (!workflowId || !stepSlug || !assistantMessage) return;
    setIsPublishing(true);
    setPublishStatus("idle");
    try {
      await workflowsApi.updateStepMessageLive(token, workflowId, stepSlug, assistantMessage);
      setPublishStatus("success");
      setTimeout(() => setPublishStatus("idle"), 2000);
    } catch {
      setPublishStatus("error");
      setTimeout(() => setPublishStatus("idle"), 3000);
    } finally {
      setIsPublishing(false);
    }
  }, [token, workflowId, stepSlug, assistantMessage]);

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
        {isActiveVersion && workflowId ? (
          <button
            type="button"
            className={styles.nodeInspectorPublishLiveButton}
            onClick={handlePublishLive}
            disabled={isPublishing || !assistantMessage}
            title={t("workflowBuilder.assistantMessageInspector.publishLiveTitle")}
          >
            <Radio size={14} />
            {isPublishing
              ? t("workflowBuilder.assistantMessageInspector.publishLivePublishing")
              : publishStatus === "success"
                ? t("workflowBuilder.assistantMessageInspector.publishLiveSuccess")
                : publishStatus === "error"
                  ? t("workflowBuilder.assistantMessageInspector.publishLiveError")
                  : t("workflowBuilder.assistantMessageInspector.publishLive")}
          </button>
        ) : null}
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
        workflowId={workflowId}
        stepSlug={stepSlug}
        isActiveVersion={isActiveVersion}
      />
    </>
  );
};
