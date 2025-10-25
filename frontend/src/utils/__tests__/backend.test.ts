import { describe, expect, it } from "vitest";

import { normalizeHostedWorkflowMetadata } from "../backend";

describe("normalizeHostedWorkflowMetadata", () => {
  it("keeps the explicit id when provided", () => {
    const normalized = normalizeHostedWorkflowMetadata({
      id: "wf-123",
      slug: "support",
      label: "Support",
      description: null,
      available: true,
      managed: true,
    });

    expect(normalized).toEqual({
      id: "wf-123",
      slug: "support",
      label: "Support",
      description: null,
      available: true,
      managed: true,
    });
  });

  it("falls back to legacy workflow_id fields", () => {
    const normalized = normalizeHostedWorkflowMetadata({
      workflow_id: "legacy-id",
      slug: "legacy",
      label: "Legacy",
      description: undefined,
      available: false,
      managed: false,
    });

    expect(normalized.id).toBe("legacy-id");
    expect(normalized.description).toBeNull();
  });

  it("uses the slug when no identifier is provided", () => {
    const normalized = normalizeHostedWorkflowMetadata({
      slug: "fallback",
      label: "Fallback",
      description: " ",
      available: true,
      managed: undefined,
    });

    expect(normalized.id).toBe("fallback");
    expect(normalized.managed).toBe(false);
    expect(normalized.description).toBeNull();
  });
});
