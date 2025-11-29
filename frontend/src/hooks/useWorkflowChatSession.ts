import { useCallback, useEffect, useMemo, useRef } from "react";
import { useChatKit, type ChatKitOptions } from "../chatkit";
import { useStreamingResume } from "../chatkit/hooks";
import type { Thread, ThreadStreamEvent } from "../chatkit/types";
import { applyDelta } from "../chatkit/api/streaming/deltas";

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
  const { control, fetchUpdates, sendUserMessage, setThread } = useChatKit(chatkitOptions);
  const hasRefreshedAfterResumeRef = useRef(false);

  // Get API config from options
  const apiUrl = chatkitOptions.api.url;
  const apiHeaders = chatkitOptions.api.headers || {};

  // Callback to handle reconnection to active streaming sessions
  // For active sessions:
  // 1. Load the thread from backend (may not have in-progress assistant message)
  // 2. Fetch ALL stored events from the session
  // 3. Apply events to reconstruct the full state including in-progress messages
  // 4. Continue polling for new events until streaming completes
  const handleReconnect = useCallback(async (sessionId: string, lastEventId: string | null) => {
    console.log('[WorkflowChat] Reconnecting to active session:', sessionId);

    const baseUrl = apiUrl.startsWith("http") ? apiUrl : `${window.location.origin}${apiUrl}`;
    const authHeaders = { ...apiHeaders, ...(token ? { Authorization: `Bearer ${token}` } : {}) };

    try {
      // Step 1: Load the thread first to get the base state
      await fetchUpdates();

      // Step 2: Fetch ALL events from the start of the session (not just after lastEventId)
      // This ensures we can reconstruct the full assistant message
      const eventsUrl = new URL(`/api/chatkit/stream/events`, baseUrl);
      eventsUrl.searchParams.set('session_id', sessionId);
      // Don't set 'after' - we want ALL events to reconstruct the message

      const eventsResponse = await fetch(eventsUrl.toString(), { headers: authHeaders });

      if (!eventsResponse.ok) {
        console.log('[WorkflowChat] Could not fetch events, using thread data only');
        return;
      }

      const { events } = await eventsResponse.json();
      console.log('[WorkflowChat] Fetched', events?.length || 0, 'events from session');

      if (events && events.length > 0 && control.thread) {
        // Step 3: Apply events to reconstruct full state
        let thread: Thread = control.thread;
        for (const event of events) {
          if (event.data) {
            thread = applyDelta(thread, event.data as ThreadStreamEvent);
          }
        }

        // Update the thread state with reconstructed data
        console.log('[WorkflowChat] Applied', events.length, 'events to reconstruct thread');
        setThread(thread);
      }

      // Step 4: Connect to resume stream to continue receiving new events
      const resumeUrl = new URL(`/api/chatkit/stream/resume/${sessionId}`, baseUrl);
      if (lastEventId) {
        resumeUrl.searchParams.set('last_event_id', lastEventId);
      }

      const resumeResponse = await fetch(resumeUrl.toString(), { headers: authHeaders });

      if (!resumeResponse.ok) {
        console.log('[WorkflowChat] Resume stream not available, session may have completed');
        await fetchUpdates(); // Final refresh to get completed state
        return;
      }

      const reader = resumeResponse.body?.getReader();
      if (!reader) {
        console.log('[WorkflowChat] No response body reader');
        await fetchUpdates();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      // Read and process SSE events until stream completes
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Check for stream completion
        if (buffer.includes('[DONE]')) {
          console.log('[WorkflowChat] Resume stream completed');
          break;
        }

        // Process complete events
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            // Events are being received - the stream is still active
            // After processing, we'll refresh to get final state
          }
        }
      }

      // Final refresh to get the complete state after streaming ends
      console.log('[WorkflowChat] Resume stream finished, final refresh');
      await fetchUpdates();
    } catch (err) {
      console.error('[WorkflowChat] Resume failed:', err);
      // Fall back to normal refresh after a delay
      setTimeout(() => {
        fetchUpdates().catch(console.error);
      }, 2000);
    }
  }, [apiUrl, apiHeaders, token, control.thread, fetchUpdates, setThread]);

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
    onReconnect: handleReconnect,
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
