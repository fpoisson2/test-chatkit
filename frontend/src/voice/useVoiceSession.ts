import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RealtimeItem, RealtimeMessageItem } from "@openai/agents/realtime";

import { useRealtimeSession } from "./useRealtimeSession";
import { useVoiceSecret } from "./useVoiceSecret";
import type { VoiceSessionSecret } from "./useVoiceSecret";

export type VoiceSessionStatus = "idle" | "connecting" | "connected" | "error";

export type VoiceTranscript = {
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

type StartOptions = {
  preserveHistory?: boolean;
};

type StopOptions = {
  clearHistory?: boolean;
  nextStatus?: VoiceSessionStatus;
};

const HISTORY_STORAGE_KEY = "chatkit:voice:history";
const MAX_ERROR_LOG_ENTRIES = 8;

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

export const resolveApiKey = (clientSecret: VoiceSessionSecret["client_secret"]): string | null => {
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

export const buildTranscriptsFromHistory = (
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

const parseStoredTranscripts = (): VoiceTranscript[] => {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as VoiceTranscript[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
};

const persistTranscripts = (transcripts: VoiceTranscript[]) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(transcripts));
  } catch {
    // Ignorer les erreurs de stockage : l'historique restera simplement en mémoire.
  }
};

export type UseVoiceSessionResult = {
  status: VoiceSessionStatus;
  isListening: boolean;
  transcripts: VoiceTranscript[];
  errors: VoiceSessionError[];
  webrtcError: string | null;
  startSession: (options?: StartOptions) => Promise<void>;
  stopSession: (options?: StopOptions) => void;
  clearErrors: () => void;
};

export const useVoiceSession = (): UseVoiceSessionResult => {
  const { fetchSecret } = useVoiceSecret();
  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [isListening, setIsListening] = useState(false);
  const [transcripts, setTranscripts] = useState<VoiceTranscript[]>(() => parseStoredTranscripts());
  const [errors, setErrors] = useState<VoiceSessionError[]>([]);
  const [webrtcError, setWebrtcError] = useState<string | null>(null);

  const suppressEmptyHistoryRef = useRef(false);
  const startSessionRef = useRef<((options?: StartOptions) => Promise<void>) | null>(null);

  const addError = useCallback((message: string) => {
    setErrors((prev) => {
      const next = [...prev, makeErrorEntry(message)];
      return next.slice(-MAX_ERROR_LOG_ENTRIES);
    });
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
    setWebrtcError(null);
  }, []);

  const updateTranscriptsFromHistory = useCallback((history: RealtimeItem[]) => {
    setTranscripts((prev) => {
      const next = buildTranscriptsFromHistory(history, prev);
      persistTranscripts(next);
      return next;
    });
  }, []);

  const resetTranscripts = useCallback(() => {
    setTranscripts(() => {
      persistTranscripts([]);
      return [];
    });
  }, []);

  const handleHistoryUpdated = useCallback(
    (history: RealtimeItem[]) => {
      if (history.length === 0 && suppressEmptyHistoryRef.current) {
        return;
      }
      suppressEmptyHistoryRef.current = false;
      updateTranscriptsFromHistory(history);
    },
    [updateTranscriptsFromHistory],
  );

  const handleConnectionChange = useCallback((value: "connected" | "connecting" | "disconnected") => {
    if (value === "connected") {
      setStatus("connected");
      setIsListening(true);
    } else if (value === "connecting") {
      setStatus("connecting");
    } else {
      setIsListening(false);
      setStatus("idle");
    }
  }, []);

  const handleAgentStart = useCallback(() => {
    setIsListening(true);
  }, []);

  const handleAgentEnd = useCallback(() => {
    setIsListening(false);
  }, []);

  const handleTransportError = useCallback(
    (error: unknown) => {
      const message = formatErrorMessage(error);
      addError(message);
      setWebrtcError(message);
    },
    [addError],
  );

  const handleSessionError = useCallback(
    (error: unknown) => {
      const message = formatErrorMessage(error);
      addError(message);
    },
    [addError],
  );

  const handleRefreshDue = useCallback(() => {
    const start = startSessionRef.current;
    if (start) {
      void start({ preserveHistory: true });
    }
  }, []);

  const { connect, disconnect } = useRealtimeSession({
    onHistoryUpdated: handleHistoryUpdated,
    onConnectionChange: handleConnectionChange,
    onAgentStart: handleAgentStart,
    onAgentEnd: handleAgentEnd,
    onTransportError: handleTransportError,
    onError: handleSessionError,
    onRefreshDue: handleRefreshDue,
  });

  const stopSession = useCallback(
    ({ clearHistory = false, nextStatus = "idle" }: StopOptions = {}) => {
      disconnect();
      setIsListening(false);
      setStatus(nextStatus);
      suppressEmptyHistoryRef.current = false;
      if (clearHistory) {
        resetTranscripts();
      }
    },
    [disconnect, resetTranscripts],
  );

  useEffect(() => () => {
    stopSession();
  }, [stopSession]);

  const startSession = useCallback(
    async ({ preserveHistory = false }: StartOptions = {}) => {
      if (status === "connecting") {
        return;
      }

      suppressEmptyHistoryRef.current = preserveHistory;
      if (!preserveHistory) {
        resetTranscripts();
      }

      disconnect();
      setIsListening(false);
      clearErrors();
      setWebrtcError(null);
      setStatus("connecting");

      try {
        const secret = await fetchSecret();
        const apiKey = resolveApiKey(secret.client_secret);
        if (!apiKey) {
          throw new Error("Secret temps réel invalide renvoyé par le serveur.");
        }

        await connect({ secret, apiKey });
        setStatus("connected");
        setIsListening(true);
      } catch (error) {
        disconnect();
        setIsListening(false);
        setStatus("error");
        const message = formatErrorMessage(error);
        addError(message);
        setWebrtcError(message);
        throw error instanceof Error ? error : new Error(message);
      }
    },
    [
      status,
      resetTranscripts,
      disconnect,
      clearErrors,
      fetchSecret,
      connect,
      addError,
    ],
  );

  useEffect(() => {
    startSessionRef.current = startSession;
  }, [startSession]);

  const value = useMemo<UseVoiceSessionResult>(
    () => ({
      status,
      isListening,
      transcripts,
      errors,
      webrtcError,
      startSession,
      stopSession,
      clearErrors,
    }),
    [clearErrors, errors, isListening, startSession, status, stopSession, transcripts, webrtcError],
  );

  return value;
};

