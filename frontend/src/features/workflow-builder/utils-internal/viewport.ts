import type { DeviceType } from "./constants";

/**
 * Viewport utilities for the workflow builder
 */

export type WorkflowViewportRecord = {
  workflow_id: number;
  version_id: number | null;
  device_type: DeviceType;
  x: number;
  y: number;
  zoom: number;
};

export type WorkflowViewportListResponse = {
  viewports: WorkflowViewportRecord[];
};

export const viewportKeyFor = (
  workflowId: number | null,
  versionId: number | null,
  deviceType: DeviceType | null,
): string | null =>
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
