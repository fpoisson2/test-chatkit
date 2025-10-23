import type {
  VoiceRealtimeSessionConfig,
  VoiceToolPermissions,
  VoiceWorkflowStartPayload,
  VoiceWorkflowStepInfo,
} from "../voice/types";
import type { VoiceSessionSecret } from "../voice/useVoiceSecret";

export type VoiceSessionWorkflowEvent = {
  type: "voice_session.created";
  step?: VoiceWorkflowStepInfo | null;
  client_secret: VoiceSessionSecret;
  session: VoiceRealtimeSessionConfig;
  tool_permissions?: Record<string, unknown>;
};

export type VoiceSessionEventExtraction = {
  payload: VoiceSessionWorkflowEvent;
  threadId: string | null;
};

const collectCandidateItems = (data: Record<string, unknown>): unknown[] => {
  const items: unknown[] = [];
  const sourceItem = (data as { item?: unknown }).item;
  if (sourceItem) {
    if (Array.isArray(sourceItem)) {
      items.push(...sourceItem);
    } else {
      items.push(sourceItem);
    }
  }

  const dataItems = (data as { items?: unknown }).items;
  if (Array.isArray(dataItems)) {
    items.push(...dataItems);
  }

  const thread = (data as { thread?: unknown }).thread;
  if (thread && typeof thread === "object") {
    const threadItems = (thread as { items?: unknown }).items;
    if (Array.isArray(threadItems)) {
      items.push(...threadItems);
    } else if (
      threadItems &&
      typeof threadItems === "object" &&
      Array.isArray((threadItems as { data?: unknown }).data)
    ) {
      items.push(...((threadItems as { data: unknown[] }).data));
    }
  }

  return items;
};

const tryParseVoiceEvent = (candidate: unknown): VoiceSessionWorkflowEvent | null => {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const typed = candidate as Record<string, unknown>;
  const itemType = typeof typed.type === "string" ? typed.type : "";
  if (itemType !== "task") {
    return null;
  }
  const task = typed.task;
  if (!task || typeof task !== "object") {
    return null;
  }
  const content = (task as { content?: unknown }).content;
  if (typeof content !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as VoiceSessionWorkflowEvent;
    if (parsed && parsed.type === "voice_session.created" && parsed.client_secret && parsed.session) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
};

const getThreadFromData = (data: Record<string, unknown>, item?: Record<string, unknown>): unknown => {
  const thread = (data as { thread?: unknown }).thread;
  if (thread && typeof thread === "object") {
    return thread;
  }
  if (item) {
    const nested = item.thread;
    if (nested && typeof nested === "object") {
      return nested;
    }
  }
  return null;
};

const deriveThreadId = (
  data: Record<string, unknown>,
  item?: Record<string, unknown>,
): string | null => {
  const thread = getThreadFromData(data, item);
  if (thread && typeof (thread as { id?: unknown }).id === "string") {
    return (thread as { id: string }).id;
  }
  if (item) {
    const threadId = (item as { thread_id?: unknown }).thread_id;
    if (typeof threadId === "string") {
      return threadId;
    }
    const camelThreadId = (item as { threadId?: unknown }).threadId;
    if (typeof camelThreadId === "string") {
      return camelThreadId;
    }
  }
  return null;
};

export const extractVoiceSessionEvent = (
  data: Record<string, unknown>,
): VoiceSessionEventExtraction | null => {
  const candidates = collectCandidateItems(data);
  for (const candidate of candidates) {
    const parsed = tryParseVoiceEvent(candidate);
    if (parsed) {
      return {
        payload: parsed,
        threadId: deriveThreadId(data, candidate as Record<string, unknown>),
      };
    }
  }
  return null;
};

export const extractVoiceWaitState = (
  data: Record<string, unknown>,
): Record<string, unknown> | null => {
  const thread = getThreadFromData(data);
  if (!thread || typeof thread !== "object") {
    return null;
  }
  const metadata = (thread as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const waitState = (metadata as { workflow_wait_for_user_input?: unknown }).workflow_wait_for_user_input;
  if (!waitState || typeof waitState !== "object") {
    return null;
  }
  return waitState as Record<string, unknown>;
};

const coerceBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return undefined;
};

export const normalizeToolPermissions = (
  permissions: Record<string, unknown> | undefined,
): VoiceToolPermissions => {
  if (!permissions) {
    return {};
  }
  const normalized: VoiceToolPermissions = {};
  for (const [rawKey, rawValue] of Object.entries(permissions)) {
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    const coerced = coerceBoolean(rawValue);
    if (coerced !== undefined) {
      normalized[key] = coerced;
    }
  }
  return normalized;
};

export const resolveVoiceStartMode = (
  session: VoiceRealtimeSessionConfig,
): "manual" | "auto" => {
  const mode = session.realtime?.start_mode;
  return mode === "manual" ? "manual" : "auto";
};

export const resolveVoiceStopMode = (
  session: VoiceRealtimeSessionConfig,
): "manual" | "auto" => {
  const mode = session.realtime?.stop_mode;
  return mode === "manual" ? "manual" : "auto";
};

export const toWorkflowStartPayload = (
  event: VoiceSessionWorkflowEvent,
): VoiceWorkflowStartPayload => ({
  clientSecret: event.client_secret,
  session: event.session,
  step: event.step ?? null,
  toolPermissions: normalizeToolPermissions(event.tool_permissions),
});
