/**
 * Composant Composer - Zone de saisie des messages avec attachements et sélection de modèle
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ComposerModel, ChatKitOptions } from '../types';
import { ImageWithBlobUrl, TEXTAREA_MAX_HEIGHT_PX } from '../utils';
import {
  Attachment,
  uploadAttachment,
  createFilePreview,
  generateAttachmentId,
  validateFile
} from '../api/attachments';

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
  onSubmit: (message: string, attachments: Attachment[]) => Promise<void>;
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
}

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
}: ComposerProps): JSX.Element {
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isMultiline, setIsMultiline] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const singleLineHeightRef = useRef<number | null>(null);
  const modeChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
      singleLineHeightRef.current = null;
      const form = textarea.closest('.chatkit-composer-form');
      if (form) {
        form.classList.remove('is-multiline');
        form.classList.add('is-singleline');
      }
      return;
    }

    // Si on force le multiline, toujours appliquer le mode multiline
    if (forceMultiline) {
      const form = textarea.closest('.chatkit-composer-form');
      if (form) {
        form.classList.add('is-multiline');
        form.classList.remove('is-singleline');
      }
      // Ajuster la hauteur du textarea
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      textarea.style.height = `${Math.min(Math.max(scrollHeight, 24), TEXTAREA_MAX_HEIGHT_PX)}px`;
      return;
    }

    // Calculer la hauteur minimale basée sur le style réel du textarea
    const styles = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(styles.lineHeight || '0');
    const paddingTop = parseFloat(styles.paddingTop || '0');
    const paddingBottom = parseFloat(styles.paddingBottom || '0');
    const lineHeightValue = lineHeight || 20;

    // Stocker la hauteur de référence pour une seule ligne (avec le contenu actuel)
    if (singleLineHeightRef.current === null) {
      singleLineHeightRef.current = lineHeightValue + paddingTop + paddingBottom;
    }

    const baseHeight = singleLineHeightRef.current;

    // Mesurer la hauteur du contenu en mode single-line
    const originalHeight = textarea.style.height;
    const originalWhiteSpace = textarea.style.whiteSpace;
    const originalOverflow = textarea.style.overflow;
    const originalWordWrap = textarea.style.wordWrap;

    // Mesure single-line
    textarea.style.height = 'auto';
    textarea.style.whiteSpace = 'nowrap';
    textarea.style.overflow = 'hidden';
    textarea.style.wordWrap = 'normal';
    const singleLineContentHeight = textarea.scrollHeight;

    // Mesure multiline
    textarea.style.whiteSpace = 'pre-wrap';
    textarea.style.wordWrap = 'break-word';
    const multilineContentHeight = textarea.scrollHeight;

    // Restaurer les styles originaux
    textarea.style.height = originalHeight;
    textarea.style.whiteSpace = originalWhiteSpace;
    textarea.style.overflow = originalOverflow;
    textarea.style.wordWrap = originalWordWrap;

    // Déterminer si on doit être en mode multiline avec hystérésis
    const shouldBeMultiline = isMultiline
      ? singleLineContentHeight > baseHeight + 2
      : singleLineContentHeight > baseHeight + (lineHeightValue * 0.1);

    // Ajuster la hauteur immédiatement en fonction du contenu effectif
    const nextHeight = Math.max(isMultiline ? multilineContentHeight : singleLineContentHeight, baseHeight);
    textarea.style.height = `${Math.min(nextHeight, TEXTAREA_MAX_HEIGHT_PX)}px`;

    // Changer le mode si nécessaire
    if (shouldBeMultiline !== isMultiline) {
      if (modeChangeTimeoutRef.current) {
        clearTimeout(modeChangeTimeoutRef.current);
        modeChangeTimeoutRef.current = null;
      }

      modeChangeTimeoutRef.current = setTimeout(() => {
        setIsMultiline(shouldBeMultiline);
        const form = textarea.closest('.chatkit-composer-form');
        if (form) {
          form.classList.toggle('is-multiline', shouldBeMultiline);
          form.classList.toggle('is-singleline', !shouldBeMultiline);
        }
        modeChangeTimeoutRef.current = null;
      }, 50);
    }

    return () => {
      if (modeChangeTimeoutRef.current) {
        clearTimeout(modeChangeTimeoutRef.current);
      }
    };
  }, [value, isMultiline, forceMultiline]);

  // Gérer l'ajout de fichiers
  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || !config?.attachments?.enabled) return;

    const attachConfig = config.attachments;
    const newAttachments: Attachment[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Vérifier le nombre max
      if (attachConfig.maxCount && attachments.length + newAttachments.length >= attachConfig.maxCount) {
        break;
      }

      // Valider le fichier
      const validation = validateFile(file, attachConfig);
      if (!validation.valid) {
        console.error(`[Composer] File validation failed: ${validation.error}`);
        continue;
      }

      const id = generateAttachmentId();
      const preview = await createFilePreview(file);
      const type = file.type.startsWith('image/') ? 'image' : 'file';

      newAttachments.push({
        id,
        file,
        type,
        preview: preview || undefined,
        status: 'pending',
      });
    }

    onAttachmentsChange([...attachments, ...newAttachments]);
  }, [attachments, config?.attachments, onAttachmentsChange]);

  // Supprimer un attachment
  const removeAttachment = useCallback((id: string) => {
    onAttachmentsChange(attachments.filter(att => att.id !== id));
  }, [attachments, onAttachmentsChange]);

  // Handlers pour le drag and drop
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    if (!config?.attachments?.enabled) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileSelect(files);
    }
  }, [config?.attachments?.enabled, handleFileSelect]);

  // Soumettre le message
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const message = value.trim();
    const hasContent = message || attachments.length > 0;

    if (!hasContent || isLoading) return;

    try {
      // Upload des attachments d'abord
      if (attachments.length > 0 && apiConfig?.url) {
        for (const att of attachments) {
          onAttachmentsChange(attachments.map(a =>
            a.id === att.id ? { ...a, status: 'uploading' as const } : a
          ));

          try {
            await uploadAttachment({
              url: apiConfig.url,
              headers: apiConfig.headers,
              attachmentId: att.id,
              file: att.file,
            });

            onAttachmentsChange(attachments.map(a =>
              a.id === att.id ? { ...a, status: 'uploaded' as const } : a
            ));
          } catch (err) {
            onAttachmentsChange(attachments.map(a =>
              a.id === att.id ? { ...a, status: 'error' as const, error: String(err) } : a
            ));
          }
        }
      }

      // Soumettre le message
      await onSubmit(message, attachments);
    } catch (error) {
      console.error('[Composer] Failed to send message:', error);
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

  const canSubmit = (value.trim() || attachments.length > 0) && !isLoading && !isDisabled;
  const attachmentsEnabled = config?.attachments?.enabled || config?.attachments !== false;

  return (
    <>
      {/* Composer */}
      <div
        className={`chatkit-composer ${isDragging ? 'is-dragging' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Drop overlay */}
        {isDragging && config?.attachments?.enabled && (
          <div className="chatkit-drop-overlay">
            <div className="chatkit-drop-overlay-content">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <span>Déposez vos fichiers ici</span>
            </div>
          </div>
        )}
        <form
          onSubmit={handleSubmit}
          className={`chatkit-composer-form ${isModelSelectorEnabled && availableModels.length > 0 ? 'is-multiline' : 'is-singleline'}${attachments.length > 0 ? ' has-attachments' : ''}`}
        >
          {/* Attachments preview inside form */}
          {attachments.length > 0 && (
            <div className="chatkit-attachments-preview">
              {attachments.map(att => (
                <div key={att.id} className={`chatkit-attachment chatkit-attachment-${att.status}`}>
                  {att.preview && <ImageWithBlobUrl src={att.preview} alt={att.file.name} />}
                  {!att.preview && (
                    <div className="chatkit-attachment-icon">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                      </svg>
                    </div>
                  )}
                  <div className="chatkit-attachment-name">{att.file.name}</div>
                  <button
                    type="button"
                    className="chatkit-attachment-remove"
                    onClick={() => removeAttachment(att.id)}
                    aria-label="Supprimer"
                  >
                    ×
                  </button>
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
                  onChange={(e) => handleFileSelect(e.target.files)}
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
