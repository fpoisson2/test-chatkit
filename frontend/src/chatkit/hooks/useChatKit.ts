/**
 * Hook principal pour gérer le chat ChatKit
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatKitOptions, Thread, ThreadStreamEvent, ChatKitControl, UserMessageContent, Action, FeedbackKind } from '../types';
import {
  streamChatKitEvents,
  fetchThread,
  sendCustomAction,
  retryAfterItem as retryAfterItemAPI,
  submitFeedback as submitFeedbackAPI,
  updateThreadMetadata as updateThreadMetadataAPI,
} from '../api/streaming';

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

  const [thread, setThread] = useState<Thread | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Charger le thread initial
  useEffect(() => {
    if (initialThread) {
      onThreadLoadStart?.({ threadId: initialThread });
      onLog?.({ name: 'thread.load.start', data: { threadId: initialThread } });

      fetchThread({
        url: api.url,
        headers: api.headers,
        threadId: initialThread,
      })
        .then((loadedThread) => {
          setThread(loadedThread);
          onThreadLoadEnd?.({ threadId: initialThread });
          onLog?.({ name: 'thread.load.end', data: { thread: loadedThread } });
        })
        .catch((err) => {
          console.error('[ChatKit] Failed to load initial thread:', err);
          onError?.({ error: err });
        });
    }
  }, [initialThread, api.url, api.headers, onThreadLoadStart, onThreadLoadEnd, onError, onLog]);

  // Envoyer un message utilisateur
  const sendUserMessage = useCallback(
    async (content: UserMessageContent[] | string) => {
      // Annuler toute requête en cours
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      setIsLoading(true);
      setError(null);
      onResponseStart?.();

      try {
        const messageContent = typeof content === 'string'
          ? [{ type: 'input_text' as const, text: content }]
          : content;

        const payload = {
          thread_id: thread?.id || null,
          messages: [
            {
              role: 'user',
              content: messageContent,
            },
          ],
        };

        let updatedThread: Thread | null = null;

        await streamChatKitEvents({
          url: api.url,
          headers: api.headers,
          body: payload,
          signal: abortControllerRef.current.signal,
          onEvent: (event: ThreadStreamEvent) => {
            onLog?.({ name: `event.${event.type}`, data: { event } });
          },
          onThreadUpdate: (newThread: Thread) => {
            updatedThread = newThread;
            setThread(newThread);
            onLog?.({ name: 'thread.update', data: { thread: newThread } });

            // Notifier le changement de thread ID si nécessaire
            if (!thread || thread.id !== newThread.id) {
              onThreadChange?.({ threadId: newThread.id });
            }
          },
          onClientToolCall: onClientTool ? async (toolCall) => {
            // Adapter le format pour correspondre à l'API attendue
            return await onClientTool({
              name: toolCall.name,
              params: toolCall.arguments,
            });
          } : undefined,
          onError: (err: Error) => {
            setError(err);
            onError?.({ error: err });
          },
        });

        if (updatedThread) {
          setThread(updatedThread);
        }

        onResponseEnd?.();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        onError?.({ error });
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [thread, api.url, api.headers, onResponseStart, onResponseEnd, onThreadChange, onError, onLog]
  );

  // Récupérer les mises à jour du thread
  const fetchUpdates = useCallback(async () => {
    if (!thread?.id) {
      return;
    }

    try {
      const updatedThread = await fetchThread({
        url: api.url,
        headers: api.headers,
        threadId: thread.id,
      });

      setThread(updatedThread);
      onLog?.({ name: 'thread.refresh', data: { thread: updatedThread } });
    } catch (err) {
      console.error('[ChatKit] Failed to fetch updates:', err);
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.({ error });
    }
  }, [thread?.id, api.url, api.headers, onError, onLog]);

  // Action personnalisée
  const customAction = useCallback(
    async (itemId: string | null, action: Action) => {
      if (!thread) {
        console.warn('[ChatKit] Cannot send custom action: no thread available');
        return;
      }

      try {
        await sendCustomAction({
          url: api.url,
          headers: api.headers,
          threadId: thread.id,
          itemId,
          action,
        });
        onLog?.({ name: 'custom_action.sent', data: { itemId, action } });

        // Rafraîchir le thread après l'action
        await fetchUpdates();
      } catch (err) {
        console.error('[ChatKit] Failed to send custom action:', err);
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.({ error });
      }
    },
    [thread?.id, api.url, api.headers, fetchUpdates, onError, onLog]
  );

  // Réessayer après un item
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

        // Rafraîchir le thread après le retry
        await fetchUpdates();
      } catch (err) {
        console.error('[ChatKit] Failed to retry after item:', err);
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.({ error });
      }
    },
    [thread?.id, api.url, api.headers, fetchUpdates, onError, onLog]
  );

  // Soumettre un feedback
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

  // Mettre à jour les métadonnées du thread
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

        // Rafraîchir le thread pour obtenir les métadonnées à jour
        await fetchUpdates();
      } catch (err) {
        console.error('[ChatKit] Failed to update thread metadata:', err);
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.({ error });
      }
    },
    [thread?.id, api.url, api.headers, fetchUpdates, onError, onLog]
  );

  // Créer le control object
  const control: ChatKitControl = {
    thread,
    isLoading,
    error,
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
