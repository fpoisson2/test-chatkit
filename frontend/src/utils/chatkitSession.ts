const STORAGE_PREFIX = "chatkit:session";
const EXPIRATION_GRACE_MS = 5 * 1000;
const REFRESH_THRESHOLD_MS = 60 * 1000;

export type StoredChatKitSession = {
  secret: string;
  expiresAt: number | null;
  storedAt: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const buildStorageKey = (ownerId: string) => `${STORAGE_PREFIX}:${ownerId}`;

export const normalizeSessionExpiration = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  if (isRecord(value)) {
    if ("expires_at" in value) {
      return normalizeSessionExpiration(value.expires_at);
    }
    if ("expiresAt" in value) {
      return normalizeSessionExpiration(value.expiresAt);
    }
  }

  return null;
};

const isSessionExpired = (session: StoredChatKitSession, now: number) =>
  Boolean(session.expiresAt && session.expiresAt - EXPIRATION_GRACE_MS <= now);

const shouldRefreshSession = (session: StoredChatKitSession, now: number) =>
  Boolean(session.expiresAt && session.expiresAt - REFRESH_THRESHOLD_MS <= now);

export const readStoredChatKitSession = (
  ownerId: string,
): { session: StoredChatKitSession | null; shouldRefresh: boolean } => {
  if (typeof window === "undefined") {
    return { session: null, shouldRefresh: false };
  }

  const key = buildStorageKey(ownerId);
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return { session: null, shouldRefresh: false };
  }

  try {
    const stored = JSON.parse(raw) as StoredChatKitSession;
    const now = Date.now();
    if (isSessionExpired(stored, now)) {
      window.localStorage.removeItem(key);
      return { session: null, shouldRefresh: false };
    }
    return { session: stored, shouldRefresh: shouldRefreshSession(stored, now) };
  } catch (error) {
    window.localStorage.removeItem(key);
    return { session: null, shouldRefresh: false };
  }
};

export const loadStoredChatKitSession = (ownerId: string): StoredChatKitSession | null =>
  readStoredChatKitSession(ownerId).session;

export const loadStoredChatKitSecret = (ownerId: string): string | null => {
  const { session } = readStoredChatKitSession(ownerId);
  return session ? session.secret : null;
};

export const shouldRefreshStoredChatKitSession = (ownerId: string): boolean =>
  readStoredChatKitSession(ownerId).shouldRefresh;

export const persistChatKitSecret = (
  ownerId: string,
  secret: string,
  expiresAt: number | null,
) => {
  if (typeof window === "undefined") {
    return;
  }

  const key = buildStorageKey(ownerId);
  const payload: StoredChatKitSession = {
    secret,
    expiresAt,
    storedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch (error) {
  }
};

export const clearStoredChatKitSecret = (ownerId: string) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(buildStorageKey(ownerId));
};
