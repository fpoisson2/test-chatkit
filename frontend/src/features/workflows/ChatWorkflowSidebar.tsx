import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../auth";
import { useAppLayout, useSidebarPortal } from "../../components/AppLayout";
import { chatkitApi, workflowsApi } from "../../utils/backend";
import type { HostedWorkflowMetadata } from "../../utils/backend";
import type { WorkflowSummary } from "../../types/workflows";
import type { HostedFlowMode } from "../../hooks/useHostedFlow";
import {
  getWorkflowInitials,
  readStoredWorkflowSelection,
  updateStoredWorkflowSelection,
  writeStoredWorkflowSelection,
} from "./utils";

type WorkflowSidebarCache = {
  workflows: WorkflowSummary[];
  hostedWorkflows: HostedWorkflowMetadata[];
  selectedWorkflowId: number | null;
  selectedHostedSlug: string | null;
  mode: HostedFlowMode;
};

let workflowSidebarCache: WorkflowSidebarCache | null = null;

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
  const navigate = useNavigate();
  const { closeSidebar, isDesktopLayout, isSidebarCollapsed } = useAppLayout();
  const { setSidebarContent, setCollapsedSidebarContent, clearSidebarContent } = useSidebarPortal();
  const { token, user } = useAuth();
  const isAdmin = Boolean(user?.is_admin);
  const cachedState = useMemo(() => (token ? workflowSidebarCache : null), [token]);
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
  const hostedInitialAnnouncedRef = useRef(false);
  const onWorkflowActivatedRef = useRef(onWorkflowActivated);

  useEffect(() => {
    onWorkflowActivatedRef.current = onWorkflowActivated;
  }, [onWorkflowActivated]);

  const loadWorkflows = useCallback(async () => {
    if (!token) {
      workflowSidebarCache = null;
      writeStoredWorkflowSelection(null);
      setWorkflows([]);
      setHostedWorkflows([]);
      setSelectedHostedSlug(null);
      setSelectedWorkflowId(null);
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

      updateStoredWorkflowSelection((previous) => {
        const preservedHostedSlug =
          resolvedHostedSlug ??
          (previous?.hostedSlug &&
          hostedList.some((entry) => entry.slug === previous.hostedSlug)
            ? previous.hostedSlug
            : null);

        return {
          mode: resolvedMode,
          localWorkflowId: resolvedLocalId,
          hostedSlug: preservedHostedSlug,
        };
      });

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
      }));
      onWorkflowActivatedRef.current(
        { kind: "hosted", slug: option.slug, option },
        { reason: "user" },
      );
      if (!isDesktopLayout) {
        closeSidebar();
      }
    },
    [closeSidebar, hostedWorkflows, isDesktopLayout, mode, selectedWorkflowId, setMode],
  );

  const compactWorkflows = useMemo(
    () => [
      ...hostedWorkflows.map((option) => ({
        key: `hosted:${option.slug}`,
        label: option.label,
        onClick: () => void handleHostedWorkflowClick(option.slug),
        disabled: !option.available,
        isActive: mode === "hosted" && selectedHostedSlug === option.slug,
        initials: getWorkflowInitials(option.label),
      })),
      ...workflows.map((workflow) => ({
        key: `local:${workflow.id}`,
        label: workflow.display_name,
        onClick: () => void handleWorkflowClick(workflow.id),
        disabled: workflow.active_version_id === null,
        isActive: mode === "local" && workflow.id === selectedWorkflowId,
        initials: getWorkflowInitials(workflow.display_name),
      })),
    ],
    [
      handleHostedWorkflowClick,
      handleWorkflowClick,
      hostedWorkflows,
      mode,
      selectedHostedSlug,
      selectedWorkflowId,
      workflows,
    ],
  );

  useEffect(() => {
    if (!token) {
      workflowSidebarCache = null;
      return;
    }

    workflowSidebarCache = {
      workflows,
      hostedWorkflows,
      selectedWorkflowId,
      selectedHostedSlug,
      mode,
    };
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

    return (
      <section className="chatkit-sidebar__section" aria-labelledby={`${sectionId}-title`}>
        <div className="chatkit-sidebar__section-header">
          <h2 id={`${sectionId}-title`} className="chatkit-sidebar__section-title">
            Workflow
          </h2>
        </div>
        <ul className="chatkit-sidebar__workflow-list">
          {hostedWorkflows.map((option) => {
            const isSelected = mode === "hosted" && selectedHostedSlug === option.slug;
            return (
              <li className="chatkit-sidebar__workflow-list-item" key={option.slug}>
                <button
                  type="button"
                  className="chatkit-sidebar__workflow-button"
                  onClick={() => void handleHostedWorkflowClick(option.slug)}
                  disabled={!option.available}
                  aria-current={isSelected ? "true" : undefined}
                  title={option.description ?? undefined}
                >
                  {option.label}
                </button>
              </li>
            );
          })}
          {workflows.map((workflow) => {
            const isActive = mode === "local" && workflow.id === selectedWorkflowId;
            const hasProduction = workflow.active_version_id !== null;
            return (
              <li key={workflow.id} className="chatkit-sidebar__workflow-list-item">
                <button
                  type="button"
                  className="chatkit-sidebar__workflow-button"
                  onClick={() => void handleWorkflowClick(workflow.id)}
                  disabled={!hasProduction}
                  aria-current={isActive ? "true" : undefined}
                >
                  {workflow.display_name}
                </button>
              </li>
            );
          })}
        </ul>
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
    selectedHostedSlug,
    selectedWorkflowId,
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
              }`}
              onClick={workflow.onClick}
              disabled={workflow.disabled}
              aria-current={workflow.isActive ? "true" : undefined}
              tabIndex={isSidebarCollapsed ? 0 : -1}
            >
              <span aria-hidden="true" className="chatkit-sidebar__workflow-compact-initial">
                {workflow.initials}
              </span>
              <span className="visually-hidden">{workflow.label}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }, [compactWorkflows, error, isSidebarCollapsed, loading, user]);

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
