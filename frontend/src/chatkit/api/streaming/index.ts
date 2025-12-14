/**
 * Module de streaming des événements ChatKit
 *
 * Ce module gère le streaming SSE depuis le backend et l'application
 * des événements delta pour maintenir l'état du thread synchronisé.
 */
import type {
  Thread,
  ThreadStreamEvent,
  ClientToolCallItem,
} from '../../types';
import { processSSEBuffer } from './sse';
import { applyDelta } from './deltas';
import { sendClientToolOutput } from './api';

// Re-export all modules
export * from './normalizers';
export * from './sse';
export * from './deltas';
export * from './api';

export interface StreamOptions {
  url: string;
  headers?: Record<string, string>;
  body: unknown;
  initialThread?: Thread | null;
  onEvent?: (event: ThreadStreamEvent) => void;
  onThreadUpdate?: (thread: Thread) => void;
  onError?: (error: Error) => void;
  onClientToolCall?: (toolCall: ClientToolCallItem) => Promise<unknown>;
  signal?: AbortSignal;
}

/**
 * Stream des événements depuis le backend
 */
export async function streamChatKitEvents(options: StreamOptions): Promise<Thread | null> {
  const {
    url,
    headers = {},
    body,
    initialThread,
    onEvent,
    onThreadUpdate,
    onError,
    onClientToolCall,
    signal,
  } = options;

  let currentThread: Thread | null = initialThread || null;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const contentType = response.headers.get('content-type') || '';

    // Si la réponse est du JSON (non-streaming), parser directement
    if (contentType.includes('application/json')) {
      try {
        const data = await response.json();
        const thread = data.thread || data;

        // Normaliser le thread
        currentThread = {
          ...thread,
          items: Array.isArray(thread.items) ? thread.items : [],
        };

        // Notifier de la création/mise à jour du thread
        onThreadUpdate?.(currentThread);

        return currentThread;
      } catch (err) {
        throw new Error(`Failed to parse JSON response: ${err}`);
      }
    }

    // Sinon, traiter comme du streaming (SSE)
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Traiter toutes les lignes complètes
      const { events, remainder } = processSSEBuffer(buffer);
      buffer = remainder;

      for (const event of events) {
        // Appliquer l'événement au thread
        if (currentThread || event.type === 'thread.created') {
          currentThread = applyDelta(currentThread || { id: '', items: [] }, event);
        }

        // Notifier les callbacks
        onEvent?.(event);

        if (onThreadUpdate && currentThread) {
          onThreadUpdate(currentThread);
        }

        // Gérer les client tool calls (support des deux formats)
        if (
          (event.type === 'thread.item.added' || event.type === 'thread.item.created') &&
          event.item.type === 'client_tool_call'
        ) {
          const toolCallItem = event.item as ClientToolCallItem;
          if (onClientToolCall && toolCallItem.status === 'pending') {
            try {
              const result = await onClientToolCall(toolCallItem);

              // Envoyer le résultat au backend
              await sendClientToolOutput({
                url,
                headers,
                threadId: toolCallItem.thread_id,
                result,
              });
            } catch (err) {
              onError?.(err instanceof Error ? err : new Error(String(err)));
            }
          }
        }

        // Gérer les erreurs
        if (event.type === 'error') {
          const errorMessage = event.message || 'Unknown error';
          const error = new Error(`[ChatKit] ${errorMessage}`);
          onError?.(error);
        }
      }
    }

    return currentThread;
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
