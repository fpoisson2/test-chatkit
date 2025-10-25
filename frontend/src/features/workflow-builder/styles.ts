import type { CSSProperties } from "react";

type DisabledOptions = {
  disabled?: boolean;
};

export const getHeaderContainerStyle = (isMobile: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: isMobile ? "0.75rem" : "1.5rem",
  padding: isMobile ? "0.75rem 1rem" : "0.75rem 1.5rem",
  background: "transparent",
  borderBottom: "none",
  zIndex: 10,
  width: "100%",
});

export const getHeaderNavigationButtonStyle = (isMobile: boolean): CSSProperties => ({
  width: "2.75rem",
  height: "2.75rem",
  borderRadius: "0.75rem",
  border: "none",
  background: "transparent",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
  alignSelf: isMobile ? "flex-start" : "center",
});

export const getHeaderLayoutStyle = (isMobile: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  flexDirection: "row",
  justifyContent: isMobile ? "center" : "flex-start",
  gap: isMobile ? "0.5rem" : "1.5rem",
  flex: 1,
  minWidth: 0,
  flexWrap: "nowrap",
  width: "100%",
});

export const getHeaderGroupStyle = (isMobile: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  flexDirection: "row",
  justifyContent: isMobile ? "center" : "flex-start",
  gap: "0.75rem",
  minWidth: 0,
  flex: isMobile ? "1 1 auto" : undefined,
  width: isMobile ? "100%" : "auto",
});

const pointerState = (options?: DisabledOptions) => ({
  cursor: options?.disabled ? "not-allowed" : "pointer",
  opacity: options?.disabled ? 0.5 : 1,
});

export const getCreateWorkflowButtonStyle = (
  isMobile: boolean,
  options?: DisabledOptions,
): CSSProperties => ({
  padding: "0.5rem 0.9rem",
  borderRadius: "0.75rem",
  border: "1px solid var(--surface-border)",
  background: "var(--surface-strong)",
  color: "var(--text-color)",
  fontWeight: 600,
  whiteSpace: "nowrap",
  width: isMobile ? "100%" : "auto",
  ...pointerState(options),
});

export const getVersionSelectStyle = (
  isMobile: boolean,
  options?: DisabledOptions,
): CSSProperties => {
  if (isMobile) {
    return {
      minWidth: 0,
      width: "100%",
      maxWidth: "240px",
      padding: "0.45rem 1.1rem",
      borderRadius: "9999px",
      border: "1px solid var(--surface-border)",
      background: "var(--surface-color)",
      color: "var(--text-color)",
      fontWeight: 600,
      backdropFilter: "blur(8px)",
      ...pointerState(options),
    };
  }

  return {
    minWidth: "200px",
    padding: "0.5rem 0.75rem",
    borderRadius: "0.75rem",
    border: "1px solid var(--surface-border)",
    background: "var(--surface-strong)",
    color: "var(--text-color)",
    ...pointerState(options),
  };
};

export const getHeaderActionAreaStyle = (isMobile: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: isMobile ? "flex-end" : "flex-start",
  gap: "0.5rem",
  width: "auto",
  flexDirection: "row",
  flexShrink: 0,
  marginLeft: isMobile ? "auto" : 0,
});

export const getDeployButtonStyle = (
  isMobile: boolean,
  options?: DisabledOptions,
): CSSProperties => ({
  padding: "0.55rem 1.1rem",
  borderRadius: "0.75rem",
  border: "none",
  background: "transparent",
  color: "var(--text-color)",
  fontWeight: 600,
  whiteSpace: "nowrap",
  width: "auto",
  ...pointerState(options),
});

export const getMobileActionButtonStyle = (options?: DisabledOptions): CSSProperties => ({
  padding: "0.85rem 1.1rem",
  borderRadius: "0.85rem",
  border: "1px solid var(--surface-border)",
  background: "var(--surface-strong)",
  color: "var(--text-color)",
  fontWeight: 600,
  width: "100%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.5rem",
  textAlign: "center",
  ...pointerState(options),
});

export const getActionMenuWrapperStyle = (isMobile: boolean): CSSProperties => ({
  position: "relative",
  width: isMobile ? "100%" : "auto",
});

export const getActionMenuTriggerStyle = (isMobile: boolean): CSSProperties => ({
  borderRadius: "0.75rem",
  border: "1px solid var(--surface-border)",
  background: "var(--surface-strong)",
  color: "var(--text-color)",
  fontWeight: 600,
  cursor: "pointer",
  width: isMobile ? "100%" : "2.5rem",
  height: isMobile ? "auto" : "2.5rem",
  padding: isMobile ? "0.6rem 1rem" : 0,
  display: isMobile ? "flex" : "grid",
  placeItems: isMobile ? undefined : "center",
  justifyContent: isMobile ? "center" : undefined,
  alignItems: isMobile ? "center" : undefined,
  gap: isMobile ? "0.5rem" : undefined,
});

export const actionMenuTriggerIconStyle: CSSProperties = {
  fontSize: "1.5rem",
  lineHeight: 1,
  color: "var(--text-color)",
};

export const actionMenuTriggerLabelStyle: CSSProperties = {
  fontSize: "0.95rem",
  fontWeight: 600,
  color: "var(--text-color)",
};

export type ActionMenuPlacement = "up" | "down";

export const getActionMenuStyle = (
  isMobile: boolean,
  placement: ActionMenuPlacement = "down",
): CSSProperties => ({
  position: "absolute",
  ...(isMobile
    ? placement === "up"
      ? {
          top: "auto",
          bottom: "calc(100% + 0.5rem)",
          right: "0",
          left: "0",
        }
      : {
          top: "calc(100% + 0.5rem)",
          bottom: "auto",
          right: "0",
          left: "0",
        }
    : placement === "up"
      ? {
          top: "auto",
          bottom: "calc(100% + 0.5rem)",
          right: "var(--chatkit-sidebar-content-padding-x)",
          left: "auto",
        }
      : {
          top: "calc(100% + 0.5rem)",
          bottom: "auto",
          right: "var(--chatkit-sidebar-content-padding-x)",
          left: "auto",
        }),
  background: "var(--surface-strong)",
  borderRadius: "0.75rem",
  border: "1px solid var(--surface-border)",
  boxShadow: "var(--shadow-card)",
  padding: "0.5rem",
  minWidth: isMobile ? "0" : "220px",
  width: isMobile ? "auto" : "max-content",
  maxWidth: isMobile ? "none" : "min(320px, 100%)",
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  zIndex: 40,
  pointerEvents: "auto",
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
  color: options?.danger ? "#b91c1c" : "var(--text-color)",
  fontWeight: 500,
  ...pointerState(options),
});

export const controlLabelStyle: CSSProperties = {
  fontSize: "0.75rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
  color: "var(--color-text-muted)",
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
  color: "var(--text-color)",
};
