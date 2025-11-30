import { useEffect, useState } from "react";

import type { NodeKind, WorkflowVersionResponse, WorkflowVersionSummary } from "./types";
import { NODE_COLORS } from "./utils";

// Constants
export const backendUrl = (import.meta.env.VITE_BACKEND_URL ?? "").trim();
export const DESKTOP_MIN_VIEWPORT_ZOOM = 0.1;
export const MOBILE_MIN_VIEWPORT_ZOOM = 0.05;
export const DESKTOP_WORKSPACE_HORIZONTAL_PADDING = "1.5rem";
export const HISTORY_LIMIT = 50;
export const REMOTE_VERSION_POLL_INTERVAL_MS = 10000;

// Type guards
export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

// Types
export type DeviceType = "mobile" | "desktop";

export type WorkflowViewportRecord = {
  workflow_id: number;
  version_id: number | null;
  device_type: DeviceType;
  x: number;
  y: number;
  zoom: number;
};

export const isValidNodeKind = (value: string): value is NodeKind =>
  Object.prototype.hasOwnProperty.call(NODE_COLORS, value);

export type AgentLikeKind = Extract<NodeKind, "agent" | "voice_agent" | "computer_use">;

export const isAgentKind = (kind: NodeKind): kind is AgentLikeKind =>
  kind === "agent" || kind === "voice_agent" || kind === "computer_use";

export type ClassValue =
  | string
  | false
  | null
  | undefined
  | Record<string, boolean | null | undefined>;

// Utility functions
export const cx = (...values: ClassValue[]): string => {
  const classes: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (typeof value === "string") {
      classes.push(value);
      continue;
    }
    for (const [className, condition] of Object.entries(value)) {
      if (condition) {
        classes.push(className);
      }
    }
  }
  return classes.join(" ");
};

export type WorkflowViewportListResponse = {
  viewports: WorkflowViewportRecord[];
};

export const viewportKeyFor = (
  workflowId: number | null,
  versionId: number | null,
  deviceType: DeviceType | null,
) =>
  workflowId != null && deviceType != null
    ? `${deviceType}:${workflowId}:${versionId ?? "latest"}`
    : null;

export const parseViewportKey = (
  key: string,
): {
  deviceType: DeviceType;
  workflowId: number;
  versionId: number | null;
} | null => {
  const [devicePart, workflowPart, versionPart] = key.split(":");
  if (devicePart !== "mobile" && devicePart !== "desktop") {
    return null;
  }
  const workflowId = Number.parseInt(workflowPart ?? "", 10);
  if (!Number.isFinite(workflowId)) {
    return null;
  }
  if (!versionPart || versionPart === "latest") {
    return { deviceType: devicePart, workflowId, versionId: null };
  }
  const versionId = Number.parseInt(versionPart, 10);
  if (!Number.isFinite(versionId)) {
    return null;
  }
  return { deviceType: devicePart, workflowId, versionId };
};

export const versionSummaryFromResponse = (
  definition: WorkflowVersionResponse,
): WorkflowVersionSummary => ({
  id: definition.id,
  workflow_id: definition.workflow_id,
  name: definition.name,
  version: definition.version,
  is_active: definition.is_active,
  created_at: definition.created_at,
  updated_at: definition.updated_at,
});

export const resolveDraftCandidate = (
  versions: WorkflowVersionSummary[],
): WorkflowVersionSummary | null => {
  if (versions.length === 0) {
    return null;
  }
  const activeVersionNumber =
    versions.find((version) => version.is_active)?.version ?? 0;
  const draftCandidates = versions.filter(
    (version) => !version.is_active && version.version > activeVersionNumber,
  );
  if (draftCandidates.length === 0) {
    return null;
  }
  return draftCandidates.reduce((latest, current) =>
    current.version > latest.version ? current : latest,
  );
};

export const sortVersionsWithDraftFirst = (
  versions: WorkflowVersionSummary[],
  draftId: number | null,
): WorkflowVersionSummary[] => {
  const items = [...versions];
  const originalOrder = new Map(items.map((version, index) => [version.id, index]));
  items.sort((a, b) => {
    if (draftId != null) {
      if (a.id === draftId && b.id !== draftId) {
        return -1;
      }
      if (b.id === draftId && a.id !== draftId) {
        return 1;
      }
    }
    if (a.version !== b.version) {
      return b.version - a.version;
    }
    if (a.is_active && !b.is_active) {
      return -1;
    }
    if (b.is_active && !a.is_active) {
      return 1;
    }
    const aUpdatedAt = new Date(a.updated_at).getTime();
    const bUpdatedAt = new Date(b.updated_at).getTime();
    if (aUpdatedAt !== bUpdatedAt) {
      return bUpdatedAt - aUpdatedAt;
    }
    const aIndex = originalOrder.get(a.id) ?? 0;
    const bIndex = originalOrder.get(b.id) ?? 0;
    return aIndex - bIndex;
  });
  return items;
};

// Custom hook
export const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQueryList = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };
    setMatches(mediaQueryList.matches);
    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", handleChange);
      return () => mediaQueryList.removeEventListener("change", handleChange);
    }
    mediaQueryList.addListener(handleChange);
    return () => mediaQueryList.removeListener(handleChange);
  }, [query]);

  return matches;
};
