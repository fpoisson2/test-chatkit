import { useEffect, useState } from "react";
import type { WorkflowSummary } from "../types/workflows";

export type LtiContextOptions = {
  isLtiUser: boolean;
  activeWorkflow: WorkflowSummary | null;
  workflowsLoading: boolean;
  setHideSidebar: (hide: boolean) => void;
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

  // Show loading overlay for LTI users until workflow is loaded and ChatKit has rendered
  useEffect(() => {
    // If not in LTI context, mark as ready immediately
    if (!isLtiContext) {
      setLtiReady(true);
      return;
    }

    // Once ready, stay ready (don't reset)
    if (ltiReady || !activeWorkflow || workflowsLoading) {
      return;
    }

    console.log('[useLtiContext] LTI workflow selected, waiting for ChatKit to render...');

    // Give ChatKit time to initialize and render (covers all app.init phases)
    const timer = setTimeout(() => {
      console.log('[useLtiContext] LTI initialization complete');
      setLtiReady(true);
    }, 500);

    return () => clearTimeout(timer);
  }, [ltiReady, isLtiContext, activeWorkflow, workflowsLoading]);

  const shouldShowLoadingOverlay = isLtiContext && !ltiReady;

  return {
    isLtiContext,
    ltiReady,
    shouldShowLoadingOverlay,
  };
}
