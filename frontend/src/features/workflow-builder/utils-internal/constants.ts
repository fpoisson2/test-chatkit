/**
 * Constants for the workflow builder
 */

export const backendUrl = (import.meta.env.VITE_BACKEND_URL ?? "").trim();

// Viewport zoom constraints
export const DESKTOP_MIN_VIEWPORT_ZOOM = 0.1;
export const MOBILE_MIN_VIEWPORT_ZOOM = 0.05;

// Layout
export const DESKTOP_WORKSPACE_HORIZONTAL_PADDING = "1.5rem";

// History and auto-save
export const HISTORY_LIMIT = 50;
export const AUTO_SAVE_DELAY_MS = 2000;

// Polling
export const REMOTE_VERSION_POLL_INTERVAL_MS = 10000;

// Device types
export type DeviceType = "mobile" | "desktop";
