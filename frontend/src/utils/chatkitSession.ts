const STORAGE_PREFIX = "chatkit:session";
const EXPIRATION_GRACE_MS = 5 * 1000;
const REFRESH_THRESHOLD_MS = 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 9 * 60 * 1000;

export type StoredChatKitSession = {
  secret: string;
  expiresAt: number | null;
  storedAt: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const buildStorageKey = (ownerId: string) => `${STORAGE_PREFIX}:${ownerId}`;

const toTimestampMs = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) {
      return null;
    }
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
};

const readMsDuration = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) {
      return null;
    }
    return value > 10_000 ? value : value * 1000;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed > 10_000 ? parsed : parsed * 1000;
    }
  }

  if (isRecord(value)) {
    const candidates: unknown[] = [value.milliseconds, value.ms, value.seconds, value.value];
    for (const candidate of candidates) {
      const duration = readMsDuration(candidate);
      if (duration) {
        return duration;
      }
    }
  }

  return null;
};

const possibleContainers = (payload: unknown): Record<string, unknown>[] => {
  if (!isRecord(payload)) {
    return [];
  }
  const containers: Record<string, unknown>[] = [payload];
  const nestedCandidates = [payload.session, payload.data, payload.result];
  for (const candidate of nestedCandidates) {
    if (isRecord(candidate)) {
      containers.push(candidate);
    }
  }
  return containers;
};

const pickFirst = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
};

export const inferChatKitSessionExpiration = (payload: unknown): number | null => {
  const now = Date.now();
  const containers = possibleContainers(payload);

  for (const container of containers) {
    const expiresAtCandidate = pickFirst(container, ["expires_at", "expiresAt"]);
    const expiresAt = toTimestampMs(expiresAtCandidate);
    if (expiresAt && expiresAt > now) {
      return expiresAt;
    }

    const expiresAfterCandidate = pickFirst(container, ["expires_after", "expiresAfter", "ttl", "ttl_seconds", "ttlSeconds"]);
    const expiresAfterMs = readMsDuration(expiresAfterCandidate);
    if (expiresAfterMs) {
      return now + expiresAfterMs;
    }
  }

  return now + DEFAULT_SESSION_TTL_MS;
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
    console.warn("[ChatKit] Échec de la lecture du secret stocké", error);
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
    console.warn("[ChatKit] Impossible de persister le secret de session", error);
  }
};

export const clearStoredChatKitSecret = (ownerId: string) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(buildStorageKey(ownerId));
};
