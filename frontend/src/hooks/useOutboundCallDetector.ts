import { useState, useEffect } from "react";

interface ThreadMessage {
  role?: string;
  content?: any;
  annotations?: Array<{ type: string; call_id?: string; [key: string]: any }>;
  metadata?: any;
}

interface Thread {
  messages?: ThreadMessage[];
  metadata?: any;
}

/**
 * Hook to detect active outbound calls from thread messages.
 * Looks for messages with annotations indicating an outbound call is starting.
 */
export function useOutboundCallDetector(thread: Thread | null): {
  callId: string | null;
  isActive: boolean;
} {
  const [callId, setCallId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!thread) {
      setCallId(null);
      setIsActive(false);
      return;
    }

    // First, check thread metadata for active call (most reliable)
    const activeCall = thread.metadata?.active_outbound_call;
    if (activeCall?.call_id) {
      setCallId(activeCall.call_id);
      setIsActive(true);
      return;
    }

    // Fallback: Look for the most recent outbound call in messages
    // We look for:
    // 1. outbound_call_start annotation (call starting)
    // 2. voice_transcript_realtime annotations (call in progress)
    // 3. audio_recordings annotation (call ended)

    if (!thread.messages) {
      setCallId(null);
      setIsActive(false);
      return;
    }

    let foundCallId: string | null = null;
    let foundActive = false;
    let callStartIndex = -1;
    let callEndIndex = -1;

    // Iterate backwards to find the most recent call events
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      const message = thread.messages[i];
      const annotations = message.annotations || [];

      // Check for call start
      const callStartAnnotation = annotations.find(
        (ann) => ann.type === "outbound_call_start"
      );
      if (callStartAnnotation && callStartIndex === -1) {
        callStartIndex = i;
        foundCallId = callStartAnnotation.call_id || null;
      }

      // Check for call end (audio recordings message)
      const hasAudioRecordings = annotations.some(
        (ann) => ann.type === "audio_recordings"
      );
      if (hasAudioRecordings && callEndIndex === -1) {
        callEndIndex = i;
      }

      // If we found both start and end, we can stop
      if (callStartIndex !== -1 && callEndIndex !== -1) {
        break;
      }
    }

    // Determine if call is active
    // Call is active if:
    // - We found a call_start annotation
    // - AND either we didn't find a call_end OR the call_end is before the call_start
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
