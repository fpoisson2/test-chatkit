import { useCallback, useEffect, useRef } from "react";

export type RealtimeConnectionStatus =
  | "connected"
  | "connecting"
  | "disconnected";

export type SessionCreatedEvent = {
  sessionId: string;
  threadId: string | null;
  session: Record<string, unknown>;
};

export type SessionFinalizedEvent = {
  sessionId: string;
  threadId: string | null;
  transcripts: unknown[];
};

export type RealtimeSessionHandlers = {
  onConnectionChange?: (status: RealtimeConnectionStatus) => void;
  onTransportError?: (error: unknown) => void;
  onSessionCreated?: (event: SessionCreatedEvent) => void;
  onHistoryUpdated?: (sessionId: string, history: unknown[]) => void;
  onHistoryDelta?: (sessionId: string, item: unknown) => void;
  onAudioChunk?: (sessionId: string, chunk: Int16Array) => void;
  onAgentStart?: (sessionId: string) => void;
  onAgentEnd?: (sessionId: string) => void;
  onSessionFinalized?: (event: SessionFinalizedEvent) => void;
  onSessionError?: (sessionId: string, message: string) => void;
};

export type ConnectOptions = {
  token: string;
  baseUrl?: string;
};

export type SendAudioOptions = {
  commit?: boolean;
};

const DEFAULT_GATEWAY_PATH = "/api/chatkit/voice/realtime";
const SAMPLE_RATE = 24_000;

const buildGatewayUrl = (token: string, baseUrl?: string): string => {
  if (typeof window === "undefined") {
    throw new Error("Realtime gateway is not available in this environment");
  }

  const backendBase = baseUrl ?? import.meta.env.VITE_BACKEND_URL ?? "";
  const origin = new URL(window.location.origin);
  const target = backendBase ? new URL(backendBase, origin) : origin;

  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";

  const sanitizedPath = target.pathname.endsWith("/")
    ? `${target.pathname.slice(0, -1)}${DEFAULT_GATEWAY_PATH}`
    : `${target.pathname}${DEFAULT_GATEWAY_PATH}`;

  target.pathname = sanitizedPath.replace(/\/+/g, "/");
  target.searchParams.set("token", token);
  return target.toString();
};

const encodePcm16 = (chunk: Int16Array): string => {
  if (typeof window === "undefined") {
    return "";
  }
  const view = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  let binary = "";
  for (let i = 0; i < view.length; i += 1) {
    binary += String.fromCharCode(view[i]);
  }
  return window.btoa(binary);
};

const decodePcm16 = (payload: string): Int16Array => {
  if (typeof window === "undefined") {
    return new Int16Array();
  }
  const binary = window.atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
};

const playAudioChunk = (
  context: AudioContext,
  nextStartRef: { current: number },
  chunk: Int16Array,
) => {
  const floatBuffer = new Float32Array(chunk.length);
  for (let i = 0; i < chunk.length; i += 1) {
    floatBuffer[i] = chunk[i] / 0x8000;
  }

  const buffer = context.createBuffer(1, floatBuffer.length, SAMPLE_RATE);
  buffer.copyToChannel(floatBuffer, 0);

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);

  const startTime = Math.max(context.currentTime, nextStartRef.current);
  try {
    source.start(startTime);
    nextStartRef.current = startTime + buffer.duration;
  } catch (error) {
    // Audio scheduling can fail if the context was interrupted; log for debugging.
    if (import.meta.env.DEV) {
      console.warn("Failed to play realtime audio chunk", error);
    }
  }
};

export const useRealtimeSession = (handlers: RealtimeSessionHandlers) => {
  const handlersRef = useRef(handlers);
  const websocketRef = useRef<WebSocket | null>(null);
  const connectionStatusRef = useRef<RealtimeConnectionStatus>("disconnected");
  const tokenRef = useRef<string | null>(null);
  const gatewayUrlRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackTimeRef = useRef(0);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const notifyConnection = useCallback((status: RealtimeConnectionStatus) => {
    connectionStatusRef.current = status;
    handlersRef.current.onConnectionChange?.(status);
  }, []);

  const closeWebSocket = useCallback(() => {
    const ws = websocketRef.current;
    websocketRef.current = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
  }, []);

  const teardownAudioContext = useCallback(() => {
    const context = audioContextRef.current;
    if (!context) {
      return;
    }
    audioContextRef.current = null;
    playbackTimeRef.current = 0;
    try {
      context.close().catch(() => undefined);
    } catch {
      /* noop */
    }
  }, []);

  const ensureAudioContext = useCallback(async () => {
    if (typeof window === "undefined") {
      return null;
    }
    let context = audioContextRef.current;
    if (!context) {
      context = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = context;
    }
    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        /* noop */
      }
    }
    return context;
  }, []);

  const handleMessage = useCallback(
    async (event: MessageEvent<string>) => {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn("Realtime gateway message parsing failed", error);
        }
        return;
      }

      if (!payload || typeof payload !== "object") {
        return;
      }

      const typed = payload as { type?: string; session_id?: string };
      const sessionId = typeof typed.session_id === "string" ? typed.session_id : null;

      switch (typed.type) {
        case "session_created": {
          const threadId =
            typeof (typed as { thread_id?: unknown }).thread_id === "string"
              ? ((typed as { thread_id: string }).thread_id || null)
              : null;
          handlersRef.current.onSessionCreated?.({
            sessionId: (typed as { session_id: string }).session_id,
            threadId,
            session: (typed as { session?: Record<string, unknown> }).session ?? {},
          });
          break;
        }
        case "history": {
          if (sessionId && Array.isArray((typed as { history?: unknown[] }).history)) {
            handlersRef.current.onHistoryUpdated?.(
              sessionId,
              (typed as { history: unknown[] }).history,
            );
          }
          break;
        }
        case "history_delta": {
          if (sessionId) {
            handlersRef.current.onHistoryDelta?.(
              sessionId,
              (typed as { item?: unknown }).item,
            );
          }
          break;
        }
        case "audio": {
          if (!sessionId) {
            break;
          }
          const data = (typed as { data?: unknown }).data;
          if (typeof data !== "string" || !data) {
            break;
          }
          const chunk = decodePcm16(data);
          const context = await ensureAudioContext();
          if (context) {
            playAudioChunk(context, playbackTimeRef, chunk);
          }
          handlersRef.current.onAudioChunk?.(sessionId, chunk);
          break;
        }
        case "audio_end": {
          playbackTimeRef.current = Math.max(
            playbackTimeRef.current,
            audioContextRef.current?.currentTime ?? 0,
          );
          break;
        }
        case "agent_start": {
          if (sessionId) {
            handlersRef.current.onAgentStart?.(sessionId);
          }
          break;
        }
        case "agent_end": {
          if (sessionId) {
            handlersRef.current.onAgentEnd?.(sessionId);
          }
          break;
        }
        case "session_finalized": {
          if (!sessionId) {
            break;
          }
          const threadId =
            typeof (typed as { thread_id?: unknown }).thread_id === "string"
              ? ((typed as { thread_id: string }).thread_id || null)
              : null;
          handlersRef.current.onSessionFinalized?.({
            sessionId,
            threadId,
            transcripts: (typed as { transcripts?: unknown[] }).transcripts ?? [],
          });
          break;
        }
        case "session_closed": {
          if (sessionId) {
            handlersRef.current.onAgentEnd?.(sessionId);
          }
          break;
        }
        case "session_error": {
          if (sessionId) {
            const errorMessage = String((typed as { error?: unknown }).error ?? "");
            handlersRef.current.onSessionError?.(sessionId, errorMessage);
          }
          break;
        }
        default: {
          if (import.meta.env.DEV) {
            console.debug("Ignoré : message voix", payload);
          }
        }
      }
    },
    [ensureAudioContext],
  );

  const connect = useCallback(
    async ({ token, baseUrl }: ConnectOptions) => {
      if (typeof window === "undefined") {
        throw new Error("Realtime sessions ne sont pas disponibles côté serveur");
      }

      if (websocketRef.current) {
        closeWebSocket();
      }

      notifyConnection("connecting");

      const url = buildGatewayUrl(token, baseUrl);
      gatewayUrlRef.current = url;
      tokenRef.current = token;

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        websocketRef.current = ws;

        const cleanListeners = () => {
          if (!ws) {
            return;
          }
          ws.onopen = null;
          ws.onerror = null;
          ws.onclose = null;
          ws.onmessage = null;
        };

        ws.onopen = () => {
          notifyConnection("connected");
          resolve();
        };

        ws.onerror = (event) => {
          cleanListeners();
          notifyConnection("disconnected");
          handlersRef.current.onTransportError?.(event);
          reject(new Error("Realtime gateway connection failed"));
        };

        ws.onclose = () => {
          cleanListeners();
          notifyConnection("disconnected");
        };

        ws.onmessage = handleMessage;
      });
    },
    [closeWebSocket, handleMessage, notifyConnection],
  );

  const disconnect = useCallback(() => {
    closeWebSocket();
    notifyConnection("disconnected");
    teardownAudioContext();
  }, [closeWebSocket, notifyConnection, teardownAudioContext]);

  const sendMessage = useCallback((payload: Record<string, unknown>) => {
    const ws = websocketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      ws.send(JSON.stringify(payload));
    } catch (error) {
      handlersRef.current.onTransportError?.(error);
    }
  }, []);

  const sendAudioChunk = useCallback(
    (sessionId: string, chunk: Int16Array, options?: SendAudioOptions) => {
      if (!sessionId || chunk.length === 0) {
        return;
      }
      sendMessage({
        type: "input_audio",
        session_id: sessionId,
        data: encodePcm16(chunk),
        commit: Boolean(options?.commit),
      });
    },
    [sendMessage],
  );

  const finalizeSession = useCallback(
    (sessionId: string, threadId?: string | null) => {
      if (!sessionId) {
        return;
      }
      const payload: Record<string, unknown> = {
        type: "finalize",
        session_id: sessionId,
      };
      if (typeof threadId === "string" && threadId) {
        payload.thread_id = threadId;
      }
      sendMessage(payload);
    },
    [sendMessage],
  );

  const interruptSession = useCallback(
    (sessionId: string) => {
      if (!sessionId) {
        return;
      }
      sendMessage({ type: "interrupt", session_id: sessionId });
    },
    [sendMessage],
  );

  useEffect(() => () => {
    disconnect();
  }, [disconnect]);

  return {
    connect,
    disconnect,
    sendAudioChunk,
    finalizeSession,
    interruptSession,
    getStatus: () => connectionStatusRef.current,
    getGatewayUrl: () => gatewayUrlRef.current,
    getToken: () => tokenRef.current,
  };
};

export type {
  ConnectOptions,
  SendAudioOptions,
  SessionCreatedEvent,
  SessionFinalizedEvent,
};
