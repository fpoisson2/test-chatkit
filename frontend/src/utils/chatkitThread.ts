const THREAD_STORAGE_PREFIX = "chatkit:last-thread";
const DEFAULT_WORKFLOW_KEY = "__default__";

const buildLegacyThreadKey = (ownerId: string) => `${THREAD_STORAGE_PREFIX}:${ownerId}`;

const normalizeWorkflowSlug = (workflowSlug?: string | null) => {
  const trimmed = workflowSlug?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_WORKFLOW_KEY;
};

const buildThreadKey = (ownerId: string, workflowSlug?: string | null) =>
  `${THREAD_STORAGE_PREFIX}:${ownerId}:${normalizeWorkflowSlug(workflowSlug)}`;

export const loadStoredThreadId = (
  ownerId: string,
  workflowSlug?: string | null,
): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const key = buildThreadKey(ownerId, workflowSlug);
  const raw = window.localStorage.getItem(key);
  if (raw && raw.trim()) {
    return raw;
  }

  const legacyKey = buildLegacyThreadKey(ownerId);
  const legacyRaw = window.localStorage.getItem(legacyKey);
  if (legacyRaw && legacyRaw.trim()) {
    try {
      window.localStorage.setItem(key, legacyRaw);
      window.localStorage.removeItem(legacyKey);
    } catch (error) {
      if (import.meta.env.DEV) {
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
  }
};

export const clearStoredThreadId = (ownerId: string, workflowSlug?: string | null) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(buildThreadKey(ownerId, workflowSlug));
  window.localStorage.removeItem(buildLegacyThreadKey(ownerId));
};
