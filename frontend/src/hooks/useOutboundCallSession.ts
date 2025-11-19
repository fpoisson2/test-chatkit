import { useState, useEffect, useRef, useCallback } from "react";

const WS_RECONNECT_DELAY = 3000; // 3 seconds
const MAX_RECONNECT_ATTEMPTS = 5;

// Wake Lock management for keeping websockets alive
let wakeLock: WakeLockSentinel | null = null;

const requestWakeLock = async () => {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
    return;
  }

  if (wakeLock !== null && !wakeLock.released) {
    return;
  }

  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    // Silent - no logging needed
  }
};

const releaseWakeLock = async () => {
  if (wakeLock !== null && !wakeLock.released) {
    try {
      await wakeLock.release();
      wakeLock = null;
    } catch {
      // Silent - no logging needed
    }
  }
};

/**
 * Hook to detect active outbound calls via WebSocket events.
 * Similar to useWorkflowVoiceSession but for outbound calls.
 */
type OutboundCallTranscriptPayload = {
  callId: string | null;
  messageId: string | null;
  role: string | null;
  text: string;
  threadId: string | null;
};

type UseOutboundCallSessionOptions = {
  enabled?: boolean;
  onTranscript?: (payload: OutboundCallTranscriptPayload) => void;
};

export function useOutboundCallSession(options?: UseOutboundCallSessionOptions): {
  callId: string | null;
  isActive: boolean;
  sendCommand: (command: { type: string; [key: string]: any }) => void;
} {
  const [callId, setCallId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const isActiveRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldConnectRef = useRef(true);

  // Keep ref in sync with state
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const sendCommand = useCallback((command: { type: string; [key: string]: any }) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(command));
      console.log("[OutboundCallSession] Sent command:", command);
    } else {
      console.error("[OutboundCallSession] WebSocket not connected, cannot send command");
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Connect to outbound call events WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/outbound/events`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection

      // Activate Wake Lock to keep connection alive
      requestWakeLock().catch(() => {
        // Silent - no logging needed
      });
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case "call_started":
            setCallId(message.call_id);
            setIsActive(true);
            console.log(`[OutboundCallSession] Call started: ${message.call_id}`);
            break;

          case "call_ended":
            console.log(`[OutboundCallSession] Call ended: ${message.call_id}`);
            setIsActive(false);
            // Reset callId after a short delay to allow UI to update
            setTimeout(() => setCallId(null), 500);
            break;

          case "hangup_response":
            // Silent - hangup response handled without logging
            break;

          case "ping":
            // Silent - ignore pings
            break;

          case "transcript_delta": {
            const payload: OutboundCallTranscriptPayload = {
              callId: typeof message.call_id === "string" ? message.call_id : null,
              messageId: typeof message.message_id === "string" ? message.message_id : null,
              role: typeof message.role === "string" ? message.role : null,
              text: typeof message.text === "string" ? message.text : "",
              threadId: typeof message.thread_id === "string" ? message.thread_id : null,
            };
            if (options?.onTranscript) {
              try {
                options.onTranscript(payload);
              } catch (err) {
                console.error("[OutboundCallSession] Transcript callback failed", err);
              }
            }
            break;
          }

          default:
            // Silent - ignore unknown event types
        }
      } catch (err) {
        console.error("[OutboundCallSession] Failed to parse message:", err);
      }
    };

    ws.onerror = (error) => {
      console.error("[OutboundCallSession] WebSocket error:", error);
    };

    ws.onclose = () => {
      wsRef.current = null;

      // Attempt reconnection if component is still mounted
      if (shouldConnectRef.current && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current += 1;

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connectWebSocket();
        }, WS_RECONNECT_DELAY);
      }
    };
  }, [options]);

  useEffect(() => {
    const enabled = options?.enabled ?? true;

    if (!enabled) {
      return;
    }

    shouldConnectRef.current = true;
    connectWebSocket();

    // Handle page visibility changes (important for mobile)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Reacquire Wake Lock if websocket is connected
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          requestWakeLock().catch(() => {
            // Silent - no logging needed
          });
        }

        // If we're disconnected, try to reconnect
        if (wsRef.current === null || wsRef.current.readyState !== WebSocket.OPEN) {
          reconnectAttemptsRef.current = 0; // Reset attempts on visibility change
          connectWebSocket();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      shouldConnectRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      // Clear reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      // Close websocket
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      // Release Wake Lock when component unmounts
      releaseWakeLock().catch(() => {
        // Silent - no logging needed
      });
    };
  }, [connectWebSocket, options?.enabled]); // connectWebSocket depends on options

  return { callId, isActive, sendCommand };
}

export type { UseOutboundCallSessionOptions, OutboundCallTranscriptPayload };
