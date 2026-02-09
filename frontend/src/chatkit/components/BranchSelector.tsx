/**
 * Dropdown selector for switching between conversation branches
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { Branch } from '../types';
import { MAIN_BRANCH_ID } from '../types';
import { useI18n } from '../../i18n/I18nProvider';

export interface BranchSelectorProps {
  /** List of available branches */
  branches: Branch[];
  /** Current active branch ID */
  currentBranchId: string;
  /** Maximum allowed branches (0 = unlimited) */
  maxBranches: number;
  /** Whether the selector should be disabled */
  disabled?: boolean;
  /** Callback when a branch is selected */
  onSwitchBranch: (branchId: string) => void;
}

export function BranchSelector({
  branches,
  currentBranchId,
  maxBranches,
  disabled = false,
  onSwitchBranch,
}: BranchSelectorProps): JSX.Element | null {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      } else if (e.key === 'Enter' || e.key === ' ') {
        setIsOpen((prev) => !prev);
      }
    },
    []
  );

  // Don't show if there's only the main branch
  if (branches.length <= 1) {
    return null;
  }

  const numberedBranches = branches.filter((branch) => branch.branch_id !== MAIN_BRANCH_ID);
  const branchIndexMap = new Map(
    numberedBranches.map((branch, index) => [branch.branch_id, index + 1])
  );

  const getBranchLabel = (branch: Branch): string => {
    if (branch.name) {
      return branch.name;
    }

    if (branch.branch_id === MAIN_BRANCH_ID) {
      return t('chatkit.branches.main') || 'Main';
    }

    const branchNumber = branchIndexMap.get(branch.branch_id);
    if (branchNumber) {
      return t('chatkit.branches.numbered', { number: branchNumber }) || `Branch #${branchNumber}`;
    }

    return branch.branch_id;
  };

  // Get the current branch info
  const currentBranch = branches.find((b) => b.branch_id === currentBranchId);
  const currentBranchName = currentBranch ? getBranchLabel(currentBranch) : currentBranchId;

  // Format branch count
  const branchCountDisplay = maxBranches > 0
    ? `${branches.length}/${maxBranches}`
    : `${branches.length}`;

  return (
    <div
      ref={containerRef}
      className="chatkit-branch-selector"
      role="combobox"
      aria-expanded={isOpen}
      aria-haspopup="listbox"
    >
      <button
        type="button"
        className="chatkit-branch-selector-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-label={t('chatkit.branches.selectBranch') || 'Select branch'}
      >
        <svg
          className="chatkit-branch-selector-icon"
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
        <span className="chatkit-branch-selector-name">{currentBranchName}</span>
        <span className="chatkit-branch-selector-count">({branchCountDisplay})</span>
        <svg
          className="chatkit-branch-selector-chevron"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {isOpen && (
        <div
          className="chatkit-branch-selector-dropdown"
          role="listbox"
          aria-label={t('chatkit.branches.availableBranches') || 'Available branches'}
        >
          {branches.map((branch) => {
            const isSelected = branch.branch_id === currentBranchId;
            const displayName = getBranchLabel(branch);

            return (
              <button
                key={branch.branch_id}
                type="button"
                className={`chatkit-branch-selector-option ${isSelected ? 'chatkit-branch-selector-option-selected' : ''}`}
                onClick={() => {
                  onSwitchBranch(branch.branch_id);
                  setIsOpen(false);
                }}
                role="option"
                aria-selected={isSelected}
              >
                <span className="chatkit-branch-selector-option-name">
                  {displayName}
                  {branch.is_default && (
                    <span className="chatkit-branch-selector-option-default">
                      ({t('chatkit.branches.default') || 'default'})
                    </span>
                  )}
                </span>
                {isSelected && (
                  <svg
                    className="chatkit-branch-selector-option-check"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
