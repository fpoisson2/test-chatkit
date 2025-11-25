import React from 'react';

export interface HeaderAction {
  icon: string;
  onClick: () => void;
}

export interface HeaderConfig {
  enabled?: boolean;
  leftAction?: HeaderAction;
}

export interface HeaderProps {
  config?: HeaderConfig | false;
  title: string;
  showNewThreadButton?: boolean;
  showHistoryButton?: boolean;
  showAddUserButton?: boolean;
  onNewThread: () => void;
  onToggleHistory: () => void;
  onAddUser?: () => void;
}

/**
 * Chat header component with title and action buttons
 */
export function Header({
  config,
  title,
  showNewThreadButton = true,
  showHistoryButton = true,
  showAddUserButton = false,
  onNewThread,
  onToggleHistory,
  onAddUser,
}: HeaderProps): JSX.Element | null {
  // Don't render if header is disabled
  if (config === false || config?.enabled === false) {
    return null;
  }

  return (
    <div className="chatkit-header">
      {config?.leftAction && (
        <button
          className="chatkit-header-action"
          onClick={config.leftAction.onClick}
          aria-label={config.leftAction.icon}
        >
          {config.leftAction.icon === 'menu' ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          ) : config.leftAction.icon}
        </button>
      )}
      <div className="chatkit-header-title">{title}</div>
      <div className="chatkit-header-actions">
        <button
          className="chatkit-header-action"
          disabled={!showNewThreadButton}
          onClick={onNewThread}
          aria-label="Nouvelle conversation"
          title="Nouvelle conversation"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14"></path>
          </svg>
        </button>
        {showAddUserButton && onAddUser && (
          <button
            className="chatkit-header-action"
            onClick={onAddUser}
            aria-label="Ajouter un utilisateur"
            title="Ajouter un utilisateur à la conversation"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="8.5" cy="7" r="4"></circle>
              <line x1="20" y1="8" x2="20" y2="14"></line>
              <line x1="23" y1="11" x2="17" y2="11"></line>
            </svg>
          </button>
        )}
        {showHistoryButton && (
          <button
            className="chatkit-header-action"
            onClick={onToggleHistory}
            aria-label="Historique"
            title="Historique des conversations"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
