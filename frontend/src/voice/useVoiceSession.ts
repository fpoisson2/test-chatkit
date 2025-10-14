import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RealtimeAgent,
  RealtimeItem,
  RealtimeMessageItem,
  RealtimeSession,
  TransportEvent,
} from "@openai/agents/realtime";

import { useAuth } from "../auth";

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
};

type VoiceSessionSecret = {
  client_secret: { value?: string } | string;
  expires_at?: string | null;
  instructions: string;
  model: string;
  voice: string;
  prompt_id?: string | null;
  prompt_version?: string | null;
  prompt_variables?: Record<string, string>;
};

type StopOptions = {
  clearHistory?: boolean;
  nextStatus?: VoiceSessionStatus;
};

const HISTORY_STORAGE_KEY = "chatkit:voice:history";
const MAX_ERROR_LOG_ENTRIES = 8;
const SECRET_REFRESH_BUFFER_MS = 60_000;
const SECRET_MIN_REFRESH_DELAY_MS = 10_000;

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

const buildPromptUpdate = (
  secret: VoiceSessionSecret,
): Record<string, unknown> | null => {
  const prompt: Record<string, unknown> = {};
  const promptId = typeof secret.prompt_id === "string" ? secret.prompt_id.trim() : "";
  if (promptId) {
    prompt.id = promptId;
  }
  const promptVersion =
    typeof secret.prompt_version === "string" ? secret.prompt_version.trim() : "";
  if (promptVersion) {
    prompt.version = promptVersion;
  }
  const variablesSource = secret.prompt_variables ?? {};
  const variableEntries = Object.entries(variablesSource).filter(([key]) => key.trim().length > 0);
  if (variableEntries.length > 0) {
    const variables: Record<string, string> = {};
    variableEntries.forEach(([key, value]) => {
      const trimmedKey = key.trim();
      if (!trimmedKey) {
        return;
      }
      variables[trimmedKey] = value;
    });
    if (Object.keys(variables).length > 0) {
      prompt.variables = variables;
    }
  }
  if (Object.keys(prompt).length === 0) {
    return null;
  }
  return { prompt };
};

const applySessionUpdate = (session: RealtimeSession, update: Record<string, unknown>) => {
  const candidate = session as unknown as {
    sendSessionUpdate?: (payload: Record<string, unknown>) => void;
    updateSession?: (payload: { session: Record<string, unknown> }) => void;
    send?: (event: Record<string, unknown>) => void;
  };

  try {
    if (typeof candidate.sendSessionUpdate === "function") {
      candidate.sendSessionUpdate(update);
      return;
    }
    if (typeof candidate.updateSession === "function") {
      candidate.updateSession({ session: update });
      return;
    }
    if (typeof candidate.send === "function") {
      candidate.send({ type: "session.update", session: update });
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("Échec de l'application des paramètres Realtime", error);
    }
  }
};

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
  const { token, logout } = useAuth();
  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [isListening, setIsListening] = useState(false);
  const [transcripts, setTranscripts] = useState<VoiceTranscript[]>(() => parseStoredTranscripts());
  const [errors, setErrors] = useState<VoiceSessionError[]>([]);
  const [webrtcError, setWebrtcError] = useState<string | null>(null);

  const sessionRef = useRef<RealtimeSession | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const listenersRef = useRef<(() => void)[]>([]);
  const suppressEmptyHistoryRef = useRef(false);

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

  const clearRefreshTimer = useCallback(() => {
    if (typeof window === "undefined") {
      refreshTimerRef.current = null;
      return;
    }
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const detachListeners = useCallback(() => {
    listenersRef.current.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch {
        // Ignorer les erreurs de désinscription pour ne pas bloquer le nettoyage.
      }
    });
    listenersRef.current = [];
  }, []);

  const stopSession = useCallback(
    ({ clearHistory = false, nextStatus = "idle" }: StopOptions = {}) => {
      clearRefreshTimer();
      const currentSession = sessionRef.current;
      if (currentSession) {
        detachListeners();
        const candidate = currentSession as RealtimeSession & { disconnect?: () => void };
        if (typeof candidate.disconnect === "function") {
          candidate.disconnect();
        } else {
          currentSession.close();
        }
      }
      sessionRef.current = null;
      setIsListening(false);
      setStatus(nextStatus);
      if (clearHistory) {
        resetTranscripts();
      }
    },
    [clearRefreshTimer, detachListeners, resetTranscripts],
  );

  useEffect(() => () => {
    stopSession();
  }, [stopSession]);

  const fetchSecret = useCallback(async (): Promise<VoiceSessionSecret> => {
    if (!token) {
      throw new Error("Authentification requise pour démarrer une session vocale.");
    }
    const response = await fetch("/api/chatkit/voice/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });

    if (response.status === 401) {
      logout();
      throw new Error("Session expirée, veuillez vous reconnecter.");
    }

    if (!response.ok) {
      throw new Error(`Échec de la récupération du secret temps réel (HTTP ${response.status}).`);
    }

    const data = (await response.json()) as VoiceSessionSecret;
    return data;
  }, [logout, token]);

  const attachSessionListeners = useCallback(
    (session: RealtimeSession) => {
      const register = (event: string, handler: (...args: any[]) => void) => {
        session.on(event as never, handler as never);
        listenersRef.current.push(() => {
          session.off(event as never, handler as never);
        });
      };

      register("history_updated", (history: RealtimeItem[]) => {
        if (history.length === 0 && suppressEmptyHistoryRef.current) {
          return;
        }
        suppressEmptyHistoryRef.current = false;
        updateTranscriptsFromHistory(history);
      });

      register("transport_event", (event: TransportEvent) => {
        if ((event as { type?: string }).type === "connection_change") {
          const statusValue = (event as { status?: string }).status;
          if (statusValue === "connected") {
            setIsListening(true);
            setStatus("connected");
          } else if (statusValue === "connecting") {
            setStatus("connecting");
          } else if (statusValue === "disconnected") {
            setIsListening(false);
            setStatus("idle");
          }
        } else if (event.type === "error") {
          const message = formatErrorMessage(event.error);
          addError(message);
          setWebrtcError(message);
        }
      });

      register("agent_start", () => {
        setIsListening(true);
      });

      register("agent_end", () => {
        setIsListening(false);
      });

      register("error", ({ error }) => {
        const message = formatErrorMessage(error);
        addError(message);
      });
    },
    [addError, updateTranscriptsFromHistory],
  );

  const startSession = useCallback(
    async ({ preserveHistory = false }: StartOptions = {}) => {
      if (status === "connecting") {
        return;
      }

      if (!token) {
        const message = "Authentification requise pour démarrer une session vocale.";
        addError(message);
        setStatus("error");
        throw new Error(message);
      }

      if (sessionRef.current) {
        stopSession({ clearHistory: false, nextStatus: "idle" });
      }

      suppressEmptyHistoryRef.current = preserveHistory;
      if (!preserveHistory) {
        resetTranscripts();
      }

      clearErrors();
      setWebrtcError(null);
      setStatus("connecting");

      try {
        const secret = await fetchSecret();
        const apiKey = resolveApiKey(secret.client_secret);
        if (!apiKey) {
          throw new Error("Secret temps réel invalide renvoyé par le serveur.");
        }

        const agent = new RealtimeAgent({
          name: "Assistant vocal ChatKit",
          instructions: secret.instructions,
        });
        const session = new RealtimeSession(agent, { transport: "webrtc" });
        sessionRef.current = session;
        attachSessionListeners(session);

        await session.connect({ apiKey, model: secret.model });
        const promptUpdate = buildPromptUpdate(secret);
        if (promptUpdate) {
          applySessionUpdate(session, promptUpdate);
        }
        setStatus("connected");
        setIsListening(true);

        clearRefreshTimer();
        if (typeof window !== "undefined") {
          const expiresAt = secret.expires_at ?? null;
          if (expiresAt) {
            const expiryDate = Date.parse(expiresAt);
            if (!Number.isNaN(expiryDate)) {
              const delay = Math.max(
                SECRET_MIN_REFRESH_DELAY_MS,
                expiryDate - Date.now() - SECRET_REFRESH_BUFFER_MS,
              );
              refreshTimerRef.current = window.setTimeout(() => {
                void startSession({ preserveHistory: true });
              }, delay);
            }
          }
        }
      } catch (error) {
        stopSession({ clearHistory: false, nextStatus: "error" });
        const message = formatErrorMessage(error);
        addError(message);
        setWebrtcError(message);
        throw error instanceof Error ? error : new Error(message);
      }
    },
    [
      attachSessionListeners,
      clearErrors,
      fetchSecret,
      resetTranscripts,
      status,
      stopSession,
      token,
      addError,
      clearRefreshTimer,
    ],
  );

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

