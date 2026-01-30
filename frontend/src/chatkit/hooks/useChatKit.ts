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
import { useBranches } from './useBranches';
import { loadOlderItems as loadOlderItemsApi } from '../api/streaming/api';
import { MAIN_BRANCH_ID } from '../types';

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
    initialBranchId,
    onError,
    onResponseStart,
    onResponseEnd,
    onThreadChange,
    onThreadLoadStart,
    onThreadLoadEnd,
    onThreadNotFound,
    onLog,
    onClientTool,
    onBranchChange,
  } = options;

  // Track current branch id for API calls that need it
  const branchIdRef = useRef<string | null>(null);

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
  } = useThreadState(initialThread, { keySuffixRef: branchIdRef });

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
  });

  // Message streaming
  const { error, setError, sendUserMessage, resumeStream } = useMessageStreaming({
    api,
    thread,
    branchIdRef,
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
    getThreadKey,
    setThread,
    fetchUpdates,
    onThreadChange,
    onError,
    onLog,
  });

  // Branch management
  const {
    branches,
    currentBranchId,
    isBranchesLoaded,
    maxBranches,
    canCreateBranch,
    isLoadingBranches,
    createBranch,
    switchBranch,
    reloadBranches,
  } = useBranches({
    api,
    threadId: thread?.id,
    onError,
    onLog,
    onBranchChange: useCallback((branchId: string) => {
      branchIdRef.current = branchId;
      onBranchChange?.({ branchId });
      // Reload thread items when branch changes
      fetchUpdates();
    }, [fetchUpdates, onBranchChange]),
  });

  useEffect(() => {
    branchIdRef.current = isBranchesLoaded ? (currentBranchId || null) : null;
  }, [currentBranchId, isBranchesLoaded]);

  // Apply initial branch from URL/state once branches are loaded
  const appliedInitialBranchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialBranchId || !isBranchesLoaded) return;
    if (appliedInitialBranchRef.current === initialBranchId) return;
    if (currentBranchId === initialBranchId) {
      appliedInitialBranchRef.current = initialBranchId;
      return;
    }
    appliedInitialBranchRef.current = initialBranchId;
    switchBranch(initialBranchId);
  }, [initialBranchId, isBranchesLoaded, currentBranchId, switchBranch]);

  // Edit message by creating a new branch
  const editMessage = useCallback(async (
    itemId: string,
    newContent: string,
    branchName?: string
  ) => {
    console.log('[useChatKit.editMessage] Called with:', { itemId, newContent, branchName, threadId: thread?.id });

    if (!thread?.id) {
      console.warn('[useChatKit.editMessage] No thread ID, returning early');
      return;
    }

    // Find the item to get the fork point (the item before this one)
    const items = thread.items || [];
    const itemIndex = items.findIndex(item => item.id === itemId);
    console.log('[useChatKit.editMessage] Item search:', { itemIndex, totalItems: items.length });

    if (itemIndex < 0) {
      console.error('[useChatKit.editMessage] Message not found');
      onError?.({ error: new Error('Message not found') });
      return;
    }

    // The fork point is the item before the one being edited
    // If it's the first item, we fork from the start
    const forkAfterItemId = itemIndex > 0 ? items[itemIndex - 1].id : null;
    console.log('[useChatKit.editMessage] Fork point:', { forkAfterItemId, itemIndex });

    if (!forkAfterItemId) {
      console.error('[useChatKit.editMessage] Cannot edit the first message');
      onError?.({ error: new Error('Cannot edit the first message') });
      return;
    }

    // Create the branch
    console.log('[useChatKit.editMessage] Creating branch...');
    const branch = await createBranch(forkAfterItemId, branchName);
    console.log('[useChatKit.editMessage] Branch result:', branch);

    if (!branch) {
      console.error('[useChatKit.editMessage] Branch creation failed');
      return; // Error already handled by createBranch
    }

    // Reload to get the updated items for the new branch
    console.log('[useChatKit.editMessage] Fetching updates...');
    await fetchUpdates();

    // Send the edited message as a new message in the branch
    console.log('[useChatKit.editMessage] Sending new message...');
    await sendUserMessage(newContent);
    console.log('[useChatKit.editMessage] Done!');
  }, [thread?.id, thread?.items, createBranch, fetchUpdates, sendUserMessage, onError]);

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
      const updatedThread = threadCacheRef.current.get(getThreadKey(thread.id));
      if (updatedThread) {
        threadCacheRef.current.set(getThreadKey(thread.id), {
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
  }, [thread?.id, thread?.pagination_cursor, isLoadingOlderItems, api.url, api.headers, setThread, threadCacheRef, onLog, onError, getThreadKey]);

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
    // Branch management
    branches,
    currentBranchId,
    maxBranches,
    canCreateBranch,
    isLoadingBranches,
    createBranch,
    switchBranch,
    editMessage,
  };

  return {
    control,
    fetchUpdates,
    sendUserMessage,
    resumeStream,
  };
}
