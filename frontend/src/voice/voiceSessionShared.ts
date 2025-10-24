import type { RealtimeItem, RealtimeMessageItem } from "@openai/agents/realtime";

import type { VoiceSessionSecret } from "./useVoiceSecret";

type VoiceSessionStatus = "idle" | "connecting" | "connected" | "error";

type VoiceTranscript = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "in_progress" | "completed" | "incomplete";
  timestamp: number;
};

type VoiceSessionError = {
  id: string;
  message: string;
  timestamp: number;
};

const VOICE_SESSION_MAX_ERROR_LOG_ENTRIES = 8;

const formatErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Une erreur inconnue est survenue.";
  }
};

const resolveApiKey = (clientSecret: VoiceSessionSecret["client_secret"]): string | null => {
  if (typeof clientSecret === "string") {
    return clientSecret;
  }
  if (clientSecret && typeof clientSecret === "object" && "value" in clientSecret) {
    const { value } = clientSecret;
    return typeof value === "string" ? value : null;
  }
  return null;
};

const isMessageItem = (item: RealtimeItem): item is RealtimeMessageItem => item.type === "message";

const collectTextFromMessage = (item: RealtimeMessageItem): string => {
  return item.content
    .map((part) => {
      if (part.type === "input_text" || part.type === "output_text") {
        return part.text;
      }
      if ("transcript" in part && part.transcript) {
        return part.transcript;
      }
      return "";
    })
    .filter(Boolean)
    .join(" ")
    .trim();
};

const buildTranscriptsFromHistory = (
  history: RealtimeItem[],
  previous: VoiceTranscript[],
): VoiceTranscript[] => {
  const previousMap = new Map(previous.map((entry) => [entry.id, entry]));
  const result: VoiceTranscript[] = [];

  history.forEach((item, index) => {
    if (!isMessageItem(item)) {
      return;
    }
    if (item.role !== "user" && item.role !== "assistant") {
      return;
    }
    const text = collectTextFromMessage(item);
    if (!text) {
      return;
    }
    const existing = previousMap.get(item.itemId);
    result.push({
      id: item.itemId,
      role: item.role,
      text,
      status: item.status,
      timestamp: existing?.timestamp ?? Date.now() + index,
    });
  });

  return result;
};

const makeErrorEntry = (message: string): VoiceSessionError => ({
  id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  message,
  timestamp: Date.now(),
});

export type { VoiceSessionStatus, VoiceTranscript, VoiceSessionError };
export {
  VOICE_SESSION_MAX_ERROR_LOG_ENTRIES,
  formatErrorMessage,
  resolveApiKey,
  buildTranscriptsFromHistory,
  makeErrorEntry,
};

