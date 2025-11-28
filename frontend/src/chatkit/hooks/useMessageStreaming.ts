/**
 * Hook pour envoyer des messages avec streaming
 */
import { useState, useCallback } from 'react';
import type { Thread, ChatKitAPIConfig, UserMessageContent, ThreadStreamEvent, InferenceOptions } from '../types';
import { streamChatKitEvents } from '../api/streaming/index';

export interface UseMessageStreamingOptions {
  api: ChatKitAPIConfig;
  thread: Thread | null;
  threadCacheRef: React.MutableRefObject<Map<string, Thread>>;
  activeThreadIdRef: React.MutableRefObject<string | null>;
  visibleThreadIdRef: React.MutableRefObject<string | null>;
  abortControllersRef: React.MutableRefObject<Map<string, AbortController>>;
  setThread: React.Dispatch<React.SetStateAction<Thread | null>>;
  setThreadLoading: (threadId: string | null | undefined, value: boolean) => void;
  getThreadKey: (threadId: string | null | undefined) => string;
  isTempThreadId: (threadId: string | null | undefined) => boolean;
  onResponseStart?: (event: { threadId: string | null }) => void;
  onResponseEnd?: (event: { threadId: string | null; finalThreadId: string | null }) => void;
  onThreadChange?: (event: { threadId: string | null }) => void;
  onError?: (error: { error: Error }) => void;
  onLog?: (entry: { name: string; data?: Record<string, unknown> }) => void;
  onClientTool?: (toolCall: { name: string; params: unknown }) => Promise<unknown>;
}

export interface UseMessageStreamingReturn {
  error: Error | null;
  sendUserMessage: (content: UserMessageContent[] | string, options?: { inferenceOptions?: InferenceOptions }) => Promise<void>;
}

export function useMessageStreaming(options: UseMessageStreamingOptions): UseMessageStreamingReturn {
  const {
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
  } = options;

  const [error, setError] = useState<Error | null>(null);

  const sendUserMessage = useCallback(
    async (content: UserMessageContent[] | string, opts?: { inferenceOptions?: InferenceOptions }) => {
      const targetThreadId = activeThreadIdRef.current ?? thread?.id ?? null;
      const threadKey = getThreadKey(targetThreadId);
      const existingController = abortControllersRef.current.get(threadKey);
      const initialThreadForStream =
        targetThreadId && !isTempThreadId(targetThreadId)
          ? threadCacheRef.current.get(targetThreadId) ?? null
          : null;

      if (existingController) {
        existingController.abort();
      }

      const controller = new AbortController();
      abortControllersRef.current.set(threadKey, controller);

      setThreadLoading(targetThreadId, true);
      setError(null);
      onResponseStart?.({ threadId: targetThreadId });

      let updatedThread: Thread | null = null;

      try {
        const messageContent = typeof content === 'string'
          ? [{ type: 'input_text' as const, text: content }]
          : content;

        // Extract attachment IDs from content items of type 'image' or 'file'
        // and filter content to only include valid message content types
        const attachmentIds: string[] = [];
        const filteredContent = messageContent.filter((item) => {
          if (item.type === 'image' && 'image' in item) {
            attachmentIds.push(item.image);
            return false;
          }
          if (item.type === 'file' && 'file' in item) {
            attachmentIds.push(item.file);
            return false;
          }
          return true;
        });

        const input = {
          content: filteredContent,
          attachments: attachmentIds,
          quoted_text: null,
          inference_options: opts?.inferenceOptions || {},
        };

        const isRealThread = targetThreadId && !isTempThreadId(targetThreadId);
        const payload = isRealThread
          ? {
              type: 'threads.add_user_message',
              params: {
                thread_id: targetThreadId,
                input,
              },
            }
          : {
              type: 'threads.create',
              params: {
                input,
              },
            };

        const streamThreadKeyRef = { current: threadKey };

        await streamChatKitEvents({
          url: api.url,
          headers: api.headers,
          body: payload,
          initialThread: initialThreadForStream,
          signal: controller.signal,
          onEvent: (event: ThreadStreamEvent) => {
            onLog?.({ name: `event.${event.type}`, data: { event } });
          },
          onThreadUpdate: (newThread: Thread) => {
            updatedThread = newThread;
            threadCacheRef.current.set(newThread.id, newThread);

            const visibleKey = getThreadKey(visibleThreadIdRef.current);
            const shouldUpdateThreadState = streamThreadKeyRef.current === visibleKey;

            if (threadKey !== getThreadKey(newThread.id)) {
              abortControllersRef.current.delete(threadKey);
              abortControllersRef.current.set(getThreadKey(newThread.id), controller);
              setThreadLoading(targetThreadId, false);
              setThreadLoading(newThread.id, true);
              streamThreadKeyRef.current = getThreadKey(newThread.id);
            }

            if (shouldUpdateThreadState) {
              setThread(newThread);
              activeThreadIdRef.current = newThread.id;
              visibleThreadIdRef.current = newThread.id;
              if (!thread || thread.id !== newThread.id) {
                onThreadChange?.({ threadId: newThread.id });
              }
            }
            onLog?.({ name: 'thread.update', data: { thread: newThread } });
          },
          onClientToolCall: onClientTool
            ? async (toolCall) => {
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
          const visibleKey = getThreadKey(visibleThreadIdRef.current);
          const streamKey = streamThreadKeyRef.current;

          if (visibleKey === streamKey) {
            setThread(updatedThread);
          }
        }

        onResponseEnd?.({ threadId: targetThreadId, finalThreadId: updatedThread?.id ?? targetThreadId });
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        onError?.({ error: e });
      } finally {
        setThreadLoading(targetThreadId, false);
        if (updatedThread?.id && updatedThread.id !== targetThreadId) {
          setThreadLoading(updatedThread.id, false);
        }
        abortControllersRef.current.delete(getThreadKey(targetThreadId));
        if (updatedThread?.id) {
          abortControllersRef.current.delete(getThreadKey(updatedThread.id));
        }
      }
    },
    [thread, api.url, api.headers, onResponseStart, onResponseEnd, onThreadChange, onError, onLog, onClientTool, getThreadKey, setThreadLoading, isTempThreadId, activeThreadIdRef, visibleThreadIdRef, threadCacheRef, abortControllersRef, setThread]
  );

  return {
    error,
    sendUserMessage,
  };
}
