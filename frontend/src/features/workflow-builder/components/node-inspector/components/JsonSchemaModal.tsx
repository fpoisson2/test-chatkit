import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { Modal } from '../../../../../components/Modal';
import { useI18n } from '../../../../../i18n';
import { SchemaBuilder, type SchemaProperty } from './SchemaBuilder';
import { jsonToVisualSchema, visualToJsonSchema } from '../utils/schemaUtils';

import styles from './JsonSchemaModal.module.css';

type SchemaEditorMode = 'text' | 'visual';

type JsonSchemaModalProps = {
  isOpen: boolean;
  value: string;
  initialMode?: SchemaEditorMode;
  schemaError?: string | null;
  onClose: () => void;
  onSave: (nextValue: string) => boolean;
};

export function JsonSchemaModal({
  isOpen,
  value,
  initialMode = 'text',
  schemaError,
  onClose,
  onSave,
}: JsonSchemaModalProps): JSX.Element | null {
  const { t } = useI18n();
  const [editorMode, setEditorMode] = useState<SchemaEditorMode>(initialMode);
  const [textValue, setTextValue] = useState(value);
  const [visualValue, setVisualValue] = useState<SchemaProperty[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTextValue(value);
      try {
        const parsedValue = JSON.parse(value);
        setVisualValue(jsonToVisualSchema(parsedValue));
      } catch (error) {
        // If JSON parsing fails, start with empty visual schema
        setVisualValue([]);
      }
      setEditorMode(initialMode);
      setLocalError(null);
    }
  }, [isOpen, value, initialMode]);

  const hasChanges = useMemo(() => {
    if (editorMode === 'text') {
      return textValue !== value;
    } else {
      const currentJson = visualToJsonSchema(visualValue);
      return currentJson !== value;
    }
  }, [editorMode, textValue, visualValue, value]);

  const validateAndGetJson = useCallback(() => {
    try {
      let jsonString: string;
      if (editorMode === 'text') {
        JSON.parse(textValue); // Validate JSON
        jsonString = textValue;
      } else {
        jsonString = visualToJsonSchema(visualValue);
        JSON.parse(jsonString); // Validate the generated JSON
      }
      setLocalError(null);
      return jsonString;
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : t('workflowBuilder.agentInspector.jsonSchemaInvalid'),
      );
      return null;
    }
  }, [editorMode, textValue, visualValue, t]);

  const handleSave = useCallback(() => {
    const jsonString = validateAndGetJson();
    if (!jsonString) {
      return;
    }
    const saved = onSave(jsonString);
    if (saved) {
      onClose();
    }
  }, [validateAndGetJson, onClose, onSave]);

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
        {/* Mode Toggle */}
        <div className={styles.modeToggle}>
          <div className={styles.toggleGroup}>
            <button
              type="button"
              className={`${styles.toggleButton} ${editorMode === 'text' ? styles.toggleButtonActive : ''}`}
              onClick={() => {
                // When switching to text mode, convert visual schema to JSON
                try {
                  const jsonString = visualToJsonSchema(visualValue);
                  setTextValue(JSON.stringify(jsonString, null, 2));
                } catch (error) {
                  setLocalError('Failed to convert visual schema to JSON');
                  return;
                }
                setEditorMode('text');
              }}
            >
              {t('workflowBuilder.agentInspector.jsonSchemaEditorMode.text')}
            </button>
            <button
              type="button"
              className={`${styles.toggleButton} ${editorMode === 'visual' ? styles.toggleButtonActive : ''}`}
              onClick={() => {
                // When switching to visual mode, convert JSON text to visual schema
                try {
                  const parsedValue = JSON.parse(textValue);
                  setVisualValue(jsonToVisualSchema(parsedValue));
                } catch (error) {
                  setLocalError('Invalid JSON - cannot switch to visual mode');
                  return;
                }
                setEditorMode('visual');
              }}
            >
              {t('workflowBuilder.agentInspector.jsonSchemaEditorMode.visual')}
            </button>
          </div>
        </div>

        {/* Editor Content */}
        {editorMode === 'text' ? (
          <>
            <textarea
              className={`${styles.textarea} ${mergedError ? styles.textareaError : ''}`}
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
              rows={18}
              autoFocus
              spellCheck={false}
              placeholder={`{\n  "schema": {\n    "type": "object",\n    "properties": {}\n  }\n}`}
            />
            <div className={styles.hintRow}>
              <p className={styles.hintText}>
                {t('workflowBuilder.agentInspector.jsonSchemaModal.validationHint')}
              </p>
              {mergedError ? <span className={styles.errorText}>{mergedError}</span> : null}
            </div>
          </>
        ) : (
          <>
            <SchemaBuilder schema={visualValue} onChange={setVisualValue} />
            {mergedError ? (
              <div className={styles.hintRow}>
                <span className={styles.errorText}>{mergedError}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
