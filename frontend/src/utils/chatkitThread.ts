const THREAD_STORAGE_PREFIX = "chatkit:last-thread";

const buildThreadKey = (ownerId: string) => `${THREAD_STORAGE_PREFIX}:${ownerId}`;

export const loadStoredThreadId = (ownerId: string): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(buildThreadKey(ownerId));
  return raw && raw.trim() ? raw : null;
};

export const persistStoredThreadId = (ownerId: string, threadId: string | null) => {
  if (typeof window === "undefined") {
    return;
  }

  const key = buildThreadKey(ownerId);
  if (!threadId) {
    window.localStorage.removeItem(key);
    return;
  }

  try {
    window.localStorage.setItem(key, threadId);
  } catch (error) {
    console.warn("[ChatKit] Impossible de persister l'identifiant du fil", error);
  }
};

export const clearStoredThreadId = (ownerId: string) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(buildThreadKey(ownerId));
};
