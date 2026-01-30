/**
 * Visual badge indicator showing the current branch when not on main
 */
import React from 'react';
import { MAIN_BRANCH_ID } from '../types';
import { useI18n } from '../../i18n/I18nProvider';

export interface BranchIndicatorProps {
  /** Current branch ID */
  currentBranchId: string;
  /** Optional branch name */
  branchName?: string | null;
  /** Callback when clicking the indicator */
  onClick?: () => void;
}

export function BranchIndicator({
  currentBranchId,
  branchName,
  onClick,
}: BranchIndicatorProps): JSX.Element | null {
  const { t } = useI18n();

  // Don't show indicator for the main branch
  if (currentBranchId === MAIN_BRANCH_ID) {
    return null;
  }

  const displayName = branchName || currentBranchId;

  return (
    <button
      type="button"
      className="chatkit-branch-indicator"
      onClick={onClick}
      title={t('chatkit.branches.viewingBranch') || 'Viewing branch'}
    >
      <svg
        className="chatkit-branch-indicator-icon"
        width="14"
        height="14"
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
      <span className="chatkit-branch-indicator-name">{displayName}</span>
    </button>
  );
}
