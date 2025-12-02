import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { Modal } from '../../../../../components/Modal';
import { useI18n } from '../../../../../i18n';

import styles from './JsonSchemaModal.module.css';

type JsonSchemaModalProps = {
  isOpen: boolean;
  value: string;
  schemaError?: string | null;
  onClose: () => void;
  onSave: (nextValue: string) => boolean;
};

export function JsonSchemaModal({
  isOpen,
  value,
  schemaError,
  onClose,
  onSave,
}: JsonSchemaModalProps): JSX.Element | null {
  const { t } = useI18n();
  const [localValue, setLocalValue] = useState(value);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLocalValue(value);
      setLocalError(null);
    }
  }, [isOpen, value]);

  const hasChanges = useMemo(() => localValue !== value, [localValue, value]);

  const validateJson = useCallback(() => {
    try {
      JSON.parse(localValue);
      setLocalError(null);
      return true;
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : t('workflowBuilder.agentInspector.jsonSchemaInvalid'),
      );
      return false;
    }
  }, [localValue, t]);

  const handleSave = useCallback(() => {
    if (!validateJson()) {
      return;
    }
    const saved = onSave(localValue);
    if (saved) {
      onClose();
    }
  }, [localValue, onClose, onSave, validateJson]);

  if (!isOpen) {
    return null;
  }

  const mergedError = localError || schemaError;

  return (
    <Modal
      title={t('workflowBuilder.agentInspector.jsonSchemaModal.title')}
      description={t('workflowBuilder.agentInspector.jsonSchemaModal.description')}
      onClose={onClose}
      size="xl"
      footer={
        <div className={styles.footer}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>
            {t('workflowBuilder.agentInspector.jsonSchemaModal.cancel')}
          </button>
          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSave}
            disabled={!hasChanges && !mergedError}
          >
            {t('workflowBuilder.agentInspector.jsonSchemaModal.apply')}
          </button>
        </div>
      }
    >
      <div className={styles.container}>
        <textarea
          className={`${styles.textarea} ${mergedError ? styles.textareaError : ''}`}
          value={localValue}
          onChange={(event) => setLocalValue(event.target.value)}
          rows={18}
          autoFocus
          spellCheck={false}
          placeholder="{\n  \"schema\": {\n    \"type\": \"object\",\n    \"properties\": {}\n  }\n}"
        />
        <div className={styles.hintRow}>
          <p className={styles.hintText}>
            {t('workflowBuilder.agentInspector.jsonSchemaModal.validationHint')}
          </p>
          {mergedError ? <span className={styles.errorText}>{mergedError}</span> : null}
        </div>
      </div>
    </Modal>
  );
}
