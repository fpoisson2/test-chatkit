import type { CSSProperties } from "react";

export const inspectorHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
  marginBottom: "1rem",
};

export const inspectorTitleStyle: CSSProperties = {
  fontSize: "1rem",
  fontWeight: 700,
  color: "var(--color-text-strong)",
};

export const inspectorSubtitleStyle: CSSProperties = {
  fontSize: "0.85rem",
  color: "var(--text-muted)",
};

export const deleteButtonStyle: CSSProperties = {
  border: "1px solid rgba(220, 38, 38, 0.25)",
  backgroundColor: "rgba(220, 38, 38, 0.12)",
  color: "#b91c1c",
  borderRadius: "9999px",
  padding: "0.35rem",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  boxShadow: "0 6px 14px rgba(220, 38, 38, 0.2)",
  transition: "background-color 150ms ease, transform 150ms ease",
};

export const deleteButtonIconStyle: CSSProperties = {
  width: "1.1rem",
  height: "1.1rem",
};

export const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  marginTop: "0.75rem",
};

export const inlineFieldStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  alignItems: "center",
  gap: "0.75rem",
  marginTop: "0.75rem",
};

export const toggleRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
};

export const labelContentStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.35rem",
  fontWeight: 600,
  color: "var(--color-text-strong)",
};
