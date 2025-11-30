/**
 * Hook principal pour gérer le chat ChatKit
 * Ce hook orchestre les hooks spécialisés pour une séparation claire des responsabilités
 */
import { useMemo, useEffect, useRef, useCallback } from 'react';
import type { ChatKitOptions, ChatKitControl, UserMessageContent } from '../types';
import { useThreadState } from './useThreadState';
import { useThreadLoading } from './useThreadLoading';
import { useAbortControllers } from './useAbortControllers';
import { useThreadLoader } from './useThreadLoader';
import { useMessageStreaming } from './useMessageStreaming';
import { useThreadActions } from './useThreadActions';

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
      resumeStream(threadId).catch((err) => {
        console.error('[ChatKit] Failed to auto-resume stream:', err);
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
  };

  return {
    control,
    fetchUpdates,
    sendUserMessage,
    resumeStream,
  };
}
