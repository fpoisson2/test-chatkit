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

export type StoredWorkflowSelection = {
  mode: "local" | "hosted";
  localWorkflowId: number | null;
  hostedSlug: string | null;
  lastUsedAt: StoredWorkflowLastUsedAt;
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

const readSessionStorageItem = (key: string): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage.getItem(key);
  } catch (error) {
    console.warn("Unable to read session storage", error);
    return null;
  }
};

const writeSessionStorageItem = (key: string, value: string | null) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (value === null) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, value);
    }
  } catch (error) {
    console.warn("Unable to write session storage", error);
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
  parseStoredSelection(readSessionStorageItem(WORKFLOW_SELECTION_STORAGE_KEY));

const ensureLastUsedAt = (
  selection: StoredWorkflowSelection | null,
  previous?: StoredWorkflowSelection | null,
): StoredWorkflowSelection | null => {
  if (!selection) {
    return null;
  }

  const lastUsedAt = cloneLastUsedAt(selection.lastUsedAt ?? previous?.lastUsedAt);
  return {
    ...selection,
    lastUsedAt,
  } satisfies StoredWorkflowSelection;
};

export const writeStoredWorkflowSelection = (selection: StoredWorkflowSelection | null) => {
  if (!selection) {
    writeSessionStorageItem(WORKFLOW_SELECTION_STORAGE_KEY, null);
    dispatchWorkflowSelectionChanged();
    return;
  }

  const normalized = ensureLastUsedAt(selection);
  writeSessionStorageItem(
    WORKFLOW_SELECTION_STORAGE_KEY,
    normalized ? JSON.stringify(normalized) : null,
  );
  dispatchWorkflowSelectionChanged();
};

export const updateStoredWorkflowSelection = (
  updater: (previous: StoredWorkflowSelection | null) => StoredWorkflowSelection | null,
) => {
  const previous = readStoredWorkflowSelection();
  const next = ensureLastUsedAt(updater(previous), previous);
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

export const getWorkflowSortMetadata = (
  entry: WorkflowSortEntry,
  lastUsedAt: StoredWorkflowLastUsedAt,
): WorkflowSortMetadata => {
  if (entry.kind === "local") {
    const key = String(entry.workflow.id);
    return {
      pinned: resolvePinnedStatus(entry.workflow),
      lastUsedAt: lastUsedAt.local[key] ?? null,
      label: entry.workflow.display_name,
    };
  }

  const key = entry.workflow.slug;
  return {
    pinned: resolvePinnedStatus(entry.workflow),
    lastUsedAt: lastUsedAt.hosted[key] ?? null,
    label: entry.workflow.label,
  };
};

const defaultWorkflowCollator = new Intl.Collator(undefined, { sensitivity: "base" });

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
  options?: { collator?: Intl.Collator },
): T[] => {
  const collator = options?.collator ?? defaultWorkflowCollator;
  return [...entries].sort((left, right) =>
    compareWorkflowSortMetadata(
      getWorkflowSortMetadata(left, lastUsedAt),
      getWorkflowSortMetadata(right, lastUsedAt),
      collator,
    ),
  );
};

export const readStoredWorkflowLastUsedMap = (): StoredWorkflowLastUsedAt =>
  cloneLastUsedAt(readStoredWorkflowSelection()?.lastUsedAt ?? null);

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
