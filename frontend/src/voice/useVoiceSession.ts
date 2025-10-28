import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../auth";
import { useAudioResampler } from "./resampler";
import { useRealtimeSession, type SendAudioOptions } from "./useRealtimeSession";
import { useVoiceSecret } from "./useVoiceSecret";

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

type StartOptions = {
  preserveHistory?: boolean;
  stream: MediaStream;
};

type StopOptions = {
  clearHistory?: boolean;
  nextStatus?: VoiceSessionStatus;
};

const HISTORY_STORAGE_KEY = "chatkit:voice:history";
const MAX_ERROR_LOG_ENTRIES = 8;
const SAMPLE_RATE = 24_000;
const COMMIT_DEBOUNCE_MS = 220;

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

type RealtimeContent = {
  type: string;
  text?: string;
  transcript?: string;
};

type RealtimeMessageItem = {
  type: "message";
  itemId?: string;
  id?: string;
  role: "user" | "assistant" | string;
  status?: string;
  content?: RealtimeContent[];
};

type RealtimeItem = RealtimeMessageItem | { type: string };

const isMessageItem = (item: RealtimeItem): item is RealtimeMessageItem => item.type === "message";

const collectTextFromMessage = (item: RealtimeMessageItem): string => {
  if (!Array.isArray(item.content)) {
    return "";
  }

  return item.content
    .map((part) => {
      if (part.type === "input_text" || part.type === "output_text" || part.type === "text") {
        return part.text ?? "";
      }
      if (part.type === "input_audio" || part.type === "output_audio" || part.type === "audio") {
        return part.transcript ?? "";
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
    const identifier = (item.itemId || item.id || `${item.role}-${index}`).trim();
    const statusRaw = (item.status || "").trim();
    const status: VoiceTranscript["status"] =
      statusRaw === "in_progress" || statusRaw === "completed"
        ? (statusRaw as VoiceTranscript["status"])
        : "completed";
    const existing = previousMap.get(identifier);
    result.push({
      id: identifier,
      role: item.role,
      text,
      status,
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
    /* Ignorer les erreurs de persistance */
  }
};

type PendingStartState = {
  stream: MediaStream;
  preserveHistory: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};

export type UseVoiceSessionResult = {
  status: VoiceSessionStatus;
  isListening: boolean;
  transcripts: VoiceTranscript[];
  errors: VoiceSessionError[];
  transportError: string | null;
  startSession: (options: StartOptions) => Promise<void>;
  stopSession: (options?: StopOptions) => void;
  clearErrors: () => void;
};

export const useVoiceSession = (): UseVoiceSessionResult => {
  const { token } = useAuth();
  const { fetchSecret } = useVoiceSecret();
  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [isListening, setIsListening] = useState(false);
  const [transcripts, setTranscripts] = useState<VoiceTranscript[]>(() => parseStoredTranscripts());
  const [errors, setErrors] = useState<VoiceSessionError[]>([]);
  const [transportError, setTransportError] = useState<string | null>(null);

  const suppressEmptyHistoryRef = useRef(false);
  const currentSessionRef = useRef<string | null>(null);
  const pendingStartRef = useRef<PendingStartState | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const historyRef = useRef<RealtimeItem[]>([]);
  const statusRef = useRef<VoiceSessionStatus>("idle");
  const resampler = useAudioResampler(SAMPLE_RATE);
  const commitTimerRef = useRef<number | null>(null);
  const hasPendingAudioRef = useRef(false);
  const currentThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const addError = useCallback((message: string) => {
    setErrors((prev) => {
      const next = [...prev, makeErrorEntry(message)];
      return next.slice(-MAX_ERROR_LOG_ENTRIES);
    });
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
    setTransportError(null);
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

  const clearCommitTimer = useCallback(() => {
    if (commitTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, []);

  const cleanupCapture = useCallback(() => {
    const processor = processorRef.current;
    processorRef.current = null;
    if (processor) {
      try {
        processor.disconnect();
      } catch {
        /* noop */
      }
      processor.onaudioprocess = null;
    }

    const source = sourceRef.current;
    sourceRef.current = null;
    if (source) {
      try {
        source.disconnect();
      } catch {
        /* noop */
      }
    }

    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context) {
      try {
        context.close().catch(() => undefined);
      } catch {
        /* noop */
      }
    }

    const stream = microphoneStreamRef.current;
    microphoneStreamRef.current = null;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          /* noop */
        }
      });
    }
    resampler.reset();
    clearCommitTimer();
    hasPendingAudioRef.current = false;
  }, [clearCommitTimer, resampler]);

  const scheduleCommit = useCallback(
    (
      sessionId: string,
      dispatcher: (
        id: string,
        chunk: Int16Array,
        options?: SendAudioOptions,
      ) => void,
    ) => {
      if (typeof window === "undefined") {
        return;
      }
      clearCommitTimer();
      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null;
        if (!hasPendingAudioRef.current) {
          return;
        }
        const tail = resampler.flush();
        const payload = tail.length > 0 ? tail : new Int16Array();
        dispatcher(sessionId, payload, { commit: true });
        hasPendingAudioRef.current = false;
      }, COMMIT_DEBOUNCE_MS);
    },
    [clearCommitTimer, resampler],
  );

  const startCapture = useCallback(
    async (
      sessionId: string,
      stream: MediaStream,
      dispatcher: (
        id: string,
        chunk: Int16Array,
        options?: SendAudioOptions,
      ) => void,
    ) => {
      if (!stream) {
        throw new Error("Flux audio introuvable pour la capture");
      }

      let context: AudioContext;
      try {
        context = new AudioContext();
      } catch (error) {
        throw error instanceof Error
          ? error
          : new Error("Impossible d'initialiser l'audio");
      }

      audioContextRef.current = context;
      try {
        if (context.state === "suspended") {
          await context.resume();
        }
      } catch {
        /* noop */
      }

      resampler.setSampleRate(context.sampleRate);

      const source = context.createMediaStreamSource(stream);
      sourceRef.current = source;
      const processor = context.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const chunk = resampler.process(input);
        if (chunk.length > 0) {
          dispatcher(sessionId, chunk);
          if (!hasPendingAudioRef.current) {
            for (let i = 0; i < chunk.length; i += 1) {
              if (chunk[i] !== 0) {
                hasPendingAudioRef.current = true;
                break;
              }
            }
          }
        }

        if (hasPendingAudioRef.current) {
          scheduleCommit(sessionId, dispatcher);
        }
      };

      source.connect(processor);
      processor.connect(context.destination);

      historyRef.current = [];
      currentSessionRef.current = sessionId;
      microphoneStreamRef.current = stream;
      hasPendingAudioRef.current = false;
    },
    [resampler, scheduleCommit],
  );

  const {
    connect: connectRealtime,
    disconnect: disconnectRealtime,
    sendAudioChunk,
    finalizeSession: finalizeRealtimeSession,
    interruptSession,
  } = useRealtimeSession({
    onConnectionChange: (value) => {
      if (value === "disconnected") {
        cleanupCapture();
        currentSessionRef.current = null;
        currentThreadIdRef.current = null;
        historyRef.current = [];
        pendingStartRef.current = null;
        setIsListening(false);
        setStatus("idle");
      } else if (value === "connected") {
        if (currentSessionRef.current) {
          setStatus("connected");
        } else if (statusRef.current !== "connecting") {
          setStatus("idle");
        }
      } else if (value === "connecting") {
        if (!currentSessionRef.current && statusRef.current === "idle") {
          setStatus("connecting");
        }
      }
    },
    onTransportError: (error) => {
      const message = formatErrorMessage(error);
      addError(message);
      setTransportError(message);
      setStatus("error");
      const pending = pendingStartRef.current;
      if (pending) {
        pendingStartRef.current = null;
        pending.reject(error instanceof Error ? error : new Error(message));
      }
    },
    onSessionCreated: async (event) => {
      const pending = pendingStartRef.current;
      if (pending) {
        pendingStartRef.current = null;
        try {
          await startCapture(event.sessionId, pending.stream, sendAudioChunk);
          currentThreadIdRef.current = event.threadId ?? null;
          suppressEmptyHistoryRef.current = pending.preserveHistory;
          if (!pending.preserveHistory) {
            resetTranscripts();
          }
          setStatus("connected");
          setIsListening(true);
          pending.resolve();
        } catch (error) {
          cleanupCapture();
          currentSessionRef.current = null;
          const message = formatErrorMessage(error);
          addError(message);
          setTransportError(message);
          setStatus("error");
          pending.reject(error instanceof Error ? error : new Error(message));
        }
        return;
      }

      if (!currentSessionRef.current) {
        currentSessionRef.current = event.sessionId;
        currentThreadIdRef.current = event.threadId ?? null;
      }
    },
    onHistoryUpdated: (sessionId, history) => {
      if (currentSessionRef.current !== sessionId) {
        return;
      }
      if (!Array.isArray(history)) {
        return;
      }
      const typed = history as RealtimeItem[];
      historyRef.current = typed;
      if (typed.length === 0 && suppressEmptyHistoryRef.current) {
        return;
      }
      suppressEmptyHistoryRef.current = false;
      updateTranscriptsFromHistory(typed);
    },
    onHistoryDelta: (sessionId, item) => {
      if (currentSessionRef.current !== sessionId) {
        return;
      }
      if (!item || typeof item !== "object") {
        return;
      }
      historyRef.current = [...historyRef.current, item as RealtimeItem];
      updateTranscriptsFromHistory(historyRef.current);
    },
    onAgentStart: (sessionId) => {
      if (currentSessionRef.current === sessionId) {
        setIsListening(true);
      }
    },
    onAgentEnd: (sessionId) => {
      if (currentSessionRef.current === sessionId) {
        setIsListening(false);
      }
    },
    onSessionFinalized: (event) => {
      if (currentSessionRef.current !== event.sessionId) {
        return;
      }
      cleanupCapture();
      currentSessionRef.current = null;
      currentThreadIdRef.current = null;
      historyRef.current = [];
      setStatus("idle");
      setIsListening(false);
      if (Array.isArray(event.transcripts) && event.transcripts.length > 0) {
        const safeTranscripts = event.transcripts as Array<{
          role?: string;
          text?: string;
          status?: string;
        }>;
        const typed = safeTranscripts.map((entry, index) => ({
          type: "message" as const,
          role: entry.role ?? "assistant",
          status: entry.status,
          itemId: `final-${index}`,
          id: `final-${index}`,
          content: [
            {
              type: (entry.role ?? "assistant") === "assistant"
                ? "output_text"
                : "input_text",
              text: entry.text ?? "",
            },
          ],
        })) as unknown as RealtimeItem[];
        updateTranscriptsFromHistory(typed);
      }
    },
    onSessionError: (sessionId, message) => {
      if (currentSessionRef.current && currentSessionRef.current !== sessionId) {
        return;
      }
      const normalized = message || "Erreur lors de la session Realtime";
      addError(normalized);
      setTransportError(normalized);
      setStatus("error");
      const pending = pendingStartRef.current;
      if (pending) {
        pendingStartRef.current = null;
        pending.reject(new Error(normalized));
      }
    },
  });

  const stopSession = useCallback(
    ({ clearHistory = false, nextStatus = "idle" }: StopOptions = {}) => {
      const pending = pendingStartRef.current;
      if (pending) {
        pendingStartRef.current = null;
        pending.reject(new Error("Session vocale interrompue"));
      }
      const sessionId = currentSessionRef.current;
      if (sessionId) {
        clearCommitTimer();
        const tail = resampler.flush();
        if (tail.length > 0) {
          sendAudioChunk(sessionId, tail, { commit: true });
        } else {
          sendAudioChunk(sessionId, new Int16Array(), { commit: true });
        }
        interruptSession(sessionId);
        const threadId = currentThreadIdRef.current;
        if (threadId) {
          finalizeRealtimeSession(sessionId, threadId);
        } else {
          finalizeRealtimeSession(sessionId);
        }
      }
      cleanupCapture();
      currentSessionRef.current = null;
      currentThreadIdRef.current = null;
      historyRef.current = [];
      suppressEmptyHistoryRef.current = false;
      hasPendingAudioRef.current = false;
      if (clearHistory) {
        resetTranscripts();
      }
      setIsListening(false);
      setStatus(nextStatus);
    },
    [
      clearCommitTimer,
      cleanupCapture,
      finalizeRealtimeSession,
      interruptSession,
      resetTranscripts,
      resampler,
      sendAudioChunk,
    ],
  );

  useEffect(() => () => {
    stopSession();
    disconnectRealtime();
  }, [disconnectRealtime, stopSession]);

  useEffect(() => {
    if (!token) {
      stopSession();
      disconnectRealtime();
      clearErrors();
      return;
    }

    let cancelled = false;
    connectRealtime({ token }).catch((error) => {
      if (cancelled) {
        return;
      }
      const message = formatErrorMessage(error);
      addError(message);
      setTransportError(message);
      setStatus("error");
    });

    return () => {
      cancelled = true;
      disconnectRealtime();
    };
  }, [addError, clearErrors, connectRealtime, disconnectRealtime, stopSession, token]);

  const startSession = useCallback(
    async ({ preserveHistory = false, stream }: StartOptions) => {
      if (statusRef.current === "connecting") {
        return;
      }

      if (!token) {
        const message = "Authentification requise pour démarrer la session vocale.";
        addError(message);
        setTransportError(message);
        setStatus("error");
        throw new Error(message);
      }

      suppressEmptyHistoryRef.current = preserveHistory;
      if (!preserveHistory) {
        resetTranscripts();
      }

      clearErrors();
      setTransportError(null);
      setStatus("connecting");

      const pendingPromise = new Promise<void>((resolve, reject) => {
        pendingStartRef.current = { stream, preserveHistory, resolve, reject };
      });

      try {
        await fetchSecret();
      } catch (error) {
        pendingStartRef.current = null;
        cleanupCapture();
        stream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            /* noop */
          }
        });
        const message = formatErrorMessage(error);
        addError(message);
        setTransportError(message);
        setStatus("error");
        throw error instanceof Error ? error : new Error(message);
      }

      await pendingPromise;
    },
    [
      addError,
      cleanupCapture,
      clearErrors,
      fetchSecret,
      resetTranscripts,
      token,
    ],
  );

  const value = useMemo<UseVoiceSessionResult>(
    () => ({
      status,
      isListening,
      transcripts,
      errors,
      transportError,
      startSession,
      stopSession,
      clearErrors,
    }),
    [clearErrors, errors, isListening, startSession, status, stopSession, transcripts, transportError],
  );

  return value;
};

export type { VoiceSessionError, VoiceSessionStatus, VoiceTranscript };
