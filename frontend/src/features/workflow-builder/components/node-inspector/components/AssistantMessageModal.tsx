import React, { useCallback, useEffect, useRef, useState } from "react";
import { Edit3, Eye, Radio } from "lucide-react";

import { useAuth } from "../../../../../auth";
import { Modal } from "../../../../../components/Modal";
import { MarkdownRenderer } from "../../../../../chatkit/components/MarkdownRenderer";
import { useI18n } from "../../../../../i18n";
import { workflowsApi } from "../../../../../utils/backend";

import styles from "./AgentPromptModal.module.css";

type AssistantMessageModalProps = {
  isOpen: boolean;
  onClose: () => void;
  value: string;
  onChange: (value: string) => void;
  workflowId?: number | null;
  stepSlug?: string;
  isActiveVersion?: boolean;
};

type ViewMode = "edit" | "preview";

export const AssistantMessageModal = ({
  isOpen,
  onClose,
  value,
  onChange,
  workflowId,
  stepSlug,
  isActiveVersion,
}: AssistantMessageModalProps): JSX.Element | null => {
  const { t } = useI18n();
  const { token } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [localValue, setLocalValue] = useState(value);
  const prevIsOpenRef = useRef(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setLocalValue(value);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, value]);

  const handleSave = useCallback(() => {
    onChange(localValue);
    onClose();
  }, [localValue, onChange, onClose]);

  const handleCancel = useCallback(() => {
    setLocalValue(value);
    onClose();
  }, [value, onClose]);

  const handlePublishLive = useCallback(async () => {
    if (!workflowId || !stepSlug) return;
    // Save first so the local value is persisted, then publish
    onChange(localValue);
    setIsPublishing(true);
    setPublishStatus("idle");
    try {
      await workflowsApi.updateStepMessageLive(token, workflowId, stepSlug, localValue);
      setPublishStatus("success");
      setTimeout(() => setPublishStatus("idle"), 2000);
    } catch {
      setPublishStatus("error");
      setTimeout(() => setPublishStatus("idle"), 3000);
    } finally {
      setIsPublishing(false);
    }
  }, [token, workflowId, stepSlug, localValue, onChange]);

  if (!isOpen) {
    return null;
  }

  const hasChanges = localValue !== value;

  return (
    <Modal
      title={t("workflowBuilder.assistantMessageInspector.modal.title")}
      onClose={handleCancel}
      size="xl"
      footer={
        <div className={styles.footer}>
          {isActiveVersion && workflowId && stepSlug ? (
            <button
              type="button"
              className={styles.publishLiveButton}
              onClick={handlePublishLive}
              disabled={isPublishing || !localValue}
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
          ) : <div />}
          <div className={styles.footerRight}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={handleCancel}
            >
              {t("workflowBuilder.assistantMessageInspector.modal.cancel")}
            </button>
            <button
              type="button"
              className={styles.saveButton}
              onClick={handleSave}
              disabled={!hasChanges}
            >
              {t("workflowBuilder.assistantMessageInspector.modal.save")}
            </button>
          </div>
        </div>
      }
    >
      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div className={styles.viewModeToggle}>
            <button
              type="button"
              className={`${styles.viewModeButton} ${viewMode === "edit" ? styles.active : ""}`}
              onClick={() => setViewMode("edit")}
              title={t("workflowBuilder.assistantMessageInspector.modal.editMode")}
            >
              <Edit3 size={16} />
              <span>{t("workflowBuilder.assistantMessageInspector.modal.editMode")}</span>
            </button>
            <button
              type="button"
              className={`${styles.viewModeButton} ${viewMode === "preview" ? styles.active : ""}`}
              onClick={() => setViewMode("preview")}
              title={t("workflowBuilder.assistantMessageInspector.modal.previewMode")}
            >
              <Eye size={16} />
              <span>{t("workflowBuilder.assistantMessageInspector.modal.previewMode")}</span>
            </button>
          </div>
          {hasChanges && (
            <span className={styles.unsavedIndicator}>
              {t("workflowBuilder.assistantMessageInspector.modal.unsavedChanges")}
            </span>
          )}
        </div>

        <div className={styles.content}>
          {viewMode === "edit" ? (
            <textarea
              className={styles.textarea}
              value={localValue}
              onChange={(event) => setLocalValue(event.target.value)}
              placeholder={t("workflowBuilder.assistantMessageInspector.modal.placeholder")}
              autoFocus
            />
          ) : (
            <div className={styles.previewContainer}>
              {localValue ? (
                <MarkdownRenderer content={localValue} theme="light" />
              ) : (
                <p className={styles.emptyPreview}>
                  {t("workflowBuilder.assistantMessageInspector.modal.emptyMessage")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

