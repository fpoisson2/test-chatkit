import { useMemo, type CSSProperties } from "react";
import { getHeaderContainerStyle, getHeaderNavigationButtonStyle } from "../styles";
import { DESKTOP_WORKSPACE_HORIZONTAL_PADDING } from "../WorkflowBuilderUtils";
import type { WorkflowSummary } from "../types";

export interface UseWorkflowStylesParams {
  isMobileLayout: boolean;
  selectedWorkflow: WorkflowSummary | null;
}

export interface UseWorkflowStylesReturn {
  headerOverlayOffset: string;
  floatingPanelStyle: CSSProperties | undefined;
  shouldShowWorkflowDescription: boolean;
  shouldShowPublicationReminder: boolean;
  headerStyle: CSSProperties;
  headerNavigationButtonStyle: CSSProperties;
  workspaceWrapperStyle: CSSProperties;
  workspaceContentStyle: CSSProperties;
  editorContainerStyle: CSSProperties;
}

/**
 * Hook for computing all layout styles based on mobile/desktop mode
 */
export const useWorkflowStyles = ({
  isMobileLayout,
  selectedWorkflow,
}: UseWorkflowStylesParams): UseWorkflowStylesReturn => {
  const headerOverlayOffset = useMemo(
    () => (isMobileLayout ? "4rem" : "4.25rem"),
    [isMobileLayout],
  );

  const shouldShowWorkflowDescription = !isMobileLayout && Boolean(selectedWorkflow?.description);
  const shouldShowPublicationReminder =
    !isMobileLayout && Boolean(selectedWorkflow) && !selectedWorkflow?.active_version_id;

  const floatingPanelStyle = useMemo<CSSProperties | undefined>(() => {
    if (isMobileLayout) {
      return undefined;
    }

    return {
      top: `calc(${headerOverlayOffset} + ${DESKTOP_WORKSPACE_HORIZONTAL_PADDING})`,
      maxHeight: `calc(100% - (${headerOverlayOffset} + 2 * ${DESKTOP_WORKSPACE_HORIZONTAL_PADDING}))`,
    };
  }, [headerOverlayOffset, isMobileLayout]);

  const headerStyle = useMemo(() => {
    const baseStyle = getHeaderContainerStyle(isMobileLayout);
    return { ...baseStyle, position: "absolute", top: 0, left: 0, right: 0 } as CSSProperties;
  }, [isMobileLayout]);

  const headerNavigationButtonStyle = useMemo(
    () => getHeaderNavigationButtonStyle(isMobileLayout),
    [isMobileLayout],
  );

  const workspaceWrapperStyle = useMemo<CSSProperties>(() => {
    if (isMobileLayout) {
      return { position: "absolute", inset: 0, overflow: "hidden" };
    }
    return { position: "relative", flex: 1, overflow: "hidden", minHeight: 0 };
  }, [isMobileLayout]);

  const workspaceContentStyle = useMemo<CSSProperties>(() => {
    if (isMobileLayout) {
      return {
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: "0",
      };
    }

    const hasWorkflowMeta = shouldShowWorkflowDescription || shouldShowPublicationReminder;

    return {
      position: "absolute",
      inset: 0,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      gap: hasWorkflowMeta ? "1rem" : "0",
      paddingTop: `calc(${headerOverlayOffset}${
        hasWorkflowMeta ? ` + ${DESKTOP_WORKSPACE_HORIZONTAL_PADDING}` : ""
      })`,
      paddingBottom: 0,
      paddingLeft: DESKTOP_WORKSPACE_HORIZONTAL_PADDING,
      paddingRight: DESKTOP_WORKSPACE_HORIZONTAL_PADDING,
    };
  }, [
    headerOverlayOffset,
    isMobileLayout,
    shouldShowPublicationReminder,
    shouldShowWorkflowDescription,
  ]);

  const editorContainerStyle = useMemo<CSSProperties>(() => {
    const baseStyle: CSSProperties = {
      flex: 1,
      minHeight: 0,
      borderRadius: isMobileLayout ? 0 : "1.25rem",
      border: isMobileLayout ? "none" : "1px solid var(--surface-border)",
      background: "var(--surface-strong)",
      overflow: "hidden",
      boxShadow: isMobileLayout ? "none" : "var(--shadow-card)",
    };

    if (!isMobileLayout) {
      baseStyle.marginLeft = `calc(-1 * ${DESKTOP_WORKSPACE_HORIZONTAL_PADDING})`;
      baseStyle.marginRight = `calc(-1 * ${DESKTOP_WORKSPACE_HORIZONTAL_PADDING})`;
    }

    if (!isMobileLayout && !(shouldShowWorkflowDescription || shouldShowPublicationReminder)) {
      baseStyle.marginTop = `calc(-1 * ${headerOverlayOffset})`;
    }

    return baseStyle;
  }, [
    headerOverlayOffset,
    isMobileLayout,
    shouldShowPublicationReminder,
    shouldShowWorkflowDescription,
  ]);

  return {
    headerOverlayOffset,
    floatingPanelStyle,
    shouldShowWorkflowDescription,
    shouldShowPublicationReminder,
    headerStyle,
    headerNavigationButtonStyle,
    workspaceWrapperStyle,
    workspaceContentStyle,
    editorContainerStyle,
  };
};
