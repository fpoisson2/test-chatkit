/**
 * useWorkflowOperations
 *
 * Hook for workflow CRUD operations.
 * Provides methods for creating, deleting, duplicating, and renaming workflows
 * with error handling and loading states.
 *
 * Responsibilities:
 * - Create workflows (local and hosted)
 * - Delete workflows (local and hosted)
 * - Duplicate workflows
 * - Rename workflows
 * - Error handling
 * - Loading state management
 *
 * @phase Phase 3.3 - Custom Hooks Creation
 */

import { useCallback, useState } from "react";
import { useWorkflowContext } from "../contexts/WorkflowContext";
import type { WorkflowSummary } from "../types";

type UseWorkflowOperationsOptions = {
  /** Auth header for API calls */
  authHeader: Record<string, string>;
  /** Authentication token for hosted workflows */
  token?: string | null;
};

type UseWorkflowOperationsReturn = {
  // State
  isProcessing: boolean;
  error: string | null;

  // Methods
  createWorkflow: (data: CreateWorkflowInput) => Promise<WorkflowSummary | null>;
  deleteWorkflow: (id: string | number, kind: "local" | "hosted") => Promise<boolean>;
  duplicateWorkflow: (id: string | number, newName: string) => Promise<WorkflowSummary | null>;
  renameWorkflow: (id: string | number, newName: string) => Promise<boolean>;
  clearError: () => void;
};

type CreateWorkflowInput = {
  kind: "local" | "hosted";
  name: string;
  remoteId?: string;
};

/**
 * Hook for workflow CRUD operations
 *
 * @example
 * ```typescript
 * const {
 *   isProcessing,
 *   error,
 *   createWorkflow,
 *   deleteWorkflow
 * } = useWorkflowOperations({
 *   authHeader: { Authorization: `Bearer ${token}` },
 *   token
 * });
 *
 * // Create workflow
 * const workflow = await createWorkflow({
 *   kind: 'local',
 *   name: 'My Workflow'
 * });
 * ```
 */
export function useWorkflowOperations(options: UseWorkflowOperationsOptions): UseWorkflowOperationsReturn {
  const { authHeader, token } = options;

  const {
    createWorkflow: contextCreateWorkflow,
    deleteWorkflow: contextDeleteWorkflow,
    deleteHostedWorkflow: contextDeleteHostedWorkflow,
    duplicateWorkflow: contextDuplicateWorkflow,
    renameWorkflow: contextRenameWorkflow,
  } = useWorkflowContext();

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Create workflow (local or hosted)
  const createWorkflow = useCallback(
    async (data: CreateWorkflowInput): Promise<WorkflowSummary | null> => {
      setIsProcessing(true);
      setError(null);

      try {
        // Validate input
        if (!data.name || data.name.trim() === "") {
          throw new Error("Workflow name is required");
        }

        if (data.kind === "hosted" && !data.remoteId) {
          throw new Error("Remote ID is required for hosted workflows");
        }

        if (data.kind === "hosted" && !token) {
          throw new Error("Authentication token is required for hosted workflows");
        }

        // Create workflow
        const result = await contextCreateWorkflow(
          {
            kind: data.kind,
            name: data.name.trim(),
            remoteId: data.remoteId,
            token: token ?? undefined,
          },
          authHeader,
        );

        setIsProcessing(false);
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to create workflow";
        setError(errorMessage);
        setIsProcessing(false);
        return null;
      }
    },
    [authHeader, token, contextCreateWorkflow],
  );

  // Delete workflow (local or hosted)
  const deleteWorkflow = useCallback(
    async (id: string | number, kind: "local" | "hosted"): Promise<boolean> => {
      setIsProcessing(true);
      setError(null);

      try {
        if (kind === "hosted") {
          // For hosted workflows, id is the slug
          const success = await contextDeleteHostedWorkflow(String(id), token ?? null);
          setIsProcessing(false);
          return success;
        } else {
          // For local workflows
          const success = await contextDeleteWorkflow(id, authHeader);
          setIsProcessing(false);
          return success;
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to delete workflow";
        setError(errorMessage);
        setIsProcessing(false);
        return false;
      }
    },
    [authHeader, token, contextDeleteWorkflow, contextDeleteHostedWorkflow],
  );

  // Duplicate workflow
  const duplicateWorkflow = useCallback(
    async (id: string | number, newName: string): Promise<WorkflowSummary | null> => {
      setIsProcessing(true);
      setError(null);

      try {
        // Validate input
        if (!newName || newName.trim() === "") {
          throw new Error("Workflow name is required");
        }

        const result = await contextDuplicateWorkflow(id, newName.trim(), authHeader);
        setIsProcessing(false);
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to duplicate workflow";
        setError(errorMessage);
        setIsProcessing(false);
        return null;
      }
    },
    [authHeader, contextDuplicateWorkflow],
  );

  // Rename workflow
  const renameWorkflow = useCallback(
    async (id: string | number, newName: string): Promise<boolean> => {
      setIsProcessing(true);
      setError(null);

      try {
        // Validate input
        if (!newName || newName.trim() === "") {
          throw new Error("Workflow name is required");
        }

        const success = await contextRenameWorkflow(id, newName.trim(), authHeader);
        setIsProcessing(false);
        return success;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to rename workflow";
        setError(errorMessage);
        setIsProcessing(false);
        return false;
      }
    },
    [authHeader, contextRenameWorkflow],
  );

  return {
    // State
    isProcessing,
    error,

    // Methods
    createWorkflow,
    deleteWorkflow,
    duplicateWorkflow,
    renameWorkflow,
    clearError,
  };
}
