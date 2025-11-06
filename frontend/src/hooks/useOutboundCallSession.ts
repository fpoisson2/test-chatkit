import { useState, useEffect, useRef, useCallback } from "react";

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

  const sendCommand = useCallback((command: { type: string; [key: string]: any }) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(command));
      console.log("[OutboundCallSession] Sent command:", command);
    } else {
      console.error("[OutboundCallSession] WebSocket not connected, cannot send command");
    }
  }, []);

  useEffect(() => {
    // Connect to outbound call events WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/outbound/events`;

    console.log("[OutboundCallSession] Connecting to", wsUrl);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[OutboundCallSession] WebSocket connected");
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
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []); // Empty deps - WebSocket should persist for the entire component lifecycle

  return { callId, isActive, sendCommand };
}

export type { UseOutboundCallSessionOptions, OutboundCallTranscriptPayload };
