/**
 * Hook pour charger et rafraîchir les threads
 */
import { useEffect, useCallback } from 'react';
import type { Thread, ChatKitAPIConfig } from '../types';
import { fetchThread } from '../api/streaming/api';

export interface UseThreadLoaderOptions {
  api: ChatKitAPIConfig;
  initialThread: string | null | undefined;
  threadCacheRef: React.MutableRefObject<Map<string, Thread>>;
  activeThreadIdRef: React.MutableRefObject<string | null>;
  visibleThreadIdRef: React.MutableRefObject<string | null>;
  setThread: React.Dispatch<React.SetStateAction<Thread | null>>;
  setThreadLoading: (threadId: string | null | undefined, value: boolean) => void;
  getThreadKey: (threadId: string | null | undefined) => string;
  generateTempThreadId: () => string;
  isTempThreadId: (threadId: string | null | undefined) => boolean;
  onThreadLoadStart?: (event: { threadId: string }) => void;
  onThreadLoadEnd?: (event: { threadId: string }) => void;
  onError?: (error: { error: Error }) => void;
  onLog?: (entry: { name: string; data?: Record<string, unknown> }) => void;
}

export interface UseThreadLoaderReturn {
  fetchUpdates: () => Promise<void>;
}

export function useThreadLoader(options: UseThreadLoaderOptions): UseThreadLoaderReturn {
  const {
    api,
    initialThread,
    threadCacheRef,
    activeThreadIdRef,
    visibleThreadIdRef,
    setThread,
    setThreadLoading,
    getThreadKey,
    generateTempThreadId,
    isTempThreadId,
    onThreadLoadStart,
    onThreadLoadEnd,
    onError,
    onLog,
  } = options;

  // Reset thread when initialThread becomes null
  useEffect(() => {
    if (initialThread === null) {
      const tempId = generateTempThreadId();
      setThread(null);
      activeThreadIdRef.current = tempId;
      visibleThreadIdRef.current = tempId;
      setThreadLoading(null, false);
    }
  }, [initialThread, generateTempThreadId, setThread, activeThreadIdRef, visibleThreadIdRef, setThreadLoading, getThreadKey]);

  // Load initial thread
  useEffect(() => {
    if (initialThread) {
      onThreadLoadStart?.({ threadId: initialThread });
      onLog?.({ name: 'thread.load.start', data: { threadId: initialThread } });

      // Check cache first for instant display
      const cachedThread = threadCacheRef.current.get(initialThread);

      if (cachedThread) {
        setThread(cachedThread);
        activeThreadIdRef.current = cachedThread.id;
        visibleThreadIdRef.current = cachedThread.id;
        onThreadLoadEnd?.({ threadId: initialThread });
        onLog?.({ name: 'thread.load.end', data: { thread: cachedThread, source: 'cache' } });
      } else {
        setThreadLoading(initialThread, true);

        fetchThread({
          url: api.url,
          headers: api.headers,
          threadId: initialThread,
        })
          .then((loadedThread) => {
            // Clear loading state BEFORE setting thread to avoid race condition
            // where typing indicator shows up when thread is set but loading not yet cleared
            setThreadLoading(loadedThread.id, false);
            setThread(loadedThread);
            threadCacheRef.current.set(loadedThread.id, loadedThread);
            activeThreadIdRef.current = loadedThread.id;
            visibleThreadIdRef.current = loadedThread.id;
            onThreadLoadEnd?.({ threadId: initialThread });
            onLog?.({ name: 'thread.load.end', data: { thread: loadedThread, source: 'server' } });
          })
          .catch((err) => {
            const errorMessage = err?.message || String(err);
            if (errorMessage.includes('404')) {
              const tempId = generateTempThreadId();
              activeThreadIdRef.current = tempId;
              visibleThreadIdRef.current = tempId;
              setThread(null);
              onThreadLoadEnd?.({ threadId: initialThread });
            } else {
              onError?.({ error: err instanceof Error ? err : new Error(errorMessage) });
            }
          })
          .finally(() => {
            setThreadLoading(initialThread, false);
          });
      }
    }
  }, [initialThread, api.url, api.headers, onThreadLoadStart, onThreadLoadEnd, onError, onLog, setThreadLoading, generateTempThreadId, threadCacheRef, activeThreadIdRef, visibleThreadIdRef, setThread]);

  // Fetch thread updates
  const fetchUpdates = useCallback(async () => {
    const targetThreadId = visibleThreadIdRef.current ?? activeThreadIdRef.current;

    if (!targetThreadId || isTempThreadId(targetThreadId)) {
      return;
    }

    try {
      setThreadLoading(targetThreadId, true);
      const updatedThread = await fetchThread({
        url: api.url,
        headers: api.headers,
        threadId: targetThreadId,
      });

      setThread(updatedThread);
      threadCacheRef.current.set(updatedThread.id, updatedThread);
      activeThreadIdRef.current = updatedThread.id;
      visibleThreadIdRef.current = updatedThread.id;
      setThreadLoading(updatedThread.id, false);
      onLog?.({ name: 'thread.refresh', data: { thread: updatedThread } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.({ error });
    } finally {
      setThreadLoading(targetThreadId, false);
    }
  }, [api.url, api.headers, onError, onLog, setThreadLoading, isTempThreadId, visibleThreadIdRef, activeThreadIdRef, threadCacheRef, setThread]);

  return {
    fetchUpdates,
  };
}
