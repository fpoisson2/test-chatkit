import { useEffect, useRef } from "react";
import type { WorkflowVersionSummary, SaveState } from "../types";
import { makeApiEndpointCandidates } from "../../../utils/backend";
import { REMOTE_VERSION_POLL_INTERVAL_MS } from "../WorkflowBuilderUtils";

interface UseRemoteVersionPollingParams {
  selectedWorkflowId: number | null;
  selectedVersionId: number | null;
  saveState: SaveState;
  hasPendingChanges: boolean;
  backendUrl: string;
  authHeader: Record<string, string>;
  t: (key: string, params?: Record<string, unknown>) => string;
  versions: WorkflowVersionSummary[];
  draftVersionId: number | null;
  loadVersions: (
    workflowId: number,
    versionId: number,
    options?: { background?: boolean; preserveViewport?: boolean }
  ) => Promise<void>;
  loadWorkflows: (options: { selectWorkflowId: number | null }) => Promise<void>;
}

/**
 * Custom hook that polls for remote version updates in the background.
 * Automatically refreshes the version list when changes are detected on the server.
 *
 * The polling only runs when:
 * - There are no pending changes
 * - Save state is idle
 * - A workflow and version are selected
 *
 * @param params - Configuration and callbacks for polling
 */
export function useRemoteVersionPolling(params: UseRemoteVersionPollingParams): void {
  const {
    selectedWorkflowId,
    selectedVersionId,
    saveState,
    hasPendingChanges,
    backendUrl,
    authHeader,
    t,
    versions,
    draftVersionId,
    loadVersions,
    loadWorkflows,
  } = params;

  // Use refs to avoid stale closures in the polling callback
  const selectedWorkflowIdRef = useRef(selectedWorkflowId);
  const selectedVersionIdRef = useRef(selectedVersionId);
  const saveStateRef = useRef(saveState);
  const hasPendingChangesRef = useRef(hasPendingChanges);
  const versionsRef = useRef(versions);
  const draftVersionIdRef = useRef(draftVersionId);

  // Keep refs synchronized with props
  useEffect(() => {
    selectedWorkflowIdRef.current = selectedWorkflowId;
  }, [selectedWorkflowId]);

  useEffect(() => {
    selectedVersionIdRef.current = selectedVersionId;
  }, [selectedVersionId]);

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  useEffect(() => {
    hasPendingChangesRef.current = hasPendingChanges;
  }, [hasPendingChanges]);

  useEffect(() => {
    versionsRef.current = versions;
  }, [versions]);

  useEffect(() => {
    draftVersionIdRef.current = draftVersionId;
  }, [draftVersionId]);

  useEffect(() => {
    // Don't poll if basic conditions aren't met
    if (
      typeof window === "undefined" ||
      !selectedWorkflowId ||
      !selectedVersionId ||
      saveState !== "idle" ||
      hasPendingChanges
    ) {
      return;
    }

    let isDisposed = false;
    let isPolling = false;

    const pollOnce = async () => {
      const workflowId = selectedWorkflowIdRef.current;
      const versionId = selectedVersionIdRef.current;

      // Recheck conditions using refs for latest values
      if (
        workflowId == null ||
        versionId == null ||
        hasPendingChangesRef.current ||
        saveStateRef.current !== "idle"
      ) {
        return;
      }

      const candidates = makeApiEndpointCandidates(
        backendUrl,
        `/api/workflows/${workflowId}/versions`,
      );

      let reloadWorkflows = false;

      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
          });

          if (!response.ok) {
            if (response.status === 404) {
              reloadWorkflows = true;
            }
            throw new Error(
              t("workflowBuilder.errors.refreshVersionsFailedWithStatus", {
                status: response.status,
              }),
            );
          }

          const summaries: WorkflowVersionSummary[] = await response.json();
          const shouldRefresh = checkVersionChanges(
            summaries,
            versionsRef.current,
            draftVersionIdRef.current
          );

          // Only reload if conditions are still met
          if (
            shouldRefresh &&
            !hasPendingChangesRef.current &&
            saveStateRef.current === "idle" &&
            selectedWorkflowIdRef.current === workflowId &&
            selectedVersionIdRef.current === versionId
          ) {
            await loadVersions(workflowId, versionId, {
              background: true,
              preserveViewport: true,
            });
          }
          return;
        } catch (error) {
          continue;
        }
      }

      // If workflow was deleted (404), reload the workflows list
      if (reloadWorkflows && !hasPendingChangesRef.current) {
        await loadWorkflows({ selectWorkflowId: null });
      }
    };

    const triggerPoll = () => {
      if (isDisposed || isPolling) {
        return;
      }
      if (hasPendingChangesRef.current || saveStateRef.current !== "idle") {
        return;
      }

      isPolling = true;
      void (async () => {
        try {
          await pollOnce();
        } finally {
          isPolling = false;
        }
      })();
    };

    // Start polling immediately and then on interval
    triggerPoll();
    const intervalId = window.setInterval(triggerPoll, REMOTE_VERSION_POLL_INTERVAL_MS);

    return () => {
      isDisposed = true;
      window.clearInterval(intervalId);
    };
  }, [
    authHeader,
    backendUrl,
    hasPendingChanges,
    loadWorkflows,
    loadVersions,
    saveState,
    selectedVersionId,
    selectedWorkflowId,
    t,
  ]);
}

/**
 * Checks if the remote versions differ from the local versions.
 * Returns true if a refresh is needed.
 */
function checkVersionChanges(
  remoteSummaries: WorkflowVersionSummary[],
  currentVersions: WorkflowVersionSummary[],
  draftId: number | null
): boolean {
  const remoteById = new Map(remoteSummaries.map((item) => [item.id, item]));

  // Check if any remote version is new or has changed
  for (const summary of remoteSummaries) {
    const local = currentVersions.find((item) => item.id === summary.id);
    if (!local) {
      return true;
    }
    if (
      local.updated_at !== summary.updated_at ||
      local.version !== summary.version
    ) {
      return true;
    }
  }

  // Check if any local version (except draft) has been deleted
  for (const local of currentVersions) {
    if (local.id === draftId) {
      continue;
    }
    if (!remoteById.has(local.id)) {
      return true;
    }
  }

  return false;
}
