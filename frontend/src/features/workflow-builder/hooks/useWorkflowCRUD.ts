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
import {
  useCreateWorkflow,
  useCreateHostedWorkflow,
  useDeleteWorkflow,
  useDeleteHostedWorkflow,
  useDuplicateWorkflow,
  useUpdateWorkflow,
} from "../../../hooks/useWorkflows";

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

  // React Query mutations
  const createWorkflowMutation = useCreateWorkflow();
  const createHostedWorkflowMutation = useCreateHostedWorkflow();
  const deleteWorkflowMutation = useDeleteWorkflow();
  const deleteHostedWorkflowMutation = useDeleteHostedWorkflow();
  const duplicateWorkflowMutation = useDuplicateWorkflow();
  const updateWorkflowMutation = useUpdateWorkflow();

  /**
   * Create a new workflow (local or hosted)
   * Migrated to use React Query mutations with optimistic updates
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
        const created = await createHostedWorkflowMutation.mutateAsync({
          token,
          payload: {
            slug,
            workflow_id: remoteId,
            label: trimmedName,
            description: undefined,
          },
        });

        // React Query handles cache invalidation automatically
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

    // Local workflow creation
    setIsCreatingWorkflow(true);
    setSaveState("saving");
    setSaveMessage(t("workflowBuilder.createWorkflow.creatingLocal"));

    try {
      const workflow = await createWorkflowMutation.mutateAsync({
        token,
        payload: {
          display_name: trimmedName,
          description: null,
        },
      });

      // React Query handles cache invalidation, but we need to load the created workflow
      await loadWorkflows({
        selectWorkflowId: workflow.id,
        selectVersionId: workflow.active_version_id,
      });

      setSaveState("saved");
      setSaveMessage(
        t("workflowBuilder.createWorkflow.successLocal", { name: trimmedName }),
      );
      setTimeout(() => setSaveState("idle"), 1500);
      closeCreateModal();
      setCreateWorkflowName("");
      setCreateWorkflowRemoteId("");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("workflowBuilder.createWorkflow.errorCreateLocal");
      setSaveState("error");
      setSaveMessage(message);
      setCreateWorkflowError(message);
    } finally {
      setIsCreatingWorkflow(false);
    }
  }, [
    token,
    closeCreateModal,
    createWorkflowKind,
    createWorkflowName,
    createWorkflowRemoteId,
    createWorkflowMutation,
    createHostedWorkflowMutation,
    loadHostedWorkflows,
    loadWorkflows,
    setCreateWorkflowError,
    setCreateWorkflowName,
    setCreateWorkflowRemoteId,
    setIsCreatingWorkflow,
    setSaveMessage,
    setSaveState,
    t,
  ]);

  /**
   * Delete a workflow
   * Migrated to use React Query mutation with optimistic updates
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

      setSaveState("saving");
      setSaveMessage("Suppression en cours…");

      try {
        await deleteWorkflowMutation.mutateAsync({ token, id: targetId });

        // Clear selection and reload workflows
        applySelection({ nodeIds: [], edgeIds: [] });
        const nextSelection = targetId === selectedWorkflowId ? null : selectedWorkflowId;
        await loadWorkflows({
          excludeWorkflowId: current.id,
          selectWorkflowId: nextSelection ?? undefined,
        });

        setSaveState("saved");
        setSaveMessage(`Workflow "${current.display_name}" supprimé.`);
        setTimeout(() => setSaveState("idle"), 1500);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Impossible de supprimer le workflow.";
        setSaveState("error");
        setSaveMessage(message);
      }
    },
    [
      token,
      applySelection,
      closeWorkflowMenu,
      deleteWorkflowMutation,
      loadWorkflows,
      selectedWorkflowId,
      setSaveMessage,
      setSaveState,
      workflows,
    ],
  );

  /**
   * Delete a hosted workflow
   * Migrated to use React Query mutation with optimistic updates
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
        await deleteHostedWorkflowMutation.mutateAsync({ token, slug });

        // React Query handles cache invalidation automatically
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
    [
      token,
      closeWorkflowMenu,
      deleteHostedWorkflowMutation,
      hostedWorkflows,
      loadHostedWorkflows,
      setSaveMessage,
      setSaveState,
      t,
    ],
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
   * Migrated to use React Query mutation with optimistic updates
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

      setSaveState("saving");
      setSaveMessage("Renommage en cours…");

      try {
        const summary = await updateWorkflowMutation.mutateAsync({
          token,
          id: targetId,
          payload: { display_name: displayName },
        });

        await loadWorkflows({
          selectWorkflowId: summary.id,
          selectVersionId: selectedVersionId ?? null,
        });

        setSaveState("saved");
        setSaveMessage(`Workflow renommé en "${summary.display_name}".`);
        setTimeout(() => setSaveState("idle"), 1500);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Impossible de renommer le workflow.";
        setSaveState("error");
        setSaveMessage(message);
      }
    },
    [
      token,
      closeWorkflowMenu,
      loadWorkflows,
      selectedVersionId,
      selectedWorkflowId,
      setSaveMessage,
      setSaveState,
      updateWorkflowMutation,
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
