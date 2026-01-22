import { useEffect, useState } from "react";
import type { WorkflowSummary } from "../types/workflows";

export type LtiContextOptions = {
  isLtiUser: boolean;
  activeWorkflow: WorkflowSummary | null;
  workflowsLoading: boolean;
  setHideSidebar: (hide: boolean) => void;
  isThreadLoading: boolean;
};

export type LtiContextReturn = {
  isLtiContext: boolean;
  ltiReady: boolean;
  shouldShowLoadingOverlay: boolean;
};

export function useLtiContext({
  isLtiUser,
  activeWorkflow,
  workflowsLoading,
  setHideSidebar,
  isThreadLoading,
}: LtiContextOptions): LtiContextReturn {
  // Detect LTI context even before user is loaded (for early loading overlay)
  // This checks if we're coming from an LTI launch by looking for the workflow ID in localStorage
  const isLtiContext = isLtiUser || (localStorage.getItem('lti_launch_workflow_id') !== null);

  const [ltiReady, setLtiReady] = useState(false);

  // Hide sidebar immediately for LTI users (before workflow loads)
  useEffect(() => {
    if (isLtiContext) {
      setHideSidebar(true);
    }
  }, [isLtiContext, setHideSidebar]);

  // Apply LTI sidebar visibility setting based on workflow config
  useEffect(() => {
    const shouldApplyLtiOptions = activeWorkflow?.lti_enabled && isLtiUser;
    const shouldHideSidebar = shouldApplyLtiOptions && !activeWorkflow?.lti_show_sidebar;

    if (shouldApplyLtiOptions) {
      setHideSidebar(shouldHideSidebar);
    }

    // Cleanup: restore sidebar when unmounting or when conditions change
    return () => {
      if (!isLtiUser) {
        setHideSidebar(false);
      }
    };
  }, [activeWorkflow?.lti_enabled, activeWorkflow?.lti_show_sidebar, isLtiUser, setHideSidebar]);

  // Show loading overlay for LTI users until workflow and thread are fully loaded
  useEffect(() => {
    // If not in LTI context, mark as ready immediately
    if (!isLtiContext) {
      setLtiReady(true);
      return;
    }

    // Once ready, stay ready (don't reset)
    if (ltiReady) {
      return;
    }

    // Safety timeout: force ready after 3 seconds to prevent indefinite loading on mobile
    const safetyTimer = setTimeout(() => {
      setLtiReady(true);
    }, 3000);

    // Wait for workflow to load AND thread to finish loading
    if (!activeWorkflow || workflowsLoading || isThreadLoading) {
      return () => clearTimeout(safetyTimer);
    }

    // All conditions met, mark as ready
    setLtiReady(true);

    return () => {
      clearTimeout(safetyTimer);
    };
  }, [ltiReady, isLtiContext, activeWorkflow, workflowsLoading, isThreadLoading]);

  const shouldShowLoadingOverlay = isLtiContext && !ltiReady;

  return {
    isLtiContext,
    ltiReady,
    shouldShowLoadingOverlay,
  };
}
