/**
 * Hook for replaying streaming events with animation.
 *
 * This hook replays missed events from a streaming session
 * with realistic timing to show the user what happened while
 * they were away.
 */

import { useCallback, useRef, useState } from "react";
import type { Thread, ThreadStreamEvent } from "../types";
import { applyDelta } from "../api/streaming/deltas";

export interface ReplayProgress {
  /** Current event index */
  current: number;
  /** Total number of events to replay */
  total: number;
  /** Percentage complete (0-100) */
  percentage: number;
}

interface UseEventReplayOptions {
  /** Callback when thread state is updated during replay */
  onThreadUpdate: (thread: Thread) => void;
  /** Base animation speed in milliseconds between events */
  animationSpeed?: number;
  /** Whether to use variable timing based on event type */
  useVariableTiming?: boolean;
}

export function useEventReplay(options: UseEventReplayOptions) {
  const {
    onThreadUpdate,
    animationSpeed = 30,
    useVariableTiming = true,
  } = options;

  const [isReplaying, setIsReplaying] = useState(false);
  const [progress, setProgress] = useState<ReplayProgress>({
    current: 0,
    total: 0,
    percentage: 0,
  });

  const abortRef = useRef<AbortController | null>(null);

  /**
   * Get delay for an event based on its type.
   * Text deltas are fast, item completions get a brief pause.
   */
  const getEventDelay = useCallback(
    (event: ThreadStreamEvent): number => {
      if (!useVariableTiming) return animationSpeed;

      const eventType = event.type;

      // Fast for text streaming
      if (
        eventType === "assistant_message.content_part.text_delta" ||
        eventType === "widget.streaming_text.value_delta"
      ) {
        return Math.max(5, animationSpeed / 3);
      }

      // Brief pause after items complete
      if (
        eventType === "thread.item.done" ||
        eventType === "assistant_message.content_part.done"
      ) {
        return animationSpeed * 3;
      }

      // Longer pause after workflow tasks
      if (
        eventType === "workflow.task.updated" &&
        "task" in event &&
        (event as { task?: { status_indicator?: string } }).task
          ?.status_indicator === "complete"
      ) {
        return animationSpeed * 2;
      }

      return animationSpeed;
    },
    [animationSpeed, useVariableTiming]
  );

  /**
   * Replay a list of events with animation.
   */
  const replayEvents = useCallback(
    async (
      initialThread: Thread,
      events: ThreadStreamEvent[]
    ): Promise<Thread> => {
      if (events.length === 0) return initialThread;

      setIsReplaying(true);
      setProgress({ current: 0, total: events.length, percentage: 0 });
      abortRef.current = new AbortController();

      let currentThread = initialThread;

      for (let i = 0; i < events.length; i++) {
        if (abortRef.current.signal.aborted) break;

        const event = events[i];

        // Apply the event to the thread
        currentThread = applyDelta(currentThread, event);
        onThreadUpdate(currentThread);

        // Update progress
        const newProgress = {
          current: i + 1,
          total: events.length,
          percentage: Math.round(((i + 1) / events.length) * 100),
        };
        setProgress(newProgress);

        // Wait before next event (unless it's the last one)
        if (i < events.length - 1) {
          const delay = getEventDelay(event);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      setIsReplaying(false);
      return currentThread;
    },
    [getEventDelay, onThreadUpdate]
  );

  /**
   * Stop the replay animation.
   */
  const stopReplay = useCallback(() => {
    abortRef.current?.abort();
    setIsReplaying(false);
  }, []);

  /**
   * Skip to the end of replay (apply all remaining events instantly).
   */
  const skipToEnd = useCallback(
    (currentThread: Thread, remainingEvents: ThreadStreamEvent[]): Thread => {
      abortRef.current?.abort();

      let thread = currentThread;
      for (const event of remainingEvents) {
        thread = applyDelta(thread, event);
      }

      onThreadUpdate(thread);
      setIsReplaying(false);
      setProgress((p) => ({
        ...p,
        current: p.total,
        percentage: 100,
      }));

      return thread;
    },
    [onThreadUpdate]
  );

  return {
    isReplaying,
    progress,
    replayEvents,
    stopReplay,
    skipToEnd,
  };
}
