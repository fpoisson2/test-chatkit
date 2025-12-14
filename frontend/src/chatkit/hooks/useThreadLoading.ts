/**
 * Hook pour gérer les états de chargement des threads
 */
import { useState, useCallback, useMemo } from 'react';

export interface UseThreadLoadingReturn {
  loadingByThread: Record<string, boolean>;
  setThreadLoading: (threadId: string | null | undefined, value: boolean) => void;
  isLoading: (currentThreadId: string | null | undefined, getThreadKey: (id: string | null | undefined) => string) => boolean;
  getLoadingThreadIds: () => Set<string>;
  clearAllLoading: () => void;
  streamingByThread: Record<string, boolean>;
  setThreadStreaming: (threadId: string | null | undefined, value: boolean) => void;
  getStreamingThreadIds: () => Set<string>;
}

export function useThreadLoading(
  getThreadKey: (threadId: string | null | undefined) => string,
  initialThreadId?: string | null
): UseThreadLoadingReturn {
  // Initialize loading state synchronously if we have an initial thread to load
  // This prevents the "new conversation" flash on page refresh
  const [loadingByThread, setLoadingByThread] = useState<Record<string, boolean>>(() => {
    if (initialThreadId) {
      return { [initialThreadId]: true };
    }
    return {};
  });

  // Streaming state - only set when actively streaming a response (not just loading a thread)
  const [streamingByThread, setStreamingByThread] = useState<Record<string, boolean>>({});

  const setThreadLoading = useCallback((threadId: string | null | undefined, value: boolean) => {
    const key = getThreadKey(threadId);
    setLoadingByThread((prev) => {
      const next = { ...prev };

      if (!value) {
        delete next[key];
      } else {
        next[key] = true;
      }

      return next;
    });
  }, [getThreadKey]);

  const isLoading = useCallback(
    (currentThreadId: string | null | undefined, getKey: (id: string | null | undefined) => string) => {
      return loadingByThread[getKey(currentThreadId)] ?? false;
    },
    [loadingByThread]
  );

  const getLoadingThreadIds = useCallback(() => {
    const ids = new Set<string>();
    for (const [key, loading] of Object.entries(loadingByThread)) {
      if (loading && key !== '__new_thread__' && !key.startsWith('__temp_thread_')) {
        ids.add(key);
      }
    }
    return ids;
  }, [loadingByThread]);

  const clearAllLoading = useCallback(() => {
    setLoadingByThread({});
  }, []);

  const setThreadStreaming = useCallback((threadId: string | null | undefined, value: boolean) => {
    const key = getThreadKey(threadId);
    setStreamingByThread((prev) => {
      const next = { ...prev };

      if (!value) {
        delete next[key];
      } else {
        next[key] = true;
      }

      return next;
    });
  }, [getThreadKey]);

  const getStreamingThreadIds = useCallback(() => {
    const ids = new Set<string>();
    for (const [key, streaming] of Object.entries(streamingByThread)) {
      if (streaming && key !== '__new_thread__' && !key.startsWith('__temp_thread_')) {
        ids.add(key);
      }
    }
    return ids;
  }, [streamingByThread]);

  return {
    loadingByThread,
    setThreadLoading,
    isLoading,
    getLoadingThreadIds,
    clearAllLoading,
    streamingByThread,
    setThreadStreaming,
    getStreamingThreadIds,
  };
}
