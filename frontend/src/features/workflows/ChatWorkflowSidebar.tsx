import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Star } from "lucide-react";

import { useAuth } from "../../auth";
import { useI18n } from "../../i18n";
import { useAppLayout, useSidebarPortal } from "../../components/AppLayout";
import { chatkitApi, workflowsApi } from "../../utils/backend";
import type { HostedWorkflowMetadata } from "../../utils/backend";
import type { WorkflowSummary } from "../../types/workflows";
import type { HostedFlowMode } from "../../hooks/useHostedFlow";
import {
  buildWorkflowOrderingTimestamps,
  clearWorkflowSidebarCache,
  getWorkflowInitials,
  isWorkflowPinned,
  orderWorkflowEntries,
  recordWorkflowLastUsedAt,
  readStoredWorkflowSelection,
  readStoredWorkflowLastUsedMap,
  readWorkflowSidebarCache,
  readStoredWorkflowPinnedLookup,
  createEmptyStoredWorkflowPinned,
  type StoredWorkflowPinned,
  type StoredWorkflowPinnedLookup,
  type StoredWorkflowLastUsedAt,
  updateStoredWorkflowSelection,
  WORKFLOW_SELECTION_CHANGED_EVENT,
  writeStoredWorkflowSelection,
  writeWorkflowSidebarCache,
} from "./utils";

const isApiError = (error: unknown): error is { status?: number; message?: string } =>
  Boolean(error) && typeof error === "object" && "status" in error;

type ActivationContext = { reason: "initial" | "user" };

type HostedWorkflowSelection = {
  kind: "hosted";
  slug: string;
  option: HostedWorkflowMetadata;
};

type LocalWorkflowSelection = {
  kind: "local";
  workflow: WorkflowSummary | null;
};

export type WorkflowActivation = HostedWorkflowSelection | LocalWorkflowSelection;

type ChatWorkflowSidebarProps = {
  mode: HostedFlowMode;
  setMode: (mode: HostedFlowMode) => void;
  onWorkflowActivated: (selection: WorkflowActivation, context: ActivationContext) => void;
};

export const ChatWorkflowSidebar = ({ mode, setMode, onWorkflowActivated }: ChatWorkflowSidebarProps) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { closeSidebar, isDesktopLayout, isSidebarCollapsed } = useAppLayout();
  const { setSidebarContent, setCollapsedSidebarContent, clearSidebarContent } = useSidebarPortal();
  const { token, user } = useAuth();
  const isAdmin = Boolean(user?.is_admin);
  const cachedState = useMemo(() => (token ? readWorkflowSidebarCache() : null), [token]);
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
  const [loading, setLoading] = useState(() => !cachedState);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
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
  const workflowsRef = useRef(workflows);
  const hostedWorkflowsRef = useRef(hostedWorkflows);
  const hostedInitialAnnouncedRef = useRef(false);
  const onWorkflowActivatedRef = useRef(onWorkflowActivated);
  const workflowCollatorRef = useRef<Intl.Collator | null>(null);
  const previousTokenRef = useRef<string | null>(token ?? null);

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
    onWorkflowActivatedRef.current = onWorkflowActivated;
  }, [onWorkflowActivated]);

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
    setPinnedLookup((current) => {
      if (!token) {
        return current;
      }

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

  const loadWorkflows = useCallback(async () => {
    const previousToken = previousTokenRef.current;
    previousTokenRef.current = token ?? null;

    if (!token) {
      clearWorkflowSidebarCache();
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
      onWorkflowActivatedRef.current({ kind: "local", workflow: null }, { reason: "initial" });
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

      if (resolvedMode === "local") {
        onWorkflowActivatedRef.current(
          { kind: "local", workflow: resolvedLocalWorkflow ?? null },
          { reason: "initial" },
        );
      }
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
      onWorkflowActivatedRef.current({ kind: "local", workflow: null }, { reason: "initial" });
    } finally {
      setLoading(false);
    }
  }, [
    hostedWorkflows.length,
    isAdmin,
    mode,
    setMode,
    token,
    workflows.length,
  ]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  useEffect(() => {
    if (mode !== "hosted") {
      hostedInitialAnnouncedRef.current = false;
      return;
    }

    if (hostedWorkflows.length === 0) {
      return;
    }

    const ensureSelectedSlug = () => {
      if (selectedHostedSlug && hostedWorkflows.some((entry) => entry.slug === selectedHostedSlug)) {
        return selectedHostedSlug;
      }
      const preferred = hostedWorkflows.find((entry) => entry.available) ?? hostedWorkflows[0];
      const slug = preferred?.slug ?? null;
      if (slug && slug !== selectedHostedSlug) {
        setSelectedHostedSlug(slug);
      }
      return slug;
    };

    const activeSlug = ensureSelectedSlug();
    if (!activeSlug) {
      return;
    }

    if (!hostedInitialAnnouncedRef.current) {
      const option = hostedWorkflows.find((entry) => entry.slug === activeSlug);
      if (option) {
        hostedInitialAnnouncedRef.current = true;
        onWorkflowActivatedRef.current(
          { kind: "hosted", slug: option.slug, option },
          { reason: "initial" },
        );
      }
    }
  }, [hostedWorkflows, mode, selectedHostedSlug]);

  const handleWorkflowClick = useCallback(
    async (workflowId: number) => {
      if (!token || !isAdmin || workflowId === selectedWorkflowId || isUpdating) {
        return;
      }

      const workflowToActivate = workflows.find((workflow) => workflow.id === workflowId);
      if (!workflowToActivate || workflowToActivate.active_version_id === null) {
        return;
      }

      const previousMode = mode;
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
          hostedSlug: previous?.hostedSlug ?? null,
          lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
          pinned: previous?.pinned ?? createEmptyStoredWorkflowPinned(),
        }));
        if (mode !== "local") {
          setMode("local");
        }
        onWorkflowActivatedRef.current(
          { kind: "local", workflow: updated.active_version_id ? updated : null },
          { reason: "user" },
        );
        if (!isDesktopLayout) {
          closeSidebar();
        }
        const updatedLastUsed = recordWorkflowLastUsedAt({
          kind: "local",
          workflow: updated,
        });
        setLastUsedAt(updatedLastUsed);
      } catch (err) {
        let message = err instanceof Error ? err.message : "Impossible de sélectionner le workflow.";
        if (isApiError(err) && err.status === 400) {
          message = "Publiez une version de production avant d'activer ce workflow.";
        }
        setError(message);
        if (previousMode !== "local") {
          setMode(previousMode);
        }
      } finally {
        setIsUpdating(false);
      }
    },
    [
      closeSidebar,
      isAdmin,
      isDesktopLayout,
      isUpdating,
      mode,
      selectedWorkflowId,
      setMode,
      token,
      workflows,
    ],
  );

  const handleHostedWorkflowClick = useCallback(
    (slug: string) => {
      const option = hostedWorkflows.find((entry) => entry.slug === slug);
      if (!option || !option.available) {
        return;
      }

      hostedInitialAnnouncedRef.current = true;
      setSelectedHostedSlug(slug);
      if (mode !== "hosted") {
        setMode("hosted");
      }
      updateStoredWorkflowSelection((previous) => ({
        mode: "hosted",
        localWorkflowId: previous?.localWorkflowId ?? selectedWorkflowId ?? null,
        hostedSlug: option.slug,
        lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
        pinned: previous?.pinned ?? createEmptyStoredWorkflowPinned(),
      }));
      onWorkflowActivatedRef.current(
        { kind: "hosted", slug: option.slug, option },
        { reason: "user" },
      );
      const updatedLastUsed = recordWorkflowLastUsedAt({
        kind: "hosted",
        workflow: option,
      });
      setLastUsedAt(updatedLastUsed);
      if (!isDesktopLayout) {
        closeSidebar();
      }
    },
    [closeSidebar, hostedWorkflows, isDesktopLayout, mode, selectedWorkflowId, setMode],
  );

  const sortedWorkflowEntries = useMemo(() => {
    const collator =
      workflowCollatorRef.current ?? new Intl.Collator(undefined, { sensitivity: "base" });
    return orderWorkflowEntries(
      [
        ...hostedWorkflows.map((workflow) => ({ kind: "hosted" as const, workflow })),
        ...workflows.map((workflow) => ({ kind: "local" as const, workflow })),
      ],
      lastUsedAt,
      { collator, pinnedLookup },
    );
  }, [hostedWorkflows, lastUsedAt, pinnedLookup, workflows]);

  const compactWorkflows = useMemo(
    () =>
      sortedWorkflowEntries.map((entry) => {
        if (entry.kind === "hosted") {
          const option = entry.workflow;
          return {
            key: `hosted:${option.slug}`,
            label: option.label,
            onClick: () => void handleHostedWorkflowClick(option.slug),
            disabled: !option.available,
            isActive: mode === "hosted" && selectedHostedSlug === option.slug,
            initials: getWorkflowInitials(option.label),
            kind: "hosted" as const,
          };
        }

        const workflow = entry.workflow;
        return {
          key: `local:${workflow.id}`,
          label: workflow.display_name,
          onClick: () => void handleWorkflowClick(workflow.id),
          disabled: workflow.active_version_id === null,
          isActive: mode === "local" && workflow.id === selectedWorkflowId,
          initials: getWorkflowInitials(workflow.display_name),
          kind: "local" as const,
        };
      }),
    [
      handleHostedWorkflowClick,
      handleWorkflowClick,
      mode,
      selectedHostedSlug,
      selectedWorkflowId,
      sortedWorkflowEntries,
    ],
  );

  type CombinedEntry =
    | { kind: "hosted"; option: HostedWorkflowMetadata; isPinned: boolean }
    | { kind: "local"; workflow: WorkflowSummary; isPinned: boolean };

  const combinedEntries: CombinedEntry[] = useMemo(
    () =>
      sortedWorkflowEntries.map((entry) =>
        entry.kind === "hosted"
          ? ({
              kind: "hosted" as const,
              option: entry.workflow,
              isPinned: isWorkflowPinned(entry, pinnedLookup),
            })
          : ({
              kind: "local" as const,
              workflow: entry.workflow,
              isPinned: isWorkflowPinned(entry, pinnedLookup),
            })
      ),
    [pinnedLookup, sortedWorkflowEntries],
  );

  const pinnedCombinedEntries = useMemo(
    () => combinedEntries.filter((entry) => entry.isPinned),
    [combinedEntries],
  );

  const regularCombinedEntries = useMemo(
    () => combinedEntries.filter((entry) => !entry.isPinned),
    [combinedEntries],
  );

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

  const handleOpenBuilder = useCallback(() => {
    navigate("/workflows");
    if (!isDesktopLayout) {
      closeSidebar();
    }
  }, [closeSidebar, isDesktopLayout, navigate]);

  const sidebarContent = useMemo(() => {
    const sectionId = "chat-sidebar-workflow";

    if (!user) {
      return (
        <section className="chatkit-sidebar__section" aria-live="polite">
          <h2 className="chatkit-sidebar__section-title">Workflow</h2>
          <p className="chatkit-sidebar__section-text">
            Connectez-vous pour choisir le workflow utilisé par ChatKit.
          </p>
        </section>
      );
    }

    if (error) {
      return (
        <section className="chatkit-sidebar__section" aria-live="polite">
          <h2 className="chatkit-sidebar__section-title">Workflow</h2>
          <p className="chatkit-sidebar__section-error">{error}</p>
          <button
            type="button"
            className="chatkit-sidebar__section-button"
            onClick={() => void loadWorkflows()}
            disabled={loading}
          >
            Réessayer
          </button>
        </section>
      );
    }

    if (loading) {
      return (
        <section className="chatkit-sidebar__section" aria-live="polite">
          <h2 className="chatkit-sidebar__section-title">Workflow</h2>
          <p className="chatkit-sidebar__section-text">Chargement des workflows…</p>
        </section>
      );
    }

    const hasHostedWorkflow = hostedWorkflows.length > 0;
    const hasLocalWorkflows = workflows.length > 0;

    if (!hasHostedWorkflow && !hasLocalWorkflows) {
      return (
        <section className="chatkit-sidebar__section" aria-live="polite">
          <h2 className="chatkit-sidebar__section-title">Workflow</h2>
          <p className="chatkit-sidebar__section-text">
            Publiez un workflow pour qu'il soit disponible dans le chat.
          </p>
          {isAdmin ? (
            <button type="button" className="chatkit-sidebar__section-button" onClick={handleOpenBuilder}>
              Ouvrir le workflow builder
            </button>
          ) : null}
        </section>
      );
    }

    const renderEntry = (entry: CombinedEntry) => {
      if (entry.kind === "hosted") {
        const { option, isPinned } = entry;
        const isSelected = mode === "hosted" && selectedHostedSlug === option.slug;
        const pinLabel = isPinned
          ? t("workflows.unpinAction", { label: option.label })
          : t("workflows.pinAction", { label: option.label });
        return (
          <li
            className="chatkit-sidebar__workflow-list-item"
            key={`hosted:${option.slug}`}
            data-hosted-workflow=""
          >
            <button
              type="button"
              className="chatkit-sidebar__workflow-button chatkit-sidebar__workflow-button--hosted"
              onClick={() => void handleHostedWorkflowClick(option.slug)}
              disabled={!option.available}
              aria-current={isSelected ? "true" : undefined}
              title={option.description ?? t("workflows.hostedBadge")}
            >
              <span className="chatkit-sidebar__workflow-label">{option.label}</span>
              <span className="chatkit-sidebar__workflow-badge chatkit-sidebar__workflow-badge--hosted">
                {t("workflows.hostedBadge")}
              </span>
            </button>
            <div className="chatkit-sidebar__workflow-actions">
              <button
                type="button"
                className="chatkit-sidebar__workflow-action-button chatkit-sidebar__workflow-pin-button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleHostedPin(option.slug);
                }}
                aria-pressed={isPinned}
                aria-label={pinLabel}
                title={pinLabel}
              >
                <Star
                  aria-hidden="true"
                  className="chatkit-sidebar__workflow-pin-icon"
                  size={18}
                  strokeWidth={isPinned ? 1.75 : 2}
                  fill={isPinned ? "currentColor" : "none"}
                />
              </button>
            </div>
            {!option.available ? (
              <p className="chatkit-sidebar__workflow-meta" aria-live="polite">
                {t("workflows.hostedUnavailable")}
              </p>
            ) : null}
            {option.description ? (
              <p className="chatkit-sidebar__workflow-meta">{option.description}</p>
            ) : null}
          </li>
        );
      }

      const { workflow, isPinned } = entry;
      const isActive = mode === "local" && workflow.id === selectedWorkflowId;
      const hasProduction = workflow.active_version_id !== null;
      const pinLabel = isPinned
        ? t("workflows.unpinAction", { label: workflow.display_name })
        : t("workflows.pinAction", { label: workflow.display_name });
      return (
        <li key={`local:${workflow.id}`} className="chatkit-sidebar__workflow-list-item">
          <button
            type="button"
            className="chatkit-sidebar__workflow-button"
            onClick={() => void handleWorkflowClick(workflow.id)}
            disabled={!hasProduction}
            aria-current={isActive ? "true" : undefined}
          >
            <span className="chatkit-sidebar__workflow-label">{workflow.display_name}</span>
          </button>
          <div className="chatkit-sidebar__workflow-actions">
            <button
              type="button"
              className="chatkit-sidebar__workflow-action-button chatkit-sidebar__workflow-pin-button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleLocalPin(workflow.id);
              }}
              aria-pressed={isPinned}
              aria-label={pinLabel}
              title={pinLabel}
            >
              <Star
                aria-hidden="true"
                className="chatkit-sidebar__workflow-pin-icon"
                size={18}
                strokeWidth={isPinned ? 1.75 : 2}
                fill={isPinned ? "currentColor" : "none"}
              />
            </button>
          </div>
        </li>
      );
    };

    return (
      <section className="chatkit-sidebar__section" aria-labelledby={`${sectionId}-title`}>
        <div className="chatkit-sidebar__section-header">
          <h2 id={`${sectionId}-title`} className="chatkit-sidebar__section-title">
            Workflow
          </h2>
        </div>
        {pinnedCombinedEntries.length > 0 ? (
          <div
            className="chatkit-sidebar__workflow-group chatkit-sidebar__workflow-group--pinned"
            data-workflow-group="pinned"
          >
            <h3 className="chatkit-sidebar__workflow-group-title">
              {t("workflows.pinnedSectionTitle")}
            </h3>
            <ul className="chatkit-sidebar__workflow-list chatkit-sidebar__workflow-list--grouped">
              {pinnedCombinedEntries.map((entry) => renderEntry(entry))}
            </ul>
          </div>
        ) : null}
        {regularCombinedEntries.length > 0 ? (
          <ul className="chatkit-sidebar__workflow-list" data-workflow-group="default">
            {regularCombinedEntries.map((entry) => renderEntry(entry))}
          </ul>
        ) : null}
        {!hasLocalWorkflows && isAdmin ? (
          <button
            type="button"
            className="chatkit-sidebar__section-button"
            onClick={handleOpenBuilder}
          >
            Ouvrir le workflow builder
          </button>
        ) : null}
      </section>
    );
  }, [
    error,
    handleOpenBuilder,
    handleHostedWorkflowClick,
    handleWorkflowClick,
    hostedWorkflows,
    isAdmin,
    loadWorkflows,
    loading,
    mode,
    pinnedCombinedEntries,
    regularCombinedEntries,
    toggleHostedPin,
    toggleLocalPin,
    selectedHostedSlug,
    selectedWorkflowId,
    t,
    user,
    workflows,
  ]);

  const collapsedSidebarContent = useMemo(() => {
    if (!user || error || loading || compactWorkflows.length === 0) {
      return null;
    }

    return (
      <ul className="chatkit-sidebar__workflow-compact-list" role="list">
        {compactWorkflows.map((workflow) => (
          <li key={workflow.key} className="chatkit-sidebar__workflow-compact-item">
            <button
              type="button"
              className={`chatkit-sidebar__workflow-compact-button${
                workflow.isActive ? " chatkit-sidebar__workflow-compact-button--active" : ""
              }${workflow.kind === "hosted" ? " chatkit-sidebar__workflow-compact-button--hosted" : ""}`}
              onClick={workflow.onClick}
              disabled={workflow.disabled}
              aria-current={workflow.isActive ? "true" : undefined}
              tabIndex={isSidebarCollapsed ? 0 : -1}
              aria-label={
                workflow.kind === "hosted"
                  ? t("workflows.hostedCompactLabel", { label: workflow.label })
                  : workflow.label
              }
            >
              <span aria-hidden="true" className="chatkit-sidebar__workflow-compact-initial">
                {workflow.initials}
              </span>
              <span className="visually-hidden">
                {workflow.label}
                {workflow.kind === "hosted" ? ` (${t("workflows.hostedBadge")})` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }, [compactWorkflows, error, isSidebarCollapsed, loading, t, user]);

  useEffect(() => {
    setSidebarContent(sidebarContent);
    setCollapsedSidebarContent(collapsedSidebarContent);
    return () => clearSidebarContent();
  }, [
    clearSidebarContent,
    collapsedSidebarContent,
    setCollapsedSidebarContent,
    setSidebarContent,
    sidebarContent,
  ]);

  return null;
};
