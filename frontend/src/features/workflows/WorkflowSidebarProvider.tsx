import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from "react";

import { useAuth } from "../../auth";
import { useSidebarPortal } from "../../components/AppLayout";
import { useHostedFlow } from "../../hooks/useHostedFlow";
import { chatkitApi, workflowsApi } from "../../utils/backend";
import type { HostedWorkflowMetadata } from "../../utils/backend";
import type { WorkflowSummary } from "../../types/workflows";
import {
  WORKFLOW_SELECTION_CHANGED_EVENT,
  buildWorkflowOrderingTimestamps,
  clearWorkflowSidebarCache,
  createEmptyStoredWorkflowPinned,
  readStoredWorkflowLastUsedMap,
  readStoredWorkflowPinnedLookup,
  readStoredWorkflowSelection,
  readWorkflowSidebarCache,
  recordWorkflowLastUsedAt,
  updateStoredWorkflowSelection,
  writeStoredWorkflowSelection,
  writeWorkflowSidebarCache,
  type StoredWorkflowLastUsedAt,
  type StoredWorkflowPinned,
  type StoredWorkflowPinnedLookup,
  type WorkflowSidebarCache,
} from "./utils";

type WorkflowSidebarContentRegistrar = (content: ReactNode | null) => () => void;

const isApiError = (error: unknown): error is { status?: number; message?: string } =>
  Boolean(error) && typeof error === "object" && "status" in error;

type WorkflowSidebarContextValue = {
  workflows: WorkflowSummary[];
  setWorkflows: Dispatch<SetStateAction<WorkflowSummary[]>>;
  workflowsRef: MutableRefObject<WorkflowSummary[]>;
  hostedWorkflows: HostedWorkflowMetadata[];
  setHostedWorkflows: Dispatch<SetStateAction<HostedWorkflowMetadata[]>>;
  hostedWorkflowsRef: MutableRefObject<HostedWorkflowMetadata[]>;
  selectedWorkflowId: number | null;
  setSelectedWorkflowId: Dispatch<SetStateAction<number | null>>;
  selectedHostedSlug: string | null;
  setSelectedHostedSlug: Dispatch<SetStateAction<string | null>>;
  initialSidebarCacheUsedRef: MutableRefObject<boolean>;
  mode: ReturnType<typeof useHostedFlow>["mode"];
  setMode: ReturnType<typeof useHostedFlow>["setMode"];
  hostedFlowEnabled: ReturnType<typeof useHostedFlow>["hostedFlowEnabled"];
  disableHostedFlow: ReturnType<typeof useHostedFlow>["disableHostedFlow"];
  enableHostedFlow: ReturnType<typeof useHostedFlow>["enableHostedFlow"];
  loading: boolean;
  error: string | null;
  isUpdating: boolean;
  lastUsedAt: StoredWorkflowLastUsedAt;
  pinnedLookup: StoredWorkflowPinnedLookup;
  toggleLocalPin: (workflowId: number) => void;
  toggleHostedPin: (slug: string) => void;
  workflowCollatorRef: MutableRefObject<Intl.Collator | null>;
  hasLoadedWorkflowsRef: MutableRefObject<boolean>;
  loadWorkflows: () => Promise<void>;
  selectLocalWorkflow: (workflowId: number) => Promise<WorkflowSummary | null>;
  selectHostedWorkflow: (slug: string) => HostedWorkflowMetadata | null;
  registerSidebarContent: WorkflowSidebarContentRegistrar;
  registerCollapsedContent: WorkflowSidebarContentRegistrar;
  clearRegisteredSidebarContent: () => void;
};

const WorkflowSidebarContext = createContext<WorkflowSidebarContextValue | null>(null);

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

const useInitialSidebarState = (hasToken: boolean) =>
  useMemo<WorkflowSidebarCache | null>(() => (hasToken ? readWorkflowSidebarCache() : null), [hasToken]);

export const WorkflowSidebarProvider = ({ children }: { children: ReactNode }) => {
  const { token, user } = useAuth();
  const isAdmin = Boolean(user?.is_admin);
  const { mode, setMode, hostedFlowEnabled, disableHostedFlow, enableHostedFlow } = useHostedFlow();
  const {
    setSidebarContent,
    clearSidebarContent,
    setCollapsedSidebarContent,
    clearCollapsedSidebarContent,
  } = useSidebarPortal();

  const initialCache = useInitialSidebarState(Boolean(token));
  const initialSidebarCacheUsedRef = useRef(Boolean(initialCache));

  const [workflows, setWorkflows] = useState<WorkflowSummary[]>(() => initialCache?.workflows ?? []);
  const [hostedWorkflows, setHostedWorkflows] = useState<HostedWorkflowMetadata[]>(
    () => initialCache?.hostedWorkflows ?? [],
  );
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(
    () => initialCache?.selectedWorkflowId ?? null,
  );
  const [selectedHostedSlug, setSelectedHostedSlug] = useState<string | null>(
    () => initialCache?.selectedHostedSlug ?? null,
  );
  const [loading, setLoading] = useState<boolean>(() => !initialCache);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
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

  const workflowsRef = useRef(workflows);
  const hostedWorkflowsRef = useRef(hostedWorkflows);
  const workflowCollatorRef = useRef<Intl.Collator | null>(ensureCollator(null));
  const hasLoadedWorkflowsRef = useRef(false);
  const previousTokenRef = useRef<string | null>(token ?? null);

  const persistPinnedLookup = useCallback(
    (next: StoredWorkflowPinnedLookup) => {
      const pinnedForStorage = buildPinnedForStorage(next);
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
    workflowCollatorRef.current = ensureCollator(workflowCollatorRef.current);
  }, []);

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

  const resetStateForSignedOutUser = useCallback(() => {
    clearWorkflowSidebarCache();
    hasLoadedWorkflowsRef.current = false;
    setWorkflows([]);
    setHostedWorkflows([]);
    setSelectedHostedSlug(null);
    setSelectedWorkflowId(null);
    setPinnedLookup({ local: new Set<number>(), hosted: new Set<string>() });
    setLastUsedAt(
      buildWorkflowOrderingTimestamps([], [], readStoredWorkflowLastUsedMap()),
    );
    setError(null);
    setLoading(false);
  }, []);

  const loadWorkflows = useCallback(async () => {
    const previousToken = previousTokenRef.current;
    previousTokenRef.current = token ?? null;

    if (!token) {
      if (previousToken) {
        writeStoredWorkflowSelection(null);
      }
      resetStateForSignedOutUser();
      if (mode !== "local") {
        setMode("local");
      }
      return;
    }

    const hasExistingData = workflows.length > 0 || hostedWorkflows.length > 0;
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

      const fallbackHosted = hostedList.find((entry) => entry.available) ?? hostedList[0] ?? null;
      if (!resolvedHostedSlug && fallbackHosted) {
        resolvedHostedSlug = fallbackHosted.slug;
      }

      let resolvedMode = mode;
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

      const availableLocalIds = new Set(items.map((workflow) => workflow.id));
      const availableHostedSlugs = new Set(hostedList.map((entry) => entry.slug));
      let sanitizedPinned: StoredWorkflowPinned | null = null;

      updateStoredWorkflowSelection((previous) => {
        const preservedHostedSlug =
          resolvedHostedSlug ??
          (previous?.hostedSlug && hostedList.some((entry) => entry.slug === previous.hostedSlug)
            ? previous.hostedSlug
            : null);

        const basePinned = previous?.pinned ?? createEmptyStoredWorkflowPinned();
        sanitizedPinned = {
          local: basePinned.local.filter((id) => availableLocalIds.has(id)),
          hosted: basePinned.hosted.filter((slug) => availableHostedSlugs.has(slug)),
        } satisfies StoredWorkflowPinned;

        return {
          mode: resolvedMode,
          localWorkflowId: resolvedLocalId,
          hostedSlug: preservedHostedSlug,
          lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
          pinned: sanitizedPinned!,
        };
      });

      if (sanitizedPinned) {
        setPinnedLookup({
          local: new Set<number>(sanitizedPinned.local),
          hosted: new Set<string>(sanitizedPinned.hosted),
        });
      }

      setLastUsedAt(
        buildWorkflowOrderingTimestamps(items, hostedList, readStoredWorkflowLastUsedMap()),
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
      hasLoadedWorkflowsRef.current = false;
      if (mode !== "local") {
        setMode("local");
      }
    } finally {
      setLoading(false);
    }
  }, [
    isAdmin,
    mode,
    resetStateForSignedOutUser,
    setMode,
    token,
    workflows.length,
    hostedWorkflows.length,
  ]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

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

  const selectLocalWorkflow = useCallback(
    async (workflowId: number) => {
      if (!token || !isAdmin || workflowId === selectedWorkflowId || isUpdating) {
        return null;
      }

      const workflowToActivate = workflowsRef.current.find((workflow) => workflow.id === workflowId);
      if (!workflowToActivate || workflowToActivate.active_version_id === null) {
        return null;
      }

      setIsUpdating(true);
      setError(null);
      try {
        const updated = await workflowsApi.setChatkitWorkflow(token, workflowId);
        setWorkflows((current) => {
          const exists = current.some((workflow) => workflow.id === updated.id);
          if (!exists) {
            return [
              ...current.map((workflow) => ({
                ...workflow,
                is_chatkit_default: false,
              })),
              updated,
            ];
          }
          return current.map((workflow) =>
            workflow.id === updated.id ? updated : { ...workflow, is_chatkit_default: false },
          );
        });
        setSelectedWorkflowId(updated.id);
        updateStoredWorkflowSelection((previous) => ({
          mode: "local",
          localWorkflowId: updated.id,
          hostedSlug: previous?.hostedSlug ?? selectedHostedSlug ?? null,
          lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
          pinned: previous?.pinned ?? createEmptyStoredWorkflowPinned(),
        }));
        const updatedLastUsed = recordWorkflowLastUsedAt({
          kind: "local",
          workflow: updated,
        });
        setLastUsedAt(updatedLastUsed);
        if (mode !== "local") {
          setMode("local");
        }
        return updated;
      } catch (err) {
        let message = err instanceof Error ? err.message : "Impossible de sélectionner le workflow.";
        if (isApiError(err) && err.status === 400) {
          message = "Publiez une version de production avant d'activer ce workflow.";
        }
        setError(message);
        return null;
      } finally {
        setIsUpdating(false);
      }
    },
    [isAdmin, isUpdating, mode, selectedHostedSlug, selectedWorkflowId, setMode, token],
  );

  const selectHostedWorkflow = useCallback(
    (slug: string) => {
      const option = hostedWorkflowsRef.current.find((entry) => entry.slug === slug);
      if (!option || !option.available) {
        return null;
      }

      setSelectedHostedSlug(slug);
      updateStoredWorkflowSelection((previous) => ({
        mode: "hosted",
        localWorkflowId: previous?.localWorkflowId ?? selectedWorkflowId ?? null,
        hostedSlug: option.slug,
        lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
        pinned: previous?.pinned ?? createEmptyStoredWorkflowPinned(),
      }));
      const updatedLastUsed = recordWorkflowLastUsedAt({
        kind: "hosted",
        workflow: option,
      });
      setLastUsedAt(updatedLastUsed);
      if (mode !== "hosted") {
        setMode("hosted");
      }
      return option;
    },
    [mode, selectedWorkflowId, setMode],
  );

  const registerSidebarContent = useCallback<WorkflowSidebarContentRegistrar>(
    (content) => {
      setSidebarContent(content);
      return () => {
        clearSidebarContent();
      };
    },
    [clearSidebarContent, setSidebarContent],
  );

  const registerCollapsedContent = useCallback<WorkflowSidebarContentRegistrar>(
    (content) => {
      setCollapsedSidebarContent(content);
      return () => {
        clearCollapsedSidebarContent();
      };
    },
    [clearCollapsedSidebarContent, setCollapsedSidebarContent],
  );

  const clearRegisteredSidebarContent = useCallback(() => {
    clearSidebarContent();
    clearCollapsedSidebarContent();
  }, [clearCollapsedSidebarContent, clearSidebarContent]);

  const value = useMemo<WorkflowSidebarContextValue>(
    () => ({
      workflows,
      setWorkflows,
      workflowsRef,
      hostedWorkflows,
      setHostedWorkflows,
      hostedWorkflowsRef,
      selectedWorkflowId,
      setSelectedWorkflowId,
      selectedHostedSlug,
      setSelectedHostedSlug,
      initialSidebarCacheUsedRef,
      mode,
      setMode,
      hostedFlowEnabled,
      disableHostedFlow,
      enableHostedFlow,
      loading,
      error,
      isUpdating,
      lastUsedAt,
      pinnedLookup,
      toggleLocalPin,
      toggleHostedPin,
      workflowCollatorRef,
      hasLoadedWorkflowsRef,
      loadWorkflows,
      selectLocalWorkflow,
      selectHostedWorkflow,
      registerSidebarContent,
      registerCollapsedContent,
      clearRegisteredSidebarContent,
    }),
    [
      disableHostedFlow,
      enableHostedFlow,
      error,
      hostedFlowEnabled,
      hostedWorkflows,
      isUpdating,
      lastUsedAt,
      loadWorkflows,
      loading,
      mode,
      pinnedLookup,
      registerCollapsedContent,
      registerSidebarContent,
      selectHostedWorkflow,
      selectLocalWorkflow,
      selectedHostedSlug,
      selectedWorkflowId,
      toggleHostedPin,
      toggleLocalPin,
      workflows,
    ],
  );

  return <WorkflowSidebarContext.Provider value={value}>{children}</WorkflowSidebarContext.Provider>;
};

export const useWorkflowSidebar = () => {
  const context = useContext(WorkflowSidebarContext);
  if (!context) {
    throw new Error("useWorkflowSidebar must be used within WorkflowSidebarProvider");
  }
  return context;
};

