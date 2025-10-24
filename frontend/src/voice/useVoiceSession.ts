import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRealtimeSession } from "./useRealtimeSession";
import { useVoiceSecret } from "./useVoiceSecret";
import type { VoiceSessionSecret } from "./useVoiceSecret";
import {
  VOICE_SESSION_MAX_ERROR_LOG_ENTRIES,
  buildTranscriptsFromHistory,
  formatErrorMessage,
  makeErrorEntry,
  resolveApiKey,
  type VoiceSessionError,
  type VoiceSessionStatus,
  type VoiceTranscript,
} from "./voiceSessionShared";

type StartOptions = {
  preserveHistory?: boolean;
};

type StopOptions = {
  clearHistory?: boolean;
  nextStatus?: VoiceSessionStatus;
};

const HISTORY_STORAGE_KEY = "chatkit:voice:history";

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
      return next.slice(-VOICE_SESSION_MAX_ERROR_LOG_ENTRIES);
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

