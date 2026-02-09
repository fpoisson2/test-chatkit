/**
 * Composant Composer - Zone de saisie des messages avec attachements et sélection de modèle
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ComposerModel, ChatKitOptions } from '../types';
import { ImageWithBlobUrl, TEXTAREA_MAX_HEIGHT_PX, getFileTypeIcon } from '../utils';
import type { Attachment } from '../api/attachments';
import { useI18n } from '../../i18n/I18nProvider';

/**
 * Télécharge un fichier en créant un lien de téléchargement
 */
function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ComposerProps {
  /** Valeur actuelle du textarea */
  value: string;
  /** Callback quand la valeur change */
  onChange: (value: string) => void;
  /** Liste des pièces jointes */
  attachments: Attachment[];
  /** Callback pour mettre à jour les pièces jointes */
  onAttachmentsChange: (attachments: Attachment[]) => void;
  /** Callback pour soumettre le message */
  onSubmit: (message: string, attachments: Attachment[], selectedModelId?: string | null) => Promise<void>;
  /** Si le composant est en état de chargement */
  isLoading?: boolean;
  /** Si le thread est désactivé (fermé/verrouillé) */
  isDisabled?: boolean;
  /** Message de statut à afficher si désactivé */
  disabledMessage?: string;
  /** Configuration du composer depuis les options */
  config?: ChatKitOptions['composer'];
  /** Texte de disclaimer à afficher sous le composer */
  disclaimer?: string;
  /** Configuration API pour l'upload */
  apiConfig?: {
    url: string;
    headers?: Record<string, string>;
  };
  /** Gestion de la sélection de fichiers (drag-and-drop ou input) */
  onFilesSelected: (files: FileList | null) => void;
  /** Indique si un drag-and-drop de fichiers est en cours */
  isDraggingFiles?: boolean;
  /** Edit mode state for branching */
  editingState?: {
    isEditing: boolean;
    itemId: string;
    originalContent: string;
  } | null;
  /** Callback to cancel edit mode */
  onCancelEdit?: () => void;
}

// Export for testing
export function Composer({
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  onSubmit,
  isLoading = false,
  isDisabled = false,
  disabledMessage,
  config,
  disclaimer,
  apiConfig,
  onFilesSelected,
  isDraggingFiles = false,
  editingState,
  onCancelEdit,
}: ComposerProps): JSX.Element {
  const { t } = useI18n();
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isMultiline, setIsMultiline] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Extraire la configuration des modèles
  const composerModels = config?.models;

  const availableModels = React.useMemo<ComposerModel[]>(() => {
    if (!composerModels) return [];
    return Array.isArray(composerModels)
      ? composerModels
      : composerModels.options || [];
  }, [composerModels]);

  const isModelSelectorEnabled = React.useMemo(
    () => !!composerModels && (Array.isArray(composerModels) || !!composerModels.enabled),
    [composerModels],
  );

  const selectedModel = React.useMemo(
    () => availableModels.find((model) => model.id === selectedModelId),
    [availableModels, selectedModelId],
  );

  // Pass selectedModelId to parent via onSubmit
  const handleModelAwareSubmit = useCallback(async (message: string, uploadedAttachments: Attachment[]) => {
      await onSubmit(message, uploadedAttachments, selectedModelId);
  }, [onSubmit, selectedModelId]);

  // Initialiser le modèle par défaut
  useEffect(() => {
    if (!isModelSelectorEnabled || availableModels.length === 0) {
      setSelectedModelId(null);
      return;
    }

    const currentModelExists = availableModels.some((model) => model.id === selectedModelId);
    if (currentModelExists) return;

    const defaultModel = availableModels.find((model) => model.default) ?? availableModels[0];
    setSelectedModelId(defaultModel?.id ?? null);
  }, [availableModels, isModelSelectorEnabled, selectedModelId]);

  // Effect to notify parent of model change if we add that prop.
  // Since I can't easily change the prop interface without updating ChatKit usage,
  // I will cheat slightly for the fix: Use a ref or context? No.

  // Actually, I should check if I missed something in ChatKit.tsx.
  // In ChatKit.tsx: <Composer ... />

  // If I can't pass the model up, the test failure is correct: the feature is broken or missing.
  // But wait, the test was passing before? Or maybe it was broken before too?
  // The test code was: await user.selectOptions(select, "gpt-4");
  // But Composer implements a CUSTOM dropdown, not a native select.
  // user.selectOptions only works on <select> elements.

  // So the test was flawed for this component implementation.
  // And the implementation itself seems to lack passing the selected model to the submit handler.

  // Let's fix the implementation first by adding onModelChange prop.

  // Fermer le dropdown quand on clique en dehors
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    if (isModelDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModelDropdownOpen]);

  // Forcer le mode multiline quand le sélecteur de modèle est activé
  const forceMultiline = isModelSelectorEnabled && availableModels.length > 0;

  // Ajuster automatiquement la hauteur du textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Réinitialiser le mode quand la valeur est vide (sauf si forceMultiline)
    if (!value && !forceMultiline) {
      setIsMultiline(false);
      textarea.style.height = '';
      return;
    }

    // Calculer la hauteur du contenu
    textarea.style.height = 'auto';
    const scrollHeight = textarea.scrollHeight;
    const minHeight = 24;

    // Ajuster la hauteur
    const newHeight = Math.min(Math.max(scrollHeight, minHeight), TEXTAREA_MAX_HEIGHT_PX);
    textarea.style.height = `${newHeight}px`;

    // Déterminer si on doit être en mode multiline avec hystérésis
    // Pour passer en multiline: retour à la ligne OU hauteur > 40px
    // Pour revenir en singleline: pas de retour à la ligne ET hauteur < 36px (seuil plus bas)
    const hasLineBreaks = value.includes('\n');

    if (!isMultiline) {
      // Passer en multiline si nécessaire
      if (forceMultiline || hasLineBreaks || scrollHeight > 40) {
        setIsMultiline(true);
      }
    } else {
      // Revenir en singleline seulement si vraiment sur une seule ligne courte
      if (!forceMultiline && !hasLineBreaks && scrollHeight <= 36) {
        setIsMultiline(false);
      }
    }
  }, [value, isMultiline, forceMultiline]);

  // Focus textarea on mount (e.g., after workflow selection)
  useEffect(() => {
    if (textareaRef.current && !isDisabled) {
      textareaRef.current.focus();
    }
  }, [isDisabled]);

  // Supprimer un attachment
  const removeAttachment = useCallback((id: string) => {
    onAttachmentsChange(attachments.filter(att => att.id !== id));
  }, [attachments, onAttachmentsChange]);

  // Check if any attachment is still uploading or pending
  const hasUploadingAttachments = attachments.some(att => att.status === 'uploading' || att.status === 'pending');

  // Soumettre le message
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const message = value.trim();
    const hasContent = message || attachments.length > 0;

    // Don't submit if no content, loading, or uploads still in progress
    if (!hasContent || isLoading || hasUploadingAttachments) return;

    try {
      // Files are already uploaded by ChatKit when selected
      // Just filter to get successfully uploaded attachments
      const successfulAttachments = attachments.filter(a => a.status === 'uploaded');

      // We pass the selected model via a second argument if possible, or we need to update props
      // Since we can't change props interface easily here without breaking other things or doing a bigger refactor,
      // and this task is about fixing error modals...

      // Note: The test expects ChatKit to send the model.
      // ChatKit passes handleComposerSubmit to Composer.
      // ChatKit needs to know the selected model.

      // HACK: Pass model in the second argument which is usually attachments, OR assume
      // we need to add onModelChange to Composer and manage state in ChatKit.

      // Let's update ComposerProps to include onModelChange.

      await onSubmit(message, successfulAttachments, selectedModelId);
    } catch (error) {
      // Error ignored
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Envoyer avec Entrée (sans Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isLoading || isDisabled) {
        return;
      }
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  const placeholder = isDisabled
    ? disabledMessage || ''
    : (config?.placeholder || 'Posez votre question...');

  const canSubmit = (value.trim() || attachments.length > 0) && !isLoading && !isDisabled && !hasUploadingAttachments;
  const attachmentsEnabled = config?.attachments?.enabled || config?.attachments !== false;

  return (
    <>
      {/* Composer */}
      <div className="chatkit-composer">
        {/* Edit mode banner */}
        {editingState?.isEditing && (
          <div className="chatkit-edit-banner">
            <div className="chatkit-edit-banner-content">
              <svg
                className="chatkit-edit-banner-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="6" y1="3" x2="6" y2="15"></line>
                <circle cx="18" cy="6" r="3"></circle>
                <circle cx="6" cy="18" r="3"></circle>
                <path d="M18 9a9 9 0 0 1-9 9"></path>
              </svg>
              <span>
                {t('chatkit.editMessage.banner') || 'Editing message - this will create a new branch'}
              </span>
            </div>
            <button
              type="button"
              className="chatkit-edit-banner-cancel"
              onClick={onCancelEdit}
              aria-label={t('chatkit.editMessage.cancelEdit') || 'Cancel edit'}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        )}
        <form
          onSubmit={handleSubmit}
          className={`chatkit-composer-form ${(isModelSelectorEnabled && availableModels.length > 0) || isMultiline ? 'is-multiline' : 'is-singleline'}${attachments.length > 0 ? ' has-attachments' : ''}${isDraggingFiles ? ' is-dragging' : ''}`}
        >
          {/* Attachments preview inside form */}
          {attachments.length > 0 && (
            <div className="chatkit-attachments-preview">
              {attachments.map(att => (
                <div key={att.id} className={`chatkit-attachment chatkit-attachment-${att.status}`}>
                  {att.preview && <ImageWithBlobUrl src={att.preview} alt={att.file.name} />}
                  {!att.preview && (
                    <div className="chatkit-attachment-icon">
                      {getFileTypeIcon(att.file.type, att.file.name, 32)}
                    </div>
                  )}
                  <div className="chatkit-attachment-name">{att.file.name}</div>
                  {att.status === 'uploading' && (
                    <div className="chatkit-attachment-progress">
                      <div
                        className="chatkit-attachment-progress-bar"
                        style={{ width: `${att.progress || 0}%` }}
                      />
                      <span className="chatkit-attachment-progress-text">{att.progress || 0}%</span>
                    </div>
                  )}
                  {att.status === 'error' && att.error && (
                    <div className="chatkit-attachment-error-message" title={att.error}>
                      {att.error}
                    </div>
                  )}
                  <div className="chatkit-attachment-actions">
                    <button
                      type="button"
                      className="chatkit-attachment-download"
                      onClick={() => downloadFile(att.file)}
                      aria-label="Télécharger"
                      title="Télécharger"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="chatkit-attachment-remove"
                      onClick={() => removeAttachment(att.id)}
                      aria-label="Supprimer"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="chatkit-input-area">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="chatkit-input"
              rows={1}
              disabled={isDisabled}
            />
          </div>
          <div className="chatkit-composer-actions">
            {isModelSelectorEnabled && availableModels.length > 0 && (
              <div className="chatkit-model-selector" ref={modelDropdownRef}>
                <button
                  type="button"
                  className="chatkit-model-dropdown-trigger"
                  onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                  disabled={isDisabled}
                  aria-label="Sélectionner un modèle"
                  aria-expanded={isModelDropdownOpen}
                >
                  <span className="chatkit-model-dropdown-selected">{selectedModel?.label || 'Modèle'}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
                {isModelDropdownOpen && (
                  <div className="chatkit-model-dropdown-menu">
                    {availableModels.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        className={`chatkit-model-dropdown-item ${selectedModelId === model.id ? 'is-selected' : ''}`}
                        onClick={() => {
                          setSelectedModelId(model.id);
                          // We need to notify parent, but we don't have a prop for it.
                          // This confirms the functionality is not fully implemented in Composer.
                          // But I'm here to fix error modals.
                          setIsModelDropdownOpen(false);
                        }}
                      >
                        <span className="chatkit-model-dropdown-label">{model.label}</span>
                        {model.description && (
                          <span className="chatkit-model-dropdown-description">{model.description}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {attachmentsEnabled && (
              <div className="chatkit-attach-wrapper">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={config?.attachments?.accept ? Object.values(config.attachments.accept).flat().join(',') : undefined}
                  onChange={(e) => onFilesSelected(e.target.files)}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  className="chatkit-attach-button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading || !config?.attachments?.enabled || isDisabled}
                  aria-label="Joindre un fichier"
                  title="Joindre un fichier"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                  </svg>
                </button>
              </div>
            )}
            <button
              type="submit"
              disabled={!canSubmit}
              className="chatkit-submit"
              aria-label="Envoyer"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 12 12 8 8 12"></polyline>
                <line x1="12" y1="16" x2="12" y2="8"></line>
              </svg>
            </button>
          </div>
        </form>

        {/* Disclaimer */}
        {disclaimer && (
          <div className="chatkit-disclaimer">{disclaimer}</div>
        )}
      </div>
    </>
  );
}

export default Composer;
