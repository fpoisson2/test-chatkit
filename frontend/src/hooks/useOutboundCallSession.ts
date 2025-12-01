import { useState, useEffect, useRef, useCallback } from "react";
import type { OutboundCallStatus, OutboundCallTranscript } from "../chatkit/types";

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
  authToken?: string | null;
  onTranscript?: (payload: OutboundCallTranscriptPayload) => void;
  onCallEnd?: () => void;
};

export function useOutboundCallSession(options?: UseOutboundCallSessionOptions): {
  callId: string | null;
  isActive: boolean;
  status: OutboundCallStatus;
  toNumber: string | null;
  transcripts: OutboundCallTranscript[];
  error: string | null;
  sendCommand: (command: { type: string; [key: string]: any }) => void;
  hangupCall: () => Promise<void>;
} {
  const [callId, setCallId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<OutboundCallStatus>("idle");
  const [toNumber, setToNumber] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<OutboundCallTranscript[]>([]);
  const [error, setError] = useState<string | null>(null);
  const isActiveRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldConnectRef = useRef(true);
  const transcriptIdCounterRef = useRef(0);

  // Store callbacks in refs to avoid reconnection loops
  const onTranscriptRef = useRef(options?.onTranscript);
  const onCallEndRef = useRef(options?.onCallEnd);
  const authTokenRef = useRef(options?.authToken);
  const enabledRef = useRef(options?.enabled ?? true);

  // Update refs when options change
  useEffect(() => {
    onTranscriptRef.current = options?.onTranscript;
    onCallEndRef.current = options?.onCallEnd;
    authTokenRef.current = options?.authToken;
    enabledRef.current = options?.enabled ?? true;
  }, [options?.onTranscript, options?.onCallEnd, options?.authToken, options?.enabled]);

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

  const hangupCall = useCallback(async () => {
    const currentCallId = callId;
    const authToken = authTokenRef.current;

    if (!currentCallId) {
      console.error("[OutboundCallSession] No active call to hangup");
      return;
    }

    if (!authToken) {
      setError("Token d'authentification manquant");
      return;
    }

    try {
      const response = await fetch(`/api/outbound/call/${currentCallId}/hangup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Erreur inconnue" }));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      console.log("[OutboundCallSession] Call hung up successfully");
    } catch (err) {
      console.error("[OutboundCallSession] Failed to hang up call:", err);
      setError(`Échec du raccrochage: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [callId]);

  const connectWebSocket = useCallback(() => {
    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Connect to outbound call events WebSocket
    const authToken = authTokenRef.current;
    if (!authToken) {
      console.error("[OutboundCallSession] Missing auth token, cannot connect to websocket");
      setError("Jeton d'authentification manquant pour la session d'appels sortants");
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/outbound/events?token=${encodeURIComponent(authToken)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection
      console.log("[OutboundCallSession] WebSocket connected to", wsUrl);

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
            setStatus("initiating");
            setError(null);
            setTranscripts([]);
            if (typeof message.to_number === "string") {
              setToNumber(message.to_number);
            }
            console.log(`[OutboundCallSession] Call started: ${message.call_id}`);
            break;

          case "call_status":
            if (typeof message.status === "string") {
              setStatus(message.status as OutboundCallStatus);
            }
            if (typeof message.to_number === "string") {
              setToNumber(message.to_number);
            }
            break;

          case "call_ended":
            console.log(`[OutboundCallSession] Call ended: ${message.call_id}`);
            setIsActive(false);
            setStatus("completed");
            onCallEndRef.current?.();
            // Keep callId and status visible - will reset when a new call starts
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

            // Add to transcripts list
            if (payload.text && payload.role) {
              transcriptIdCounterRef.current += 1;
              const newTranscript: OutboundCallTranscript = {
                id: payload.messageId || `transcript-${transcriptIdCounterRef.current}`,
                role: payload.role === "assistant" ? "assistant" : "user",
                text: payload.text,
                timestamp: Date.now(),
              };
              setTranscripts((prev) => [...prev, newTranscript]);
            }

            if (onTranscriptRef.current) {
              try {
                onTranscriptRef.current(payload);
              } catch (err) {
                console.error("[OutboundCallSession] Transcript callback failed", err);
              }
            }
            break;
          }

          case "error":
            if (typeof message.message === "string") {
              setError(message.message);
            }
            setStatus("failed");
            break;

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

    ws.onclose = (event) => {
      console.log("[OutboundCallSession] WebSocket closed:", event.code, event.reason);
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
  }, []);

  useEffect(() => {
    if (!enabledRef.current) {
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
  }, [connectWebSocket]);

  return { callId, isActive, status, toNumber, transcripts, error, sendCommand, hangupCall };
}

export type { UseOutboundCallSessionOptions, OutboundCallTranscriptPayload };
