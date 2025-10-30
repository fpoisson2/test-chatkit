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
};

const WORKFLOW_SELECTION_STORAGE_KEY = "chatkit:workflow-selection";

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
      } satisfies StoredWorkflowSelection;
    }
  } catch (error) {
    console.warn("Unable to parse workflow selection", error);
  }

  return null;
};

export const readStoredWorkflowSelection = (): StoredWorkflowSelection | null =>
  parseStoredSelection(readSessionStorageItem(WORKFLOW_SELECTION_STORAGE_KEY));

export const writeStoredWorkflowSelection = (selection: StoredWorkflowSelection | null) => {
  if (!selection) {
    writeSessionStorageItem(WORKFLOW_SELECTION_STORAGE_KEY, null);
    return;
  }

  writeSessionStorageItem(WORKFLOW_SELECTION_STORAGE_KEY, JSON.stringify(selection));
};

export const updateStoredWorkflowSelection = (
  updater: (previous: StoredWorkflowSelection | null) => StoredWorkflowSelection | null,
) => {
  const previous = readStoredWorkflowSelection();
  const next = updater(previous);
  writeStoredWorkflowSelection(next);
};
