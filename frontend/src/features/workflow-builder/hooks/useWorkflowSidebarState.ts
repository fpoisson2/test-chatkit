import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { HostedWorkflowMetadata } from "../../../utils/backend";
import type {
  StoredWorkflowLastUsedAt,
  StoredWorkflowPinned,
  StoredWorkflowPinnedLookup,
  WorkflowSidebarCache,
} from "../../workflows/utils";
import {
  WORKFLOW_SELECTION_CHANGED_EVENT,
  buildWorkflowOrderingTimestamps,
  createEmptyStoredWorkflowPinned,
  readStoredWorkflowLastUsedMap,
  readStoredWorkflowPinnedLookup,
  readStoredWorkflowSelection,
  readWorkflowSidebarCache,
  updateStoredWorkflowSelection,
  writeWorkflowSidebarCache,
} from "../../workflows/utils";
import type { WorkflowSummary } from "../../../types/workflows";

type WorkflowSidebarStateArgs = {
  token: string | null;
};

export type WorkflowSidebarState = {
  initialSidebarCache: WorkflowSidebarCache | null;
  initialSidebarCacheUsedRef: MutableRefObject<boolean>;
  workflows: WorkflowSummary[];
  setWorkflows: Dispatch<SetStateAction<WorkflowSummary[]>>;
  workflowsRef: MutableRefObject<WorkflowSummary[]>;
  hostedWorkflows: HostedWorkflowMetadata[];
  setHostedWorkflows: Dispatch<SetStateAction<HostedWorkflowMetadata[]>>;
  hostedWorkflowsRef: MutableRefObject<HostedWorkflowMetadata[]>;
  lastUsedAt: StoredWorkflowLastUsedAt;
  pinnedLookup: StoredWorkflowPinnedLookup;
  toggleLocalPin: (workflowId: number) => void;
  toggleHostedPin: (slug: string) => void;
  workflowSortCollatorRef: MutableRefObject<Intl.Collator | null>;
  hasLoadedWorkflowsRef: MutableRefObject<boolean>;
  selectedWorkflowId: number | null;
  setSelectedWorkflowId: Dispatch<SetStateAction<number | null>>;
};

const ensureCollator = (current: Intl.Collator | null): Intl.Collator | null => {
  if (typeof Intl === "undefined" || typeof Intl.Collator !== "function") {
    return null;
  }

  if (current) {
    return current;
  }

  return new Intl.Collator(undefined, { sensitivity: "base" });
};

const buildPinnedForStorage = (lookup: StoredWorkflowPinnedLookup): StoredWorkflowPinned => ({
  local: Array.from(lookup.local),
  hosted: Array.from(lookup.hosted),
});

const computeInitialSidebarState = () => {
  const cache = readWorkflowSidebarCache();
  const selection = readStoredWorkflowSelection();

  return {
    cache,
    selection,
  };
};

const useWorkflowSidebarState = ({ token }: WorkflowSidebarStateArgs): WorkflowSidebarState => {
  const { cache: initialSidebarCache, selection: initialStoredSelection } =
    useMemo(computeInitialSidebarState, []);
  const initialSidebarCacheUsedRef = useRef(Boolean(initialSidebarCache));
  const workflowsRef = useRef<WorkflowSummary[]>(initialSidebarCache?.workflows ?? []);
  const hostedWorkflowsRef = useRef<HostedWorkflowMetadata[]>(
    initialSidebarCache?.hostedWorkflows ?? [],
  );
  const workflowSortCollatorRef = useRef<Intl.Collator | null>(ensureCollator(null));
  const hasLoadedWorkflowsRef = useRef(false);

  const [workflows, setWorkflows] = useState<WorkflowSummary[]>(
    () => initialSidebarCache?.workflows ?? [],
  );
  const [hostedWorkflows, setHostedWorkflows] = useState<HostedWorkflowMetadata[]>(
    () => initialSidebarCache?.hostedWorkflows ?? [],
  );
  const [lastUsedAt, setLastUsedAt] = useState<StoredWorkflowLastUsedAt>(() =>
    buildWorkflowOrderingTimestamps(
      initialSidebarCache?.workflows ?? [],
      initialSidebarCache?.hostedWorkflows ?? [],
      readStoredWorkflowLastUsedMap(),
    ),
  );
  const [pinnedLookup, setPinnedLookup] = useState<StoredWorkflowPinnedLookup>(() =>
    readStoredWorkflowPinnedLookup(),
  );
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(() => {
    if (initialSidebarCache?.selectedWorkflowId != null) {
      return initialSidebarCache.selectedWorkflowId;
    }
    return initialStoredSelection?.localWorkflowId ?? null;
  });

  const isPersistingPinnedRef = useRef(false);

  const persistPinnedLookup = useCallback(
    (next: StoredWorkflowPinnedLookup) => {
      const pinnedForStorage = buildPinnedForStorage(next);

      isPersistingPinnedRef.current = true;
      updateStoredWorkflowSelection((previous) => ({
        mode: previous?.mode ?? (selectedWorkflowId != null ? "local" : "hosted"),
        localWorkflowId: previous?.localWorkflowId ?? selectedWorkflowId ?? null,
        hostedSlug: previous?.hostedSlug ?? null,
        lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
        pinned: pinnedForStorage,
      }));

      const clearPersistingFlag = () => {
        if (isPersistingPinnedRef.current) {
          isPersistingPinnedRef.current = false;
        }
      };

      if (typeof queueMicrotask === "function") {
        queueMicrotask(clearPersistingFlag);
      } else {
        Promise.resolve().then(clearPersistingFlag).catch(clearPersistingFlag);
      }
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

  useEffect(() => {
    workflowSortCollatorRef.current = ensureCollator(workflowSortCollatorRef.current);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleSelectionChange = () => {
      if (isPersistingPinnedRef.current) {
        isPersistingPinnedRef.current = false;
        return;
      }

      setLastUsedAt(
        buildWorkflowOrderingTimestamps(
          workflowsRef.current,
          hostedWorkflowsRef.current,
          readStoredWorkflowLastUsedMap(),
        ),
      );
      setPinnedLookup(readStoredWorkflowPinnedLookup());
    };

    window.addEventListener(WORKFLOW_SELECTION_CHANGED_EVENT, handleSelectionChange);
    return () => {
      window.removeEventListener(WORKFLOW_SELECTION_CHANGED_EVENT, handleSelectionChange);
    };
  }, []);

  useEffect(() => {
    workflowsRef.current = workflows;
  }, [workflows]);

  useEffect(() => {
    hostedWorkflowsRef.current = hostedWorkflows;
  }, [hostedWorkflows]);

  useEffect(() => {
    setLastUsedAt(
      buildWorkflowOrderingTimestamps(workflows, hostedWorkflows, readStoredWorkflowLastUsedMap()),
    );
  }, [hostedWorkflows, workflows]);

  useEffect(() => {
    if (!token || !hasLoadedWorkflowsRef.current) {
      return;
    }

    setPinnedLookup((current) => {
      const availableLocalIds = new Set(workflows.map((workflow) => workflow.id));
      const availableHostedSlugs = new Set(
        hostedWorkflows.filter((workflow) => workflow.managed).map((workflow) => workflow.slug),
      );

      const nextLocal = Array.from(current.local).filter((id) => availableLocalIds.has(id));
      const nextHosted = Array.from(current.hosted).filter((slug) => availableHostedSlugs.has(slug));

      if (nextLocal.length === current.local.size && nextHosted.length === current.hosted.size) {
        return current;
      }

      const next: StoredWorkflowPinnedLookup = {
        local: new Set(nextLocal),
        hosted: new Set(nextHosted),
      };
      persistPinnedLookup(next);
      return next;
    });
  }, [hostedWorkflows, persistPinnedLookup, token, workflows]);

  useEffect(() => {
    updateStoredWorkflowSelection((previous) => {
      if (selectedWorkflowId == null) {
        if (!previous || previous.mode === "hosted" || previous.localWorkflowId == null) {
          return previous;
        }

        return { ...previous, localWorkflowId: null };
      }

      const preservedHostedSlug = previous?.hostedSlug ?? null;

      if (
        previous &&
        previous.mode === "local" &&
        previous.localWorkflowId === selectedWorkflowId &&
        previous.hostedSlug === preservedHostedSlug
      ) {
        return previous;
      }

      return {
        mode: "local",
        localWorkflowId: selectedWorkflowId,
        hostedSlug: preservedHostedSlug,
        lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
        pinned: previous?.pinned ?? createEmptyStoredWorkflowPinned(),
      };
    });
  }, [selectedWorkflowId]);

  useEffect(() => {
    if (workflows.length === 0 && hostedWorkflows.length === 0) {
      return;
    }

    const existingCache = readWorkflowSidebarCache();

    writeWorkflowSidebarCache({
      workflows,
      hostedWorkflows,
      selectedWorkflowId,
      selectedHostedSlug:
        existingCache?.selectedHostedSlug ?? initialStoredSelection?.hostedSlug ?? null,
      mode: existingCache?.mode ?? initialStoredSelection?.mode ?? "local",
    });
  }, [hostedWorkflows, initialStoredSelection, selectedWorkflowId, workflows]);

  return {
    initialSidebarCache,
    initialSidebarCacheUsedRef,
    workflows,
    setWorkflows,
    workflowsRef,
    hostedWorkflows,
    setHostedWorkflows,
    hostedWorkflowsRef,
    lastUsedAt,
    pinnedLookup,
    toggleLocalPin,
    toggleHostedPin,
    workflowSortCollatorRef,
    hasLoadedWorkflowsRef,
    selectedWorkflowId,
    setSelectedWorkflowId,
  };
};

export default useWorkflowSidebarState;
