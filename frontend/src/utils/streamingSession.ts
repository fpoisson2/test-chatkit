/**
 * Streaming session state management for resume capability.
 *
 * This module provides utilities to track active streaming sessions
 * in sessionStorage, enabling resume after page refresh.
 */

const SESSION_STORAGE_KEY = "chatkit:streaming-session";
const PAGE_SESSION_KEY = "chatkit:page-session-id";

// Generate a unique ID for this page load - changes on every refresh
const PAGE_SESSION_ID = `page_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export interface StreamingSessionState {
  /** Unique streaming session ID from backend */
  sessionId: string;
  /** Thread ID being streamed */
  threadId: string;
  /** Last received event ID for resume position */
  lastEventId: string | null;
  /** Timestamp when streaming started */
  startedAt: number;
  /** Page session ID that created this session */
  pageSessionId?: string;
}

/**
 * Save streaming session state to sessionStorage.
 */
export function saveStreamingSession(state: StreamingSessionState): void {
  if (typeof window === "undefined") return;

  try {
    // Add current page session ID to track which page created this session
    const stateWithPageId = { ...state, pageSessionId: PAGE_SESSION_ID };
    console.info("[streamingSession] Saving session:", stateWithPageId);
    const jsonStr = JSON.stringify(stateWithPageId);
    sessionStorage.setItem(SESSION_STORAGE_KEY, jsonStr);
    // Verify it was saved
    const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
    console.info("[streamingSession] Verified saved:", saved === jsonStr ? "OK" : "MISMATCH", saved);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[ChatKit] Failed to save streaming session:", error);
    }
  }
}

/**
 * Load streaming session state from sessionStorage.
 */
export function loadStreamingSession(): StreamingSessionState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    console.info("[streamingSession] Raw from storage:", raw);
    if (!raw) return null;

    const state = JSON.parse(raw) as StreamingSessionState;
    console.info("[streamingSession] Parsed state:", state);

    // Validate required fields
    if (!state.sessionId || !state.threadId) {
      console.warn("[streamingSession] Invalid state - missing required fields, clearing");
      clearStreamingSession();
      return null;
    }

    return state;
  } catch (error) {
    console.error("[streamingSession] Error loading session, clearing:", error);
    clearStreamingSession();
    return null;
  }
}

/**
 * Update the last event ID in the stored session.
 */
export function updateLastEventId(eventId: string): void {
  const session = loadStreamingSession();
  if (session) {
    session.lastEventId = eventId;
    saveStreamingSession(session);
  }
}

/**
 * Clear streaming session from sessionStorage.
 */
export function clearStreamingSession(): void {
  if (typeof window === "undefined") return;

  // Log stack trace to find who is clearing the session
  console.warn("[streamingSession] Clearing session - stack trace:", new Error().stack);

  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}

/**
 * Check if there's a potentially resumable session for a given thread.
 */
export function hasResumableSession(threadId: string): boolean {
  const session = loadStreamingSession();
  return session !== null && session.threadId === threadId;
}

/**
 * Get the threadId from any active streaming session.
 * Used to prioritize loading the streaming thread on page refresh.
 */
export function getStreamingSessionThreadId(): string | null {
  const session = loadStreamingSession();
  return session?.threadId ?? null;
}

/**
 * Check if the saved session was created by a previous page load.
 * Returns true if we should attempt to resume (session from different page),
 * false if session was created by current page (no need to resume).
 */
export function shouldAttemptResume(): boolean {
  const session = loadStreamingSession();
  if (!session) return false;

  // If no pageSessionId, it's from an old format - try to resume
  if (!session.pageSessionId) return true;

  // Only resume if session was created by a different page load
  const isFromDifferentPage = session.pageSessionId !== PAGE_SESSION_ID;
  console.info("[streamingSession] shouldAttemptResume:", {
    sessionPageId: session.pageSessionId,
    currentPageId: PAGE_SESSION_ID,
    isFromDifferentPage,
  });
  return isFromDifferentPage;
}
