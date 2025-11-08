/**
 * useWorkflowCRUD
 *
 * Phase 1: Workflow CRUD Operations Extraction
 *
 * Hook for managing workflow Create, Read, Update, and Delete operations.
 * Centralizes all workflow CRUD logic from WorkflowBuilderPage (~400 lines).
 *
 * Responsibilities:
 * - Create workflows (local and hosted)
 * - Delete workflows (local and hosted)
 * - Duplicate workflows
 * - Rename workflows
 * - Handle API calls with retry logic
 * - Manage save/loading states
 * - Update workflow lists after operations
 *
 * This hook encapsulates ~400 lines from WorkflowBuilderPage:
 * - handleSubmitCreateWorkflow (120 lines)
 * - handleDeleteWorkflow (86 lines)
 * - handleDeleteHostedWorkflow (40 lines)
 * - handleDuplicateWorkflow (74 lines)
 * - handleRenameWorkflow (92 lines)
 */

import { useCallback } from "react";
import { makeApiEndpointCandidates } from "../../../utils/backend";
import { chatkitApi } from "../../../utils/backend";
import { backendUrl } from "../WorkflowBuilderUtils";
import { slugifyWorkflowName, buildGraphPayloadFrom } from "../utils";
import { useSaveContext } from "../contexts/SaveContext";
import { useModalContext } from "../contexts/ModalContext";
import { useWorkflowContext } from "../contexts/WorkflowContext";
import type {
  WorkflowSummary,
  WorkflowVersionResponse,
  FlowNode,
  FlowEdge,
} from "../types";

type TranslationFunction = (key: string, params?: Record<string, unknown>) => string;

type UseWorkflowCRUDParams = {
  authHeader: Record<string, string>;
  token: string | null;
  t: TranslationFunction;
  loadWorkflows: (options?: {
    selectWorkflowId?: number | null;
    selectVersionId?: number | null;
    excludeWorkflowId?: number | null;
    suppressLoadingState?: boolean;
  }) => Promise<void>;
  loadHostedWorkflows: () => Promise<void>;
  closeWorkflowMenu: () => void;
  applySelection: (selection: {
    nodeIds: string[];
    edgeIds: string[];
    primaryNodeId?: string | null;
    primaryEdgeId?: string | null;
  }) => void;
  buildGraphPayload: () => ReturnType<typeof buildGraphPayloadFrom>;
};

type UseWorkflowCRUDReturn = {
  handleSubmitCreateWorkflow: () => Promise<void>;
  handleDeleteWorkflow: (workflowId?: number) => Promise<void>;
  handleDeleteHostedWorkflow: (slug: string) => Promise<void>;
  handleDuplicateWorkflow: (workflowId?: number) => Promise<void>;
  handleRenameWorkflow: (workflowId?: number) => Promise<void>;
};

/**
 * Hook for managing workflow CRUD operations
 *
 * @example
 * ```typescript
 * const {
 *   handleSubmitCreateWorkflow,
 *   handleDeleteWorkflow,
 *   handleDeleteHostedWorkflow,
 *   handleDuplicateWorkflow,
 *   handleRenameWorkflow
 * } = useWorkflowCRUD({
 *   authHeader,
 *   token,
 *   t,
 *   loadWorkflows,
 *   loadHostedWorkflows,
 *   closeWorkflowMenu,
 *   applySelection,
 *   buildGraphPayload
 * });
 *
 * // Create a new workflow
 * await handleSubmitCreateWorkflow();
 *
 * // Delete a workflow
 * await handleDeleteWorkflow(workflowId);
 * ```
 */
export function useWorkflowCRUD(params: UseWorkflowCRUDParams): UseWorkflowCRUDReturn {
  const {
    authHeader,
    token,
    t,
    loadWorkflows,
    loadHostedWorkflows,
    closeWorkflowMenu,
    applySelection,
    buildGraphPayload,
  } = params;

  // Access contexts
  const { setSaveState, setSaveMessage } = useSaveContext();
  const {
    createWorkflowKind,
    createWorkflowName,
    createWorkflowRemoteId,
    setCreateWorkflowError,
    setIsCreatingWorkflow,
    closeCreateModal,
    setCreateWorkflowName,
    setCreateWorkflowRemoteId,
  } = useModalContext();
  const {
    workflows,
    hostedWorkflows,
    selectedWorkflowId,
    selectedVersionId,
  } = useWorkflowContext();

  /**
   * Create a new workflow (local or hosted)
   * Extracted from WorkflowBuilderPage.tsx lines 1442-1561 (120 lines)
   */
  const handleSubmitCreateWorkflow = useCallback(async () => {
    setCreateWorkflowError(null);
    const trimmedName = createWorkflowName.trim();
    if (!trimmedName) {
      setCreateWorkflowError(t("workflowBuilder.createWorkflow.errorMissingName"));
      return;
    }

    if (createWorkflowKind === "hosted") {
      const remoteId = createWorkflowRemoteId.trim();
      if (!remoteId) {
        setCreateWorkflowError(t("workflowBuilder.createWorkflow.errorMissingRemoteId"));
        return;
      }
      if (!token) {
        const message = t("workflowBuilder.createWorkflow.errorAuthentication");
        setSaveState("error");
        setSaveMessage(message);
        setCreateWorkflowError(message);
        return;
      }

      setIsCreatingWorkflow(true);
      const slug = slugifyWorkflowName(trimmedName);
      setSaveState("saving");
      setSaveMessage(t("workflowBuilder.createWorkflow.creatingHosted"));
      try {
        const created = await chatkitApi.createHostedWorkflow(token, {
          slug,
          workflow_id: remoteId,
          label: trimmedName,
          description: undefined,
        });
        chatkitApi.invalidateHostedWorkflowCache();
        await loadHostedWorkflows();
        setSaveState("saved");
        setSaveMessage(
          t("workflowBuilder.createWorkflow.successHosted", { label: created.label }),
        );
        setTimeout(() => setSaveState("idle"), 1500);
        closeCreateModal();
        setCreateWorkflowName("");
        setCreateWorkflowRemoteId("");
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t("workflowBuilder.createWorkflow.errorCreateHosted");
        setSaveState("error");
        setSaveMessage(message);
        setCreateWorkflowError(message);
      } finally {
        setIsCreatingWorkflow(false);
      }
      return;
    }

    setIsCreatingWorkflow(true);
    try {
      const slug = slugifyWorkflowName(trimmedName);
      const payload = {
        slug,
        display_name: trimmedName,
        description: null,
        graph: null,
      };
      const candidates = makeApiEndpointCandidates(backendUrl, "/api/workflows");
      let lastError: Error | null = null;
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
            body: JSON.stringify(payload),
          });
          if (!response.ok) {
            throw new Error(`Échec de la création (${response.status})`);
          }
          const data: WorkflowVersionResponse = await response.json();
          await loadWorkflows({
            selectWorkflowId: data.workflow_id,
            selectVersionId: data.id,
          });
          setSaveState("saved");
          setSaveMessage(
            t("workflowBuilder.createWorkflow.successLocal", { name: trimmedName }),
          );
          setTimeout(() => setSaveState("idle"), 1500);
          closeCreateModal();
          setCreateWorkflowName("");
          setCreateWorkflowRemoteId("");
          return;
        } catch (error) {
          lastError =
            error instanceof Error
              ? error
              : new Error(t("workflowBuilder.createWorkflow.errorCreateLocal"));
        }
      }
      const message = lastError?.message ?? t("workflowBuilder.createWorkflow.errorCreateLocal");
      setSaveState("error");
      setSaveMessage(message);
      setCreateWorkflowError(message);
    } finally {
      setIsCreatingWorkflow(false);
    }
  }, [
    authHeader,
    closeCreateModal,
    createWorkflowKind,
    createWorkflowName,
    createWorkflowRemoteId,
    loadHostedWorkflows,
    loadWorkflows,
    setCreateWorkflowError,
    setCreateWorkflowName,
    setCreateWorkflowRemoteId,
    setIsCreatingWorkflow,
    setSaveMessage,
    setSaveState,
    t,
    token,
  ]);

  /**
   * Delete a workflow
   * Extracted from WorkflowBuilderPage.tsx lines 1563-1648 (86 lines)
   */
  const handleDeleteWorkflow = useCallback(
    async (workflowId?: number) => {
      const targetId = workflowId ?? selectedWorkflowId;
      if (!targetId) {
        return;
      }
      const current = workflows.find((workflow) => workflow.id === targetId);
      if (!current) {
        return;
      }
      if (current.is_chatkit_default) {
        setSaveState("error");
        setSaveMessage(
          "Sélectionnez un autre workflow pour ChatKit avant de supprimer celui-ci.",
        );
        return;
      }
      const confirmed = window.confirm(
        `Supprimer le workflow "${current.display_name}" ? Cette action est irréversible.`,
      );
      if (!confirmed) {
        return;
      }
      closeWorkflowMenu();
      const endpoint = `/api/workflows/${targetId}`;
      const candidates = makeApiEndpointCandidates(backendUrl, endpoint);
      let lastError: Error | null = null;
      setSaveState("saving");
      setSaveMessage("Suppression en cours…");
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
          });
          if (response.status === 204) {
            applySelection({ nodeIds: [], edgeIds: [] });
            const nextSelection = targetId === selectedWorkflowId ? null : selectedWorkflowId;
            await loadWorkflows({
              excludeWorkflowId: current.id,
              selectWorkflowId: nextSelection ?? undefined,
            });
            setSaveState("saved");
            setSaveMessage(`Workflow "${current.display_name}" supprimé.`);
            setTimeout(() => setSaveState("idle"), 1500);
            return;
          }
          if (response.status === 400) {
            let message = "Impossible de supprimer le workflow.";
            try {
              const detail = (await response.json()) as { detail?: unknown };
              if (detail && typeof detail.detail === "string") {
                message = detail.detail;
              }
            } catch (parseError) {
              console.error(parseError);
            }
            throw new Error(message);
          }
          if (response.status === 404) {
            throw new Error("Le workflow n'existe plus.");
          }
          throw new Error(`Impossible de supprimer le workflow (${response.status}).`);
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            continue;
          }
          lastError = error instanceof Error ? error : new Error("Impossible de supprimer le workflow.");
        }
      }
      setSaveState("error");
      setSaveMessage(lastError?.message ?? "Impossible de supprimer le workflow.");
    },
    [
      authHeader,
      applySelection,
      closeWorkflowMenu,
      loadWorkflows,
      selectedWorkflowId,
      setSaveMessage,
      setSaveState,
      workflows,
    ],
  );

  /**
   * Delete a hosted workflow
   * Extracted from WorkflowBuilderPage.tsx lines 1650-1689 (40 lines)
   */
  const handleDeleteHostedWorkflow = useCallback(
    async (slug: string) => {
      if (!token) {
        setSaveState("error");
        setSaveMessage(t("workflowBuilder.createWorkflow.errorAuthentication"));
        return;
      }
      const entry = hostedWorkflows.find((workflow) => workflow.slug === slug);
      if (!entry) {
        return;
      }
      closeWorkflowMenu();
      const confirmed = window.confirm(
        t("workflowBuilder.hostedSection.confirmDelete", { label: entry.label }),
      );
      if (!confirmed) {
        return;
      }
      setSaveState("saving");
      setSaveMessage(t("workflowBuilder.hostedSection.deleting"));
      try {
        await chatkitApi.deleteHostedWorkflow(token, slug);
        chatkitApi.invalidateHostedWorkflowCache();
        await loadHostedWorkflows();
        setSaveState("saved");
        setSaveMessage(
          t("workflowBuilder.hostedSection.deleteSuccess", { label: entry.label }),
        );
        setTimeout(() => setSaveState("idle"), 1500);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t("workflowBuilder.hostedSection.deleteError");
        setSaveState("error");
        setSaveMessage(message);
      }
    },
    [closeWorkflowMenu, hostedWorkflows, loadHostedWorkflows, setSaveMessage, setSaveState, t, token],
  );

  /**
   * Duplicate a workflow
   * Extracted from WorkflowBuilderPage.tsx lines 1751-1824 (74 lines)
   */
  const handleDuplicateWorkflow = useCallback(
    async (workflowId?: number) => {
      const targetId = workflowId ?? selectedWorkflowId;
      const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId);
      if (!targetId || !selectedWorkflow || targetId !== selectedWorkflowId) {
        closeWorkflowMenu();
        if (targetId && targetId !== selectedWorkflowId) {
          setSaveState("error");
          setSaveMessage("Sélectionnez le workflow avant de le dupliquer.");
          setTimeout(() => setSaveState("idle"), 1500);
        }
        return;
      }

      const baseName = selectedWorkflow.display_name?.trim() || "Workflow sans nom";
      const proposed = window.prompt("Nom du duplicata ?", `${baseName} (copie)`);
      if (!proposed) {
        return;
      }

      const displayName = proposed.trim();
      if (!displayName) {
        return;
      }

      const payload = {
        slug: slugifyWorkflowName(displayName),
        display_name: displayName,
        description: selectedWorkflow.description,
        graph: buildGraphPayload(),
      };

      const candidates = makeApiEndpointCandidates(backendUrl, "/api/workflows");
      let lastError: Error | null = null;
      setSaveState("saving");
      setSaveMessage("Duplication en cours…");
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            throw new Error(`Échec de la duplication (${response.status})`);
          }

          const data: WorkflowVersionResponse = await response.json();
          closeWorkflowMenu();
          await loadWorkflows({ selectWorkflowId: data.workflow_id, selectVersionId: data.id });
          setSaveState("saved");
          setSaveMessage(`Workflow dupliqué sous "${displayName}".`);
          setTimeout(() => setSaveState("idle"), 1500);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Impossible de dupliquer le workflow.");
        }
      }

      setSaveState("error");
      setSaveMessage(lastError?.message ?? "Impossible de dupliquer le workflow.");
    },
    [
      authHeader,
      buildGraphPayload,
      closeWorkflowMenu,
      loadWorkflows,
      selectedWorkflowId,
      setSaveMessage,
      setSaveState,
      workflows,
    ],
  );

  /**
   * Rename a workflow
   * Extracted from WorkflowBuilderPage.tsx lines 1826-1917 (92 lines)
   */
  const handleRenameWorkflow = useCallback(
    async (workflowId?: number) => {
      const targetId = workflowId ?? selectedWorkflowId;
      if (!targetId) {
        return;
      }

      const target = workflows.find((workflow) => workflow.id === targetId);
      if (!target) {
        closeWorkflowMenu();
        return;
      }

      closeWorkflowMenu();

      const baseName = target.display_name?.trim() || "Workflow sans nom";
      const proposed = window.prompt("Nouveau nom du workflow ?", baseName);
      if (proposed === null) {
        return;
      }

      const displayName = proposed.trim();
      if (!displayName || displayName === target.display_name) {
        return;
      }

      const slug =
        target.slug === "workflow-par-defaut"
          ? target.slug
          : slugifyWorkflowName(displayName);
      if (!slug) {
        setSaveState("error");
        setSaveMessage("Impossible de renommer le workflow.");
        return;
      }

      const payload = {
        display_name: displayName,
        slug,
      };

      const candidates = makeApiEndpointCandidates(backendUrl, `/api/workflows/${targetId}`);
      let lastError: Error | null = null;

      setSaveState("saving");
      setSaveMessage("Renommage en cours…");

      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            throw new Error(`Échec du renommage (${response.status})`);
          }

          const summary: WorkflowSummary = await response.json();
          await loadWorkflows({
            selectWorkflowId: summary.id,
            selectVersionId: selectedVersionId ?? null,
          });
          setSaveState("saved");
          setSaveMessage(`Workflow renommé en "${summary.display_name}".`);
          setTimeout(() => setSaveState("idle"), 1500);
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            continue;
          }
          lastError = error instanceof Error ? error : new Error("Impossible de renommer le workflow.");
        }
      }

      setSaveState("error");
      setSaveMessage(lastError?.message ?? "Impossible de renommer le workflow.");
    },
    [
      authHeader,
      closeWorkflowMenu,
      loadWorkflows,
      selectedVersionId,
      selectedWorkflowId,
      setSaveMessage,
      setSaveState,
      workflows,
    ],
  );

  return {
    handleSubmitCreateWorkflow,
    handleDeleteWorkflow,
    handleDeleteHostedWorkflow,
    handleDuplicateWorkflow,
    handleRenameWorkflow,
  };
}
