import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../auth";
import { useAppLayout, useSidebarPortal } from "../../components/AppLayout";
import { useI18n } from "../../i18n";
import { workflowsApi } from "../../utils/backend";
import type { WorkflowSummary } from "../../types/workflows";

const isApiError = (error: unknown): error is { status?: number; message?: string } =>
  Boolean(error) && typeof error === "object" && "status" in error;

const HOSTED_WORKFLOW_KEY = "hosted" as const;

type WorkflowSelectionKey = typeof HOSTED_WORKFLOW_KEY | number;

type ActivationContext = { reason: "initial" | "user"; mode: "local" | "hosted" };

type ChatWorkflowSidebarProps = {
  hostedFlowEnabled: boolean;
  onWorkflowActivated: (workflow: WorkflowSummary | null, context: ActivationContext) => void;
};

export const ChatWorkflowSidebar = ({ hostedFlowEnabled, onWorkflowActivated }: ChatWorkflowSidebarProps) => {
  const navigate = useNavigate();
  const { closeSidebar, isDesktopLayout } = useAppLayout();
  const { setSidebarContent, clearSidebarContent } = useSidebarPortal();
  const { token, user } = useAuth();
  const { t } = useI18n();
  const isAdmin = Boolean(user?.is_admin);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedWorkflowKey, setSelectedWorkflowKey] = useState<WorkflowSelectionKey | null>(
    hostedFlowEnabled ? HOSTED_WORKFLOW_KEY : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const loadWorkflows = useCallback(async () => {
    const initialMode: ActivationContext["mode"] = hostedFlowEnabled ? "hosted" : "local";

    if (!token || !isAdmin) {
      setWorkflows([]);
      setSelectedWorkflowKey(hostedFlowEnabled ? HOSTED_WORKFLOW_KEY : null);
      setError(null);
      setLoading(false);
      onWorkflowActivated(null, { reason: "initial", mode: initialMode });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const items = await workflowsApi.list(token);
      setWorkflows(items);

      if (hostedFlowEnabled) {
        setSelectedWorkflowKey(HOSTED_WORKFLOW_KEY);
        onWorkflowActivated(null, { reason: "initial", mode: "hosted" });
        return;
      }

      const active =
        items.find((workflow) => workflow.is_chatkit_default && workflow.active_version_id !== null) ??
        items.find((workflow) => workflow.active_version_id !== null) ??
        null;
      const nextKey: WorkflowSelectionKey | null = active?.id ?? null;
      setSelectedWorkflowKey(nextKey);
      onWorkflowActivated(active ?? null, { reason: "initial", mode: "local" });
    } catch (err) {
      let message = err instanceof Error ? err.message : "Impossible de charger les workflows.";
      if (isApiError(err) && err.status === 403) {
        message = "Vous n'avez pas les droits pour consulter les workflows.";
      }
      setError(message);
      setWorkflows([]);
      setSelectedWorkflowKey(hostedFlowEnabled ? HOSTED_WORKFLOW_KEY : null);
      onWorkflowActivated(null, { reason: "initial", mode: initialMode });
    } finally {
      setLoading(false);
    }
  }, [hostedFlowEnabled, isAdmin, onWorkflowActivated, token]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  const handleWorkflowClick = useCallback(
    async (workflowId: number) => {
      if (!token || !isAdmin || workflowId === selectedWorkflowKey || isUpdating) {
        return;
      }

      const workflowToActivate = workflows.find((workflow) => workflow.id === workflowId);
      if (!workflowToActivate || workflowToActivate.active_version_id === null) {
        return;
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
        setSelectedWorkflowKey(updated.id);
        onWorkflowActivated(updated.active_version_id ? updated : null, {
          reason: "user",
          mode: "local",
        });
        if (!isDesktopLayout) {
          closeSidebar();
        }
      } catch (err) {
        let message = err instanceof Error ? err.message : "Impossible de sélectionner le workflow.";
        if (isApiError(err) && err.status === 400) {
          message = "Publiez une version de production avant d'activer ce workflow.";
        }
        setError(message);
      } finally {
        setIsUpdating(false);
      }
    },
    [
      closeSidebar,
      isAdmin,
      isDesktopLayout,
      isUpdating,
      onWorkflowActivated,
      selectedWorkflowKey,
      token,
      workflows,
    ],
  );

  const handleHostedClick = useCallback(() => {
    if (selectedWorkflowKey === HOSTED_WORKFLOW_KEY) {
      return;
    }

    setError(null);
    setSelectedWorkflowKey(HOSTED_WORKFLOW_KEY);
    onWorkflowActivated(null, { reason: "user", mode: "hosted" });
    if (!isDesktopLayout) {
      closeSidebar();
    }
  }, [closeSidebar, isDesktopLayout, onWorkflowActivated, selectedWorkflowKey]);

  const handleOpenBuilder = useCallback(() => {
    navigate("/workflows");
    if (!isDesktopLayout) {
      closeSidebar();
    }
  }, [closeSidebar, isDesktopLayout, navigate]);

  const sidebarContent = useMemo(() => {
    const sectionId = "chat-sidebar-workflow";
    const hostedWorkflowLabel = t("chat.sidebar.hostedWorkflow.label");
    const isHostedActive = selectedWorkflowKey === HOSTED_WORKFLOW_KEY;

    const workflowList = (
      <ul className="chatkit-sidebar__workflow-list">
        <li key={HOSTED_WORKFLOW_KEY} className="chatkit-sidebar__workflow-list-item">
          <button
            type="button"
            className="chatkit-sidebar__workflow-button"
            onClick={handleHostedClick}
            aria-current={isHostedActive ? "true" : undefined}
          >
            {hostedWorkflowLabel}
          </button>
        </li>
        {workflows.map((workflow) => {
          const isActive = workflow.id === selectedWorkflowKey;
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
    );

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

    if (workflows.length === 0) {
      return (
        <section className="chatkit-sidebar__section" aria-live="polite">
          <h2 className="chatkit-sidebar__section-title">Workflow</h2>
          {workflowList}
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
        {workflowList}
      </section>
    );
  }, [
    error,
    handleOpenBuilder,
    handleWorkflowClick,
    handleHostedClick,
    isAdmin,
    loadWorkflows,
    loading,
    selectedWorkflowKey,
    t,
    user,
    workflows,
  ]);

  useEffect(() => {
    setSidebarContent(sidebarContent);
    return () => clearSidebarContent();
  }, [clearSidebarContent, setSidebarContent, sidebarContent]);

  return null;
};
