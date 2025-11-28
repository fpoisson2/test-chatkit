import { useCallback, useEffect, useMemo, useRef } from "react";
import { useChatKit, type ChatKitOptions } from "../chatkit";
import { useStreamingResume } from "../chatkit/hooks";
import type { ThreadStreamEvent } from "../chatkit/types";

import type { WorkflowSummary } from "../types/workflows";
import { useChatkitWorkflowSync } from "./useChatkitWorkflowSync";

type UseWorkflowChatSessionOptions = {
  chatkitOptions: ChatKitOptions;
  token: string | null;
  activeWorkflow: WorkflowSummary | null;
  initialThreadId: string | null;
  reportError: (message: string, detail?: unknown) => void;
  mode: "local" | "hosted";
  autoStartEnabled?: boolean;
};

type UseWorkflowChatSessionResult = ReturnType<typeof useChatKit> & {
  requestRefresh: ReturnType<typeof useChatkitWorkflowSync>["requestRefresh"];
  chatkitWorkflowInfo: ReturnType<typeof useChatkitWorkflowSync>["chatkitWorkflowInfo"];
};

export const useWorkflowChatSession = ({
  chatkitOptions,
  token,
  activeWorkflow,
  initialThreadId,
  reportError,
  mode,
  autoStartEnabled = true,
}: UseWorkflowChatSessionOptions): UseWorkflowChatSessionResult => {
  const { control, fetchUpdates, sendUserMessage } = useChatKit(chatkitOptions);
  const hasRefreshedAfterResumeRef = useRef(false);

  // Get API config from options
  const apiUrl = chatkitOptions.api.url;
  const apiHeaders = chatkitOptions.api.headers || {};

  // Streaming resume hook - detects and handles interrupted sessions
  const {
    isResuming,
    needsReplay,
    missedEvents,
    sessionStatus,
    clearMissedEvents,
  } = useStreamingResume({
    apiUrl,
    headers: { ...apiHeaders, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    threadId: initialThreadId,
    enabled: !!initialThreadId && !!token,
    onReplay: (events: ThreadStreamEvent[]) => {
      console.log('[WorkflowChat] Session completed with', events.length, 'missed events - will refresh');
    },
  });

  // When we detect a completed session, refresh the thread to show final state
  useEffect(() => {
    // Skip if already refreshed for this session
    if (hasRefreshedAfterResumeRef.current) {
      return;
    }

    // Skip if still resuming or no session status yet
    if (isResuming || !sessionStatus) {
      return;
    }

    // If session was completed, refresh the thread to get the final state
    if (sessionStatus.status === 'completed' && control.thread) {
      console.log('[WorkflowChat] Session was completed, refreshing thread to show final state');
      hasRefreshedAfterResumeRef.current = true;
      fetchUpdates()
        .then(() => {
          console.log('[WorkflowChat] Thread refreshed after session resume');
          clearMissedEvents();
        })
        .catch((err) => {
          console.error('[WorkflowChat] Failed to refresh thread after resume:', err);
        });
    }
  }, [isResuming, sessionStatus, control.thread, fetchUpdates, clearMissedEvents]);

  // Reset the ref when thread changes
  useEffect(() => {
    hasRefreshedAfterResumeRef.current = false;
  }, [initialThreadId]);

  const hostedRequestRefresh = useCallback(
    (context?: string) => {
      if (import.meta.env.DEV) {
        console.log('[WorkflowChat] requestRefresh appelé', { context });
      }
      return fetchUpdates()
        .then((result) => {
          if (import.meta.env.DEV) {
            console.log('[WorkflowChat] fetchUpdates terminé avec succès', { context, result });
          }
          return result;
        })
        .catch((err) => {
          if (import.meta.env.DEV) {
            console.error('[WorkflowChat] fetchUpdates a échoué', { context, err });
          }
        });
    },
    [fetchUpdates],
  );

  const workflowSync = useChatkitWorkflowSync({
    token,
    activeWorkflow,
    fetchUpdates,
    sendUserMessage,
    initialThreadId,
    reportError,
    enabled: true, // Always enabled to support workflow sync in both local and hosted modes
    autoStartEnabled,
    isStreaming: control.isLoading,
  });

  const requestRefresh = mode === "hosted" ? hostedRequestRefresh : workflowSync.requestRefresh;
  const chatkitWorkflowInfo = workflowSync.chatkitWorkflowInfo;

  return useMemo(
    () => ({
      control,
      fetchUpdates,
      sendUserMessage,
      requestRefresh,
      chatkitWorkflowInfo,
    }),
    [chatkitWorkflowInfo, control, fetchUpdates, requestRefresh, sendUserMessage],
  );
};

export type { UseWorkflowChatSessionOptions, UseWorkflowChatSessionResult };
