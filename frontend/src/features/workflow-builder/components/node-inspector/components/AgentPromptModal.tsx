/**
 * AgentPromptModal - Modal for viewing and editing agent system prompt
 * Allows viewing the prompt in a larger format with optional markdown rendering
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Modal } from '../../../../../components/Modal';
import { MarkdownRenderer } from '../../../../../chatkit/components/MarkdownRenderer';
import { useI18n } from '../../../../../i18n';
import { Eye, Edit3 } from 'lucide-react';
import styles from './AgentPromptModal.module.css';

export interface AgentPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  value: string;
  onChange: (value: string) => void;
}

type ViewMode = 'edit' | 'preview';

export function AgentPromptModal({
  isOpen,
  onClose,
  value,
  onChange,
}: AgentPromptModalProps): JSX.Element | null {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<ViewMode>('edit');
  const [localValue, setLocalValue] = useState(value);
  const prevIsOpenRef = useRef(false);

  // Sync local value only when modal opens (transition from closed to open)
  // This prevents overwriting user edits when value prop changes during editing
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

  if (!isOpen) {
    return null;
  }

  const hasChanges = localValue !== value;

  return (
    <Modal
      title={t('workflowBuilder.agentInspector.promptModal.title')}
      onClose={handleCancel}
      size="xl"
      footer={
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={handleCancel}
          >
            {t('workflowBuilder.agentInspector.promptModal.cancel')}
          </button>
          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSave}
            disabled={!hasChanges}
          >
            {t('workflowBuilder.agentInspector.promptModal.save')}
          </button>
        </div>
      }
    >
      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div className={styles.viewModeToggle}>
            <button
              type="button"
              className={`${styles.viewModeButton} ${viewMode === 'edit' ? styles.active : ''}`}
              onClick={() => setViewMode('edit')}
              title={t('workflowBuilder.agentInspector.promptModal.editMode')}
            >
              <Edit3 size={16} />
              <span>{t('workflowBuilder.agentInspector.promptModal.editMode')}</span>
            </button>
            <button
              type="button"
              className={`${styles.viewModeButton} ${viewMode === 'preview' ? styles.active : ''}`}
              onClick={() => setViewMode('preview')}
              title={t('workflowBuilder.agentInspector.promptModal.previewMode')}
            >
              <Eye size={16} />
              <span>{t('workflowBuilder.agentInspector.promptModal.previewMode')}</span>
            </button>
          </div>
          {hasChanges && (
            <span className={styles.unsavedIndicator}>
              {t('workflowBuilder.agentInspector.promptModal.unsavedChanges')}
            </span>
          )}
        </div>

        <div className={styles.content}>
          {viewMode === 'edit' ? (
            <textarea
              className={styles.textarea}
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              placeholder={t('workflowBuilder.agentInspector.messagePlaceholder')}
              autoFocus
            />
          ) : (
            <div className={styles.previewContainer}>
              {localValue ? (
                <MarkdownRenderer content={localValue} theme="light" />
              ) : (
                <p className={styles.emptyPreview}>
                  {t('workflowBuilder.agentInspector.promptModal.emptyPrompt')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
