import { useState, useEffect } from "react";

/**
 * Hook to detect active outbound calls via WebSocket events.
 * Similar to useWorkflowVoiceSession but for outbound calls.
 */
export function useOutboundCallSession(): {
  callId: string | null;
  isActive: boolean;
} {
  const [callId, setCallId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    // Connect to outbound call events WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/outbound/events`;

    console.log("[OutboundCallSession] Connecting to", wsUrl);

    const ws = new WebSocket(wsUrl);

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
            if (message.call_id === callId) {
              setIsActive(false);
              console.log("[OutboundCallSession] Call ended:", message.call_id);
            }
            break;

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
    };
  }, [callId]);

  return { callId, isActive };
}
