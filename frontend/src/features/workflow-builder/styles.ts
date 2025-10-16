import type { CSSProperties } from "react";

type DisabledOptions = {
  disabled?: boolean;
};

export const getHeaderContainerStyle = (isMobile: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: isMobile ? "space-between" : "flex-start",
  gap: isMobile ? "0.75rem" : "1.5rem",
  padding: isMobile ? "0.75rem 1rem" : "0.75rem 1.5rem",
  background: isMobile ? "transparent" : "#f8fafc",
  borderBottom: isMobile ? "none" : "1px solid rgba(15, 23, 42, 0.08)",
  zIndex: 10,
  width: "100%",
});

export const getHeaderNavigationButtonStyle = (isMobile: boolean): CSSProperties => ({
  width: "2.75rem",
  height: "2.75rem",
  borderRadius: "0.75rem",
  border: "1px solid rgba(15, 23, 42, 0.18)",
  background: "#f8fafc",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
  alignSelf: isMobile ? "flex-start" : "center",
});

export const getHeaderLayoutStyle = (isMobile: boolean): CSSProperties => ({
  display: "flex",
  alignItems: isMobile ? "stretch" : "center",
  flexDirection: isMobile ? "column" : "row",
  gap: isMobile ? "1rem" : "1.5rem",
  flex: 1,
  minWidth: 0,
  flexWrap: isMobile ? "wrap" : "nowrap",
  width: "100%",
});

export const getHeaderGroupStyle = (isMobile: boolean): CSSProperties => ({
  display: "flex",
  alignItems: isMobile ? "stretch" : "center",
  flexDirection: isMobile ? "column" : "row",
  gap: "0.75rem",
  minWidth: 0,
  flex: isMobile ? "1 1 auto" : undefined,
  width: isMobile ? "100%" : "auto",
});

const pointerState = (options?: DisabledOptions) => ({
  cursor: options?.disabled ? "not-allowed" : "pointer",
  opacity: options?.disabled ? 0.5 : 1,
});

export const getWorkflowSelectStyle = (
  isMobile: boolean,
  options?: DisabledOptions,
): CSSProperties => ({
  minWidth: isMobile ? undefined : "220px",
  maxWidth: isMobile ? "100%" : "340px",
  width: isMobile ? "100%" : undefined,
  padding: "0.5rem 0.75rem",
  borderRadius: "0.75rem",
  border: "1px solid rgba(15, 23, 42, 0.15)",
  background: "#fff",
  color: "#0f172a",
  fontWeight: 600,
  ...pointerState(options),
});

export const getCreateWorkflowButtonStyle = (
  isMobile: boolean,
  options?: DisabledOptions,
): CSSProperties => ({
  padding: "0.5rem 0.9rem",
  borderRadius: "0.75rem",
  border: "1px solid rgba(15, 23, 42, 0.15)",
  background: "#fff",
  color: "#0f172a",
  fontWeight: 600,
  whiteSpace: "nowrap",
  width: isMobile ? "100%" : "auto",
  ...pointerState(options),
});

export const getVersionSelectStyle = (
  isMobile: boolean,
  options?: DisabledOptions,
): CSSProperties => ({
  minWidth: isMobile ? undefined : "200px",
  width: isMobile ? "100%" : undefined,
  padding: "0.5rem 0.75rem",
  borderRadius: "0.75rem",
  border: "1px solid rgba(15, 23, 42, 0.15)",
  background: "#fff",
  color: "#0f172a",
  ...pointerState(options),
});

export const activeWorkflowBadgeStyle: CSSProperties = {
  color: "#047857",
  fontWeight: 600,
  fontSize: "0.85rem",
  whiteSpace: "nowrap",
};

export const getHeaderActionAreaStyle = (isMobile: boolean): CSSProperties => ({
  display: "flex",
  alignItems: isMobile ? "flex-start" : "center",
  gap: "0.5rem",
  width: isMobile ? "100%" : "auto",
  flexDirection: isMobile ? "column" : "row",
});

export const getMobileHeaderMenuButtonStyle = (
  options?: DisabledOptions & { active?: boolean },
): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.5rem",
  padding: "0.6rem 1rem",
  borderRadius: "0.75rem",
  border: "1px solid rgba(15, 23, 42, 0.15)",
  background: options?.active ? "#0f172a" : "#fff",
  color: options?.active ? "#fff" : "#0f172a",
  fontWeight: 600,
  ...pointerState(options),
});

export const mobileHeaderMenuIconStyle: CSSProperties = {
  fontSize: "1.35rem",
  lineHeight: 1,
};

export const getDeployButtonStyle = (
  isMobile: boolean,
  options?: DisabledOptions,
): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: "0.35rem",
  padding: 0,
  borderRadius: "0.75rem",
  border: "none",
  background: "none",
  backgroundColor: "transparent",
  appearance: "none",
  WebkitAppearance: "none",
  color: "#0f172a",
  fontWeight: 600,
  whiteSpace: "nowrap",
  width: "auto",
  alignSelf: isMobile ? "flex-start" : undefined,
  ...pointerState(options),
});

export const getActionMenuWrapperStyle = (isMobile: boolean): CSSProperties => ({
  position: "relative",
  width: "auto",
});

export const getActionMenuTriggerStyle = (isMobile: boolean): CSSProperties => ({
  display: isMobile ? "inline-flex" : "grid",
  alignItems: isMobile ? "center" : undefined,
  gap: isMobile ? "0.5rem" : undefined,
  borderRadius: "0.75rem",
  border: "none",
  background: "none",
  backgroundColor: "transparent",
  appearance: "none",
  WebkitAppearance: "none",
  color: "#0f172a",
  fontWeight: 600,
  cursor: "pointer",
  width: isMobile ? "auto" : "2.5rem",
  height: isMobile ? "auto" : "2.5rem",
  padding: 0,
  placeItems: isMobile ? undefined : "center",
  justifyContent: isMobile ? "flex-start" : "center",
  ...pointerState(),
});

export const actionMenuTriggerIconStyle: CSSProperties = {
  fontSize: "1.5rem",
  lineHeight: 1,
  color: "#0f172a",
};

export const actionMenuTriggerLabelStyle: CSSProperties = {
  fontSize: "0.95rem",
  fontWeight: 600,
  color: "#0f172a",
};

export const getActionMenuStyle = (isMobile: boolean): CSSProperties => ({
  position: "absolute",
  top: "calc(100% + 0.5rem)",
  right: isMobile ? undefined : 0,
  left: isMobile ? 0 : undefined,
  background: "#fff",
  borderRadius: "0.75rem",
  border: "1px solid rgba(15, 23, 42, 0.1)",
  boxShadow: "0 20px 40px rgba(15, 23, 42, 0.12)",
  padding: "0.5rem",
  minWidth: isMobile ? "100%" : "220px",
  width: isMobile ? "100%" : "auto",
  zIndex: 30,
});

export const getActionMenuItemStyle = (
  isMobile: boolean,
  options?: DisabledOptions & { danger?: boolean },
): CSSProperties => ({
  width: "100%",
  textAlign: "left",
  padding: "0.6rem 0.75rem",
  borderRadius: "0.6rem",
  border: "none",
  background: "transparent",
  color: options?.danger ? "#b91c1c" : "#0f172a",
  fontWeight: 500,
  ...pointerState(options),
});

export const controlLabelStyle: CSSProperties = {
  fontSize: "0.75rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
  color: "#64748b",
  display: "inline-flex",
  alignItems: "center",
  whiteSpace: "nowrap",
};

export const loadingStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "1.1rem",
  height: "100%",
};
