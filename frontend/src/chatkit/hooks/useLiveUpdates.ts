/**
 * Hook for subscribing to live step content updates via SSE.
 *
 * When an admin edits an assistant message step in the workflow builder,
 * this hook receives the update and patches the displayed messages in real-time.
 */
import { useEffect, useRef } from 'react';
import type { Thread } from '../types';

interface UseLiveUpdatesOptions {
  apiUrl: string;
  headers?: Record<string, string>;
  threadId: string | undefined;
  setThread: React.Dispatch<React.SetStateAction<Thread | null>>;
  refreshThread?: () => Promise<void>;
}

interface StepContentUpdateEvent {
  type: 'step.content.updated';
  step_slug: string;
  new_text: string;
}

export function useLiveUpdates({
  apiUrl,
  headers,
  threadId,
  setThread,
  refreshThread,
}: UseLiveUpdatesOptions): void {
  const abortRef = useRef<AbortController | null>(null);
  const refreshThreadRef = useRef(refreshThread);
  refreshThreadRef.current = refreshThread;
  const headersRef = useRef(headers);
  headersRef.current = headers;
  const setThreadRef = useRef(setThread);
  setThreadRef.current = setThread;

  useEffect(() => {
    if (!threadId) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const connect = async () => {
      try {
        const url = `${apiUrl.replace(/\/+$/, '')}/live-updates?thread_id=${encodeURIComponent(threadId)}`;
        const response = await fetch(url, {
          headers: headersRef.current || {},
          signal: controller.signal,
        });

        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6);
            try {
              const event: StepContentUpdateEvent = JSON.parse(jsonStr);
              if (event.type === 'step.content.updated') {
                if (refreshThreadRef.current) {
                  void refreshThreadRef.current();
                } else {
                  setThreadRef.current((prev) => {
                    if (!prev) return prev;
                    const updatedItems = prev.items.map((item) => {
                      if (
                        item.type === 'assistant_message' &&
                        'step_slug' in item &&
                        (item as any).step_slug === event.step_slug
                      ) {
                        return {
                          ...item,
                          content: item.content.map((c) =>
                            c.type === 'output_text'
                              ? { ...c, text: event.new_text }
                              : c
                          ),
                        };
                      }
                      return item;
                    });
                    return { ...prev, items: updatedItems };
                  });
                }
              }
            } catch {
              // Ignore parse errors (keepalive comments, etc.)
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.warn('[useLiveUpdates] SSE connection lost:', err);
      }
    };

    connect();

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [apiUrl, threadId]);
}
