import { useCallback, useEffect, useRef, useState } from "react";
import type { HostedWorkflowMetadata, WorkflowSummary } from "../../../utils/backend";
import {
  buildWorkflowOrderingTimestamps,
  readStoredWorkflowLastUsedMap,
  readStoredWorkflowPinnedLookup,
  updateStoredWorkflowSelection,
  WORKFLOW_SELECTION_CHANGED_EVENT,
  type StoredWorkflowLastUsedAt,
  type StoredWorkflowPinned,
  type StoredWorkflowPinnedLookup,
} from "../../workflows/utils";

interface WorkflowStateCache {
  workflows: WorkflowSummary[];
  hostedWorkflows: HostedWorkflowMetadata[];
  selectedWorkflowId: number | null;
}

interface UseWorkflowStateOptions {
  initialCache: WorkflowStateCache | null;
  selectedWorkflowId: number | null;
}

interface UseWorkflowStateReturn {
  // State
  workflows: WorkflowSummary[];
  hostedWorkflows: HostedWorkflowMetadata[];
  lastUsedAt: StoredWorkflowLastUsedAt;
  pinnedLookup: StoredWorkflowPinnedLookup;
  hostedLoading: boolean;
  hostedError: string | null;

  // Refs
  workflowsRef: React.MutableRefObject<WorkflowSummary[]>;
  hostedWorkflowsRef: React.MutableRefObject<HostedWorkflowMetadata[]>;
  workflowSortCollatorRef: React.MutableRefObject<Intl.Collator | null>;
  hasLoadedWorkflowsRef: React.MutableRefObject<boolean>;

  // Setters
  setWorkflows: React.Dispatch<React.SetStateAction<WorkflowSummary[]>>;
  setHostedWorkflows: React.Dispatch<React.SetStateAction<HostedWorkflowMetadata[]>>;
  setLastUsedAt: React.Dispatch<React.SetStateAction<StoredWorkflowLastUsedAt>>;
  setHostedLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setHostedError: React.Dispatch<React.SetStateAction<string | null>>;

  // Actions
  toggleLocalPin: (workflowId: number) => void;
  toggleHostedPin: (slug: string) => void;
  persistPinnedLookup: (next: StoredWorkflowPinnedLookup) => void;
}

/**
 * Hook to manage workflow state including local workflows, hosted workflows,
 * pinning, and ordering timestamps.
 */
export const useWorkflowState = ({
  initialCache,
  selectedWorkflowId,
}: UseWorkflowStateOptions): UseWorkflowStateReturn => {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>(
    () => initialCache?.workflows ?? [],
  );

  const [hostedWorkflows, setHostedWorkflows] = useState<HostedWorkflowMetadata[]>(
    () => initialCache?.hostedWorkflows ?? [],
  );

  const [lastUsedAt, setLastUsedAt] = useState<StoredWorkflowLastUsedAt>(() =>
    buildWorkflowOrderingTimestamps(
      initialCache?.workflows ?? [],
      initialCache?.hostedWorkflows ?? [],
      readStoredWorkflowLastUsedMap(),
    ),
  );

  const [pinnedLookup, setPinnedLookup] = useState<StoredWorkflowPinnedLookup>(() =>
    readStoredWorkflowPinnedLookup(),
  );

  const [hostedLoading, setHostedLoading] = useState(false);
  const [hostedError, setHostedError] = useState<string | null>(null);

  const workflowsRef = useRef(workflows);
  const hostedWorkflowsRef = useRef(hostedWorkflows);
  const workflowSortCollatorRef = useRef<Intl.Collator | null>(null);
  const hasLoadedWorkflowsRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    workflowsRef.current = workflows;
  }, [workflows]);

  useEffect(() => {
    hostedWorkflowsRef.current = hostedWorkflows;
  }, [hostedWorkflows]);

  // Initialize Intl.Collator for sorting
  useEffect(() => {
    if (typeof Intl === "undefined" || typeof Intl.Collator !== "function") {
      return;
    }

    if (!workflowSortCollatorRef.current) {
      workflowSortCollatorRef.current = new Intl.Collator(undefined, {
        sensitivity: "base",
      });
    }
  }, []);

  // Listen for workflow selection changes
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleSelectionChange = () => {
      setLastUsedAt(
        buildWorkflowOrderingTimestamps(
          workflowsRef.current,
          hostedWorkflowsRef.current,
          readStoredWorkflowLastUsedMap(),
        ),
      );
    };

    window.addEventListener(WORKFLOW_SELECTION_CHANGED_EVENT, handleSelectionChange);
    return () => {
      window.removeEventListener(WORKFLOW_SELECTION_CHANGED_EVENT, handleSelectionChange);
    };
  }, []);

  const persistPinnedLookup = useCallback(
    (next: StoredWorkflowPinnedLookup) => {
      const pinnedForStorage: StoredWorkflowPinned = {
        local: Array.from(next.local),
        hosted: Array.from(next.hosted),
      };
      updateStoredWorkflowSelection((previous) => ({
        mode: previous?.mode ?? (selectedWorkflowId != null ? "local" : "hosted"),
        localWorkflowId: previous?.localWorkflowId ?? selectedWorkflowId ?? null,
        hostedSlug: previous?.hostedSlug ?? null,
        lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
        pinned: pinnedForStorage,
      }));
    },
    [selectedWorkflowId],
  );

  const toggleLocalPin = useCallback(
    (workflowId: number) => {
      setPinnedLookup((current) => {
        const next: StoredWorkflowPinnedLookup = {
          local: new Set(current.local),
          hosted: new Set(current.hosted),
        };
        if (next.local.has(workflowId)) {
          next.local.delete(workflowId);
        } else {
          next.local.add(workflowId);
        }
        persistPinnedLookup(next);
        return next;
      });
    },
    [persistPinnedLookup],
  );

  const toggleHostedPin = useCallback(
    (slug: string) => {
      setPinnedLookup((current) => {
        const next: StoredWorkflowPinnedLookup = {
          local: new Set(current.local),
          hosted: new Set(current.hosted),
        };
        if (next.hosted.has(slug)) {
          next.hosted.delete(slug);
        } else {
          next.hosted.add(slug);
        }
        persistPinnedLookup(next);
        return next;
      });
    },
    [persistPinnedLookup],
  );

  return {
    workflows,
    hostedWorkflows,
    lastUsedAt,
    pinnedLookup,
    hostedLoading,
    hostedError,
    workflowsRef,
    hostedWorkflowsRef,
    workflowSortCollatorRef,
    hasLoadedWorkflowsRef,
    setWorkflows,
    setHostedWorkflows,
    setLastUsedAt,
    setHostedLoading,
    setHostedError,
    toggleLocalPin,
    toggleHostedPin,
    persistPinnedLookup,
  };
};
