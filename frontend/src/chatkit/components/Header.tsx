import type { ReactNode } from 'react';

export interface HeaderAction {
  icon: string;
  onClick: () => void;
}

export interface HeaderConfig {
  enabled?: boolean;
  leftAction?: HeaderAction;
  customContent?: ReactNode;
}

export interface HeaderProps {
  config?: HeaderConfig | false;
  title: string;
  showNewThreadButton?: boolean;
  showHistoryButton?: boolean;
  onNewThread: () => void;
  onToggleHistory: () => void;
}

/**
 * Chat header component with title and action buttons
 */
export function Header({
  config,
  title,
  showNewThreadButton = true,
  showHistoryButton = true,
  onNewThread,
  onToggleHistory,
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
      {/* Custom content (e.g., workflow selector) or default title */}
      {config?.customContent ? (
        <div className="chatkit-header-custom">{config.customContent}</div>
      ) : (
        <div className="chatkit-header-title">{title}</div>
      )}
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
