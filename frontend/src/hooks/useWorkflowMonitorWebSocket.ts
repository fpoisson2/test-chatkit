import { useEffect, useRef, useState, useCallback } from "react";

interface WorkflowStepInfo {
  slug: string;
  display_name: string;
  timestamp: string | null;
}

interface WorkflowUserInfo {
  id: number;
  email: string;
  is_admin: boolean;
}

interface WorkflowInfo {
  id: number;
  slug: string;
  display_name: string;
  definition_id: number | null;
}

interface ActiveWorkflowSession {
  thread_id: string;
  user: WorkflowUserInfo;
  workflow: WorkflowInfo;
  current_step: WorkflowStepInfo;
  step_history: WorkflowStepInfo[];
  started_at: string;
  last_activity: string;
  status: "active" | "waiting_user" | "paused";
}

interface WebSocketMessage {
  type: "initial" | "update" | "error";
  data?: {
    sessions: ActiveWorkflowSession[];
    total_count: number;
  };
  error?: string;
}

interface UseWorkflowMonitorWebSocketOptions {
  token: string | null;
  enabled: boolean;
  onUpdate?: (sessions: ActiveWorkflowSession[]) => void;
  onError?: (error: string) => void;
}

interface UseWorkflowMonitorWebSocketReturn {
  sessions: ActiveWorkflowSession[];
  isConnected: boolean;
  error: string | null;
  reconnect: () => void;
}

const WS_RECONNECT_DELAY = 3000; // 3 secondes
const MAX_RECONNECT_ATTEMPTS = 5;
const RAW_BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? "").trim();
const DEFAULT_API_BASE_PATH = "/api";
const WORKFLOW_MONITOR_SUFFIX = "/admin/workflows/monitor";

// Wake Lock management for keeping websockets alive
let wakeLock: WakeLockSentinel | null = null;

const requestWakeLock = async () => {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
    console.log("[WorkflowMonitor] Wake Lock API not supported");
    return;
  }

  if (wakeLock !== null && !wakeLock.released) {
    console.log("[WorkflowMonitor] Wake Lock already active");
    return;
  }

  try {
    wakeLock = await navigator.wakeLock.request("screen");
    console.log("[WorkflowMonitor] Wake Lock activated - websockets will stay alive in background");

    wakeLock.addEventListener("release", () => {
      console.log("[WorkflowMonitor] Wake Lock released");
    });
  } catch (error) {
    console.log("[WorkflowMonitor] Failed to acquire Wake Lock:", error);
  }
};

const releaseWakeLock = async () => {
  if (wakeLock !== null && !wakeLock.released) {
    try {
      await wakeLock.release();
      wakeLock = null;
      console.log("[WorkflowMonitor] Wake Lock released manually");
    } catch (error) {
      console.log("[WorkflowMonitor] Failed to release Wake Lock:", error);
    }
  }
};

const sanitizeApiBasePath = (pathname: string) => {
  if (!pathname || pathname === "/") {
    return DEFAULT_API_BASE_PATH;
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
};

const buildWorkflowMonitorUrl = (token: string) => {
  if (typeof window === "undefined") {
    throw new Error("WebSocket non disponible dans cet environnement");
  }

  const origin = new URL(window.location.origin);
  const backendBase = RAW_BACKEND_URL
    ? new URL(RAW_BACKEND_URL, origin)
    : new URL(DEFAULT_API_BASE_PATH, origin);

  const target = new URL(backendBase.toString());
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  const apiBasePath = sanitizeApiBasePath(backendBase.pathname);
  const monitorPath = `${apiBasePath}${WORKFLOW_MONITOR_SUFFIX}`;
  target.pathname = monitorPath.startsWith("/") ? monitorPath : `/${monitorPath}`;
  target.search = "";
  target.searchParams.set("token", token);

  return target.toString();
};

export const useWorkflowMonitorWebSocket = ({
  token,
  enabled,
  onUpdate,
  onError,
}: UseWorkflowMonitorWebSocketOptions): UseWorkflowMonitorWebSocketReturn => {
  const [sessions, setSessions] = useState<ActiveWorkflowSession[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const shouldConnectRef = useRef(enabled);
  const onUpdateRef = useRef(onUpdate);
  const onErrorRef = useRef(onError);

  // Garder les refs à jour
  useEffect(() => {
    onUpdateRef.current = onUpdate;
    onErrorRef.current = onError;
  }, [onUpdate, onError]);

  const getWebSocketUrl = useCallback(() => {
    if (!token) {
      throw new Error("Token manquant pour la connexion WebSocket");
    }
    return buildWorkflowMonitorUrl(token);
  }, [token]);

  const connect = useCallback(() => {
    if (!enabled || !token) {
      return;
    }

    // Fermer toute connexion existante avant d'en créer une nouvelle
    if (wsRef.current) {
      console.log("[WebSocket] Closing existing connection before creating new one");
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const ws = new WebSocket(getWebSocketUrl());

      ws.onopen = () => {
        console.log("[WebSocket] Connected to workflow monitor");
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;

        // Activate Wake Lock to keep connection alive
        requestWakeLock().catch((error) => {
          console.log("[WorkflowMonitor] Failed to activate Wake Lock on connect:", error);
        });
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          if (message.type === "error") {
            const errorMsg = message.error || "Unknown WebSocket error";
            setError(errorMsg);
            onErrorRef.current?.(errorMsg);
            return;
          }

          if (message.data) {
            setSessions(message.data.sessions);
            onUpdateRef.current?.(message.data.sessions);
          }
        } catch (err) {
          console.error("[WebSocket] Error parsing message:", err);
        }
      };

      ws.onerror = (event) => {
        console.error("[WebSocket] Error:", event);
        setError("WebSocket connection error");
        onErrorRef.current?.("WebSocket connection error");
      };

      ws.onclose = (event) => {
        console.log("[WebSocket] Disconnected:", event.code, event.reason);
        setIsConnected(false);
        wsRef.current = null;

        // Tentative de reconnexion si activée
        if (
          shouldConnectRef.current &&
          reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS
        ) {
          reconnectAttemptsRef.current++;
          console.log(
            `[WebSocket] Reconnecting (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, WS_RECONNECT_DELAY);
        } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          setError("Failed to reconnect after multiple attempts");
          onErrorRef.current?.("Failed to reconnect after multiple attempts");
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("[WebSocket] Connection error:", err);
      setError("Failed to connect to WebSocket");
      onErrorRef.current?.("Failed to connect to WebSocket");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);

    // Release Wake Lock when disconnecting
    releaseWakeLock().catch((error) => {
      console.log("[WorkflowMonitor] Failed to release Wake Lock on disconnect:", error);
    });
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    reconnectAttemptsRef.current = 0;
    connect();
  }, [disconnect, connect]);

  // Gérer la connexion/déconnexion
  useEffect(() => {
    shouldConnectRef.current = enabled;

    if (enabled && token) {
      connect();
    } else {
      disconnect();
    }

    // Handle page visibility changes (important for mobile)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Only log and take action if we have an active websocket
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        console.log("[WorkflowMonitor] Page became visible, checking connection");

        // Reacquire Wake Lock if websocket is connected
        requestWakeLock().catch((error) => {
          console.log("[WorkflowMonitor] Failed to reacquire Wake Lock:", error);
        });

        // If we're disconnected, reconnect logic is already in ws.onclose
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      shouldConnectRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token]);

  return {
    sessions,
    isConnected,
    error,
    reconnect,
  };
};
