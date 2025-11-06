/**
 * useVersionManagement
 *
 * Hook for managing workflow versions.
 * Handles draft versions, production versions, loading, and deployment.
 *
 * Responsibilities:
 * - Version state management
 * - Loading version details
 * - Draft/production version resolution
 * - Version selection
 * - Deployment operations
 *
 * @phase Phase 3.2 - Custom Hooks Creation
 */

import { useCallback, useMemo, useState } from "react";
import { useWorkflowContext } from "../contexts/WorkflowContext";
import type { WorkflowVersionSummary, WorkflowVersionResponse } from "../types";
import { makeApiEndpointCandidates } from "../../../utils/backend";
import { backendUrl } from "../WorkflowBuilderUtils";

type UseVersionManagementOptions = {
  /** Workflow ID to manage versions for */
  workflowId: string | number | null;
  /** Auth header for API calls */
  authHeader: Record<string, string>;
};

type UseVersionManagementReturn = {
  // State
  versions: WorkflowVersionSummary[];
  selectedVersionId: number | null;
  selectedVersionDetail: WorkflowVersionResponse | null;
  draftVersionId: number | null;
  draftVersionSummary: WorkflowVersionSummary | null;
  isDeploying: boolean;
  deployError: string | null;

  // Refs
  versionsRef: React.MutableRefObject<WorkflowVersionSummary[]>;
  selectedVersionIdRef: React.MutableRefObject<number | null>;
  draftVersionIdRef: React.MutableRefObject<number | null>;

  // Methods
  loadVersions: (options?: LoadVersionsOptions) => Promise<void>;
  loadVersionDetail: (versionId: number, options?: LoadVersionDetailOptions) => Promise<WorkflowVersionResponse | null>;
  selectVersion: (versionId: number | null) => void;
  resolveVersionIdToPromote: () => number | null;
  deployVersion: (versionId: number, toProduction?: boolean) => Promise<boolean>;
};

type LoadVersionsOptions = {
  currentVersionId?: number | null;
  onSuccess?: (versions: WorkflowVersionSummary[], selectedVersionId: number | null) => void;
  onError?: (error: string) => void;
};

type LoadVersionDetailOptions = {
  onSuccess?: (response: WorkflowVersionResponse) => void;
  onError?: (error: string) => void;
};

/**
 * Hook for managing workflow versions
 *
 * @example
 * ```typescript
 * const {
 *   versions,
 *   draftVersionId,
 *   loadVersions,
 *   deployVersion
 * } = useVersionManagement({
 *   workflowId: selectedWorkflowId,
 *   authHeader: { Authorization: `Bearer ${token}` }
 * });
 * ```
 */
export function useVersionManagement(options: UseVersionManagementOptions): UseVersionManagementReturn {
  const { workflowId, authHeader } = options;

  const {
    versions,
    selectedVersionId,
    selectedVersionDetail,
    draftVersionId,
    draftVersionSummary,
    versionsRef,
    selectedVersionIdRef,
    draftVersionIdRef,
    loadVersions: contextLoadVersions,
    loadVersionDetail: contextLoadVersionDetail,
    selectVersion: contextSelectVersion,
  } = useWorkflowContext();

  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  // Load versions for current workflow
  const loadVersions = useCallback(
    async (loadOptions?: LoadVersionsOptions) => {
      if (!workflowId) {
        return;
      }

      await contextLoadVersions(workflowId, authHeader, loadOptions);
    },
    [workflowId, authHeader, contextLoadVersions],
  );

  // Load version detail
  const loadVersionDetail = useCallback(
    async (versionId: number, loadOptions?: LoadVersionDetailOptions) => {
      return await contextLoadVersionDetail(versionId, authHeader, loadOptions);
    },
    [authHeader, contextLoadVersionDetail],
  );

  // Select version
  const selectVersion = useCallback(
    (versionId: number | null) => {
      contextSelectVersion(versionId);
    },
    [contextSelectVersion],
  );

  // Resolve which version ID should be promoted
  const resolveVersionIdToPromote = useCallback((): number | null => {
    // If a specific version is selected and it's not the draft, use it
    if (selectedVersionId && selectedVersionId !== draftVersionId) {
      return selectedVersionId;
    }

    // Otherwise, use the draft version if it exists
    if (draftVersionId) {
      return draftVersionId;
    }

    // Fallback: use the selected version even if it's the draft
    return selectedVersionId;
  }, [selectedVersionId, draftVersionId]);

  // Deploy (promote) a version to production
  const deployVersion = useCallback(
    async (versionId: number, toProduction: boolean = false): Promise<boolean> => {
      if (!workflowId) {
        setDeployError("No workflow selected");
        return false;
      }

      setIsDeploying(true);
      setDeployError(null);

      try {
        const endpoint = `/workflow_versions/${versionId}/promote`;
        const candidates = makeApiEndpointCandidates(backendUrl, endpoint);

        let lastError: string | null = null;

        for (const url of candidates) {
          try {
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...authHeader,
              },
              body: JSON.stringify({
                is_active: toProduction,
              }),
            });

            if (!response.ok) {
              lastError = `HTTP ${response.status}`;
              continue;
            }

            // Success - reload versions to get updated state
            await loadVersions();
            setIsDeploying(false);
            return true;
          } catch (error) {
            lastError = error instanceof Error ? error.message : "Unknown error";
            continue;
          }
        }

        // All attempts failed
        const errorMessage = lastError ?? "Failed to deploy version";
        setDeployError(errorMessage);
        setIsDeploying(false);
        return false;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to deploy version";
        setDeployError(errorMessage);
        setIsDeploying(false);
        return false;
      }
    },
    [workflowId, authHeader, loadVersions],
  );

  return {
    // State
    versions,
    selectedVersionId,
    selectedVersionDetail,
    draftVersionId,
    draftVersionSummary,
    isDeploying,
    deployError,

    // Refs
    versionsRef,
    selectedVersionIdRef,
    draftVersionIdRef,

    // Methods
    loadVersions,
    loadVersionDetail,
    selectVersion,
    resolveVersionIdToPromote,
    deployVersion,
  };
}
