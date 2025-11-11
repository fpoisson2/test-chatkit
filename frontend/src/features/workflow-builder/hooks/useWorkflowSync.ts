import { useEffect, useRef, type MutableRefObject } from "react";
import type { WorkflowSummary, HostedWorkflowMetadata } from "../types";

export interface UseWorkflowSyncParams {
  // From WorkflowSidebarProvider
  sidebarWorkflows: WorkflowSummary[];
  sidebarHostedWorkflows: HostedWorkflowMetadata[];
  sidebarSelectedWorkflowId: number | null;
  setSidebarWorkflows: (workflows: WorkflowSummary[]) => void;
  setSidebarHostedWorkflows: (workflows: HostedWorkflowMetadata[]) => void;
  setSidebarSelectedWorkflowId: (id: number | null) => void;

  // From WorkflowContext
  workflows: WorkflowSummary[];
  hostedWorkflows: HostedWorkflowMetadata[];
  selectedWorkflowId: number | null;
  setWorkflows: (workflows: WorkflowSummary[]) => void;
  setHostedWorkflows: (workflows: HostedWorkflowMetadata[]) => void;
  setSelectedWorkflowId: (id: number | null) => void;

  // Load function
  loadVersions: (workflowId: number, versionId: number | null) => Promise<void>;
}

export interface UseWorkflowSyncReturn {
  initializedFromProviderRef: MutableRefObject<boolean>;
  needsVersionLoadRef: MutableRefObject<boolean>;
}

/**
 * Hook for synchronizing workflow state between WorkflowContext and WorkflowSidebarProvider
 *
 * This hook implements a ONE-TIME initialization pattern:
 * 1. Initialize WorkflowContext from provider ONCE
 * 2. After that, sync changes FROM WorkflowContext TO provider
 * 3. Never sync FROM provider TO WorkflowContext after initialization
 */
export const useWorkflowSync = ({
  sidebarWorkflows,
  sidebarHostedWorkflows,
  sidebarSelectedWorkflowId,
  setSidebarWorkflows,
  setSidebarHostedWorkflows,
  setSidebarSelectedWorkflowId,
  workflows,
  hostedWorkflows,
  selectedWorkflowId,
  setWorkflows,
  setHostedWorkflows,
  setSelectedWorkflowId,
  loadVersions,
}: UseWorkflowSyncParams): UseWorkflowSyncReturn => {
  const initializedFromProviderRef = useRef(false);
  const needsVersionLoadRef = useRef(false);

  // ONE-TIME initialization from provider
  useEffect(() => {
    if (!initializedFromProviderRef.current && sidebarWorkflows.length > 0) {
      initializedFromProviderRef.current = true;
      setWorkflows(sidebarWorkflows);
      setHostedWorkflows(sidebarHostedWorkflows);
      // Initialize selectedWorkflowId from provider if present
      if (sidebarSelectedWorkflowId !== null) {
        setSelectedWorkflowId(sidebarSelectedWorkflowId);
        needsVersionLoadRef.current = true;
      }
    }
  }, [
    sidebarWorkflows,
    sidebarHostedWorkflows,
    sidebarSelectedWorkflowId,
    setWorkflows,
    setHostedWorkflows,
    setSelectedWorkflowId,
  ]);

  // Load versions after initialization from provider
  useEffect(() => {
    if (needsVersionLoadRef.current && selectedWorkflowId !== null) {
      needsVersionLoadRef.current = false;
      void loadVersions(selectedWorkflowId, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkflowId]);

  // Sync TO provider when WorkflowContext changes (not from provider)
  const workflowsStringified = JSON.stringify(workflows.map((w) => w.id));
  const hostedWorkflowsStringified = JSON.stringify(hostedWorkflows.map((w) => w.slug));

  useEffect(() => {
    if (workflows.length > 0 && initializedFromProviderRef.current) {
      setSidebarWorkflows(workflows);
    }
  }, [workflowsStringified, setSidebarWorkflows, workflows]);

  useEffect(() => {
    if (hostedWorkflows.length > 0 && initializedFromProviderRef.current) {
      setSidebarHostedWorkflows(hostedWorkflows);
    }
  }, [hostedWorkflowsStringified, setSidebarHostedWorkflows, hostedWorkflows]);

  useEffect(() => {
    setSidebarSelectedWorkflowId(selectedWorkflowId as number | null);
  }, [selectedWorkflowId, setSidebarSelectedWorkflowId]);

  return {
    initializedFromProviderRef,
    needsVersionLoadRef,
  };
};
