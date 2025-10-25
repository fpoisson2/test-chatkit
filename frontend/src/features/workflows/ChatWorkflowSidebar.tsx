import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../auth";
import { useAppLayout, useSidebarPortal } from "../../components/AppLayout";
import { chatkitApi, workflowsApi } from "../../utils/backend";
import type { HostedWorkflowMetadata } from "../../utils/backend";
import type { WorkflowSummary } from "../../types/workflows";
import type { HostedFlowMode } from "../../hooks/useHostedFlow";

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
  const { closeSidebar, isDesktopLayout } = useAppLayout();
  const { setSidebarContent, clearSidebarContent } = useSidebarPortal();
  const { token, user } = useAuth();
  const isAdmin = Boolean(user?.is_admin);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null);
  const [hostedWorkflows, setHostedWorkflows] = useState<HostedWorkflowMetadata[]>([]);
  const [selectedHostedSlug, setSelectedHostedSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const hostedInitialAnnouncedRef = useRef(false);

  const loadWorkflows = useCallback(async () => {
    if (!token || !isAdmin) {
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
      onWorkflowActivated({ kind: "local", workflow: null }, { reason: "initial" });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [items, hosted] = await Promise.all([
        workflowsApi.list(token),
        chatkitApi
          .getHostedWorkflows(token)
          .catch((err) => {
            if (isApiError(err) && err.status === 404) {
              return null;
            }
            if (import.meta.env.DEV) {
              console.warn("Impossible de charger le workflow hébergé.", err);
            }
            return null;
          }),
      ]);
      setWorkflows(items);
      const hostedList = Array.isArray(hosted) ? hosted : [];
      setHostedWorkflows(hostedList);
      setSelectedHostedSlug((current) => {
        if (!hostedList.length) {
          return null;
        }
        if (current && hostedList.some((entry) => entry.slug === current)) {
          return current;
        }
        const preferred = hostedList.find((entry) => entry.available) ?? hostedList[0];
        return preferred?.slug ?? null;
      });
      const active =
        items.find((workflow) => workflow.is_chatkit_default && workflow.active_version_id !== null) ??
        items.find((workflow) => workflow.active_version_id !== null) ??
        null;
      setSelectedWorkflowId(active?.id ?? null);

      if (mode === "local") {
        onWorkflowActivated({ kind: "local", workflow: active ?? null }, { reason: "initial" });
      } else if (mode === "hosted" && hostedList.length === 0) {
        setMode("local");
        onWorkflowActivated({ kind: "local", workflow: active ?? null }, { reason: "initial" });
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
      onWorkflowActivated({ kind: "local", workflow: null }, { reason: "initial" });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, mode, onWorkflowActivated, setMode, token]);

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
        onWorkflowActivated(
          { kind: "hosted", slug: option.slug, option },
          { reason: "initial" },
        );
      }
    }
  }, [hostedWorkflows, mode, onWorkflowActivated, selectedHostedSlug]);

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
        if (mode !== "local") {
          setMode("local");
        }
        onWorkflowActivated(
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
      onWorkflowActivated,
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
      onWorkflowActivated(
        { kind: "hosted", slug: option.slug, option },
        { reason: "user" },
      );
      if (!isDesktopLayout) {
        closeSidebar();
      }
    },
    [
      closeSidebar,
      hostedWorkflows,
      isDesktopLayout,
      mode,
      onWorkflowActivated,
      setMode,
    ],
  );

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

    if (!isAdmin) {
      return (
        <section className="chatkit-sidebar__section" aria-live="polite">
          <h2 className="chatkit-sidebar__section-title">Workflow</h2>
          <p className="chatkit-sidebar__section-text">
            Votre rôle ne permet pas de modifier le workflow ChatKit.
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
          <button type="button" className="chatkit-sidebar__section-button" onClick={handleOpenBuilder}>
            Ouvrir le workflow builder
          </button>
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
        {!hasLocalWorkflows ? (
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

  useEffect(() => {
    setSidebarContent(sidebarContent);
    return () => clearSidebarContent();
  }, [clearSidebarContent, setSidebarContent, sidebarContent]);

  return null;
};
