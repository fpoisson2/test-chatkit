/**
 * Modal for editing a message and creating a new branch
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useI18n } from '../../i18n/I18nProvider';

export interface EditMessageModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Original message content */
  originalContent: string;
  /** Callback when the modal is closed */
  onClose: () => void;
  /** Callback when the user wants to create a branch with edited content */
  onCreateBranch: (editedContent: string, branchName?: string) => void;
  /** Whether branch creation is in progress */
  isLoading?: boolean;
}

export function EditMessageModal({
  isOpen,
  originalContent,
  onClose,
  onCreateBranch,
  isLoading = false,
}: EditMessageModalProps): JSX.Element | null {
  const { t } = useI18n();
  const [editedContent, setEditedContent] = useState(originalContent);
  const [branchName, setBranchName] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset content when modal opens
  useEffect(() => {
    if (isOpen) {
      setEditedContent(originalContent);
      setBranchName('');
      // Focus textarea after a short delay
      setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      }, 100);
    }
  }, [isOpen, originalContent]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        if (editedContent.trim() && editedContent !== originalContent) {
          onCreateBranch(editedContent, branchName || undefined);
        }
      }
    },
    [editedContent, originalContent, branchName, onClose, onCreateBranch]
  );

  // Handle submit
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (editedContent.trim() && editedContent !== originalContent && !isLoading) {
        onCreateBranch(editedContent, branchName || undefined);
      }
    },
    [editedContent, originalContent, branchName, isLoading, onCreateBranch]
  );

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) {
    return null;
  }

  const canSubmit = editedContent.trim() && editedContent !== originalContent && !isLoading;

  return (
    <div
      className="chatkit-edit-modal-backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-modal-title"
    >
      <div className="chatkit-edit-modal">
        <div className="chatkit-edit-modal-header">
          <h3 id="edit-modal-title" className="chatkit-edit-modal-title">
            {t('chatkit.editMessage.title') || 'Edit Message'}
          </h3>
          <button
            type="button"
            className="chatkit-edit-modal-close"
            onClick={onClose}
            aria-label={t('chatkit.editMessage.close') || 'Close'}
          >
            <svg
              width="20"
              height="20"
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

        <form onSubmit={handleSubmit}>
          <div className="chatkit-edit-modal-body">
            <p className="chatkit-edit-modal-description">
              {t('chatkit.editMessage.description') ||
                'Edit your message below. This will create a new conversation branch.'}
            </p>

            <textarea
              ref={textareaRef}
              className="chatkit-edit-modal-textarea"
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              placeholder={t('chatkit.editMessage.placeholder') || 'Enter your message...'}
              rows={5}
              disabled={isLoading}
            />

            <div className="chatkit-edit-modal-branch-name">
              <label htmlFor="branch-name" className="chatkit-edit-modal-label">
                {t('chatkit.editMessage.branchNameLabel') || 'Branch name (optional)'}
              </label>
              <input
                id="branch-name"
                type="text"
                className="chatkit-edit-modal-input"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder={t('chatkit.editMessage.branchNamePlaceholder') || 'e.g., Alternative approach'}
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="chatkit-edit-modal-footer">
            <button
              type="button"
              className="chatkit-edit-modal-button chatkit-edit-modal-button-secondary"
              onClick={onClose}
              disabled={isLoading}
            >
              {t('chatkit.editMessage.cancel') || 'Cancel'}
            </button>
            <button
              type="submit"
              className="chatkit-edit-modal-button chatkit-edit-modal-button-primary"
              disabled={!canSubmit}
            >
              {isLoading ? (
                <span className="chatkit-edit-modal-loading">
                  <span className="chatkit-typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                </span>
              ) : (
                t('chatkit.editMessage.createBranch') || 'Create Branch'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
