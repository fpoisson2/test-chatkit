import { ChevronDown } from "lucide-react";
import type { CSSProperties } from "react";
import styles from "../../WorkflowBuilderPage.module.css";

export interface BlockLibraryItem {
  key: string;
  label: string;
  shortLabel: string;
  color: string;
  onClick: () => void;
}

interface BlockLibraryPanelProps {
  isMobileLayout: boolean;
  isOpen: boolean;
  items: BlockLibraryItem[];
  loading: boolean;
  selectedWorkflowId: number | null;
  onToggle?: () => void;
  toggleRef?: React.RefObject<HTMLButtonElement>;
  scrollRef?: React.RefObject<HTMLDivElement>;
  itemRefs?: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  onItemRefSet?: (key: string, node: HTMLDivElement | null) => void;
  contentId?: string;
}

const getBlockLibraryButtonStyle = (disabled: boolean): CSSProperties => ({
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: "0.85rem",
  padding: "0.95rem 1.15rem",
  border: "1px solid var(--surface-border)",
  borderRadius: "1rem",
  background: disabled ? "var(--surface-muted)" : "var(--surface-strong)",
  cursor: disabled ? "not-allowed" : "pointer",
  transition: "all 160ms cubic-bezier(0.4, 0, 0.2, 1)",
  opacity: disabled ? 0.55 : 1,
  boxShadow: disabled ? "none" : "0 2px 8px rgba(15, 23, 42, 0.04)",
});

/**
 * Block library panel component - displays available node types
 * Handles both mobile (scrollable with animations) and desktop (collapsible) layouts
 */
export const BlockLibraryPanel = ({
  isMobileLayout,
  isOpen,
  items,
  loading,
  selectedWorkflowId,
  onToggle,
  toggleRef,
  scrollRef,
  itemRefs,
  onItemRefSet,
  contentId = "block-library-content",
}: BlockLibraryPanelProps) => {
  const disabled = loading || !selectedWorkflowId;

  if (isMobileLayout) {
    return (
      <div className={styles.blockLibraryContent}>
        <div
          ref={scrollRef}
          className={styles.blockLibraryScroller}
          role="list"
          aria-label="Blocs disponibles"
        >
          {items.map((item) => (
            <div
              key={item.key}
              role="listitem"
              className={styles.blockLibraryItemWrapper}
              ref={(node) => {
                if (itemRefs && node) {
                  itemRefs.current[item.key] = node;
                } else if (itemRefs) {
                  delete itemRefs.current[item.key];
                }
                onItemRefSet?.(item.key, node);
              }}
            >
              <button
                type="button"
                onClick={() => item.onClick()}
                disabled={disabled}
                style={getBlockLibraryButtonStyle(disabled)}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: "2.85rem",
                    height: "2.85rem",
                    borderRadius: "0.95rem",
                    background: item.color,
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                    fontWeight: 700,
                    fontSize: "1.25rem",
                  }}
                >
                  {item.shortLabel}
                </span>
                <span
                  style={{
                    fontSize: "1.05rem",
                    fontWeight: 600,
                    lineHeight: 1.1,
                  }}
                >
                  {item.label}
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Desktop layout
  const primaryTextColor = "var(--text-color)";

  return (
    <div className={styles.blockLibraryDesktopContent}>
      <div className={styles.blockLibraryDesktopHeader}>
        <span>Bibliothèque de blocs</span>
        <button
          type="button"
          ref={toggleRef}
          className={styles.blockLibraryDesktopToggle}
          onClick={onToggle}
          aria-controls={contentId}
          aria-expanded={isOpen}
        >
          <span className={styles.srOnly}>
            {isOpen ? "Masquer la bibliothèque de blocs" : "Afficher la bibliothèque de blocs"}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={styles.blockLibraryDesktopToggleIcon}
            data-expanded={isOpen ? "true" : "false"}
            size={18}
          />
        </button>
      </div>
      <div
        id={contentId}
        className={styles.blockLibraryDesktopScroller}
        role="list"
        aria-label="Blocs disponibles"
        hidden={!isOpen}
      >
        {isOpen
          ? items.map((item) => (
              <div key={item.key} className={styles.blockLibraryDesktopItem} role="listitem">
                <button
                  type="button"
                  onClick={() => item.onClick()}
                  disabled={disabled}
                  style={getBlockLibraryButtonStyle(disabled)}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: "2.35rem",
                      height: "2.35rem",
                      borderRadius: "0.75rem",
                      background: item.color,
                      color: "#fff",
                      display: "grid",
                      placeItems: "center",
                      fontWeight: 700,
                      fontSize: "1.05rem",
                    }}
                  >
                    {item.shortLabel}
                  </span>
                  <div style={{ textAlign: "left", color: primaryTextColor }}>
                    <strong style={{ fontSize: "1rem" }}>{item.label}</strong>
                  </div>
                </button>
              </div>
            ))
          : null}
      </div>
    </div>
  );
};
