import { useCallback, useEffect, useRef } from "react";
import { RealtimeAgent, RealtimeItem, RealtimeSession, TransportEvent } from "@openai/agents/realtime";

import type { VoiceSessionSecret } from "./useVoiceSecret";

const SECRET_REFRESH_BUFFER_MS = 60_000;
const SECRET_MIN_REFRESH_DELAY_MS = 10_000;

type RealtimeConnectionStatus = "connected" | "connecting" | "disconnected";

type RealtimeSessionHandlers = {
  onHistoryUpdated?: (history: RealtimeItem[]) => void;
  onConnectionChange?: (status: RealtimeConnectionStatus) => void;
  onTransportError?: (error: unknown) => void;
  onAgentStart?: () => void;
  onAgentEnd?: () => void;
  onError?: (error: unknown) => void;
  onRefreshDue?: () => void;
};

type ConnectOptions = {
  secret: VoiceSessionSecret;
  apiKey: string;
};

type UseRealtimeSessionResult = {
  connect: (options: ConnectOptions) => Promise<void>;
  disconnect: () => void;
  startResponse: () => boolean;
};

const buildPromptUpdate = (secret: VoiceSessionSecret): Record<string, unknown> | null => {
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

const createRefreshDelay = (secret: VoiceSessionSecret): number | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const expiresAt = secret.expires_at ?? null;
  if (!expiresAt) {
    return null;
  }
  const expiryDate = Date.parse(expiresAt);
  if (Number.isNaN(expiryDate)) {
    return null;
  }
  const delay = Math.max(
    SECRET_MIN_REFRESH_DELAY_MS,
    expiryDate - Date.now() - SECRET_REFRESH_BUFFER_MS,
  );
  if (!Number.isFinite(delay) || delay <= 0) {
    return SECRET_MIN_REFRESH_DELAY_MS;
  }
  return delay;
};

export const useRealtimeSession = (
  handlers: RealtimeSessionHandlers,
): UseRealtimeSessionResult => {
  const handlersRef = useRef(handlers);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const listenersRef = useRef<(() => void)[]>([]);
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

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

  const disconnect = useCallback(() => {
    clearRefreshTimer();
    detachListeners();
    const currentSession = sessionRef.current;
    if (currentSession) {
      const candidate = currentSession as RealtimeSession & { disconnect?: () => void };
      if (typeof candidate.disconnect === "function") {
        try {
          candidate.disconnect();
        } catch {
          candidate.close();
        }
      } else {
        currentSession.close();
      }
    }
    sessionRef.current = null;
  }, [clearRefreshTimer, detachListeners]);

  useEffect(() => () => {
    disconnect();
  }, [disconnect]);

  const scheduleRefresh = useCallback(
    (secret: VoiceSessionSecret) => {
      clearRefreshTimer();
      const delay = createRefreshDelay(secret);
      if (delay === null) {
        return;
      }
      if (typeof window === "undefined") {
        return;
      }
      refreshTimerRef.current = window.setTimeout(() => {
        handlersRef.current.onRefreshDue?.();
      }, delay);
    },
    [clearRefreshTimer],
  );

  const attachSessionListeners = useCallback(
    (session: RealtimeSession) => {
      const register = (event: string, handler: (...args: any[]) => void) => {
        session.on(event as never, handler as never);
        listenersRef.current.push(() => {
          session.off(event as never, handler as never);
        });
      };

      register("history_updated", (history: RealtimeItem[]) => {
        handlersRef.current.onHistoryUpdated?.(history);
      });

      register("transport_event", (event: TransportEvent) => {
        const type = (event as { type?: string }).type;
        if (type === "connection_change") {
          const statusValue = (event as { status?: RealtimeConnectionStatus }).status;
          if (statusValue === "connected" || statusValue === "connecting" || statusValue === "disconnected") {
            handlersRef.current.onConnectionChange?.(statusValue);
          }
        } else if (type === "error") {
          handlersRef.current.onTransportError?.((event as { error?: unknown }).error);
        }
      });

      register("agent_start", () => {
        handlersRef.current.onAgentStart?.();
      });

      register("agent_end", () => {
        handlersRef.current.onAgentEnd?.();
      });

      register("error", ({ error }: { error: unknown }) => {
        handlersRef.current.onError?.(error);
      });
    },
    [],
  );

  const connect = useCallback(
    async ({ secret, apiKey }: ConnectOptions) => {
      disconnect();

      const agent = new RealtimeAgent({
        name: "Assistant vocal ChatKit",
        instructions: secret.instructions,
        ...(secret.voice ? { voice: secret.voice } : {}),
      });
      const sessionModel =
        typeof secret.model === "string" && secret.model.trim()
          ? secret.model.trim()
          : "gpt-4o-realtime-preview";
      const session = new RealtimeSession(agent, {
        transport: "webrtc",
        model: sessionModel,
        ...(secret.session_config ? { config: secret.session_config } : {}),
      });
      sessionRef.current = session;
      attachSessionListeners(session);

      try {
        await session.connect({ apiKey, model: sessionModel });
        if (secret.session_config) {
          applySessionUpdate(session, secret.session_config);
        }
        const promptUpdate = buildPromptUpdate(secret);
        if (promptUpdate) {
          applySessionUpdate(session, promptUpdate);
        }
        scheduleRefresh(secret);
      } catch (error) {
        disconnect();
        throw error;
      }
    },
    [attachSessionListeners, disconnect, scheduleRefresh],
  );

  const startResponse = useCallback((): boolean => {
    const session = sessionRef.current;
    if (!session) {
      return false;
    }
    try {
      const transport = session.transport as { sendEvent?: (event: Record<string, unknown>) => void };
      transport.sendEvent?.({ type: "response.create" });
      return true;
    } catch (error) {
      handlersRef.current.onError?.(error);
      return false;
    }
  }, []);

  return {
    connect,
    disconnect,
    startResponse,
  };
};

export type { RealtimeSessionHandlers, RealtimeConnectionStatus, ConnectOptions };

