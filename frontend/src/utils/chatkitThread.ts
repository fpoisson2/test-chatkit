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

  console.log("[DEBUG-CONV] loadStoredThreadId", {
    ownerId,
    workflowSlug,
    key,
    rawValue: raw,
    timestamp: new Date().toISOString(),
  });

  if (raw && raw.trim()) {
    console.log("[DEBUG-CONV] loadStoredThreadId returning", { threadId: raw });
    return raw;
  }

  const legacyKey = buildLegacyThreadKey(ownerId);
  const legacyRaw = window.localStorage.getItem(legacyKey);
  if (legacyRaw && legacyRaw.trim()) {
    console.log("[DEBUG-CONV] loadStoredThreadId returning legacy", { threadId: legacyRaw });
    try {
      window.localStorage.setItem(key, legacyRaw);
      window.localStorage.removeItem(legacyKey);
    } catch (error) {
      // Migration error ignored
    }
    return legacyRaw;
  }

  console.log("[DEBUG-CONV] loadStoredThreadId returning null (no stored thread)");
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

  console.log("[DEBUG-CONV] persistStoredThreadId", {
    ownerId,
    threadId,
    workflowSlug,
    key,
    timestamp: new Date().toISOString(),
  });

  if (!threadId) {
    console.log("[DEBUG-CONV] persistStoredThreadId: removing (null threadId)");
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(buildLegacyThreadKey(ownerId));
    return;
  }

  try {
    window.localStorage.setItem(key, threadId);
    console.log("[DEBUG-CONV] persistStoredThreadId: saved", { key, threadId });
  } catch (error) {
    console.log("[DEBUG-CONV] persistStoredThreadId: error", { error });
    // Persist error ignored
  }
};

export const clearStoredThreadId = (ownerId: string, workflowSlug?: string | null) => {
  if (typeof window === "undefined") {
    return;
  }
  const key = buildThreadKey(ownerId, workflowSlug);

  console.log("[DEBUG-CONV] clearStoredThreadId", {
    ownerId,
    workflowSlug,
    key,
    previousValue: window.localStorage.getItem(key),
    timestamp: new Date().toISOString(),
  });

  window.localStorage.removeItem(key);
  window.localStorage.removeItem(buildLegacyThreadKey(ownerId));
  console.log("[DEBUG-CONV] clearStoredThreadId: completed");
};
