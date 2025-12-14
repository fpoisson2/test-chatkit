import { useEffect, useMemo, useState } from "react";
import type { ChatKitOptions } from "../chatkit";
import type { WorkflowSummary } from "../types/workflows";
import type { HostedFlowMode } from "./useHostedFlow";

const MAX_CACHED_INSTANCES = 5;

export type WorkflowInstanceData = {
  workflowId: string;
  mode: HostedFlowMode;
  workflow: WorkflowSummary | null;
  initialThreadId: string | null;
  chatkitOptions: ChatKitOptions;
  createdAt: number;
  instanceKey: number;
};

export type UseChatInstanceCacheOptions = {
  mode: HostedFlowMode;
  activeWorkflowId: number | null;
  hostedWorkflowSlug: string | null;
  activeWorkflow: WorkflowSummary | null;
  initialThreadId: string | null;
  chatkitOptions: ChatKitOptions;
  chatInstanceKey: number;
};

export type ChatInstanceCacheReturn = {
  currentWorkflowId: string;
  activeInstances: Map<string, WorkflowInstanceData>;
};

export function useChatInstanceCache({
  mode,
  activeWorkflowId,
  hostedWorkflowSlug,
  activeWorkflow,
  initialThreadId,
  chatkitOptions,
  chatInstanceKey,
}: UseChatInstanceCacheOptions): ChatInstanceCacheReturn {
  const [cachedInstances, setCachedInstances] = useState<Map<string, WorkflowInstanceData>>(
    new Map(),
  );

  const currentWorkflowId = useMemo(() => {
    if (mode === "hosted") {
      return `hosted::${hostedWorkflowSlug ?? "__default__"}`;
    }
    return `local::${activeWorkflowId ?? "__default__"}`;
  }, [mode, hostedWorkflowSlug, activeWorkflowId]);

  // Ensure current instance always exists by computing activeInstances synchronously
  const activeInstances = useMemo(() => {
    const result = new Map(cachedInstances);

    // Always ensure the current workflow instance exists
    if (!result.has(currentWorkflowId)) {
      result.set(currentWorkflowId, {
        workflowId: currentWorkflowId,
        mode,
        workflow: activeWorkflow,
        initialThreadId,
        chatkitOptions,
        createdAt: Date.now(),
        instanceKey: chatInstanceKey,
      });
    }

    return result;
  }, [cachedInstances, currentWorkflowId, mode, activeWorkflow, initialThreadId, chatkitOptions, chatInstanceKey]);

  // Update cached instances asynchronously (for persistence across workflow switches)
  useEffect(() => {
    setCachedInstances((prev) => {
      const existing = prev.get(currentWorkflowId);

      if (existing) {
        if (existing.instanceKey === chatInstanceKey) {
          return prev;
        }
        const next = new Map(prev);
        next.set(currentWorkflowId, {
          ...existing,
          instanceKey: chatInstanceKey,
        });
        return next;
      }

      const next = new Map(prev);

      next.set(currentWorkflowId, {
        workflowId: currentWorkflowId,
        mode,
        workflow: activeWorkflow,
        initialThreadId,
        chatkitOptions,
        createdAt: Date.now(),
        instanceKey: chatInstanceKey,
      });

      if (next.size > MAX_CACHED_INSTANCES) {
        const entries = Array.from(next.entries());
        entries.sort((a, b) => a[1].createdAt - b[1].createdAt);

        const toKeep = entries
          .filter(([id]) => id === currentWorkflowId)
          .concat(
            entries.filter(([id]) => id !== currentWorkflowId).slice(-MAX_CACHED_INSTANCES + 1),
          );

        return new Map(toKeep);
      }

      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkflowId, chatInstanceKey]);

  return {
    currentWorkflowId,
    activeInstances,
  };
}
