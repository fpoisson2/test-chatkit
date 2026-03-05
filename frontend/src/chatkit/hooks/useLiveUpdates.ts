/**
 * Hook for subscribing to live step content updates via lightweight polling.
 *
 * Polls the backend every few seconds to detect admin edits to workflow steps.
 * This approach works reliably through Cloudflare Tunnel (unlike SSE which gets buffered).
 */
import { useEffect, useRef } from 'react';
import type { Thread } from '../types';

const POLL_INTERVAL_MS = 1500;

interface UseLiveUpdatesOptions {
  apiUrl: string;
  headers?: Record<string, string>;
  threadId: string | undefined;
  setThread: React.Dispatch<React.SetStateAction<Thread | null>>;
  refreshThread?: () => Promise<void>;
}

export function useLiveUpdates({
  apiUrl,
  headers,
  threadId,
  refreshThread,
}: UseLiveUpdatesOptions): void {
  const refreshThreadRef = useRef(refreshThread);
  refreshThreadRef.current = refreshThread;
  const headersRef = useRef(headers);
  headersRef.current = headers;
  const sinceRef = useRef(0);

  useEffect(() => {
    if (!threadId) return;

    let stopped = false;

    const poll = async () => {
      while (!stopped) {
        try {
          const url = `${apiUrl.replace(/\/+$/, '')}/live-updates/poll?thread_id=${encodeURIComponent(threadId)}&since=${sinceRef.current}`;
          const resp = await fetch(url, { headers: headersRef.current || {} });
          if (resp.ok) {
            const data = await resp.json();
            if (data.changed && refreshThreadRef.current) {
              sinceRef.current = data.ts;
              await refreshThreadRef.current();
            }
          }
        } catch {
          // Network error — retry on next interval
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    };

    poll();

    // Also listen for direct browser events from AdminVoicePanel (same tab)
    const handleDirectUpdate = () => {
      if (refreshThreadRef.current) {
        void refreshThreadRef.current();
      }
    };
    window.addEventListener('chatkit:live-update', handleDirectUpdate);

    return () => {
      stopped = true;
      window.removeEventListener('chatkit:live-update', handleDirectUpdate);
    };
  }, [apiUrl, threadId]);
}
