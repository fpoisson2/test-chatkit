import { useState, useEffect } from "react";

interface ThreadItem {
  type?: string;
  task?: {
    content?: string;
  };
}

interface Thread {
  items?: ThreadItem[];
}

/**
 * Hook to detect active outbound calls from thread task items.
 * Looks for "outbound_call.event" task items (similar to realtime.event for voice sessions).
 */
export function useOutboundCallDetector(thread: Thread | null): {
  callId: string | null;
  isActive: boolean;
} {
  const [callId, setCallId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!thread || !thread.items) {
      setCallId(null);
      setIsActive(false);
      return;
    }

    let foundCallId: string | null = null;
    let foundActive = false;
    let callStartIndex = -1;
    let callEndIndex = -1;

    // Iterate backwards to find the most recent outbound call events
    for (let i = thread.items.length - 1; i >= 0; i--) {
      const item = thread.items[i];

      // Look for task items with outbound_call.event
      if (item.type === "task" && item.task?.content) {
        try {
          const content = item.task.content;
          // Try to parse as JSON to find the event
          if (content.includes('"type":"outbound_call.event"') || content.includes('"type": "outbound_call.event"')) {
            const parsed = JSON.parse(content);
            if (parsed.type === "outbound_call.event" && parsed.event) {
              if (parsed.event.type === "call_started" && callStartIndex === -1) {
                callStartIndex = i;
                foundCallId = parsed.event.call_id || null;
              } else if (parsed.event.type === "call_ended" && callEndIndex === -1) {
                callEndIndex = i;
              }
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      // If we found both start and end, we can stop
      if (callStartIndex !== -1 && callEndIndex !== -1) {
        break;
      }
    }

    // Determine if call is active
    // Call is active if:
    // - We found a call_started event
    // - AND either we didn't find a call_ended event OR the call_ended is before the call_started
    if (foundCallId && callStartIndex !== -1) {
      if (callEndIndex === -1 || callEndIndex < callStartIndex) {
        foundActive = true;
      }
    }

    setCallId(foundCallId);
    setIsActive(foundActive);
  }, [thread]);

  return { callId, isActive };
}
