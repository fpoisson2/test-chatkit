import { describe, expect, test } from "vitest";

import type { WorkflowVersionSummary } from "../types";
import {
  findLatestDraftVersion,
  resolveDraftTarget,
  sortVersionsWithDraftFirst,
} from "../WorkflowBuilderPage";

const makeVersion = (
  overrides: Partial<WorkflowVersionSummary>,
): WorkflowVersionSummary => ({
  id: overrides.id ?? 1,
  workflow_id: overrides.workflow_id ?? 1,
  name: overrides.name ?? null,
  version: overrides.version ?? 1,
  is_active: overrides.is_active ?? false,
  created_at: overrides.created_at ?? "2024-01-01T00:00:00Z",
  updated_at: overrides.updated_at ?? "2024-01-02T00:00:00Z",
});

describe("versions utils", () => {
  test("findLatestDraftVersion retourne le brouillon le plus récent", () => {
    const versions: WorkflowVersionSummary[] = [
      makeVersion({ id: 1, version: 1, is_active: true }),
      makeVersion({ id: 2, version: 2, updated_at: "2024-01-03T00:00:00Z" }),
      makeVersion({ id: 3, version: 3, updated_at: "2024-01-04T00:00:00Z" }),
    ];

    const draft = findLatestDraftVersion(versions);

    expect(draft).not.toBeNull();
    expect(draft?.id).toBe(3);
  });

  test("findLatestDraftVersion renvoie null lorsqu'aucun brouillon n'est présent", () => {
    const versions: WorkflowVersionSummary[] = [
      makeVersion({ id: 1, version: 1, is_active: true }),
      makeVersion({ id: 2, version: 2, is_active: true }),
    ];

    expect(findLatestDraftVersion(versions)).toBeNull();
  });

  test("sortVersionsWithDraftFirst place le brouillon le plus récent en premier", () => {
    const versions: WorkflowVersionSummary[] = [
      makeVersion({ id: 10, version: 1, is_active: true }),
      makeVersion({ id: 20, version: 2, updated_at: "2024-01-03T00:00:00Z" }),
      makeVersion({ id: 30, version: 3, updated_at: "2024-01-04T00:00:00Z" }),
    ];

    const ordered = sortVersionsWithDraftFirst(versions);

    expect(ordered[0]?.id).toBe(30);
    expect(ordered[0]?.name).toBe("Brouillon");
    expect(ordered.slice(1)).toEqual([
      versions[0],
      versions[1],
    ]);
  });

  test("sortVersionsWithDraftFirst n'écrase pas un nom de brouillon personnalisé", () => {
    const versions: WorkflowVersionSummary[] = [
      makeVersion({ id: 1, version: 1, is_active: true }),
      makeVersion({
        id: 2,
        version: 2,
        name: "Version de test",
        updated_at: "2024-01-03T00:00:00Z",
      }),
    ];

    const ordered = sortVersionsWithDraftFirst(versions);

    expect(ordered[0]).toMatchObject({ id: 2, name: "Version de test" });
  });

  test("resolveDraftTarget renvoie le brouillon sélectionné", () => {
    const draft = makeVersion({ id: 42, version: 10, is_active: false });
    const result = resolveDraftTarget(draft, draft, draft);

    expect(result).toBe(draft);
  });

  test("resolveDraftTarget réutilise le brouillon existant lorsqu'une ancienne version est modifiée", () => {
    const draft = makeVersion({ id: 100, version: 12, is_active: false });
    const selected = makeVersion({ id: 50, version: 5, is_active: false });

    const result = resolveDraftTarget(selected, draft, draft);

    expect(result).toBe(draft);
  });

  test("resolveDraftTarget retourne null lorsqu'aucun brouillon n'est disponible", () => {
    const selected = makeVersion({ id: 2, version: 2, is_active: false });

    const result = resolveDraftTarget(selected, null, null);

    expect(result).toBeNull();
  });
});

