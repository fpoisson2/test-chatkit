import { getStreamingSessionThreadId } from "./streamingSession";

const THREAD_STORAGE_PREFIX = "chatkit:last-thread";
const DEFAULT_WORKFLOW_KEY = "__default__";

const buildLegacyThreadKey = (ownerId: string) => `${THREAD_STORAGE_PREFIX}:${ownerId}`;

const normalizeWorkflowSlug = (workflowSlug?: string | null) => {
  const trimmed = workflowSlug?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_WORKFLOW_KEY;
};

const buildThreadKey = (ownerId: string, workflowSlug?: string | null) =>
  `${THREAD_STORAGE_PREFIX}:${ownerId}:${normalizeWorkflowSlug(workflowSlug)}`;

/**
 * Get the thread ID from URL parameters.
 * Supports both ?thread=xxx and #thread=xxx formats.
 */
const getThreadIdFromUrl = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  // Check query parameters first (e.g., ?thread=thr_xxx or ?t=thr_xxx)
  const urlParams = new URLSearchParams(window.location.search);
  const threadParam = urlParams.get("thread") || urlParams.get("t");
  if (threadParam && threadParam.trim()) {
    return threadParam.trim();
  }

  // Check hash parameters (e.g., #thread=thr_xxx)
  const hash = window.location.hash;
  if (hash) {
    const hashParams = new URLSearchParams(hash.slice(1));
    const hashThread = hashParams.get("thread") || hashParams.get("t");
    if (hashThread && hashThread.trim()) {
      return hashThread.trim();
    }
  }

  return null;
};

export const loadStoredThreadId = (
  ownerId: string,
  workflowSlug?: string | null,
): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  // 1. Check URL parameters first - highest priority
  const urlThreadId = getThreadIdFromUrl();
  if (urlThreadId) {
    console.info("[ChatKit] Found thread ID in URL:", urlThreadId);
    return urlThreadId;
  }

  // 2. Check for an active streaming session - resume takes priority over stored thread
  const streamingThreadId = getStreamingSessionThreadId();
  if (streamingThreadId) {
    console.info("[ChatKit] Found streaming session for thread:", streamingThreadId);
    return streamingThreadId;
  }

  // 3. Check localStorage for the last viewed thread
  const key = buildThreadKey(ownerId, workflowSlug);
  const raw = window.localStorage.getItem(key);
  if (raw && raw.trim()) {
    return raw;
  }

  // 4. Check legacy localStorage key
  const legacyKey = buildLegacyThreadKey(ownerId);
  const legacyRaw = window.localStorage.getItem(legacyKey);
  if (legacyRaw && legacyRaw.trim()) {
    try {
      window.localStorage.setItem(key, legacyRaw);
      window.localStorage.removeItem(legacyKey);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn(
          "[ChatKit] Impossible de migrer l'identifiant du fil vers la clé par workflow",
          error,
        );
      }
    }
    return legacyRaw;
  }

  return null;
};

export const persistStoredThreadId = (
  ownerId: string,
  threadId: string | null,
  workflowSlug?: string | null,
) => {
  if (typeof window === "undefined") {
    return;
  }

  const key = buildThreadKey(ownerId, workflowSlug);
  if (!threadId) {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(buildLegacyThreadKey(ownerId));
    return;
  }

  try {
    window.localStorage.setItem(key, threadId);
  } catch (error) {
    console.warn("[ChatKit] Impossible de persister l'identifiant du fil", error);
  }
};

export const clearStoredThreadId = (ownerId: string, workflowSlug?: string | null) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(buildThreadKey(ownerId, workflowSlug));
  window.localStorage.removeItem(buildLegacyThreadKey(ownerId));
};

/**
 * Update the URL with the thread ID parameter.
 * Uses replaceState to avoid adding to browser history.
 */
export const setThreadIdInUrl = (threadId: string | null) => {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);

  if (threadId) {
    url.searchParams.set("thread", threadId);
  } else {
    url.searchParams.delete("thread");
    url.searchParams.delete("t");
  }

  window.history.replaceState({}, "", url.toString());
};

/**
 * Clear thread ID from URL without reloading.
 */
export const clearThreadIdFromUrl = () => {
  setThreadIdInUrl(null);
};
