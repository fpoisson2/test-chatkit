import { useMemo, type CSSProperties } from "react";
import { useSaveContext } from "../contexts";

/**
 * WorkflowBuilderToast displays save status notifications
 * Uses SaveContext to access save state and message
 */
export default function WorkflowBuilderToast() {
  const { saveState, saveMessage } = useSaveContext();

  const toastStyles = useMemo<CSSProperties>(() => {
    switch (saveState) {
      case "error":
        return {
          background: "rgba(239, 68, 68, 0.18)",
          color: "#b91c1c",
          border: "1px solid rgba(248, 113, 113, 0.35)",
        };
      case "saving":
        return {
          background: "rgba(14, 165, 233, 0.18)",
          color: "#0369a1",
          border: "1px solid rgba(56, 189, 248, 0.35)",
        };
      case "saved":
        return {
          background: "rgba(34, 197, 94, 0.18)",
          color: "#15803d",
          border: "1px solid rgba(74, 222, 128, 0.35)",
        };
      default:
        return {
          background: "rgba(100, 116, 139, 0.18)",
          color: "#475569",
          border: "1px solid rgba(148, 163, 184, 0.35)",
        };
    }
  }, [saveState]);

  if (!saveMessage) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        bottom: "1.5rem",
        left: "50%",
        transform: "translateX(-50%)",
        padding: "0.65rem 1.25rem",
        borderRadius: "9999px",
        boxShadow: "0 12px 28px rgba(15, 23, 42, 0.12)",
        zIndex: 30,
        ...toastStyles,
      }}
      role={saveState === "error" ? "alert" : "status"}
    >
      {saveMessage}
    </div>
  );
}
