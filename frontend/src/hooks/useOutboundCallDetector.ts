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
    // Debug: log thread structure
    console.log('[OutboundCallDetector] Thread received:', {
      hasThread: !!thread,
      hasItems: !!thread?.items,
      itemsLength: thread?.items?.length,
      threadKeys: thread ? Object.keys(thread) : [],
      firstItems: thread?.items?.slice(0, 3),
    });

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
            console.log('[OutboundCallDetector] Found outbound_call.event:', parsed);
            if (parsed.type === "outbound_call.event" && parsed.event) {
              if (parsed.event.type === "call_started" && callStartIndex === -1) {
                callStartIndex = i;
                foundCallId = parsed.event.call_id || null;
                console.log('[OutboundCallDetector] Found call_started:', foundCallId);
              } else if (parsed.event.type === "call_ended" && callEndIndex === -1) {
                callEndIndex = i;
                console.log('[OutboundCallDetector] Found call_ended');
              }
            }
          }
        } catch (e) {
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

    console.log('[OutboundCallDetector] Result:', { callId: foundCallId, isActive: foundActive });

    setCallId(foundCallId);
    setIsActive(foundActive);
  }, [thread]);

  return { callId, isActive };
}
