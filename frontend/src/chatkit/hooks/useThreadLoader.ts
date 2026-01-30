/**
 * Hook pour charger et rafraîchir les threads
 */
import { useEffect, useCallback } from 'react';
import type { Thread, ChatKitAPIConfig } from '../types';
import { fetchThread } from '../api/streaming/api';

export interface UseThreadLoaderOptions {
  api: ChatKitAPIConfig;
  initialThread: string | null | undefined;
  branchIdRef?: React.MutableRefObject<string | null>;
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
  onThreadNotFound?: (event: { threadId: string }) => void;
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
    branchIdRef,
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
    onThreadNotFound,
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
      const cachedThread = threadCacheRef.current.get(getThreadKey(initialThread));

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
          branchId: branchIdRef?.current,
        })
          .then((loadedThread) => {
            const responseBranchId =
              (loadedThread.metadata as { current_branch_id?: string } | undefined)
                ?.current_branch_id ?? null;
            if (branchIdRef?.current && responseBranchId && responseBranchId !== branchIdRef.current) {
              // Ignore stale response from another branch
              onLog?.({
                name: 'thread.load.ignored',
                data: {
                  threadId: loadedThread.id,
                  responseBranchId,
                  expectedBranchId: branchIdRef.current,
                },
              });
              return;
            }
            // Clear loading state BEFORE setting thread to avoid race condition
            // where typing indicator shows up when thread is set but loading not yet cleared
            setThreadLoading(loadedThread.id, false);
            setThread(loadedThread);
            threadCacheRef.current.set(getThreadKey(loadedThread.id), loadedThread);
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
              // Notify that the thread was not found so the UI can redirect to new conversation
              onThreadNotFound?.({ threadId: initialThread });
            } else {
              onError?.({ error: err instanceof Error ? err : new Error(errorMessage) });
            }
          })
          .finally(() => {
            setThreadLoading(initialThread, false);
          });
      }
    }
  }, [initialThread, api.url, api.headers, onThreadLoadStart, onThreadLoadEnd, onError, onLog, setThreadLoading, generateTempThreadId, threadCacheRef, activeThreadIdRef, visibleThreadIdRef, setThread, getThreadKey]);

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
        branchId: branchIdRef?.current,
      });

      const responseBranchId =
        (updatedThread.metadata as { current_branch_id?: string } | undefined)
          ?.current_branch_id ?? null;
      if (branchIdRef?.current && responseBranchId && responseBranchId !== branchIdRef.current) {
        onLog?.({
          name: 'thread.refresh.ignored',
          data: {
            threadId: updatedThread.id,
            responseBranchId,
            expectedBranchId: branchIdRef.current,
          },
        });
        return;
      }

      setThread(updatedThread);
      threadCacheRef.current.set(getThreadKey(updatedThread.id), updatedThread);
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
  }, [api.url, api.headers, onError, onLog, setThreadLoading, isTempThreadId, visibleThreadIdRef, activeThreadIdRef, threadCacheRef, setThread, branchIdRef, getThreadKey]);

  return {
    fetchUpdates,
  };
}
