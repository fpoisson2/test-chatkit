/**
 * Hook pour charger et rafraîchir les threads
 */
import { useEffect, useCallback, useRef } from 'react';
import type { Thread, ChatKitAPIConfig, ThreadStreamEvent } from '../types';
import { fetchThread, isThreadStreaming, buildResumeStreamingPayload } from '../api/streaming/api';
import { streamChatKitEvents } from '../api/streaming/index';

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
  getAbortController: (threadId: string) => AbortController;
  onThreadUpdate?: (thread: Thread) => void;
  onStreamEvent?: (event: ThreadStreamEvent) => void;
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
    getAbortController,
    onThreadUpdate,
    onStreamEvent,
    onThreadLoadStart,
    onThreadLoadEnd,
    onError,
    onLog,
  } = options;

  // Track if we're currently resuming streaming to avoid duplicate attempts
  const isResumingRef = useRef(false);
  // Track which thread we've already attempted to resume (to prevent re-triggering on re-renders)
  const resumedThreadIdRef = useRef<string | null>(null);
  // Track previous initialThread to detect actual changes
  const prevInitialThreadRef = useRef<string | null | undefined>(undefined);

  // Store callbacks in refs to avoid triggering useEffect re-runs
  const callbacksRef = useRef({
    onThreadUpdate,
    onStreamEvent,
    onError,
    onLog,
  });
  // Update refs on each render
  callbacksRef.current = {
    onThreadUpdate,
    onStreamEvent,
    onError,
    onLog,
  };

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

  // Resume streaming for a thread that was interrupted
  const resumeStreaming = useCallback(async (thread: Thread) => {
    // Prevent duplicate resume attempts for the same thread
    if (isResumingRef.current) {
      callbacksRef.current.onLog?.({ name: 'thread.resume.skip', data: { threadId: thread.id, reason: 'already_resuming' } });
      return;
    }

    // Check if we've already attempted to resume this specific thread
    if (resumedThreadIdRef.current === thread.id) {
      callbacksRef.current.onLog?.({ name: 'thread.resume.skip', data: { threadId: thread.id, reason: 'already_attempted' } });
      return;
    }

    isResumingRef.current = true;
    resumedThreadIdRef.current = thread.id;
    callbacksRef.current.onLog?.({ name: 'thread.resume.start', data: { threadId: thread.id } });

    try {
      const abortController = getAbortController(thread.id);
      const body = buildResumeStreamingPayload(thread.id);

      await streamChatKitEvents({
        url: api.url,
        headers: api.headers,
        body,
        initialThread: thread,
        signal: abortController.signal,
        onThreadUpdate: (updatedThread) => {
          setThread(updatedThread);
          threadCacheRef.current.set(updatedThread.id, updatedThread);
          callbacksRef.current.onThreadUpdate?.(updatedThread);
        },
        onEvent: (event) => {
          callbacksRef.current.onStreamEvent?.(event);
        },
        onError: (err) => {
          console.error('[ChatKit] Error resuming streaming:', err);
          callbacksRef.current.onError?.({ error: err });
        },
      });

      callbacksRef.current.onLog?.({ name: 'thread.resume.end', data: { threadId: thread.id } });
    } catch (err) {
      // Don't log abort errors as they are expected when navigating away
      if (err instanceof Error && err.name === 'AbortError') {
        callbacksRef.current.onLog?.({ name: 'thread.resume.aborted', data: { threadId: thread.id } });
      } else {
        console.error('[ChatKit] Failed to resume streaming:', err);
        callbacksRef.current.onError?.({ error: err instanceof Error ? err : new Error(String(err)) });
      }
    } finally {
      isResumingRef.current = false;
    }
  }, [api.url, api.headers, getAbortController, setThread, threadCacheRef]);

  // Store load callbacks in refs to avoid triggering useEffect re-runs
  const loadCallbacksRef = useRef({
    onThreadLoadStart,
    onThreadLoadEnd,
  });
  loadCallbacksRef.current = {
    onThreadLoadStart,
    onThreadLoadEnd,
  };

  // Load initial thread
  useEffect(() => {
    // Only reset resume tracking when thread actually changes
    if (prevInitialThreadRef.current !== initialThread) {
      resumedThreadIdRef.current = null;
      prevInitialThreadRef.current = initialThread;
    }

    if (initialThread) {
      loadCallbacksRef.current.onThreadLoadStart?.({ threadId: initialThread });
      callbacksRef.current.onLog?.({ name: 'thread.load.start', data: { threadId: initialThread } });

      // Check cache first for instant display
      const cachedThread = threadCacheRef.current.get(initialThread);

      if (cachedThread) {
        setThread(cachedThread);
        activeThreadIdRef.current = cachedThread.id;
        visibleThreadIdRef.current = cachedThread.id;
        loadCallbacksRef.current.onThreadLoadEnd?.({ threadId: initialThread });
        callbacksRef.current.onLog?.({ name: 'thread.load.end', data: { thread: cachedThread, source: 'cache' } });

        // Check if we need to resume streaming for cached thread
        if (isThreadStreaming(cachedThread)) {
          callbacksRef.current.onLog?.({ name: 'thread.resume.detected', data: { threadId: cachedThread.id, source: 'cache' } });
          resumeStreaming(cachedThread);
        }
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
            loadCallbacksRef.current.onThreadLoadEnd?.({ threadId: initialThread });
            callbacksRef.current.onLog?.({ name: 'thread.load.end', data: { thread: loadedThread, source: 'server' } });

            // Check if we need to resume streaming for the loaded thread
            if (isThreadStreaming(loadedThread)) {
              callbacksRef.current.onLog?.({ name: 'thread.resume.detected', data: { threadId: loadedThread.id, source: 'server' } });
              resumeStreaming(loadedThread);
            }
          })
          .catch((err) => {
            const errorMessage = err?.message || String(err);
            if (errorMessage.includes('404')) {
              console.warn('[ChatKit] Initial thread not found, starting with empty thread');
              const tempId = generateTempThreadId();
              activeThreadIdRef.current = tempId;
              visibleThreadIdRef.current = tempId;
              setThread(null);
              loadCallbacksRef.current.onThreadLoadEnd?.({ threadId: initialThread });
            } else {
              console.error('[ChatKit] Failed to load initial thread:', err);
              callbacksRef.current.onError?.({ error: err instanceof Error ? err : new Error(errorMessage) });
            }
          })
          .finally(() => {
            setThreadLoading(initialThread, false);
          });
      }
    }
  // Note: resumeStreaming is stable (only depends on api.url, api.headers, getAbortController, setThread, threadCacheRef)
  // Callbacks are accessed via refs to prevent unnecessary re-runs
  }, [initialThread, api.url, api.headers, setThreadLoading, generateTempThreadId, threadCacheRef, activeThreadIdRef, visibleThreadIdRef, setThread, resumeStreaming]);

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
      callbacksRef.current.onLog?.({ name: 'thread.refresh', data: { thread: updatedThread } });
    } catch (err) {
      console.error('[ChatKit] Failed to fetch updates:', err);
      const error = err instanceof Error ? err : new Error(String(err));
      callbacksRef.current.onError?.({ error });
    } finally {
      setThreadLoading(targetThreadId, false);
    }
  }, [api.url, api.headers, setThreadLoading, isTempThreadId, visibleThreadIdRef, activeThreadIdRef, threadCacheRef, setThread]);

  return {
    fetchUpdates,
  };
}
