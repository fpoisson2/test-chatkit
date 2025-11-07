import { ChevronDown } from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import styles from "../WorkflowBuilderPage.module.css";
import { useUIContext } from "../contexts/UIContext";
import { useWorkflowContext } from "../contexts/WorkflowContext";

export interface BlockLibraryItem {
  key: string;
  label: string;
  shortLabel: string;
  color: string;
  onClick: () => void;
}

// Phase 4.5: Reduced from 8 props to 3 props (-62.5%)
// Migrated to contexts:
// - isOpen → UIContext.isBlockLibraryOpen
// - isMobileLayout → UIContext.isMobileLayout
// - toggleBlockLibrary → UIContext.toggleBlockLibrary
// - loading → WorkflowContext.loading
// - selectedWorkflowId → WorkflowContext.selectedWorkflowId
export interface BlockLibraryProps {
  contentId: string;
  items: BlockLibraryItem[];
  toggleRef: RefObject<HTMLButtonElement>;
}

export interface BlockLibraryTransform {
  arcOffset: number;
  opacity: number;
  scale: number;
  zIndex: number;
}

export const calculateBlockLibraryTransform = (
  distance: number,
  maxDistance: number,
): BlockLibraryTransform => {
  const safeMaxDistance = Math.max(maxDistance, 1);
  const normalized = Math.min(distance / safeMaxDistance, 1);
  const eased = 1 - Math.pow(normalized, 1.6);

  const scale = 0.82 + eased * 0.38;
  const arcOffset = Math.pow(normalized, 1.5) * 32;
  const opacity = 0.55 + eased * 0.45;
  const zIndex = 100 + Math.round(eased * 100);

  return { arcOffset, opacity, scale, zIndex };
};

const getBlockLibraryButtonStyle = (
  isMobileLayout: boolean,
  disabled: boolean,
): CSSProperties => {
  if (isMobileLayout) {
    return {
      display: "flex",
      alignItems: "center",
      gap: "1rem",
      padding: "1.15rem 1.1rem",
      border: "none",
      background: "rgba(15, 23, 42, 0.28)",
      borderRadius: "1.1rem",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.45 : 1,
      width: "100%",
      textAlign: "left",
      transition: "background 0.3s ease, transform 0.3s ease",
      color: "#f8fafc",
    } satisfies CSSProperties;
  }

  return {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.5rem 0",
    border: "none",
    background: "transparent",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    width: "100%",
    textAlign: "left",
  } satisfies CSSProperties;
};

const BlockLibrary = ({
  contentId,
  items,
  toggleRef,
}: BlockLibraryProps) => {
  // Phase 4.5: Use contexts instead of props
  const { isBlockLibraryOpen: isOpen, isMobileLayout, toggleBlockLibrary } = useUIContext();
  const { loading, selectedWorkflowId } = useWorkflowContext();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement>>({});
  const animationFrameRef = useRef<number | null>(null);

  const updateTransforms = useCallback(() => {
    if (!isMobileLayout || typeof window === "undefined") {
      return;
    }

    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    if (containerRect.height === 0) {
      return;
    }

    const containerCenter = containerRect.top + containerRect.height / 2;
    const maxDistance = Math.max(containerRect.height / 2, 1);

    items.forEach((item) => {
      const element = itemRefs.current[item.key];
      if (!element) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const elementCenter = rect.top + rect.height / 2;
      const distance = Math.abs(elementCenter - containerCenter);
      const { arcOffset, opacity, scale, zIndex } = calculateBlockLibraryTransform(
        distance,
        maxDistance,
      );

      element.style.transform = `translateX(${arcOffset}px) scale(${scale})`;
      element.style.opacity = opacity.toFixed(3);
      element.style.zIndex = String(zIndex);
    });
  }, [isMobileLayout, items]);

  const scheduleTransformUpdate = useCallback(() => {
    if (!isMobileLayout || typeof window === "undefined") {
      return;
    }

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      updateTransforms();
      animationFrameRef.current = null;
    });
  }, [isMobileLayout, updateTransforms]);

  useEffect(() => {
    if (!isMobileLayout || !isOpen) {
      return undefined;
    }

    const container = scrollRef.current;
    if (!container) {
      return undefined;
    }

    const handleScroll = () => {
      scheduleTransformUpdate();
    };

    scheduleTransformUpdate();

    container.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [isMobileLayout, isOpen, scheduleTransformUpdate]);

  useEffect(() => {
    if (!isMobileLayout || !isOpen || typeof document === "undefined") {
      return undefined;
    }

    const { style } = document.body;
    const previousOverflow = style.overflow;
    style.overflow = "hidden";

    return () => {
      style.overflow = previousOverflow;
    };
  }, [isMobileLayout, isOpen]);

  useEffect(() => {
    if (!isMobileLayout || !isOpen) {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    scheduleTransformUpdate();

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isMobileLayout, isOpen, items, scheduleTransformUpdate]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, []);

  const primaryTextColor = useMemo(() => (isMobileLayout ? "#f8fafc" : "var(--text-color)"), [
    isMobileLayout,
  ]);

  if (isMobileLayout) {
    return (
      <div className={styles.blockLibraryContent}>
        <div
          ref={(element) => {
            scrollRef.current = element;
            if (element && isOpen) {
              scheduleTransformUpdate();
            }
          }}
          className={styles.blockLibraryScroller}
          role="list"
          aria-label="Blocs disponibles"
        >
          {items.map((item) => {
            const disabled = loading || selectedWorkflowId == null;
            return (
              <div
                key={item.key}
                role="listitem"
                className={styles.blockLibraryItemWrapper}
                ref={(node) => {
                  if (node) {
                    itemRefs.current[item.key] = node;
                    scheduleTransformUpdate();
                  } else {
                    delete itemRefs.current[item.key];
                  }
                }}
              >
                <button
                  type="button"
                  onClick={() => item.onClick()}
                  disabled={disabled}
                  style={getBlockLibraryButtonStyle(isMobileLayout, disabled)}
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
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.blockLibraryDesktopContent}>
      <div className={styles.blockLibraryDesktopHeader}>
        <span>Bibliothèque de blocs</span>
        <button
          type="button"
          ref={toggleRef}
          className={styles.blockLibraryDesktopToggle}
          onClick={toggleBlockLibrary}
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
          ? items.map((item) => {
              const disabled = loading || selectedWorkflowId == null;
              return (
                <div key={item.key} className={styles.blockLibraryDesktopItem} role="listitem">
                  <button
                    type="button"
                    onClick={() => item.onClick()}
                    disabled={disabled}
                    style={getBlockLibraryButtonStyle(isMobileLayout, disabled)}
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
              );
            })
          : null}
      </div>
    </div>
  );
};

export default BlockLibrary;
