/**
 * Hook principal pour gérer le chat ChatKit
 * Ce hook orchestre les hooks spécialisés pour une séparation claire des responsabilités
 */
import { useMemo } from 'react';
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
  const {
    loadingByThread,
    setThreadLoading,
    isLoading: isLoadingFn,
    getLoadingThreadIds,
  } = useThreadLoading(getThreadKey);

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
  const { error, sendUserMessage } = useMessageStreaming({
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

  // Create control object
  const control: ChatKitControl = {
    thread,
    isLoading,
    error,
    loadingThreadIds,
    sendMessage: sendUserMessage,
    refresh: fetchUpdates,
    customAction,
    retryAfterItem,
    submitFeedback,
    updateThreadMetadata,
  };

  return {
    control,
    fetchUpdates,
    sendUserMessage,
  };
}
