import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildWorkflowOrderingTimestamps,
  WORKFLOW_SELECTION_STORAGE_KEY,
  compareWorkflowSortMetadata,
  getWorkflowProductionOrderTimestamp,
  getWorkflowSortMetadata,
  orderWorkflowEntries,
  readStoredWorkflowSelection,
  recordWorkflowLastUsedAt,
  updateStoredWorkflowSelection,
  writeStoredWorkflowSelection,
  type StoredWorkflowLastUsedAt,
  type WorkflowSortEntry,
} from "../utils";
import type { HostedWorkflowMetadata } from "../../../utils/backend";
import type { WorkflowSummary } from "../../../types/workflows";

type WindowWithStubs = Window & {
  sessionStorage: Storage;
  addEventListener: Window["addEventListener"];
  removeEventListener: Window["removeEventListener"];
  dispatchEvent: Window["dispatchEvent"];
};

const createWorkflowSummary = (
  id: number,
  name: string,
  overrides: Partial<WorkflowSummary> = {},
): WorkflowSummary => ({
  id,
  slug: `workflow-${id}`,
  display_name: name,
  description: null,
  active_version_id: 1,
  active_version_number: 1,
  is_chatkit_default: false,
  versions_count: 1,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  ...overrides,
});

const createHostedWorkflow = (
  slug: string,
  label: string,
  overrides: Partial<HostedWorkflowMetadata> = {},
): HostedWorkflowMetadata => ({
  id: slug,
  slug,
  label,
  description: null,
  available: true,
  managed: true,
  ...overrides,
});

let windowStub: WindowWithStubs;

beforeEach(() => {
  const storage = new Map<string, string>();
  const listeners = new Map<string, Set<(event: Event) => void>>();

  const sessionStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
    key: vi.fn(),
    length: 0,
  } satisfies Storage;

  const addEventListener = vi.fn((type: string, handler: EventListenerOrEventListenerObject) => {
    const set = listeners.get(type) ?? new Set<(event: Event) => void>();
    const listener =
      typeof handler === "function" ? handler : (event: Event) => handler.handleEvent(event);
    set.add(listener);
    listeners.set(type, set);
  });

  const removeEventListener = vi.fn(
    (type: string, handler: EventListenerOrEventListenerObject) => {
      const set = listeners.get(type);
      if (!set) {
        return;
      }
      const listener =
        typeof handler === "function" ? handler : (event: Event) => handler.handleEvent(event);
      set.delete(listener);
      if (set.size === 0) {
        listeners.delete(type);
      }
    },
  );

  const dispatchEvent = vi.fn((event: Event) => {
    const set = listeners.get(event.type);
    if (set) {
      for (const listener of set) {
        listener.call(windowStub, event);
      }
    }
    return true;
  });

  windowStub = {
    sessionStorage,
    addEventListener,
    removeEventListener,
    dispatchEvent,
  } as unknown as WindowWithStubs;

  vi.stubGlobal("window", windowStub);
  if (typeof Event === "undefined") {
    class SimpleEvent {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    }
    vi.stubGlobal("Event", SimpleEvent as unknown as typeof Event);
  }

  writeStoredWorkflowSelection(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("workflow storage helpers", () => {
  it("records last used timestamps for local and hosted workflows", () => {
    const local = createWorkflowSummary(1, "Alpha");
    const hosted = createHostedWorkflow("assistant", "Assistant");

    const localTimestamp = 1_000_000;
    const hostedTimestamp = 2_000_000;

    const afterLocal = recordWorkflowLastUsedAt(
      { kind: "local", workflow: local },
      localTimestamp,
    );
    expect(afterLocal.local[String(local.id)]).toBe(localTimestamp);
    expect(afterLocal.hosted[hosted.slug]).toBeUndefined();

    const afterHosted = recordWorkflowLastUsedAt(
      { kind: "hosted", workflow: hosted },
      hostedTimestamp,
    );
    expect(afterHosted.local[String(local.id)]).toBe(localTimestamp);
    expect(afterHosted.hosted[hosted.slug]).toBe(hostedTimestamp);

    const stored = readStoredWorkflowSelection();
    expect(stored?.lastUsedAt.local[String(local.id)]).toBe(localTimestamp);
    expect(stored?.lastUsedAt.hosted[hosted.slug]).toBe(hostedTimestamp);
  });

  it("preserves last used metadata when updating the stored selection", () => {
    const lastUsed: StoredWorkflowLastUsedAt = {
      local: { "7": 1234 },
      hosted: {},
    };

    writeStoredWorkflowSelection({
      mode: "local",
      localWorkflowId: 7,
      hostedSlug: null,
      lastUsedAt: lastUsed,
    });

    updateStoredWorkflowSelection((previous) => {
      if (!previous) {
        throw new Error("Expected previous selection");
      }
      return {
        ...previous,
        mode: "hosted",
        hostedSlug: "assistant",
      };
    });

    const stored = readStoredWorkflowSelection();
    expect(stored?.lastUsedAt.local["7"]).toBe(1234);
    expect(stored?.mode).toBe("hosted");
    expect(stored?.hostedSlug).toBe("assistant");
  });

  it("parses legacy selections without last used metadata", () => {
    const legacyPayload = {
      mode: "local" as const,
      localWorkflowId: 5,
      hostedSlug: null,
    };
    windowStub.sessionStorage.setItem(
      WORKFLOW_SELECTION_STORAGE_KEY,
      JSON.stringify(legacyPayload),
    );

    const selection = readStoredWorkflowSelection();
    expect(selection).not.toBeNull();
    expect(selection?.lastUsedAt).toEqual({ hosted: {}, local: {} });
  });
});

describe("workflow ordering timestamps", () => {
  it("derives production ordering timestamps from workflow metadata", () => {
    const workflow = createWorkflowSummary(1, "Alpha", {
      updated_at: "2024-05-02T10:00:00Z",
      created_at: "2024-05-01T10:00:00Z",
    });

    expect(getWorkflowProductionOrderTimestamp(workflow)).toBe(
      Date.parse("2024-05-02T10:00:00Z"),
    );
  });

  it("falls back to creation date when update timestamp is missing", () => {
    const workflow = createWorkflowSummary(2, "Beta", {
      updated_at: "invalid",
      created_at: "2024-04-01T12:00:00Z",
    });

    expect(getWorkflowProductionOrderTimestamp(workflow)).toBe(
      Date.parse("2024-04-01T12:00:00Z"),
    );
  });

  it("builds ordering maps combining workflow and hosted metadata", () => {
    const workflows = [
      createWorkflowSummary(1, "Alpha", { updated_at: "2024-05-01T00:00:00Z" }),
      createWorkflowSummary(2, "Beta", { updated_at: "invalid", created_at: "2024-04-01T00:00:00Z" }),
    ];
    const hosted = [createHostedWorkflow("assistant", "Assistant")];
    const base: StoredWorkflowLastUsedAt = {
      local: { "2": 1234, "3": 5555 },
      hosted: { assistant: 9_999, helper: 1_111 },
    };

    const ordering = buildWorkflowOrderingTimestamps(workflows, hosted, base);

    expect(ordering.local).toEqual({
      "1": Date.parse("2024-05-01T00:00:00Z"),
      "2": Date.parse("2024-04-01T00:00:00Z"),
    });
    expect(ordering.hosted).toEqual({ assistant: 9_999 });
  });
});

describe("workflow sorting", () => {
  it("orders workflows by pinned status, recency, then label", () => {
    const pinnedLocal = createWorkflowSummary(2, "Beta", { pinned: true } as unknown as WorkflowSummary);
    const recentLocal = createWorkflowSummary(1, "Alpha");
    const hosted = createHostedWorkflow("delta", "Delta");
    const fallbackLocal = createWorkflowSummary(3, "Gamma");

    const lastUsedAt: StoredWorkflowLastUsedAt = {
      local: {
        [String(recentLocal.id)]: 2_000,
      },
      hosted: {
        [hosted.slug]: 1_500,
      },
    };

    const entries: WorkflowSortEntry[] = [
      { kind: "local", workflow: fallbackLocal },
      { kind: "hosted", workflow: hosted },
      { kind: "local", workflow: recentLocal },
      { kind: "local", workflow: pinnedLocal },
    ];

    const ordered = orderWorkflowEntries(entries, lastUsedAt, {
      collator: new Intl.Collator("en", { sensitivity: "base" }),
    });

    expect(ordered.map((entry) => {
      if (entry.kind === "hosted") {
        return `hosted:${entry.workflow.slug}`;
      }
      return `local:${entry.workflow.id}`;
    })).toEqual([
      `local:${pinnedLocal.id}`,
      `local:${recentLocal.id}`,
      `hosted:${hosted.slug}`,
      `local:${fallbackLocal.id}`,
    ]);
  });

  it("orders local workflows using production deployment recency", () => {
    const recentProduction = createWorkflowSummary(1, "Alpha", {
      updated_at: "2024-05-02T00:00:00Z",
    });
    const olderProduction = createWorkflowSummary(2, "Beta", {
      updated_at: "2024-05-01T00:00:00Z",
    });

    const ordering = buildWorkflowOrderingTimestamps(
      [recentProduction, olderProduction],
      [],
      {
        local: { "1": 1, "2": 9_999 },
        hosted: {},
      },
    );

    const ordered = orderWorkflowEntries(
      [
        { kind: "local", workflow: olderProduction },
        { kind: "local", workflow: recentProduction },
      ],
      ordering,
    );

    expect(ordered.map((entry) => entry.workflow.id)).toEqual([1, 2]);
  });

  it("builds consistent sort metadata for workflows", () => {
    const local = createWorkflowSummary(8, "Zeta");
    const hosted = createHostedWorkflow("sigma", "Sigma");
    const lastUsedAt: StoredWorkflowLastUsedAt = {
      local: { "8": 10 },
      hosted: { sigma: 5 },
    };

    const localMeta = getWorkflowSortMetadata({ kind: "local", workflow: local }, lastUsedAt);
    const hostedMeta = getWorkflowSortMetadata({ kind: "hosted", workflow: hosted }, lastUsedAt);

    expect(localMeta).toEqual({ pinned: false, lastUsedAt: 10, label: "Zeta" });
    expect(hostedMeta).toEqual({ pinned: false, lastUsedAt: 5, label: "Sigma" });

    const comparator = compareWorkflowSortMetadata(localMeta, hostedMeta, new Intl.Collator("en"));
    expect(Math.sign(comparator)).toBeLessThan(0);
  });
});

