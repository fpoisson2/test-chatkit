import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../auth';
import { useUsers } from '../../hooks/useUsers';
import { workflowsApi, type WorkflowShare, type EditableUser } from '../../utils/backend';
import type { WorkflowSummary } from '../../types/workflows';
import styles from './ShareWorkflowModal.module.css';

export interface ShareWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  workflow: WorkflowSummary | null;
  onSharesUpdated?: () => void;
}

/**
 * Modal for sharing a workflow with other users
 */
export function ShareWorkflowModal({
  isOpen,
  onClose,
  workflow,
  onSharesUpdated,
}: ShareWorkflowModalProps): JSX.Element | null {
  const { token } = useAuth();
  const { data: users = [], isLoading: usersLoading } = useUsers(token);
  const [shares, setShares] = useState<WorkflowShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [addingUserId, setAddingUserId] = useState<number | null>(null);
  const [updatingShareId, setUpdatingShareId] = useState<number | null>(null);
  const [deletingShareId, setDeletingShareId] = useState<number | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load shares when modal opens
  useEffect(() => {
    if (isOpen && workflow && token) {
      setSharesLoading(true);
      workflowsApi.listShares(token, workflow.id)
        .then(setShares)
        .catch((err) => console.error('Failed to load shares:', err))
        .finally(() => setSharesLoading(false));
    }
  }, [isOpen, workflow, token]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Reset search when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setShares([]);
    }
  }, [isOpen]);

  // Get shared user IDs for filtering
  const sharedUserIds = shares.map((share) => share.user_id);

  // Filter out already shared users
  const availableUsers = users.filter(
    (user) => !sharedUserIds.includes(user.id)
  );

  // Filter by search query
  const filteredUsers = availableUsers.filter((user) => {
    const query = searchQuery.toLowerCase();
    const email = user.email.toLowerCase();
    return email.includes(query);
  });

  const handleAddShare = useCallback(async (user: EditableUser, permission: 'read' | 'write') => {
    if (!token || !workflow) return;

    setAddingUserId(user.id);
    try {
      const newShare = await workflowsApi.createShare(token, workflow.id, user.id, permission);
      setShares((prev) => [...prev, newShare]);
      setSearchQuery('');
      onSharesUpdated?.();
    } catch (err) {
      console.error('Failed to add share:', err);
    } finally {
      setAddingUserId(null);
    }
  }, [token, workflow, onSharesUpdated]);

  const handleUpdateShare = useCallback(async (share: WorkflowShare, permission: 'read' | 'write') => {
    if (!token || !workflow) return;

    setUpdatingShareId(share.id);
    try {
      const updatedShare = await workflowsApi.updateShare(token, workflow.id, share.id, permission);
      setShares((prev) => prev.map((s) => s.id === share.id ? updatedShare : s));
      onSharesUpdated?.();
    } catch (err) {
      console.error('Failed to update share:', err);
    } finally {
      setUpdatingShareId(null);
    }
  }, [token, workflow, onSharesUpdated]);

  const handleDeleteShare = useCallback(async (share: WorkflowShare) => {
    if (!token || !workflow) return;

    setDeletingShareId(share.id);
    try {
      await workflowsApi.deleteShare(token, workflow.id, share.id);
      setShares((prev) => prev.filter((s) => s.id !== share.id));
      onSharesUpdated?.();
    } catch (err) {
      console.error('Failed to delete share:', err);
    } finally {
      setDeletingShareId(null);
    }
  }, [token, workflow, onSharesUpdated]);

  // Get initials for avatar
  const getInitials = (email: string): string => {
    const name = email.split('@')[0];
    return name.substring(0, 2).toUpperCase();
  };

  // Generate color from user id
  const getAvatarColor = (userId: number): string => {
    const colors = [
      '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
      '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
    ];
    return colors[userId % colors.length];
  };

  if (!isOpen || !workflow) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} ref={modalRef}>
        <div className={styles.header}>
          <h3 className={styles.title}>Partager "{workflow.display_name}"</h3>
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Fermer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Current shares */}
        {shares.length > 0 && (
          <div className={styles.section}>
            <h4 className={styles.sectionTitle}>Utilisateurs avec acces</h4>
            <div className={styles.sharesList}>
              {sharesLoading ? (
                <div className={styles.loading}>Chargement...</div>
              ) : (
                shares.map((share) => (
                  <div key={share.id} className={styles.shareItem}>
                    <div
                      className={styles.avatar}
                      style={{ backgroundColor: getAvatarColor(share.user_id) }}
                    >
                      {getInitials(share.user.email)}
                    </div>
                    <div className={styles.shareInfo}>
                      <span className={styles.shareEmail}>{share.user.email}</span>
                    </div>
                    <select
                      className={styles.permissionSelect}
                      value={share.permission}
                      onChange={(e) => handleUpdateShare(share, e.target.value as 'read' | 'write')}
                      disabled={updatingShareId === share.id || deletingShareId === share.id}
                    >
                      <option value="read">Lecture</option>
                      <option value="write">Lecture/Ecriture</option>
                    </select>
                    <button
                      className={styles.removeButton}
                      onClick={() => handleDeleteShare(share)}
                      disabled={deletingShareId === share.id}
                      aria-label="Supprimer le partage"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Add new share */}
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Ajouter un utilisateur</h4>
          <div className={styles.searchBox}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              ref={inputRef}
              type="text"
              placeholder="Rechercher un utilisateur..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
            />
          </div>

          <div className={styles.usersList}>
            {usersLoading ? (
              <div className={styles.loading}>Chargement...</div>
            ) : filteredUsers.length === 0 ? (
              <div className={styles.empty}>
                {searchQuery
                  ? "Aucun utilisateur trouve"
                  : availableUsers.length === 0
                  ? "Tous les utilisateurs ont deja acces"
                  : "Aucun utilisateur disponible"}
              </div>
            ) : (
              filteredUsers.slice(0, 5).map((user) => (
                <div key={user.id} className={styles.userItem}>
                  <div
                    className={styles.avatar}
                    style={{ backgroundColor: getAvatarColor(user.id) }}
                  >
                    {getInitials(user.email)}
                  </div>
                  <div className={styles.userInfo}>
                    <span className={styles.userEmail}>{user.email}</span>
                  </div>
                  <div className={styles.addButtons}>
                    <button
                      className={styles.addButton}
                      onClick={() => handleAddShare(user, 'read')}
                      disabled={addingUserId === user.id}
                      title="Ajouter en lecture"
                    >
                      Lecture
                    </button>
                    <button
                      className={`${styles.addButton} ${styles.addButtonWrite}`}
                      onClick={() => handleAddShare(user, 'write')}
                      disabled={addingUserId === user.id}
                      title="Ajouter en lecture/ecriture"
                    >
                      Ecriture
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShareWorkflowModal;
