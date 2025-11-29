import type { WorkflowActivation } from "../features/workflows/WorkflowSidebar";
import type { HostedFlowMode } from "../hooks/useHostedFlow";

export const HOSTED_STORAGE_PREFIX = "hosted::";
export const DEFAULT_WORKFLOW_STORAGE_KEY = "__default__";
export const FALLBACK_SELECTION: WorkflowActivation = { kind: "local", workflow: null };

export const normalizeWorkflowStorageKey = (slug: string | null | undefined): string => {
  const trimmed = slug?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_WORKFLOW_STORAGE_KEY;
};

export const resolvePersistenceSlug = (
  mode: HostedFlowMode,
  selection: WorkflowActivation | null | undefined,
): string | null => {
  const effectiveSelection = selection ?? FALLBACK_SELECTION;
  const baseSlug =
    effectiveSelection.kind === "hosted"
      ? effectiveSelection.slug
      : effectiveSelection.workflow?.slug ?? null;

  if (mode === "hosted") {
    return `${HOSTED_STORAGE_PREFIX}${normalizeWorkflowStorageKey(baseSlug)}`;
  }

  return baseSlug;
};

export const buildSessionStorageKey = (owner: string, slug: string | null | undefined): string =>
  `${owner}:${normalizeWorkflowStorageKey(slug)}`;
