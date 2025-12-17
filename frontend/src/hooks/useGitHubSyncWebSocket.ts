/**
 * WebSocket hook for real-time GitHub sync notifications.
 * Automatically invalidates workflows query when sync events are received.
 */
import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { workflowsKeys } from "./useWorkflows";
import { githubKeys } from "./useGitHubIntegrations";

interface GitHubSyncEvent {
  type: "connected" | "github_sync_complete" | "ping";
  data?: {
    repo_full_name?: string;
    branch?: string;
    sync_type?: "pull" | "push";
    workflows_affected?: string[];
    message?: string;
  };
}

interface UseGitHubSyncWebSocketOptions {
  token: string | null;
  enabled: boolean;
}

const WS_RECONNECT_DELAY = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;
const RAW_BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? "").trim();
const DEFAULT_API_BASE_PATH = "/api";
const GITHUB_SYNC_WS_SUFFIX = "/github/sync/ws";

const sanitizeApiBasePath = (pathname: string) => {
  if (!pathname || pathname === "/") {
    return DEFAULT_API_BASE_PATH;
  }
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
};

const buildGitHubSyncWsUrl = (token: string) => {
  if (typeof window === "undefined") {
    throw new Error("WebSocket not available in this environment");
  }

  const origin = new URL(window.location.origin);
  const backendBase = RAW_BACKEND_URL
    ? new URL(RAW_BACKEND_URL, origin)
    : new URL(DEFAULT_API_BASE_PATH, origin);

  const target = new URL(backendBase.toString());
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  const apiBasePath = sanitizeApiBasePath(backendBase.pathname);
  const wsPath = `${apiBasePath}${GITHUB_SYNC_WS_SUFFIX}`;
  target.pathname = wsPath.startsWith("/") ? wsPath : `/${wsPath}`;
  target.search = "";
  target.searchParams.set("token", token);

  return target.toString();
};

export const useGitHubSyncWebSocket = ({
  token,
  enabled,
}: UseGitHubSyncWebSocketOptions): void => {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const shouldConnectRef = useRef(enabled);

  const handleSyncEvent = useCallback(
    (event: GitHubSyncEvent) => {
      if (event.type === "github_sync_complete") {
        // Refetch workflows list to refresh sidebar immediately
        void queryClient.refetchQueries({ queryKey: workflowsKeys.all });
        // Also invalidate GitHub-related queries
        queryClient.invalidateQueries({ queryKey: githubKeys.repoSyncs() });

        console.log(
          "[GitHubSync] Received sync notification, refetching workflows",
          event.data
        );
      }
    },
    [queryClient]
  );

  const connect = useCallback(() => {
    if (!enabled || !token) {
      return;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const ws = new WebSocket(buildGitHubSyncWsUrl(token));

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        console.log("[GitHubSync] WebSocket connected");
      };

      ws.onmessage = (event) => {
        try {
          const message: GitHubSyncEvent = JSON.parse(event.data);

          // Ignore ping messages (keep-alive)
          if (message.type === "ping") {
            return;
          }

          handleSyncEvent(message);
        } catch {
          // Error parsing message
        }
      };

      ws.onerror = () => {
        console.warn("[GitHubSync] WebSocket error");
      };

      ws.onclose = () => {
        wsRef.current = null;

        if (
          shouldConnectRef.current &&
          reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS
        ) {
          reconnectAttemptsRef.current++;
          console.log(
            `[GitHubSync] Reconnecting... attempt ${reconnectAttemptsRef.current}`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, WS_RECONNECT_DELAY);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("[GitHubSync] Failed to connect:", err);
    }
  }, [enabled, token, handleSyncEvent]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

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
};
