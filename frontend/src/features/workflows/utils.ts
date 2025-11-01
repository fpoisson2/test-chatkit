import type { HostedWorkflowMetadata } from "../../utils/backend";
import type { WorkflowSummary } from "../../types/workflows";
import type { HostedFlowMode } from "../../hooks/useHostedFlow";

export const getWorkflowInitials = (label: string) => {
  const trimmed = label.trim();

  if (!trimmed) {
    return "?";
  }

  const words = trimmed.split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return "?";
  }

  if (words.length === 1) {
    return trimmed.slice(0, 2).toUpperCase();
  }

  return (words[0]?.charAt(0) ?? "").concat(words[1]?.charAt(0) ?? "").toUpperCase();
};

export type StoredWorkflowPinned = {
  local: number[];
  hosted: string[];
};

export type StoredWorkflowPinnedLookup = {
  local: Set<number>;
  hosted: Set<string>;
};

export type StoredWorkflowSelection = {
  mode: "local" | "hosted";
  localWorkflowId: number | null;
  hostedSlug: string | null;
  lastUsedAt: StoredWorkflowLastUsedAt;
  pinned: StoredWorkflowPinned;
};

export type WorkflowSidebarCache = {
  workflows: WorkflowSummary[];
  hostedWorkflows: HostedWorkflowMetadata[];
  selectedWorkflowId: number | null;
  selectedHostedSlug: string | null;
  mode: HostedFlowMode;
};

export type StoredWorkflowLastUsedAt = {
  local: Record<string, number>;
  hosted: Record<string, number>;
};

export type WorkflowSortEntry =
  | { kind: "local"; workflow: WorkflowSummary }
  | { kind: "hosted"; workflow: HostedWorkflowMetadata };

export type WorkflowSortMetadata = {
  pinned: boolean;
  lastUsedAt: number | null;
  label: string;
};

export const WORKFLOW_SELECTION_STORAGE_KEY = "chatkit:workflow-selection";
export const WORKFLOW_SELECTION_CHANGED_EVENT = "chatkit:workflow-selection-changed";

const createEmptyLastUsedAt = (): StoredWorkflowLastUsedAt => ({
  local: {},
  hosted: {},
});

const cloneLastUsedAt = (value: StoredWorkflowLastUsedAt | null | undefined): StoredWorkflowLastUsedAt => {
  if (!value) {
    return createEmptyLastUsedAt();
  }

  return {
    local: { ...value.local },
    hosted: { ...value.hosted },
  };
};

const createEmptyPinnedSet = (): StoredWorkflowPinned => ({
  local: [],
  hosted: [],
});

const normalizePinnedNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return null;
};

const normalizePinnedString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const deduplicate = <T>(values: readonly T[]): T[] => {
  const result: T[] = [];
  const seen = new Set<T>();

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
};

const clonePinnedSet = (value: StoredWorkflowPinned | null | undefined): StoredWorkflowPinned => {
  if (!value) {
    return createEmptyPinnedSet();
  }

  const local = deduplicate(
    (Array.isArray(value.local) ? value.local : []).map((entry) => normalizePinnedNumber(entry)).filter(
      (entry): entry is number => entry !== null,
    ),
  );
  const hosted = deduplicate(
    (Array.isArray(value.hosted) ? value.hosted : []).map((entry) => normalizePinnedString(entry)).filter(
      (entry): entry is string => entry !== null,
    ),
  );

  return { local, hosted };
};

const createPinnedLookup = (pinned: StoredWorkflowPinned): StoredWorkflowPinnedLookup => ({
  local: new Set(pinned.local),
  hosted: new Set(pinned.hosted),
});

const parsePinnedLocal = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return deduplicate(
    value
      .map((entry) => normalizePinnedNumber(entry))
      .filter((entry): entry is number => entry !== null),
  );
};

const parsePinnedHosted = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return deduplicate(
    value
      .map((entry) => normalizePinnedString(entry))
      .filter((entry): entry is string => entry !== null),
  );
};

const parsePinnedSet = (value: unknown): StoredWorkflowPinned => {
  if (!value || typeof value !== "object") {
    return createEmptyPinnedSet();
  }

  const record = value as Partial<StoredWorkflowPinned> & {
    local?: unknown;
    hosted?: unknown;
  };

  return {
    local: parsePinnedLocal(record.local),
    hosted: parsePinnedHosted(record.hosted),
  };
};

export const readStoredWorkflowPinnedLookup = (): StoredWorkflowPinnedLookup =>
  createPinnedLookup(readStoredWorkflowSelection()?.pinned ?? createEmptyPinnedSet());

export const createEmptyStoredWorkflowPinned = (): StoredWorkflowPinned => createEmptyPinnedSet();

const readSelectionStorageItem = (key: string): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const { localStorage, sessionStorage } = window as Window & {
    localStorage?: Storage;
    sessionStorage?: Storage;
  };

  const safeRead = (storage: Storage | undefined): string | null => {
    if (!storage) {
      return null;
    }

    try {
      return storage.getItem(key);
    } catch (error) {
      console.warn("Unable to read workflow selection storage", error);
      return null;
    }
  };

  const localValue = safeRead(localStorage);
  if (localValue !== null) {
    return localValue;
  }

  const sessionValue = safeRead(sessionStorage);
  if (sessionValue === null) {
    return null;
  }

  if (localStorage) {
    try {
      localStorage.setItem(key, sessionValue);
    } catch (error) {
      console.warn("Unable to migrate workflow selection storage", error);
    }
  }

  if (sessionStorage) {
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      console.warn("Unable to clear legacy workflow selection storage", error);
    }
  }

  return sessionValue;
};

const writeSelectionStorageItem = (key: string, value: string | null) => {
  if (typeof window === "undefined") {
    return;
  }

  const { localStorage, sessionStorage } = window as Window & {
    localStorage?: Storage;
    sessionStorage?: Storage;
  };

  const safeRemove = (storage: Storage | undefined) => {
    if (!storage) {
      return;
    }

    try {
      storage.removeItem(key);
    } catch (error) {
      console.warn("Unable to clear workflow selection storage", error);
    }
  };

  if (value === null) {
    safeRemove(localStorage);
    safeRemove(sessionStorage);
    return;
  }

  let stored = false;
  if (localStorage) {
    try {
      localStorage.setItem(key, value);
      stored = true;
    } catch (error) {
      console.warn("Unable to write workflow selection storage", error);
    }
  }

  if (!stored && sessionStorage) {
    try {
      sessionStorage.setItem(key, value);
      stored = true;
    } catch (error) {
      console.warn("Unable to write workflow selection storage fallback", error);
    }
  }

  if (stored && sessionStorage) {
    safeRemove(sessionStorage);
  }
};

const parseTimestamp = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const parseLastUsedRecord = (input: unknown): Record<string, number> => {
  if (!input || typeof input !== "object") {
    return {};
  }

  const entries: Array<[string, number]> = [];
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const timestamp = parseTimestamp(raw);
    if (timestamp !== null) {
      entries.push([key, timestamp]);
    }
  }

  return Object.fromEntries(entries);
};

const parseLastUsedAt = (value: unknown): StoredWorkflowLastUsedAt => {
  if (!value || typeof value !== "object") {
    return createEmptyLastUsedAt();
  }

  const record = value as Partial<StoredWorkflowLastUsedAt> & {
    local?: unknown;
    hosted?: unknown;
  };

  return {
    local: parseLastUsedRecord(record.local),
    hosted: parseLastUsedRecord(record.hosted),
  };
};

const parseStoredSelection = (value: string | null): StoredWorkflowSelection | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<StoredWorkflowSelection>;
    if (
      (parsed.mode === "local" || parsed.mode === "hosted") &&
      (parsed.localWorkflowId === null || typeof parsed.localWorkflowId === "number") &&
      (parsed.hostedSlug === null || typeof parsed.hostedSlug === "string")
    ) {
      return {
        mode: parsed.mode,
        localWorkflowId: parsed.localWorkflowId ?? null,
        hostedSlug: parsed.hostedSlug ?? null,
        lastUsedAt: parseLastUsedAt(parsed.lastUsedAt),
        pinned: parsePinnedSet(parsed.pinned),
      } satisfies StoredWorkflowSelection;
    }
  } catch (error) {
    console.warn("Unable to parse workflow selection", error);
  }

  return null;
};

const dispatchWorkflowSelectionChanged = () => {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }

  try {
    window.dispatchEvent(new Event(WORKFLOW_SELECTION_CHANGED_EVENT));
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("Unable to dispatch workflow selection change event", error);
    }
  }
};

export const readStoredWorkflowSelection = (): StoredWorkflowSelection | null =>
  parseStoredSelection(readSelectionStorageItem(WORKFLOW_SELECTION_STORAGE_KEY));

const normalizeStoredSelection = (
  selection: StoredWorkflowSelection | null,
  previous?: StoredWorkflowSelection | null,
): StoredWorkflowSelection | null => {
  if (!selection) {
    return null;
  }

  const lastUsedAt = cloneLastUsedAt(selection.lastUsedAt ?? previous?.lastUsedAt);
  const pinned = clonePinnedSet(selection.pinned ?? previous?.pinned);
  return {
    ...selection,
    lastUsedAt,
    pinned,
  } satisfies StoredWorkflowSelection;
};

export const writeStoredWorkflowSelection = (selection: StoredWorkflowSelection | null) => {
  if (!selection) {
    writeSelectionStorageItem(WORKFLOW_SELECTION_STORAGE_KEY, null);
    dispatchWorkflowSelectionChanged();
    return;
  }

  const normalized = normalizeStoredSelection(selection);
  writeSelectionStorageItem(
    WORKFLOW_SELECTION_STORAGE_KEY,
    normalized ? JSON.stringify(normalized) : null,
  );
  dispatchWorkflowSelectionChanged();
};

export const updateStoredWorkflowSelection = (
  updater: (previous: StoredWorkflowSelection | null) => StoredWorkflowSelection | null,
) => {
  const previous = readStoredWorkflowSelection();
  const next = normalizeStoredSelection(updater(previous), previous);
  writeStoredWorkflowSelection(next);
};

const resolvePinnedStatus = (
  entry: WorkflowSummary | HostedWorkflowMetadata,
): boolean => {
  const candidate = entry as {
    pinned?: boolean | null;
    pinned_at?: string | null;
    pinnedAt?: string | null;
  };

  if (typeof candidate.pinned === "boolean") {
    return candidate.pinned;
  }

  return Boolean(candidate.pinned_at ?? candidate.pinnedAt ?? null);
};

export const isWorkflowPinned = (
  entry: WorkflowSortEntry,
  pinnedLookup?: StoredWorkflowPinnedLookup,
): boolean => {
  const isStoredPinned = () => {
    if (!pinnedLookup) {
      return false;
    }

    if (entry.kind === "local") {
      return pinnedLookup.local.has(entry.workflow.id);
    }

    return pinnedLookup.hosted.has(entry.workflow.slug);
  };

  if (entry.kind === "local") {
    return resolvePinnedStatus(entry.workflow) || isStoredPinned();
  }

  return resolvePinnedStatus(entry.workflow) || isStoredPinned();
};

export const getWorkflowSortMetadata = (
  entry: WorkflowSortEntry,
  lastUsedAt: StoredWorkflowLastUsedAt,
  pinnedLookup?: StoredWorkflowPinnedLookup,
): WorkflowSortMetadata => {
  if (entry.kind === "local") {
    const key = String(entry.workflow.id);
    return {
      pinned: isWorkflowPinned(entry, pinnedLookup),
      lastUsedAt: lastUsedAt.local[key] ?? null,
      label: entry.workflow.display_name,
    };
  }

  const key = entry.workflow.slug;
  return {
    pinned: isWorkflowPinned(entry, pinnedLookup),
    lastUsedAt: lastUsedAt.hosted[key] ?? null,
    label: entry.workflow.label,
  };
};

const defaultWorkflowCollator = new Intl.Collator(undefined, { sensitivity: "base" });

type OrderWorkflowEntriesOptions = {
  collator?: Intl.Collator;
  pinned?: StoredWorkflowPinned;
  pinnedLookup?: StoredWorkflowPinnedLookup;
};

export const compareWorkflowSortMetadata = (
  a: WorkflowSortMetadata,
  b: WorkflowSortMetadata,
  collator: Intl.Collator = defaultWorkflowCollator,
): number => {
  if (a.pinned !== b.pinned) {
    return a.pinned ? -1 : 1;
  }

  if (a.lastUsedAt !== b.lastUsedAt) {
    if (a.lastUsedAt == null) {
      return 1;
    }
    if (b.lastUsedAt == null) {
      return -1;
    }
    return b.lastUsedAt - a.lastUsedAt;
  }

  return collator.compare(a.label, b.label);
};

export const orderWorkflowEntries = <T extends WorkflowSortEntry>(
  entries: readonly T[],
  lastUsedAt: StoredWorkflowLastUsedAt,
  options?: OrderWorkflowEntriesOptions,
): T[] => {
  const collator = options?.collator ?? defaultWorkflowCollator;
  const pinnedLookup =
    options?.pinnedLookup ??
    (options?.pinned ? createPinnedLookup(options.pinned) : undefined);
  return [...entries].sort((left, right) =>
    compareWorkflowSortMetadata(
      getWorkflowSortMetadata(left, lastUsedAt, pinnedLookup),
      getWorkflowSortMetadata(right, lastUsedAt, pinnedLookup),
      collator,
    ),
  );
};

export const readStoredWorkflowLastUsedMap = (): StoredWorkflowLastUsedAt =>
  cloneLastUsedAt(readStoredWorkflowSelection()?.lastUsedAt ?? null);

const parseIsoTimestamp = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getWorkflowProductionOrderTimestamp = (
  workflow: WorkflowSummary,
): number | null => {
  const updatedAt = parseIsoTimestamp(workflow.updated_at);
  if (updatedAt != null) {
    return updatedAt;
  }

  return parseIsoTimestamp(workflow.created_at);
};

export const buildWorkflowOrderingTimestamps = (
  workflows: readonly WorkflowSummary[],
  hostedWorkflows: readonly HostedWorkflowMetadata[],
  base: StoredWorkflowLastUsedAt = createEmptyLastUsedAt(),
): StoredWorkflowLastUsedAt => {
  const fallback = cloneLastUsedAt(base);
  const localEntries: Record<string, number> = {};

  for (const workflow of workflows) {
    const key = String(workflow.id);
    const deploymentTimestamp = getWorkflowProductionOrderTimestamp(workflow);
    if (deploymentTimestamp != null) {
      localEntries[key] = deploymentTimestamp;
      continue;
    }

    const stored = fallback.local[key];
    if (typeof stored === "number") {
      localEntries[key] = stored;
    }
  }

  const hostedEntries: Record<string, number> = {};
  for (const entry of hostedWorkflows) {
    const stored = fallback.hosted[entry.slug];
    if (typeof stored === "number") {
      hostedEntries[entry.slug] = stored;
    }
  }

  return { local: localEntries, hosted: hostedEntries };
};

export const readStoredWorkflowLastUsedAt = (
  entry: WorkflowSortEntry,
): number | null =>
  getWorkflowSortMetadata(entry, readStoredWorkflowLastUsedMap()).lastUsedAt;

export const recordWorkflowLastUsedAt = (
  entry: WorkflowSortEntry,
  timestamp: number = Date.now(),
): StoredWorkflowLastUsedAt => {
  let result = createEmptyLastUsedAt();
  updateStoredWorkflowSelection((previous) => {
    const base =
      previous ?? {
        mode: entry.kind,
        localWorkflowId: entry.kind === "local" ? entry.workflow.id : null,
        hostedSlug: entry.kind === "hosted" ? entry.workflow.slug : null,
        lastUsedAt: createEmptyLastUsedAt(),
        pinned: createEmptyPinnedSet(),
      };

    const nextLastUsedAt = cloneLastUsedAt(base.lastUsedAt);
    if (entry.kind === "local") {
      nextLastUsedAt.local[String(entry.workflow.id)] = timestamp;
    } else {
      nextLastUsedAt.hosted[entry.workflow.slug] = timestamp;
    }

    result = nextLastUsedAt;
    return {
      ...base,
      lastUsedAt: nextLastUsedAt,
      pinned: clonePinnedSet(base.pinned),
    } satisfies StoredWorkflowSelection;
  });

  return result;
};

let workflowSidebarCache: WorkflowSidebarCache | null = null;

export const readWorkflowSidebarCache = (): WorkflowSidebarCache | null => workflowSidebarCache;

export const writeWorkflowSidebarCache = (cache: WorkflowSidebarCache | null) => {
  workflowSidebarCache = cache;
};

export const clearWorkflowSidebarCache = () => {
  workflowSidebarCache = null;
};
