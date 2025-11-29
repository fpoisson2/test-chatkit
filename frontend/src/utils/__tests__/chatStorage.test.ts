import { describe, it, expect } from "vitest";
import {
  normalizeWorkflowStorageKey,
  resolvePersistenceSlug,
  buildSessionStorageKey,
  HOSTED_STORAGE_PREFIX,
  DEFAULT_WORKFLOW_STORAGE_KEY,
} from "../chatStorage";

describe("chatStorage utilities", () => {
  describe("normalizeWorkflowStorageKey", () => {
    it("should return trimmed slug when valid", () => {
      expect(normalizeWorkflowStorageKey("my-workflow")).toBe("my-workflow");
      expect(normalizeWorkflowStorageKey("  my-workflow  ")).toBe("my-workflow");
    });

    it("should return default key for null/undefined/empty", () => {
      expect(normalizeWorkflowStorageKey(null)).toBe(DEFAULT_WORKFLOW_STORAGE_KEY);
      expect(normalizeWorkflowStorageKey(undefined)).toBe(DEFAULT_WORKFLOW_STORAGE_KEY);
      expect(normalizeWorkflowStorageKey("")).toBe(DEFAULT_WORKFLOW_STORAGE_KEY);
      expect(normalizeWorkflowStorageKey("   ")).toBe(DEFAULT_WORKFLOW_STORAGE_KEY);
    });
  });

  describe("resolvePersistenceSlug", () => {
    it("should return workflow slug for local mode", () => {
      const selection = {
        kind: "local" as const,
        workflow: { slug: "my-workflow", id: 1, display_name: "My Workflow" } as any,
      };

      expect(resolvePersistenceSlug("local", selection)).toBe("my-workflow");
    });

    it("should return null for local mode with no workflow", () => {
      const selection = { kind: "local" as const, workflow: null };

      expect(resolvePersistenceSlug("local", selection)).toBeNull();
    });

    it("should return prefixed slug for hosted mode", () => {
      const selection = { kind: "hosted" as const, slug: "hosted-workflow" };

      expect(resolvePersistenceSlug("hosted", selection)).toBe(
        `${HOSTED_STORAGE_PREFIX}hosted-workflow`
      );
    });

    it("should handle hosted mode with null selection", () => {
      expect(resolvePersistenceSlug("hosted", null)).toBe(
        `${HOSTED_STORAGE_PREFIX}${DEFAULT_WORKFLOW_STORAGE_KEY}`
      );
    });
  });

  describe("buildSessionStorageKey", () => {
    it("should combine owner and normalized slug", () => {
      expect(buildSessionStorageKey("user@example.com", "my-workflow")).toBe(
        "user@example.com:my-workflow"
      );
    });

    it("should use default key for null slug", () => {
      expect(buildSessionStorageKey("user@example.com", null)).toBe(
        `user@example.com:${DEFAULT_WORKFLOW_STORAGE_KEY}`
      );
    });
  });
});
