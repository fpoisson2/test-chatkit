import { memo, useMemo, type CSSProperties } from "react";
import type { SaveState } from "../../types";

interface SaveToastProps {
  saveState: SaveState;
  saveMessage: string | null;
}

/**
 * Toast notification component for save/deploy status messages
 * Memoized to prevent unnecessary re-renders
 */
const SaveToastComponent = ({ saveState, saveMessage }: SaveToastProps) => {
  const toastStyles = useMemo(() => {
    switch (saveState) {
      case "error":
        return {
          background: "rgba(239, 68, 68, 0.18)",
          color: "#b91c1c",
          border: "1px solid rgba(248, 113, 113, 0.35)",
        } as const;
      case "saving":
        return {
          background: "rgba(14, 165, 233, 0.18)",
          color: "#0284c7",
          border: "1px solid rgba(56, 189, 248, 0.35)",
        } as const;
      case "saved":
        return {
          background: "rgba(34, 197, 94, 0.18)",
          color: "#15803d",
          border: "1px solid rgba(74, 222, 128, 0.35)",
        } as const;
      default:
        return {
          background: "var(--color-surface-subtle)",
          color: "var(--text-color)",
          border: "1px solid var(--surface-border)",
        } as const;
    }
  }, [saveState]);

  if (!saveMessage) {
    return null;
  }

  const containerStyle: CSSProperties = {
    position: "absolute",
    bottom: "1.5rem",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "0.65rem 1.25rem",
    borderRadius: "9999px",
    boxShadow: "0 12px 28px rgba(15, 23, 42, 0.12)",
    zIndex: 30,
    ...toastStyles,
  };

  return (
    <div style={containerStyle} role={saveState === "error" ? "alert" : "status"}>
      {saveMessage}
    </div>
  );
};

/**
 * Memoized SaveToast component
 * Only re-renders when saveState or saveMessage changes
 */
export const SaveToast = memo(SaveToastComponent);
