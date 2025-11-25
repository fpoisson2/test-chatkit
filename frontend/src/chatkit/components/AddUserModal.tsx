import React, { useState, useEffect, useRef } from 'react';

export interface User {
  id: number;
  email: string;
  name?: string;
  avatar_url?: string;
}

export interface AddUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectUser: (user: User) => void;
  users: User[];
  isLoading?: boolean;
  currentParticipantIds?: number[];
  title?: string;
}

/**
 * Modal pour sélectionner un utilisateur à ajouter à la conversation
 */
export function AddUserModal({
  isOpen,
  onClose,
  onSelectUser,
  users,
  isLoading = false,
  currentParticipantIds = [],
  title = "Ajouter un participant",
}: AddUserModalProps): JSX.Element | null {
  const [searchQuery, setSearchQuery] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter out already added participants
  const availableUsers = users.filter(
    user => !currentParticipantIds.includes(user.id)
  );

  // Filter by search query
  const filteredUsers = availableUsers.filter(user => {
    const query = searchQuery.toLowerCase();
    const email = user.email.toLowerCase();
    const name = (user.name || '').toLowerCase();
    return email.includes(query) || name.includes(query);
  });

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
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectUser = (user: User) => {
    onSelectUser(user);
    onClose();
  };

  // Get display name for user
  const getDisplayName = (user: User): string => {
    if (user.name) return user.name;
    // Extract name from email (before @)
    return user.email.split('@')[0];
  };

  // Get initials for avatar
  const getInitials = (user: User): string => {
    const name = getDisplayName(user);
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

  return (
    <div className="chatkit-modal-overlay">
      <div className="chatkit-add-user-modal" ref={modalRef}>
        <div className="chatkit-add-user-modal-header">
          <h3 className="chatkit-add-user-modal-title">{title}</h3>
          <button
            className="chatkit-add-user-modal-close"
            onClick={onClose}
            aria-label="Fermer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="chatkit-add-user-modal-search">
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
            className="chatkit-add-user-modal-search-input"
          />
        </div>

        <div className="chatkit-add-user-modal-list">
          {isLoading ? (
            <div className="chatkit-add-user-modal-loading">
              Chargement...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="chatkit-add-user-modal-empty">
              {searchQuery
                ? "Aucun utilisateur trouvé"
                : availableUsers.length === 0
                ? "Tous les utilisateurs sont déjà participants"
                : "Aucun utilisateur disponible"}
            </div>
          ) : (
            filteredUsers.map((user) => (
              <button
                key={user.id}
                className="chatkit-add-user-modal-item"
                onClick={() => handleSelectUser(user)}
              >
                <div
                  className="chatkit-add-user-modal-avatar"
                  style={{
                    backgroundColor: user.avatar_url ? undefined : getAvatarColor(user.id),
                  }}
                >
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt="" />
                  ) : (
                    <span>{getInitials(user)}</span>
                  )}
                </div>
                <div className="chatkit-add-user-modal-user-info">
                  <span className="chatkit-add-user-modal-user-name">
                    {getDisplayName(user)}
                  </span>
                  <span className="chatkit-add-user-modal-user-email">
                    {user.email}
                  </span>
                </div>
                <svg className="chatkit-add-user-modal-add-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default AddUserModal;
