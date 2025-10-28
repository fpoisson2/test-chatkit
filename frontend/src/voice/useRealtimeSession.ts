import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

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

const logRealtime = (message: string, payload?: Record<string, unknown>) => {
  const safePayload = payload ? maskSensitiveFields(payload) : undefined;
  console.info("[VoiceRealtime]", message, safePayload ?? "");
};

type ConnectionRecord = {
  gatewayUrl: string;
  websocket: WebSocket | null;
  status: RealtimeConnectionStatus;
  connectPromise: Promise<void> | null;
  listeners: Map<string, MutableRefObject<RealtimeSessionHandlers>>;
  audioContext: AudioContext | null;
  playbackTime: number;
  token: string | null;
};

const connectionPool = new Map<string, ConnectionRecord>();
let listenerCounter = 0;

const createListenerId = () => {
  listenerCounter += 1;
  return `listener-${listenerCounter}`;
};

const notifyConnectionChange = (
  record: ConnectionRecord,
  status: RealtimeConnectionStatus,
) => {
  record.status = status;
  if (status === "connected" && record.listeners.size === 0) {
    const ws = record.websocket;
    if (ws && ws.readyState === WebSocket.OPEN) {
      logRealtime("closing idle websocket after connect", {
        gatewayUrl: record.gatewayUrl,
      });
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
  }
  record.listeners.forEach((handlersRef) => {
    handlersRef.current.onConnectionChange?.(status);
  });
};

const broadcastTransportError = (record: ConnectionRecord, error: unknown) => {
  record.listeners.forEach((handlersRef) => {
    handlersRef.current.onTransportError?.(error);
  });
};

const broadcast = (
  record: ConnectionRecord,
  cb: (handlers: RealtimeSessionHandlers) => void,
) => {
  record.listeners.forEach((handlersRef) => {
    cb(handlersRef.current);
  });
};

const ensureAudioContextForRecord = async (
  record: ConnectionRecord,
): Promise<AudioContext | null> => {
  if (typeof window === "undefined") {
    return null;
  }
  let context = record.audioContext;
  if (!context) {
    context = new AudioContext({ sampleRate: SAMPLE_RATE });
    record.audioContext = context;
  }
  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      /* noop */
    }
  }
  return context;
};

const teardownAudioContextForRecord = (record: ConnectionRecord) => {
  const context = record.audioContext;
  if (!context) {
    return;
  }
  record.audioContext = null;
  record.playbackTime = 0;
  try {
    context.close().catch(() => undefined);
  } catch {
    /* noop */
  }
};

const playAudioChunk = (
  record: ConnectionRecord,
  context: AudioContext,
  chunk: Int16Array,
) => {
  if (chunk.length === 0) {
    return;
  }
  const floatBuffer = new Float32Array(chunk.length);
  for (let i = 0; i < chunk.length; i += 1) {
    floatBuffer[i] = chunk[i] / 0x8000;
  }

  const buffer = context.createBuffer(1, floatBuffer.length, SAMPLE_RATE);
  buffer.copyToChannel(floatBuffer, 0);

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);

  const startTime = Math.max(context.currentTime, record.playbackTime);
  try {
    source.start(startTime);
    record.playbackTime = startTime + buffer.duration;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("Failed to play realtime audio chunk", error);
    }
  }
};

const handleMessageForRecord = async (
  record: ConnectionRecord,
  event: MessageEvent<string>,
) => {
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
      broadcast(record, (handlers) => {
        handlers.onSessionCreated?.({
          sessionId: (typed as { session_id: string }).session_id,
          threadId,
          session: (typed as { session?: Record<string, unknown> }).session ?? {},
        });
      });
      break;
    }
    case "history": {
      if (sessionId && Array.isArray((typed as { history?: unknown[] }).history)) {
        broadcast(record, (handlers) => {
          handlers.onHistoryUpdated?.(sessionId, (typed as { history: unknown[] }).history);
        });
      }
      break;
    }
    case "history_delta": {
      if (sessionId) {
        broadcast(record, (handlers) => {
          handlers.onHistoryDelta?.(sessionId, (typed as { item?: unknown }).item);
        });
      }
      break;
    }
    case "audio": {
      if (!sessionId) {
        break;
      }
      const data = (typed as { data?: unknown }).data;
      if (typeof data !== "string" || data.length === 0) {
        break;
      }
      const chunk = decodePcm16(data);
      const context = await ensureAudioContextForRecord(record);
      if (context) {
        playAudioChunk(record, context, chunk);
      }
      broadcast(record, (handlers) => {
        handlers.onAudioChunk?.(sessionId, chunk);
      });
      break;
    }
    case "audio_end": {
      record.playbackTime = Math.max(
        record.playbackTime,
        record.audioContext?.currentTime ?? 0,
      );
      break;
    }
    case "agent_start": {
      if (sessionId) {
        broadcast(record, (handlers) => {
          handlers.onAgentStart?.(sessionId);
        });
      }
      break;
    }
    case "agent_end": {
      if (sessionId) {
        broadcast(record, (handlers) => {
          handlers.onAgentEnd?.(sessionId);
        });
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
      broadcast(record, (handlers) => {
        handlers.onSessionFinalized?.({
          sessionId,
          threadId,
          transcripts: (typed as { transcripts?: unknown[] }).transcripts ?? [],
        });
      });
      break;
    }
    case "session_closed": {
      if (sessionId) {
        broadcast(record, (handlers) => {
          handlers.onAgentEnd?.(sessionId);
        });
      }
      break;
    }
    case "session_error": {
      if (sessionId) {
        const errorMessage = String((typed as { error?: unknown }).error ?? "");
        broadcast(record, (handlers) => {
          handlers.onSessionError?.(sessionId, errorMessage);
        });
      }
      break;
    }
    default: {
      if (import.meta.env.DEV) {
        console.debug("Ignoré : message voix", payload);
      }
    }
  }
};

const openWebSocketForRecord = (record: ConnectionRecord): Promise<void> => {
  if (record.websocket && record.websocket.readyState === WebSocket.OPEN) {
    logRealtime("websocket reuse", record.gatewayUrl);
    return Promise.resolve();
  }
  if (record.connectPromise) {
    logRealtime("websocket awaiting connect promise", record.gatewayUrl);
    return record.connectPromise;
  }

  notifyConnectionChange(record, "connecting");

  const promise = new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(record.gatewayUrl);
    record.websocket = ws;
    let settled = false;

    logRealtime("websocket created", record.gatewayUrl);

    ws.onopen = () => {
      logRealtime("websocket open", record.gatewayUrl);
      settled = true;
      record.connectPromise = null;
      notifyConnectionChange(record, "connected");
      resolve();
    };

    ws.onerror = (event) => {
      logRealtime("websocket error", record.gatewayUrl, event);
      broadcastTransportError(record, event);
      if (!settled) {
        settled = true;
        record.connectPromise = null;
        reject(new Error("Realtime gateway connection failed"));
      }
    };

    ws.onclose = () => {
      logRealtime("websocket closed", record.gatewayUrl);
      record.websocket = null;
      record.connectPromise = null;
      notifyConnectionChange(record, "disconnected");
      teardownAudioContextForRecord(record);
      if (!settled) {
        settled = true;
        reject(new Error("Realtime gateway connection closed"));
      }
      if (record.listeners.size === 0) {
        connectionPool.delete(record.gatewayUrl);
      }
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      void handleMessageForRecord(record, event);
    };
  });

  record.connectPromise = promise;
  return promise;
};

const releaseListener = (gatewayUrl: string, listenerId: string) => {
  const record = connectionPool.get(gatewayUrl);
  if (!record) {
    return;
  }
  logRealtime("release listener", listenerId, gatewayUrl);
  record.listeners.delete(listenerId);
  if (record.listeners.size === 0) {
    const ws = record.websocket;
    if (ws) {
      if (record.status !== "connected") {
        logRealtime("idle connection awaiting connect, skip close", {
          gatewayUrl,
          status: record.status,
        });
        return;
      }

      if (ws.readyState === WebSocket.OPEN) {
        logRealtime("closing websocket (open) after last listener", gatewayUrl);
        try {
          ws.close();
        } catch {
          /* noop */
        }
      }
    }
    teardownAudioContextForRecord(record);
  }
};

export const useRealtimeSession = (handlers: RealtimeSessionHandlers) => {
  const handlersRef = useRef<RealtimeSessionHandlers>(handlers);
  const listenerIdRef = useRef<string>(createListenerId());
  const connectionKeyRef = useRef<string | null>(null);
  const connectionStatusRef = useRef<RealtimeConnectionStatus>("disconnected");
  const tokenRef = useRef<string | null>(null);
  const gatewayUrlRef = useRef<string | null>(null);

  useEffect(() => {
    handlersRef.current = {
      ...handlers,
      onConnectionChange: (status) => {
        connectionStatusRef.current = status;
        handlers.onConnectionChange?.(status);
      },
    };
  }, [handlers]);

  const disconnect = useCallback(() => {
    const key = connectionKeyRef.current;
    if (!key) {
      return;
    }
    releaseListener(key, listenerIdRef.current);
    connectionKeyRef.current = null;
    gatewayUrlRef.current = null;
    tokenRef.current = null;
    connectionStatusRef.current = "disconnected";
  }, []);

  const connect = useCallback(
    async ({ token, baseUrl }: ConnectOptions) => {
      if (typeof window === "undefined") {
        throw new Error("Realtime sessions ne sont pas disponibles côté serveur");
      }

      const gatewayUrl = buildGatewayUrl(token, baseUrl);
      logRealtime("connect requested", {
        gatewayUrl,
        tokenSuffix: token.slice(-6),
      });
      const previousKey = connectionKeyRef.current;
      if (previousKey && previousKey !== gatewayUrl) {
        logRealtime("releasing previous connection", previousKey);
        releaseListener(previousKey, listenerIdRef.current);
      }

      let record = connectionPool.get(gatewayUrl);
      if (!record) {
        logRealtime("creating connection record", gatewayUrl);
        record = {
          gatewayUrl,
          websocket: null,
          status: "disconnected",
          connectPromise: null,
          listeners: new Map(),
          audioContext: null,
          playbackTime: 0,
          token,
        };
        connectionPool.set(gatewayUrl, record);
      } else {
        record.token = token;
      }

      record.listeners.set(listenerIdRef.current, handlersRef);
      connectionKeyRef.current = gatewayUrl;
      gatewayUrlRef.current = gatewayUrl;
      tokenRef.current = token;

      handlersRef.current.onConnectionChange?.(record.status);

      if (record.status === "connected" && record.websocket?.readyState === WebSocket.OPEN) {
        logRealtime("connection already open", gatewayUrl);
        return;
      }

      await openWebSocketForRecord(record);
    },
    [],
  );

  const sendMessage = useCallback((payload: Record<string, unknown>) => {
    const key = connectionKeyRef.current;
    if (!key) {
      logRealtime("sendMessage skipped (no connection key)", {});
      return;
    }
    const record = connectionPool.get(key);
    if (!record) {
      logRealtime("sendMessage skipped (no record)", { key });
      return;
    }
    const ws = record.websocket;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logRealtime("sendMessage skipped (socket not open)", {
        readyState: ws?.readyState,
        hasSocket: Boolean(ws),
      });
      return;
    }
    try {
      ws.send(JSON.stringify(payload));
    } catch (error) {
      broadcastTransportError(record, error);
    }
  }, []);

  const sendAudioChunk = useCallback(
    (sessionId: string, chunk: Int16Array, options?: SendAudioOptions) => {
      if (!sessionId) {
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
const maskToken = (value: string): string => {
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
};

const maskUrlToken = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("token")) {
      parsed.searchParams.set("token", maskToken(parsed.searchParams.get("token") ?? ""));
    }
    return parsed.toString();
  } catch {
    return url;
  }
};

const maskSensitiveFields = (payload: Record<string, unknown>) => {
  const entries = Object.entries(payload).map(([key, value]) => {
    if (typeof value === "string" && key.toLowerCase().includes("token")) {
      return [key, maskToken(value)];
    }
    if (typeof value === "string" && value.startsWith("ws")) {
      return [key, maskUrlToken(value)];
    }
    return [key, value];
  });
  return Object.fromEntries(entries);
};
