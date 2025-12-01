import { COMPUTER_USE_ENVIRONMENTS, DEFAULT_COMPUTER_USE_CONFIG } from "../constants";
import type { ComputerUseConfig, ComputerUseMode } from "../../../types";

export type ComputerUseFieldUpdates = {
  display_width?: string | number;
  display_height?: string | number;
  environment?: string;
  mode?: string;
  start_url?: string;
  ssh_host?: string;
  ssh_port?: string | number;
  ssh_username?: string;
  ssh_password?: string;
  ssh_private_key?: string;
  vnc_host?: string;
  vnc_port?: string | number;
  vnc_password?: string;
  novnc_port?: string | number;
};

const clampDimension = (value: string | number | undefined, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.round(parsed), 4096);
  }
  return fallback;
};

const normalizeEnvironment = (
  value: string | undefined,
  fallback: ComputerUseConfig["environment"],
): ComputerUseConfig["environment"] => {
  const normalized = value?.trim().toLowerCase();
  return COMPUTER_USE_ENVIRONMENTS.includes(
    normalized as (typeof COMPUTER_USE_ENVIRONMENTS)[number],
  )
    ? (normalized as ComputerUseConfig["environment"])
    : fallback;
};

const normalizeMode = (
  value: string | undefined,
  fallback: ComputerUseMode,
): ComputerUseMode => {
  if (value === "agent" || value === "manual") {
    return value;
  }
  return fallback;
};

const hasOwnProperty = <T extends object>(target: T, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

const setOptionalStringField = (
  target: ComputerUseConfig,
  key:
    | "start_url"
    | "ssh_host"
    | "ssh_username"
    | "ssh_password"
    | "ssh_private_key"
    | "vnc_host"
    | "vnc_password",
  raw: unknown,
) => {
  const value = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  const trimmed = value.trim();
  if (trimmed) {
    (target as Record<string, unknown>)[key] = trimmed;
  } else {
    delete (target as Record<string, unknown>)[key];
  }
};

const setOptionalPortField = (
  target: ComputerUseConfig,
  key: "ssh_port" | "vnc_port" | "novnc_port",
  raw: unknown,
) => {
  const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) {
    (target as Record<string, unknown>)[key] = Math.round(parsed);
  } else {
    delete (target as Record<string, unknown>)[key];
  }
};

export const buildComputerUseConfig = (
  currentConfig: ComputerUseConfig | null,
  updates: ComputerUseFieldUpdates,
): ComputerUseConfig => {
  const base: ComputerUseConfig = {
    ...DEFAULT_COMPUTER_USE_CONFIG,
    mode: currentConfig?.mode ?? DEFAULT_COMPUTER_USE_CONFIG.mode,
    ...(currentConfig ?? {}),
  };

  const next: ComputerUseConfig = { ...base };

  next.display_width = clampDimension(
    updates.display_width ?? base.display_width,
    base.display_width,
  );
  next.display_height = clampDimension(
    updates.display_height ?? base.display_height,
    base.display_height,
  );
  next.environment = normalizeEnvironment(updates.environment, base.environment);
  next.mode = normalizeMode(updates.mode, base.mode);

  if (hasOwnProperty(updates, "start_url")) {
    setOptionalStringField(next, "start_url", updates.start_url);
  }

  const stringFields: Array<{
    key:
      | "ssh_host"
      | "ssh_username"
      | "ssh_password"
      | "ssh_private_key"
      | "vnc_host"
      | "vnc_password";
    value: unknown;
  }> = [
    { key: "ssh_host", value: updates.ssh_host },
    { key: "ssh_username", value: updates.ssh_username },
    { key: "ssh_password", value: updates.ssh_password },
    { key: "ssh_private_key", value: updates.ssh_private_key },
    { key: "vnc_host", value: updates.vnc_host },
    { key: "vnc_password", value: updates.vnc_password },
  ];

  for (const field of stringFields) {
    if (hasOwnProperty(updates, field.key)) {
      setOptionalStringField(next, field.key, field.value);
    }
  }

  const portFields: Array<{ key: "ssh_port" | "vnc_port" | "novnc_port"; value: unknown }> = [
    { key: "ssh_port", value: updates.ssh_port },
    { key: "vnc_port", value: updates.vnc_port },
    { key: "novnc_port", value: updates.novnc_port },
  ];

  for (const field of portFields) {
    if (hasOwnProperty(updates, field.key)) {
      setOptionalPortField(next, field.key, field.value);
    }
  }

  return next;
};
