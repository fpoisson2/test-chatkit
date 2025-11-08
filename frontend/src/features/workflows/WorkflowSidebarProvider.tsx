import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "../../auth";
import { chatkitApi, hostedWorkflowsApi, workflowsApi, type HostedWorkflowMetadata } from "../../utils/backend";
import type { WorkflowSummary } from "../../types/workflows";
import type { HostedFlowMode } from "../../hooks/useHostedFlow";
import {
  buildWorkflowOrderingTimestamps,
  clearWorkflowSidebarCache,
  readStoredWorkflowSelection,
  readStoredWorkflowLastUsedMap,
  readWorkflowSidebarCache,
  readStoredWorkflowPinnedLookup,
  createEmptyStoredWorkflowPinned,
  recordWorkflowLastUsedAt,
  updateStoredWorkflowSelection,
  writeStoredWorkflowSelection,
  writeWorkflowSidebarCache,
  WORKFLOW_SELECTION_CHANGED_EVENT,
  type StoredWorkflowPinned,
  type StoredWorkflowPinnedLookup,
  type StoredWorkflowLastUsedAt,
} from "./utils";

const isApiError = (error: unknown): error is { status?: number; message?: string } =>
  Boolean(error) && typeof error === "object" && "status" in error;

type WorkflowSidebarContextValue = {
  // Data
  workflows: WorkflowSummary[];
  hostedWorkflows: HostedWorkflowMetadata[];
  selectedWorkflowId: number | null;
  selectedHostedSlug: string | null;
  mode: HostedFlowMode;
  loading: boolean;
  error: string | null;
  lastUsedAt: StoredWorkflowLastUsedAt;
  pinnedLookup: StoredWorkflowPinnedLookup;
  workflowCollator: Intl.Collator | null;

  // Actions
  setMode: (mode: HostedFlowMode) => void;
  setWorkflows: React.Dispatch<React.SetStateAction<WorkflowSummary[]>>;
  setHostedWorkflows: React.Dispatch<React.SetStateAction<HostedWorkflowMetadata[]>>;
  setSelectedWorkflowId: React.Dispatch<React.SetStateAction<number | null>>;
  setSelectedHostedSlug: React.Dispatch<React.SetStateAction<string | null>>;
  toggleLocalPin: (workflowId: number) => void;
  toggleHostedPin: (slug: string) => void;
  loadWorkflows: () => Promise<void>;

  // Refs (for advanced use cases)
  workflowsRef: React.MutableRefObject<WorkflowSummary[]>;
  hostedWorkflowsRef: React.MutableRefObject<HostedWorkflowMetadata[]>;
  hasLoadedWorkflowsRef: React.MutableRefObject<boolean>;
};

const WorkflowSidebarContext = createContext<WorkflowSidebarContextValue | undefined>(undefined);

export const useWorkflowSidebar = () => {
  const context = useContext(WorkflowSidebarContext);
  if (!context) {
    throw new Error("useWorkflowSidebar must be used within WorkflowSidebarProvider");
  }
  return context;
};

type WorkflowSidebarProviderProps = {
  children: ReactNode;
};

export const WorkflowSidebarProvider = ({ children }: WorkflowSidebarProviderProps) => {
  const { token, user } = useAuth();
  const isAdmin = Boolean(user?.is_admin);

  // Initialize from cache
  const cachedState = useMemo(() => (token ? readWorkflowSidebarCache() : null), [token]);

  // State
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>(
    () => cachedState?.workflows ?? [],
  );
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(
    () => cachedState?.selectedWorkflowId ?? null,
  );
  const [hostedWorkflows, setHostedWorkflows] = useState<HostedWorkflowMetadata[]>(
    () => cachedState?.hostedWorkflows ?? [],
  );
  const [selectedHostedSlug, setSelectedHostedSlug] = useState<string | null>(
    () => cachedState?.selectedHostedSlug ?? null,
  );
  const [mode, setMode] = useState<HostedFlowMode>(() => cachedState?.mode ?? "local");
  const [loading, setLoading] = useState(() => !cachedState);
  const [error, setError] = useState<string | null>(null);
  const [lastUsedAt, setLastUsedAt] = useState<StoredWorkflowLastUsedAt>(() =>
    buildWorkflowOrderingTimestamps(
      cachedState?.workflows ?? [],
      cachedState?.hostedWorkflows ?? [],
      readStoredWorkflowLastUsedMap(),
    ),
  );
  const [pinnedLookup, setPinnedLookup] = useState<StoredWorkflowPinnedLookup>(() =>
    readStoredWorkflowPinnedLookup(),
  );

  // Refs
  const workflowsRef = useRef(workflows);
  const hostedWorkflowsRef = useRef(hostedWorkflows);

  // Wrap setters to avoid unnecessary updates
  const setWorkflowsStable = useCallback<React.Dispatch<React.SetStateAction<WorkflowSummary[]>>>((value) => {
    setWorkflows((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      // Only update if the array reference actually changed
      if (next === prev) return prev;
      // Deep check if arrays have same content
      if (next.length === prev.length && next.every((w, i) => w.id === prev[i]?.id)) {
        return prev;
      }
      return next;
    });
  }, []);

  const setHostedWorkflowsStable = useCallback<React.Dispatch<React.SetStateAction<HostedWorkflowMetadata[]>>>((value) => {
    setHostedWorkflows((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      // Only update if the array reference actually changed
      if (next === prev) return prev;
      // Deep check if arrays have same content
      if (next.length === prev.length && next.every((w, i) => w.slug === prev[i]?.slug)) {
        return prev;
      }
      return next;
    });
  }, []);
  const workflowCollatorRef = useRef<Intl.Collator | null>(null);
  const previousTokenRef = useRef<string | null>(token ?? null);
  const hasLoadedWorkflowsRef = useRef(false);
  const hostedInitialAnnouncedRef = useRef(false);

  // Initialize collator
  useEffect(() => {
    if (typeof Intl === "undefined" || typeof Intl.Collator !== "function") {
      return;
    }

    if (!workflowCollatorRef.current) {
      workflowCollatorRef.current = new Intl.Collator(undefined, {
        sensitivity: "base",
      });
    }
  }, []);

  // Persist pinned lookup helper
  const persistPinnedLookup = useCallback(
    (next: StoredWorkflowPinnedLookup) => {
      const pinnedForStorage: StoredWorkflowPinned = {
        local: Array.from(next.local),
        hosted: Array.from(next.hosted),
      };
      updateStoredWorkflowSelection((previous) => ({
        mode: previous?.mode ?? mode,
        localWorkflowId: previous?.localWorkflowId ?? selectedWorkflowId ?? null,
        hostedSlug: previous?.hostedSlug ?? selectedHostedSlug ?? null,
        lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
        pinned: pinnedForStorage,
      }));
    },
    [mode, selectedHostedSlug, selectedWorkflowId],
  );

  // Toggle pin actions
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

  // Sync refs
  useEffect(() => {
    workflowsRef.current = workflows;
  }, [workflows]);

  useEffect(() => {
    hostedWorkflowsRef.current = hostedWorkflows;
  }, [hostedWorkflows]);

  // Listen to workflow selection changes from other components/tabs
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
      setPinnedLookup(readStoredWorkflowPinnedLookup());
    };

    window.addEventListener(WORKFLOW_SELECTION_CHANGED_EVENT, handleSelectionChange);
    return () => {
      window.removeEventListener(WORKFLOW_SELECTION_CHANGED_EVENT, handleSelectionChange);
    };
  }, []);

  // Update lastUsedAt when workflows change
  useEffect(() => {
    setLastUsedAt(
      buildWorkflowOrderingTimestamps(workflows, hostedWorkflows, readStoredWorkflowLastUsedMap()),
    );
  }, [hostedWorkflows, workflows]);

  // Sanitize pinned workflows when data changes
  useEffect(() => {
    if (!token || !hasLoadedWorkflowsRef.current) {
      return;
    }

    setPinnedLookup((current) => {
      const availableLocalIds = new Set(workflows.map((workflow) => workflow.id));
      const availableHostedSlugs = new Set(hostedWorkflows.map((workflow) => workflow.slug));
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

  // Persist selection changes
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

  // Write to cache
  useEffect(() => {
    if (!token) {
      clearWorkflowSidebarCache();
      return;
    }

    writeWorkflowSidebarCache({
      workflows,
      hostedWorkflows,
      selectedWorkflowId,
      selectedHostedSlug,
      mode,
    });
  }, [hostedWorkflows, mode, selectedHostedSlug, selectedWorkflowId, token, workflows]);

  // Load workflows
  const loadWorkflows = useCallback(async () => {
    const previousToken = previousTokenRef.current;
    previousTokenRef.current = token ?? null;

    if (!token) {
      clearWorkflowSidebarCache();
      hasLoadedWorkflowsRef.current = false;
      if (previousToken) {
        writeStoredWorkflowSelection(null);
      }
      setWorkflows([]);
      setHostedWorkflows([]);
      setSelectedHostedSlug(null);
      setSelectedWorkflowId(null);
      setPinnedLookup({ local: new Set<number>(), hosted: new Set<string>() });
      setLastUsedAt(
        buildWorkflowOrderingTimestamps(
          [],
          [],
          readStoredWorkflowLastUsedMap(),
        ),
      );
      setError(null);
      setLoading(false);
      hostedInitialAnnouncedRef.current = false;
      if (mode !== "local") {
        setMode("local");
      }
      return;
    }

    const hasExistingData = workflowsRef.current.length > 0 || hostedWorkflowsRef.current.length > 0;
    if (!hasExistingData) {
      setLoading(true);
    }
    setError(null);

    try {
      const workflowsPromise = isAdmin
        ? workflowsApi.list(token)
        : Promise.resolve<WorkflowSummary[]>([]);
      const hostedPromise = chatkitApi
        .getHostedWorkflows(token)
        .catch((err) => {
          if (isApiError(err) && err.status === 404) {
            return null;
          }
          if (import.meta.env.DEV) {
            console.warn("Impossible de charger le workflow hébergé.", err);
          }
          return null;
        });

      const [items, hosted] = await Promise.all([workflowsPromise, hostedPromise]);
      const hostedList = Array.isArray(hosted) ? hosted : [];

      hasLoadedWorkflowsRef.current = true;

      const storedSelection = readStoredWorkflowSelection();
      const defaultLocal =
        items.find((workflow) => workflow.is_chatkit_default && workflow.active_version_id !== null) ??
        items.find((workflow) => workflow.active_version_id !== null) ??
        null;

      let resolvedLocalWorkflow: WorkflowSummary | null = defaultLocal;
      if (storedSelection?.localWorkflowId != null) {
        const matchingLocal = items.find((workflow) => workflow.id === storedSelection.localWorkflowId);
        if (matchingLocal && matchingLocal.active_version_id !== null) {
          resolvedLocalWorkflow = matchingLocal;
        }
      }

      let resolvedHostedSlug: string | null = null;
      if (storedSelection?.hostedSlug) {
        const matchingHosted = hostedList.find((entry) => entry.slug === storedSelection.hostedSlug);
        if (matchingHosted) {
          resolvedHostedSlug = matchingHosted.slug;
        }
      }

      const fallbackHosted =
        hostedList.find((entry) => entry.available) ?? hostedList[0] ?? null;
      if (!resolvedHostedSlug && fallbackHosted) {
        resolvedHostedSlug = fallbackHosted.slug;
      }

      let resolvedMode: HostedFlowMode = mode;
      if (storedSelection) {
        if (storedSelection.mode === "hosted" && resolvedHostedSlug) {
          resolvedMode = "hosted";
        } else if (storedSelection.mode === "local" && resolvedLocalWorkflow) {
          resolvedMode = "local";
        }
      }

      if (resolvedMode === "hosted" && !resolvedHostedSlug) {
        resolvedMode = "local";
      }

      if (resolvedMode === "local" && !resolvedLocalWorkflow) {
        resolvedLocalWorkflow = defaultLocal;
      }

      const resolvedLocalId = resolvedLocalWorkflow?.id ?? null;

      setWorkflows(items);
      setHostedWorkflows(hostedList);
      setSelectedHostedSlug(resolvedHostedSlug ?? null);
      setSelectedWorkflowId(resolvedLocalId);

      if (resolvedMode !== mode) {
        setMode(resolvedMode);
      }

      hostedInitialAnnouncedRef.current = false;

      const availableLocalIds = new Set(items.map((workflow) => workflow.id));
      const availableHostedSlugs = new Set(hostedList.map((entry) => entry.slug));
      let sanitizedPinned: StoredWorkflowPinned | null = null;

      updateStoredWorkflowSelection((previous) => {
        const preservedHostedSlug =
          resolvedHostedSlug ??
          (previous?.hostedSlug &&
          hostedList.some((entry) => entry.slug === previous.hostedSlug)
            ? previous.hostedSlug
            : null);

        const basePinned = previous?.pinned ?? createEmptyStoredWorkflowPinned();
        sanitizedPinned = {
          local: basePinned.local.filter((id) => availableLocalIds.has(id)),
          hosted: basePinned.hosted.filter((slug) => availableHostedSlugs.has(slug)),
        };

        return {
          mode: resolvedMode,
          localWorkflowId: resolvedLocalId,
          hostedSlug: preservedHostedSlug,
          lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
          pinned: sanitizedPinned,
        };
      });

      if (sanitizedPinned) {
        setPinnedLookup({
          local: new Set<number>(sanitizedPinned.local),
          hosted: new Set<string>(sanitizedPinned.hosted),
        });
      }

      setLastUsedAt(
        buildWorkflowOrderingTimestamps(
          items,
          hostedList,
          readStoredWorkflowLastUsedMap(),
        ),
      );
    } catch (err) {
      let message = err instanceof Error ? err.message : "Impossible de charger les workflows.";
      if (isApiError(err) && err.status === 403) {
        message = "Vous n'avez pas les droits pour consulter les workflows.";
      }
      setError(message);
      setWorkflows([]);
      setHostedWorkflows([]);
      setSelectedHostedSlug(null);
      setSelectedWorkflowId(null);
      hostedInitialAnnouncedRef.current = false;
      if (mode !== "local") {
        setMode("local");
      }
      hasLoadedWorkflowsRef.current = false;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, token]);
  // Note: mode is intentionally not in deps to avoid reloading on mode change
  // We read mode from storage and update it if needed inside loadWorkflows

  // Auto-load on mount (only once if we have cache)
  useEffect(() => {
    // Only load if we haven't loaded yet, or if we don't have any data
    if (!hasLoadedWorkflowsRef.current || (workflowsRef.current.length === 0 && hostedWorkflowsRef.current.length === 0)) {
      void loadWorkflows();
    }
  }, [loadWorkflows]);

  const contextValue = useMemo<WorkflowSidebarContextValue>(
    () => ({
      workflows,
      hostedWorkflows,
      selectedWorkflowId,
      selectedHostedSlug,
      mode,
      loading,
      error,
      lastUsedAt,
      pinnedLookup,
      workflowCollator: workflowCollatorRef.current,
      setMode,
      setWorkflows: setWorkflowsStable,
      setHostedWorkflows: setHostedWorkflowsStable,
      setSelectedWorkflowId,
      setSelectedHostedSlug,
      toggleLocalPin,
      toggleHostedPin,
      loadWorkflows,
      workflowsRef,
      hostedWorkflowsRef,
      hasLoadedWorkflowsRef,
    }),
    [
      workflows,
      hostedWorkflows,
      selectedWorkflowId,
      selectedHostedSlug,
      mode,
      loading,
      error,
      lastUsedAt,
      pinnedLookup,
      setWorkflowsStable,
      setHostedWorkflowsStable,
      toggleLocalPin,
      toggleHostedPin,
      loadWorkflows,
    ],
  );

  return (
    <WorkflowSidebarContext.Provider value={contextValue}>
      {children}
    </WorkflowSidebarContext.Provider>
  );
};
