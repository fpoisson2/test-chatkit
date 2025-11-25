/**
 * Hook pour les actions sur le thread (custom action, retry, feedback, metadata)
 */
import { useCallback } from 'react';
import type { Thread, ChatKitAPIConfig, Action, FeedbackKind } from '../types';
import {
  streamChatKitEvents,
  retryAfterItem as retryAfterItemAPI,
  submitFeedback as submitFeedbackAPI,
  updateThreadMetadata as updateThreadMetadataAPI,
} from '../api/streaming/index';

export interface UseThreadActionsOptions {
  api: ChatKitAPIConfig;
  thread: Thread | null;
  threadCacheRef: React.MutableRefObject<Map<string, Thread>>;
  setThread: React.Dispatch<React.SetStateAction<Thread | null>>;
  fetchUpdates: () => Promise<void>;
  onThreadChange?: (event: { threadId?: string | null; thread?: Thread }) => void;
  onError?: (error: { error: Error }) => void;
  onLog?: (entry: { name: string; data?: Record<string, unknown> }) => void;
}

export interface UseThreadActionsReturn {
  customAction: (itemId: string | null, action: Action) => Promise<void>;
  retryAfterItem: (itemId: string) => Promise<void>;
  submitFeedback: (itemIds: string[], kind: FeedbackKind) => Promise<void>;
  updateThreadMetadata: (metadata: Record<string, unknown>) => Promise<void>;
}

export function useThreadActions(options: UseThreadActionsOptions): UseThreadActionsReturn {
  const {
    api,
    thread,
    threadCacheRef,
    setThread,
    fetchUpdates,
    onThreadChange,
    onError,
    onLog,
  } = options;

  const customAction = useCallback(
    async (itemId: string | null, action: Action) => {
      if (!thread) {
        console.warn('[ChatKit] Cannot send custom action: no thread available');
        return;
      }

      try {
        const backendAction = {
          type: action.type,
          payload: (action as any).data,
        };

        const updatedThread = await streamChatKitEvents({
          url: api.url,
          headers: api.headers,
          body: {
            type: 'threads.custom_action',
            params: {
              thread_id: thread.id,
              item_id: itemId,
              action: backendAction,
            },
          },
          initialThread: thread,
          onEvent: (event) => {
            onLog?.({ name: 'custom_action.event', data: { event } });
          },
          onThreadUpdate: (updated) => {
            setThread(updated);
            threadCacheRef.current.set(updated.id, updated);
            onThreadChange?.({ thread: updated });
          },
          onError: (err) => {
            console.error('[ChatKit] Custom action stream error:', err);
            onError?.({ error: err });
          },
        });

        onLog?.({ name: 'custom_action.sent', data: { itemId, action } });

        if (updatedThread) {
          setThread(updatedThread);
          threadCacheRef.current.set(updatedThread.id, updatedThread);
        }
      } catch (err) {
        console.error('[ChatKit] Failed to send custom action:', err);
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.({ error });
      }
    },
    [thread, api.url, api.headers, onError, onLog, onThreadChange, threadCacheRef, setThread]
  );

  const retryAfterItem = useCallback(
    async (itemId: string) => {
      if (!thread) {
        console.warn('[ChatKit] Cannot retry: no thread available');
        return;
      }

      try {
        await retryAfterItemAPI({
          url: api.url,
          headers: api.headers,
          threadId: thread.id,
          itemId,
        });
        onLog?.({ name: 'retry_after_item.sent', data: { itemId } });

        await fetchUpdates();
      } catch (err) {
        console.error('[ChatKit] Failed to retry after item:', err);
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.({ error });
      }
    },
    [thread?.id, api.url, api.headers, fetchUpdates, onError, onLog]
  );

  const submitFeedback = useCallback(
    async (itemIds: string[], kind: FeedbackKind) => {
      if (!thread) {
        console.warn('[ChatKit] Cannot submit feedback: no thread available');
        return;
      }

      try {
        await submitFeedbackAPI({
          url: api.url,
          headers: api.headers,
          threadId: thread.id,
          itemIds,
          kind,
        });
        onLog?.({ name: 'feedback.submitted', data: { itemIds, kind } });
      } catch (err) {
        console.error('[ChatKit] Failed to submit feedback:', err);
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.({ error });
      }
    },
    [thread?.id, api.url, api.headers, onError, onLog]
  );

  const updateThreadMetadata = useCallback(
    async (metadata: Record<string, unknown>) => {
      if (!thread) {
        console.warn('[ChatKit] Cannot update metadata: no thread available');
        return;
      }

      try {
        await updateThreadMetadataAPI({
          url: api.url,
          headers: api.headers,
          threadId: thread.id,
          metadata,
        });
        onLog?.({ name: 'thread.metadata.updated', data: { metadata } });

        await fetchUpdates();
      } catch (err) {
        console.error('[ChatKit] Failed to update thread metadata:', err);
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.({ error });
      }
    },
    [thread?.id, api.url, api.headers, fetchUpdates, onError, onLog]
  );

  return {
    customAction,
    retryAfterItem,
    submitFeedback,
    updateThreadMetadata,
  };
}
