/**
 * Hook principal pour gérer le chat ChatKit
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
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
  const [loadingByThread, setLoadingByThread] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<Error | null>(null);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const activeThreadIdRef = useRef<string | null>(initialThread || null);

  const getThreadKey = useCallback((threadId: string | null | undefined) => threadId ?? '__new_thread__', []);

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

  // Réinitialiser le thread si initialThread devient null
  useEffect(() => {
    if (initialThread === null) {
      setThread(null);
      activeThreadIdRef.current = null;
      abortControllersRef.current.forEach((controller) => controller.abort());
      abortControllersRef.current.clear();
      setLoadingByThread({});
    } else if (initialThread) {
      activeThreadIdRef.current = initialThread;
    }
  }, [initialThread]);

  // Charger le thread initial
  useEffect(() => {
    if (initialThread) {
      onThreadLoadStart?.({ threadId: initialThread });
      onLog?.({ name: 'thread.load.start', data: { threadId: initialThread } });

      setThreadLoading(initialThread, true);

      fetchThread({
        url: api.url,
        headers: api.headers,
        threadId: initialThread,
      })
        .then((loadedThread) => {
          setThread(loadedThread);
          activeThreadIdRef.current = loadedThread.id;
          setThreadLoading(loadedThread.id, false);
          onThreadLoadEnd?.({ threadId: initialThread });
          onLog?.({ name: 'thread.load.end', data: { thread: loadedThread } });
        })
        .catch((err) => {
          // Si le thread n'existe pas (404), on l'ignore et on démarre avec thread=null
          const errorMessage = err?.message || String(err);
          if (errorMessage.includes('404')) {
            console.warn('[ChatKit] Initial thread not found, starting with empty thread');
            onThreadLoadEnd?.({ threadId: initialThread });
          } else {
            console.error('[ChatKit] Failed to load initial thread:', err);
            onError?.({ error: err instanceof Error ? err : new Error(errorMessage) });
          }
        })
        .finally(() => {
          setThreadLoading(initialThread, false);
        });
    }
  }, [initialThread, api.url, api.headers, onThreadLoadStart, onThreadLoadEnd, onError, onLog, setThreadLoading]);

  // Envoyer un message utilisateur
  const sendUserMessage = useCallback(
    async (content: UserMessageContent[] | string, options?: { inferenceOptions?: any }) => {
      const targetThreadId = thread?.id ?? activeThreadIdRef.current;
      const threadKey = getThreadKey(targetThreadId);
      const existingController = abortControllersRef.current.get(threadKey);

      if (existingController) {
        existingController.abort();
      }

      const controller = new AbortController();
      abortControllersRef.current.set(threadKey, controller);

      setThreadLoading(targetThreadId, true);
      setError(null);
      onResponseStart?.();

      try {
        const messageContent = typeof content === 'string'
          ? [{ type: 'input_text' as const, text: content }]
          : content;

        const input = {
          content: messageContent,
          attachments: [],
          quoted_text: null,
          inference_options: options?.inferenceOptions || {},
        };

          // Si un thread existe, ajouter un message. Sinon, créer un nouveau thread
          const payload = thread?.id
            ? {
                type: 'threads.add_user_message',
                params: {
                  thread_id: thread.id,
                  input,
                },
              }
            : {
                type: 'threads.create',
                params: {
                  input,
                },
              };

          console.log('[ChatKit] Sending message with payload:', payload);

          let updatedThread: Thread | null = null;

          await streamChatKitEvents({
            url: api.url,
            headers: api.headers,
            body: payload,
            initialThread: thread,
            signal: controller.signal,
            onEvent: (event: ThreadStreamEvent) => {
              onLog?.({ name: `event.${event.type}`, data: { event } });
            },
            onThreadUpdate: (newThread: Thread) => {
              console.log('[ChatKit] Thread updated:', newThread);
              updatedThread = newThread;
              setThread(newThread);
              activeThreadIdRef.current = newThread.id;
              if (threadKey !== getThreadKey(newThread.id)) {
                abortControllersRef.current.delete(threadKey);
                abortControllersRef.current.set(getThreadKey(newThread.id), controller);
                setThreadLoading(targetThreadId, false);
                setThreadLoading(newThread.id, true);
              }
              onLog?.({ name: 'thread.update', data: { thread: newThread } });

              // Notifier le changement de thread ID si nécessaire
              if (!thread || thread.id !== newThread.id) {
                onThreadChange?.({ threadId: newThread.id });
              }
            },
            onClientToolCall: onClientTool
              ? async (toolCall) => {
                  // Adapter le format pour correspondre à l'API attendue
                  return await onClientTool({
                    name: toolCall.name,
                    params: toolCall.arguments,
                  });
                }
              : undefined,
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
        const latestThreadId = activeThreadIdRef.current ?? thread?.id ?? targetThreadId;
        setThreadLoading(latestThreadId, false);
        abortControllersRef.current.delete(getThreadKey(latestThreadId));
      }
    },
    [thread, api.url, api.headers, onResponseStart, onResponseEnd, onThreadChange, onError, onLog, onClientTool, getThreadKey, setThreadLoading]
  );

  // Récupérer les mises à jour du thread
  const fetchUpdates = useCallback(async () => {
    const targetThreadId = thread?.id ?? activeThreadIdRef.current;

    if (!targetThreadId) {
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
      activeThreadIdRef.current = updatedThread.id;
      setThreadLoading(updatedThread.id, false);
      onLog?.({ name: 'thread.refresh', data: { thread: updatedThread } });
    } catch (err) {
      console.error('[ChatKit] Failed to fetch updates:', err);
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.({ error });
    } finally {
      setThreadLoading(targetThreadId, false);
    }
  }, [thread?.id, api.url, api.headers, onError, onLog, setThreadLoading]);

  useEffect(() => {
    return () => {
      abortControllersRef.current.forEach((controller) => controller.abort());
      abortControllersRef.current.clear();
    };
  }, []);

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

  const currentThreadId = thread?.id ?? activeThreadIdRef.current;
  const isLoading = useMemo(
    () => loadingByThread[getThreadKey(currentThreadId)] ?? false,
    [currentThreadId, getThreadKey, loadingByThread],
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
