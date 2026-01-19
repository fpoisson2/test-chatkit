/**
 * Hook principal pour gérer le chat ChatKit
 * Ce hook orchestre les hooks spécialisés pour une séparation claire des responsabilités
 */
import { useMemo, useEffect, useRef, useCallback, useState } from 'react';
import type { ChatKitOptions, ChatKitControl, UserMessageContent } from '../types';
import { useThreadState } from './useThreadState';
import { useThreadLoading } from './useThreadLoading';
import { useAbortControllers } from './useAbortControllers';
import { useThreadLoader } from './useThreadLoader';
import { useMessageStreaming } from './useMessageStreaming';
import { useThreadActions } from './useThreadActions';
import { loadOlderItems as loadOlderItemsApi } from '../api/streaming/api';

export interface UseChatKitReturn {
  control: ChatKitControl;
  fetchUpdates: () => Promise<void>;
  sendUserMessage: (content: UserMessageContent[] | string) => Promise<void>;
  resumeStream: (threadId: string) => Promise<void>;
}

export function useChatKit(options: ChatKitOptions): UseChatKitReturn {
  const {
    api,
    initialThread,
    onError,
    onResponseStart,
    onResponseEnd,
    onThreadChange,
    onThreadLoadStart,
    onThreadLoadEnd,
    onThreadNotFound,
    onLog,
    onClientTool,
  } = options;

  // Thread state management
  const {
    thread,
    setThread,
    activeThreadIdRef,
    visibleThreadIdRef,
    threadCacheRef,
    getThreadKey,
    generateTempThreadId,
    isTempThreadId,
  } = useThreadState(initialThread);

  // Loading state management
  // Pass initialThread to initialize loading state synchronously on mount
  const {
    loadingByThread,
    setThreadLoading,
    isLoading: isLoadingFn,
    getLoadingThreadIds,
  } = useThreadLoading(getThreadKey, initialThread);

  // Abort controllers management
  const { abortControllersRef } = useAbortControllers();


  // Thread loading and refresh
  const { fetchUpdates } = useThreadLoader({
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
    onThreadNotFound,
    onError,
    onLog,
  });

  // Message streaming
  const { error, setError, sendUserMessage, resumeStream } = useMessageStreaming({
    api,
    thread,
    threadCacheRef,
    activeThreadIdRef,
    visibleThreadIdRef,
    abortControllersRef,
    setThread,
    setThreadLoading,
    getThreadKey,
    isTempThreadId,
    onResponseStart,
    onResponseEnd,
    onThreadChange,
    onError,
    onLog,
    onClientTool,
  });

  // Auto-resume stream when an active thread is loaded
  const resumedThreadsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const threadId = thread?.id;
    const status = thread?.status?.type;
    const isTemp = isTempThreadId(threadId);

    if (
      threadId &&
      !isTemp &&
      status === 'active' &&
      !resumedThreadsRef.current.has(threadId)
    ) {
      resumedThreadsRef.current.add(threadId);
      resumeStream(threadId).catch(() => {
        // Error ignored
      });
    }
  }, [thread, isTempThreadId, resumeStream]);

  // Thread actions
  const {
    customAction,
    retryAfterItem,
    submitFeedback,
    updateThreadMetadata,
  } = useThreadActions({
    api,
    thread,
    threadCacheRef,
    setThread,
    fetchUpdates,
    onThreadChange,
    onError,
    onLog,
  });

  // Computed loading state
  const currentThreadId = thread?.id ?? activeThreadIdRef.current;
  const isLoading = useMemo(
    () => isLoadingFn(currentThreadId, getThreadKey),
    [currentThreadId, getThreadKey, isLoadingFn, loadingByThread]
  );

  const loadingThreadIds = useMemo(
    () => getLoadingThreadIds(),
    [getLoadingThreadIds, loadingByThread]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, [setError]);

  // State for loading older items
  const [isLoadingOlderItems, setIsLoadingOlderItems] = useState(false);

  // Load older items function
  const loadOlderItems = useCallback(async () => {
    if (!thread?.id || !thread.pagination_cursor || isLoadingOlderItems) {
      return;
    }

    setIsLoadingOlderItems(true);
    try {
      const result = await loadOlderItemsApi({
        url: api.url,
        headers: api.headers,
        threadId: thread.id,
        cursor: thread.pagination_cursor,
        limit: 50,
      });

      // Prepend older items to the beginning of the list
      setThread((prevThread) => {
        if (!prevThread) return null;
        return {
          ...prevThread,
          items: [...result.items, ...prevThread.items],
          has_more_items: result.has_more,
          pagination_cursor: result.cursor,
        };
      });

      // Update cache
      const updatedThread = threadCacheRef.current.get(thread.id);
      if (updatedThread) {
        threadCacheRef.current.set(thread.id, {
          ...updatedThread,
          items: [...result.items, ...updatedThread.items],
          has_more_items: result.has_more,
          pagination_cursor: result.cursor,
        });
      }

      onLog?.({ name: 'thread.load_older_items', data: { count: result.items.length, has_more: result.has_more } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.({ error });
    } finally {
      setIsLoadingOlderItems(false);
    }
  }, [thread?.id, thread?.pagination_cursor, isLoadingOlderItems, api.url, api.headers, setThread, threadCacheRef, onLog, onError]);

  // Computed hasMoreItems
  const hasMoreItems = thread?.has_more_items ?? false;

  // Create control object
  const control: ChatKitControl = {
    thread,
    isLoading,
    error,
    loadingThreadIds,
    sendMessage: sendUserMessage,
    resumeStream,
    refresh: fetchUpdates,
    customAction,
    retryAfterItem,
    submitFeedback,
    updateThreadMetadata,
    clearError,
    hasMoreItems,
    isLoadingOlderItems,
    loadOlderItems,
  };

  return {
    control,
    fetchUpdates,
    sendUserMessage,
    resumeStream,
  };
}
