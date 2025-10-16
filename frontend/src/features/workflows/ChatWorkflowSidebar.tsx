import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../auth";
import { useAppLayout, useSidebarPortal } from "../../components/AppLayout";
import { workflowsApi } from "../../utils/backend";
import type { WorkflowSummary } from "../../types/workflows";

const buildWorkflowOptionLabel = (workflow: WorkflowSummary): string => {
  const parts = [workflow.display_name];
  if (workflow.active_version_number) {
    parts.push(`prod v${workflow.active_version_number}`);
  } else {
    parts.push("aucune version en production");
  }
  return parts.join(" · ");
};

const isApiError = (error: unknown): error is { status?: number; message?: string } =>
  Boolean(error) && typeof error === "object" && "status" in error;

type ActivationContext = { reason: "initial" | "user" };

type ChatWorkflowSidebarProps = {
  onWorkflowActivated: (workflow: WorkflowSummary | null, context: ActivationContext) => void;
};

export const ChatWorkflowSidebar = ({ onWorkflowActivated }: ChatWorkflowSidebarProps) => {
  const navigate = useNavigate();
  const { closeSidebar, isDesktopLayout } = useAppLayout();
  const { setSidebarContent, clearSidebarContent } = useSidebarPortal();
  const { token, user } = useAuth();
  const isAdmin = Boolean(user?.is_admin);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [workflows, selectedWorkflowId],
  );

  const publishedWorkflows = useMemo(
    () => workflows.filter((workflow) => workflow.active_version_id !== null),
    [workflows],
  );

  const loadWorkflows = useCallback(async () => {
    if (!token || !isAdmin) {
      setWorkflows([]);
      setSelectedWorkflowId(null);
      setError(null);
      setLoading(false);
      onWorkflowActivated(null, { reason: "initial" });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const items = await workflowsApi.list(token);
      setWorkflows(items);
      const active =
        items.find((workflow) => workflow.is_chatkit_default && workflow.active_version_id !== null) ??
        items.find((workflow) => workflow.active_version_id !== null) ??
        null;
      setSelectedWorkflowId(active?.id ?? null);
      onWorkflowActivated(active ?? null, { reason: "initial" });
    } catch (err) {
      let message = err instanceof Error ? err.message : "Impossible de charger les workflows.";
      if (isApiError(err) && err.status === 403) {
        message = "Vous n'avez pas les droits pour consulter les workflows.";
      }
      setError(message);
      setWorkflows([]);
      setSelectedWorkflowId(null);
      onWorkflowActivated(null, { reason: "initial" });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, onWorkflowActivated, token]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  const handleSelectWorkflow = useCallback(
    async (event: ChangeEvent<HTMLSelectElement>) => {
      const { value } = event.target;
      if (value === "" || !token || !isAdmin) {
        return;
      }

      const nextId = Number.parseInt(value, 10);
      if (!Number.isFinite(nextId) || nextId === selectedWorkflowId) {
        return;
      }

      const workflowToActivate = workflows.find((workflow) => workflow.id === nextId);
      if (!workflowToActivate || workflowToActivate.active_version_id === null) {
        setError("Publiez une version de production avant d'activer ce workflow.");
        return;
      }

      setIsUpdating(true);
      setError(null);
      try {
        const updated = await workflowsApi.setChatkitWorkflow(token, nextId);
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
        onWorkflowActivated(
          updated.active_version_id ? updated : null,
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
      } finally {
        setIsUpdating(false);
      }
    },
    [
      closeSidebar,
      isAdmin,
      isDesktopLayout,
      onWorkflowActivated,
      selectedWorkflowId,
      token,
      workflows,
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
          <h2 className="chatkit-sidebar__section-title">Workflow actif</h2>
          <p className="chatkit-sidebar__section-text">
            Connectez-vous pour choisir le workflow utilisé par ChatKit.
          </p>
        </section>
      );
    }

    if (!isAdmin) {
      return (
        <section className="chatkit-sidebar__section" aria-live="polite">
          <h2 className="chatkit-sidebar__section-title">Workflow actif</h2>
          <p className="chatkit-sidebar__section-text">
            Votre rôle ne permet pas de modifier le workflow ChatKit.
          </p>
        </section>
      );
    }

    if (error) {
      return (
        <section className="chatkit-sidebar__section" aria-live="polite">
          <h2 className="chatkit-sidebar__section-title">Workflow actif</h2>
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
          <h2 className="chatkit-sidebar__section-title">Workflow actif</h2>
          <p className="chatkit-sidebar__section-text">Chargement des workflows…</p>
        </section>
      );
    }

    if (workflows.length === 0) {
      return (
        <section className="chatkit-sidebar__section" aria-live="polite">
          <h2 className="chatkit-sidebar__section-title">Workflow actif</h2>
          <p className="chatkit-sidebar__section-text">
            Publiez un workflow pour qu'il soit disponible dans le chat.
          </p>
          <button type="button" className="chatkit-sidebar__section-button" onClick={handleOpenBuilder}>
            Ouvrir le workflow builder
          </button>
        </section>
      );
    }

    const hasPublishedWorkflow = publishedWorkflows.length > 0;

    return (
      <section className="chatkit-sidebar__section" aria-labelledby={`${sectionId}-title`}>
        <div className="chatkit-sidebar__section-header">
          <h2 id={`${sectionId}-title`} className="chatkit-sidebar__section-title">
            Workflow actif
          </h2>
        </div>
        <label htmlFor={`${sectionId}-select`} className="chatkit-sidebar__section-label">
          Workflow de production
        </label>
        <select
          id={`${sectionId}-select`}
          className="chatkit-sidebar__section-select"
          value={selectedWorkflowId ?? ""}
          onChange={handleSelectWorkflow}
          disabled={isUpdating}
        >
          <option value="" disabled={hasPublishedWorkflow}>
            {hasPublishedWorkflow
              ? "Choisissez un workflow de production"
              : "Aucune version de production disponible"}
          </option>
          {workflows.map((workflow) => (
            <option
              key={workflow.id}
              value={workflow.id}
              disabled={workflow.active_version_id === null}
            >
              {buildWorkflowOptionLabel(workflow)}
            </option>
          ))}
        </select>
        {isUpdating ? (
          <p className="chatkit-sidebar__section-text">Activation du workflow…</p>
        ) : null}
        {selectedWorkflow?.description ? (
          <p className="chatkit-sidebar__section-text chatkit-sidebar__section-text--muted">
            {selectedWorkflow.description}
          </p>
        ) : null}
        {selectedWorkflow?.active_version_number ? (
          <p className="chatkit-sidebar__section-hint">
            Production : v{selectedWorkflow.active_version_number}
          </p>
        ) : null}
        {!hasPublishedWorkflow ? (
          <p className="chatkit-sidebar__section-text">
            Publiez une version de production pour activer un workflow.
          </p>
        ) : null}
        <button type="button" className="chatkit-sidebar__section-button" onClick={handleOpenBuilder}>
          Gérer dans le workflow builder
        </button>
      </section>
    );
  }, [
    error,
    handleOpenBuilder,
    handleSelectWorkflow,
    isAdmin,
    isUpdating,
    loadWorkflows,
    loading,
    publishedWorkflows,
    selectedWorkflow,
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
