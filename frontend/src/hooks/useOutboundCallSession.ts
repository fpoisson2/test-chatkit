import { useState, useEffect, useRef, useCallback } from "react";

const WS_RECONNECT_DELAY = 3000; // 3 seconds
const MAX_RECONNECT_ATTEMPTS = 5;

// Wake Lock management for keeping websockets alive
let wakeLock: WakeLockSentinel | null = null;

const requestWakeLock = async () => {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
    console.log("[OutboundCallSession] Wake Lock API not supported");
    return;
  }

  if (wakeLock !== null && !wakeLock.released) {
    console.log("[OutboundCallSession] Wake Lock already active");
    return;
  }

  try {
    wakeLock = await navigator.wakeLock.request("screen");
    console.log("[OutboundCallSession] Wake Lock activated - websockets will stay alive in background");

    wakeLock.addEventListener("release", () => {
      console.log("[OutboundCallSession] Wake Lock released");
    });
  } catch (error) {
    console.log("[OutboundCallSession] Failed to acquire Wake Lock:", error);
  }
};

const releaseWakeLock = async () => {
  if (wakeLock !== null && !wakeLock.released) {
    try {
      await wakeLock.release();
      wakeLock = null;
      console.log("[OutboundCallSession] Wake Lock released manually");
    } catch (error) {
      console.log("[OutboundCallSession] Failed to release Wake Lock:", error);
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
  onTranscript?: (payload: OutboundCallTranscriptPayload) => void;
};

export function useOutboundCallSession(options?: UseOutboundCallSessionOptions): {
  callId: string | null;
  isActive: boolean;
  sendCommand: (command: { type: string; [key: string]: any }) => void;
} {
  const [callId, setCallId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldConnectRef = useRef(true);

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
      console.log("[OutboundCallSession] Closing existing connection before creating new one");
      wsRef.current.close();
      wsRef.current = null;
    }

    // Connect to outbound call events WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/outbound/events`;

    console.log("[OutboundCallSession] Connecting to", wsUrl);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[OutboundCallSession] WebSocket connected");
      reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection

      // Activate Wake Lock to keep connection alive
      requestWakeLock().catch((error) => {
        console.log("[OutboundCallSession] Failed to activate Wake Lock on connect:", error);
      });
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log("[OutboundCallSession] Event received:", message);

        switch (message.type) {
          case "call_started":
            setCallId(message.call_id);
            setIsActive(true);
            console.log("[OutboundCallSession] Call started:", message.call_id);
            break;

          case "call_ended":
            console.log("[OutboundCallSession] Call ended:", message.call_id);
            setIsActive(false);
            // Reset callId after a short delay to allow UI to update
            setTimeout(() => setCallId(null), 500);
            break;

          case "hangup_response":
            console.log("[OutboundCallSession] Hangup response:", message);
            if (message.success) {
              console.log("[OutboundCallSession] Call hung up successfully");
            } else {
              console.error("[OutboundCallSession] Failed to hang up call");
            }
            break;

          case "ping":
            // Ignore pings
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
            console.log("[OutboundCallSession] Unknown event type:", message.type);
        }
      } catch (err) {
        console.error("[OutboundCallSession] Failed to parse message:", err);
      }
    };

    ws.onerror = (error) => {
      console.error("[OutboundCallSession] WebSocket error:", error);
    };

    ws.onclose = () => {
      console.log("[OutboundCallSession] WebSocket closed");
      wsRef.current = null;

      // Attempt reconnection if component is still mounted
      if (shouldConnectRef.current && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current += 1;
        console.log(
          `[OutboundCallSession] Reconnecting (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...`
        );

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connectWebSocket();
        }, WS_RECONNECT_DELAY);
      } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        console.error("[OutboundCallSession] Max reconnect attempts reached");
      }
    };
  }, [options]);

  useEffect(() => {
    shouldConnectRef.current = true;
    connectWebSocket();

    // Handle page visibility changes (important for mobile)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("[OutboundCallSession] Page became visible, checking connection");

        // Reacquire Wake Lock if websocket is connected
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          requestWakeLock().catch((error) => {
            console.log("[OutboundCallSession] Failed to reacquire Wake Lock:", error);
          });
        }

        // If we're disconnected, try to reconnect
        if (wsRef.current === null || wsRef.current.readyState !== WebSocket.OPEN) {
          console.log("[OutboundCallSession] Reconnecting after visibility change");
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
      releaseWakeLock().catch((error) => {
        console.log("[OutboundCallSession] Failed to release Wake Lock on unmount:", error);
      });
    };
  }, [connectWebSocket]); // connectWebSocket depends on options

  return { callId, isActive, sendCommand };
}

export type { UseOutboundCallSessionOptions, OutboundCallTranscriptPayload };
