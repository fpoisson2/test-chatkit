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

  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    return `${protocol}//${host}/api/admin/workflows/monitor?token=${encodeURIComponent(token || "")}`;
  }, [token]);

  const connect = useCallback(() => {
    if (!enabled || !token || wsRef.current) {
      return;
    }

    try {
      const ws = new WebSocket(getWebSocketUrl());

      ws.onopen = () => {
        console.log("[WebSocket] Connected to workflow monitor");
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          if (message.type === "error") {
            const errorMsg = message.error || "Unknown WebSocket error";
            setError(errorMsg);
            onError?.(errorMsg);
            return;
          }

          if (message.data) {
            setSessions(message.data.sessions);
            onUpdate?.(message.data.sessions);
          }
        } catch (err) {
          console.error("[WebSocket] Error parsing message:", err);
        }
      };

      ws.onerror = (event) => {
        console.error("[WebSocket] Error:", event);
        setError("WebSocket connection error");
        onError?.("WebSocket connection error");
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
          onError?.("Failed to reconnect after multiple attempts");
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("[WebSocket] Connection error:", err);
      setError("Failed to connect to WebSocket");
      onError?.("Failed to connect to WebSocket");
    }
  }, [enabled, token, getWebSocketUrl, onUpdate, onError]);

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

    return () => {
      shouldConnectRef.current = false;
      disconnect();
    };
  }, [enabled, token, connect, disconnect]);

  return {
    sessions,
    isConnected,
    error,
    reconnect,
  };
};
