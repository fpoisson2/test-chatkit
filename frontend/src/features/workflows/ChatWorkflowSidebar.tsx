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

export const HOSTED_WORKFLOW_SLUG = "hosted-workflow" as const;

type HostedWorkflowSelection = {
  kind: "hosted";
  slug: typeof HOSTED_WORKFLOW_SLUG;
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
  const [hostedWorkflow, setHostedWorkflow] = useState<HostedWorkflowMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const hostedInitialAnnouncedRef = useRef(false);

  const loadWorkflows = useCallback(async () => {
    if (!token || !isAdmin) {
      setWorkflows([]);
      setHostedWorkflow(null);
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
          .getHostedWorkflow(token)
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
      setHostedWorkflow(hosted);
      const active =
        items.find((workflow) => workflow.is_chatkit_default && workflow.active_version_id !== null) ??
        items.find((workflow) => workflow.active_version_id !== null) ??
        null;
      setSelectedWorkflowId(active?.id ?? null);

      if (mode === "local") {
        onWorkflowActivated({ kind: "local", workflow: active ?? null }, { reason: "initial" });
      } else if (mode === "hosted" && !hosted) {
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
      setHostedWorkflow(null);
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
    if (mode === "hosted") {
      if (hostedWorkflow && !hostedInitialAnnouncedRef.current) {
        hostedInitialAnnouncedRef.current = true;
        onWorkflowActivated(
          { kind: "hosted", slug: HOSTED_WORKFLOW_SLUG, option: hostedWorkflow },
          { reason: "initial" },
        );
      }
    } else {
      hostedInitialAnnouncedRef.current = false;
    }
  }, [hostedWorkflow, mode, onWorkflowActivated]);

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

  const handleHostedWorkflowClick = useCallback(() => {
    if (!hostedWorkflow || !hostedWorkflow.available) {
      return;
    }

    hostedInitialAnnouncedRef.current = true;
    if (mode !== "hosted") {
      setMode("hosted");
    }
    onWorkflowActivated(
      { kind: "hosted", slug: HOSTED_WORKFLOW_SLUG, option: hostedWorkflow },
      { reason: "user" },
    );
    if (!isDesktopLayout) {
      closeSidebar();
    }
  }, [
    closeSidebar,
    hostedWorkflow,
    isDesktopLayout,
    mode,
    onWorkflowActivated,
    setMode,
  ]);

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

    const hasHostedWorkflow = Boolean(hostedWorkflow);
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
          {hasHostedWorkflow && (
            <li className="chatkit-sidebar__workflow-list-item" key={HOSTED_WORKFLOW_SLUG}>
              <button
                type="button"
                className="chatkit-sidebar__workflow-button"
                onClick={() => void handleHostedWorkflowClick()}
                disabled={!hostedWorkflow.available}
                aria-current={mode === "hosted" ? "true" : undefined}
              >
                {hostedWorkflow.label}
              </button>
            </li>
          )}
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
    hostedWorkflow,
    isAdmin,
    loadWorkflows,
    loading,
    mode,
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
