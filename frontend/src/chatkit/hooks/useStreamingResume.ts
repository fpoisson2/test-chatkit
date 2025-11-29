/**
 * Hook for resuming streaming sessions after page refresh.
 *
 * This hook provides:
 * - Detection of interrupted streaming sessions
 * - Reconnection to active streams via SSE
 * - Retrieval of missed events for completed streams
 * - Session state tracking during streaming
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadStreamEvent } from "../types";
import {
  clearStreamingSession,
  loadStreamingSession,
  saveStreamingSession,
  shouldAttemptResume,
  updateLastEventId,
} from "../../utils/streamingSession";

export interface StreamingSessionStatus {
  session_id: string;
  thread_id: string;
  status: "active" | "completed" | "error";
  last_event_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface StreamingResumeState {
  /** Whether we're currently checking/resuming a session */
  isResuming: boolean;
  /** Whether there are events that need to be replayed */
  needsReplay: boolean;
  /** Events that were missed and need to be replayed */
  missedEvents: ThreadStreamEvent[];
  /** Session status from backend */
  sessionStatus: StreamingSessionStatus | null;
  /** Thread ID from saved session (if different from current) */
  savedSessionThreadId: string | null;
}

interface UseStreamingResumeOptions {
  /** API base URL */
  apiUrl: string;
  /** Headers for API requests */
  headers?: Record<string, string>;
  /** Thread ID to check for resumable session */
  threadId: string | null;
  /** Called when reconnecting to an active stream */
  onReconnect?: (sessionId: string, lastEventId: string | null) => Promise<void>;
  /** Called when events need to be replayed */
  onReplay?: (events: ThreadStreamEvent[]) => void;
  /** Whether resume functionality is enabled */
  enabled?: boolean;
}

export function useStreamingResume(options: UseStreamingResumeOptions) {
  const {
    apiUrl,
    headers = {},
    threadId,
    onReconnect,
    onReplay,
    enabled = true,
  } = options;

  const [state, setState] = useState<StreamingResumeState>({
    isResuming: false,
    needsReplay: false,
    missedEvents: [],
    sessionStatus: null,
    savedSessionThreadId: null,
  });

  // Track which threadId we successfully checked (to avoid duplicate checks)
  // Only updated after async operation completes to handle React Strict Mode properly
  const checkedRef = useRef<string | null>("__not_checked__");
  const abortControllerRef = useRef<AbortController | null>(null);

  // Memoize headers to avoid unnecessary effect re-runs
  const headersRef = useRef(headers);
  headersRef.current = headers;

  // Check for resumable session on mount or when threadId changes
  useEffect(() => {
    // First, check if there's a session in storage (before any conditions)
    const savedSession = loadStreamingSession();
    const shouldResume = shouldAttemptResume();

    console.info("[useStreamingResume] Checking for resumable session:", {
      enabled,
      threadId,
      alreadyChecked: checkedRef.current,
      hasSavedSession: savedSession !== null,
      savedSessionId: savedSession?.sessionId,
      savedThreadId: savedSession?.threadId,
      shouldResume,
    });

    // Skip if not enabled
    if (!enabled) {
      console.info("[useStreamingResume] Not enabled, skipping");
      return;
    }

    // Skip if we already successfully checked for this exact threadId
    // Use a special marker to distinguish "never checked" from "checked with null"
    if (checkedRef.current === threadId) {
      console.info("[useStreamingResume] Already checked for this threadId, skipping");
      return;
    }

    console.info("[useStreamingResume] Loaded session from storage:", savedSession);
    if (!savedSession) {
      console.info("[useStreamingResume] No saved session found");
      // Mark as checked even when no session found (for this threadId)
      checkedRef.current = threadId;
      return;
    }

    // Skip if session was created by current page (streaming is still active on this page)
    // We only need to check/resume for sessions from previous page loads
    if (!shouldResume) {
      console.info("[useStreamingResume] Session was created by current page, no need to resume");
      checkedRef.current = threadId;
      return;
    }

    // If threadIds don't match, expose the saved session's threadId so caller can navigate
    // Don't clear the session yet - let the caller decide what to do
    if (threadId && savedSession.threadId !== threadId) {
      console.info("[useStreamingResume] Thread mismatch - saved session is for different thread:", {
        currentThreadId: threadId,
        savedThreadId: savedSession.threadId,
      });
      setState((s) => ({ ...s, savedSessionThreadId: savedSession.threadId }));
      // Don't return - still check the session status to see if we should redirect
    }

    // Capture current threadId for use in async callback
    const currentThreadId = threadId;

    const checkAndResume = async () => {
      setState((s) => ({ ...s, isResuming: true }));
      abortControllerRef.current = new AbortController();

      try {
        // Build the status URL - handle both absolute and relative apiUrl
        const baseUrl = apiUrl.startsWith("http") ? apiUrl : `${window.location.origin}${apiUrl}`;
        const statusUrl = new URL("/api/chatkit/stream/status", baseUrl);
        statusUrl.searchParams.set("session_id", savedSession.sessionId);

        console.info("[useStreamingResume] Checking session status at:", statusUrl.toString());

        const statusResponse = await fetch(statusUrl.toString(), {
          headers: headersRef.current,
          signal: abortControllerRef.current.signal,
        });

        console.info("[useStreamingResume] Status response:", statusResponse.status, statusResponse.statusText);

        if (!statusResponse.ok) {
          // Session not found or expired - clear session tracking but keep thread in URL
          // The thread can still be loaded normally even if streaming session is gone
          const errorText = await statusResponse.text().catch(() => "");
          console.info("[useStreamingResume] Session not found or expired, clearing session. Error:", errorText);
          clearStreamingSession();
          // Don't clear thread from URL - let normal thread loading take over
          setState((s) => ({ ...s, isResuming: false, savedSessionThreadId: null }));
          // Mark as checked so we don't retry
          checkedRef.current = currentThreadId;
          return;
        }

        const sessionStatus: StreamingSessionStatus = await statusResponse.json();
        console.info("[useStreamingResume] Session status from backend:", sessionStatus);

        // Check if this is for a different thread
        const isForDifferentThread = threadId && savedSession.threadId !== threadId;

        setState((s) => ({
          ...s,
          sessionStatus,
          savedSessionThreadId: isForDifferentThread ? savedSession.threadId : null,
        }));

        // If session is for a different thread and it's still active,
        // don't attempt to resume here - let the caller navigate to the correct thread
        if (isForDifferentThread && sessionStatus.status === "active") {
          console.info("[useStreamingResume] Session is active for different thread, signaling for redirect");
          // Don't clear - let caller handle navigation
          setState((s) => ({ ...s, isResuming: false }));
          checkedRef.current = currentThreadId;
          return;
        }

        if (sessionStatus.status === "active") {
          // Session still active - attempt reconnection
          console.info("[useStreamingResume] Session still active, attempting reconnection");
          if (onReconnect) {
            await onReconnect(savedSession.sessionId, savedSession.lastEventId);
          }
        } else if (sessionStatus.status === "completed") {
          // Session completed - fetch missed events for replay
          console.info("[useStreamingResume] Session completed, fetching missed events");
          const eventsUrl = new URL("/api/chatkit/stream/events", baseUrl);
          eventsUrl.searchParams.set("session_id", savedSession.sessionId);
          if (savedSession.lastEventId) {
            eventsUrl.searchParams.set("after", savedSession.lastEventId);
          }

          const eventsResponse = await fetch(eventsUrl.toString(), {
            headers: headersRef.current,
            signal: abortControllerRef.current.signal,
          });

          if (eventsResponse.ok) {
            const { events } = await eventsResponse.json();

            if (events && events.length > 0) {
              const eventData = events.map(
                (e: { data: ThreadStreamEvent }) => e.data
              );
              console.info("[useStreamingResume] Found", events.length, "missed events to replay");
              setState((s) => ({
                ...s,
                needsReplay: true,
                missedEvents: eventData,
              }));
              onReplay?.(eventData);
            } else {
              console.info("[useStreamingResume] No missed events to replay");
            }
          }
        } else {
          console.info("[useStreamingResume] Session status is:", sessionStatus.status);
        }
        // If status is 'error' or session is completed/handled, clear the session

        clearStreamingSession();
        setState((s) => ({ ...s, savedSessionThreadId: null }));
        // Mark as checked after successful completion
        checkedRef.current = currentThreadId;
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("[ChatKit] Resume check failed:", error);
          // Only mark as checked if it's not an abort (abort = cleanup, don't mark)
          clearStreamingSession();
          setState((s) => ({ ...s, savedSessionThreadId: null }));
          checkedRef.current = currentThreadId;
        }
        // Don't mark checked on abort - let the next mount retry
      } finally {
        setState((s) => ({ ...s, isResuming: false }));
      }
    };

    checkAndResume();

    return () => {
      abortControllerRef.current?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, enabled, onReconnect, onReplay, threadId]);

  // Start tracking a new streaming session
  const startTracking = useCallback((sessionId: string, threadId: string) => {
    saveStreamingSession({
      sessionId,
      threadId,
      lastEventId: null,
      startedAt: Date.now(),
    });
  }, []);

  // Track event IDs as they arrive
  const trackEvent = useCallback((eventId: string) => {
    updateLastEventId(eventId);
  }, []);

  // Stop tracking (clear session)
  const stopTracking = useCallback(() => {
    clearStreamingSession();
  }, []);

  // Clear missed events after replay
  const clearMissedEvents = useCallback(() => {
    setState((s) => ({
      ...s,
      needsReplay: false,
      missedEvents: [],
    }));
  }, []);

  return {
    ...state,
    startTracking,
    trackEvent,
    stopTracking,
    clearMissedEvents,
  };
}
