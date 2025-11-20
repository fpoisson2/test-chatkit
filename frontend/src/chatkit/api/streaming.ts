/**
 * Gestion du streaming des événements ChatKit
 */
import type {
  Thread,
  ThreadStreamEvent,
  ThreadItem,
  AssistantMessageItem,
  ClientToolCallItem,
  ThreadListResponse,
  ItemListResponse,
} from '../types';

export interface StreamOptions {
  url: string;
  headers?: Record<string, string>;
  body: unknown;
  onEvent?: (event: ThreadStreamEvent) => void;
  onThreadUpdate?: (thread: Thread) => void;
  onError?: (error: Error) => void;
  onClientToolCall?: (toolCall: ClientToolCallItem) => Promise<unknown>;
  signal?: AbortSignal;
}

/**
 * Parse une ligne d'événement server-sent events
 */
function parseSSELine(line: string): ThreadStreamEvent | null {
  // Format: data: {json}
  if (!line.startsWith('data: ')) {
    return null;
  }

  const jsonStr = line.slice(6); // Enlever "data: "

  if (jsonStr === '[DONE]') {
    return null;
  }

  try {
    return JSON.parse(jsonStr) as ThreadStreamEvent;
  } catch (error) {
    console.warn('[ChatKit] Failed to parse SSE line:', line, error);
    return null;
  }
}

/**
 * Applique un événement delta à un thread
 */
function applyDelta(thread: Thread, event: ThreadStreamEvent): Thread {
  if (event.type === 'thread.created') {
    return event.thread;
  }

  if (event.type === 'thread.item.created') {
    const exists = thread.items.find((item) => item.id === event.item.id);
    if (exists) {
      return thread;
    }

    return {
      ...thread,
      items: [...thread.items, event.item],
    };
  }

  if (event.type === 'thread.item.delta') {
    const { item_id, content_index, type, text, widget } = event.delta;

    const items = thread.items.map((item) => {
      if (item.id !== item_id) {
        return item;
      }

      // Mise à jour du contenu
      const newContent = [...(item as AssistantMessageItem).content];

      // S'assurer que l'index existe
      while (newContent.length <= content_index) {
        newContent.push({
          type: type as 'text',
          text: '',
        } as any);
      }

      if (type === 'text' && text !== undefined) {
        const existing = newContent[content_index];
        if (existing.type === 'text') {
          newContent[content_index] = {
            ...existing,
            text: (existing.text || '') + text,
          };
        }
      } else if (type === 'widget' && widget !== undefined) {
        const existing = newContent[content_index];
        if (existing && existing.type === 'widget') {
          // Merge du widget
          newContent[content_index] = {
            ...existing,
            widget: {
              ...existing.widget,
              ...widget,
            },
          };
        } else {
          newContent[content_index] = {
            type: 'widget',
            widget: widget as any,
          };
        }
      }

      return {
        ...item,
        content: newContent,
      };
    });

    return {
      ...thread,
      items,
    };
  }

  if (event.type === 'thread.item.completed') {
    const items = thread.items.map((item) => {
      if (item.id === event.item.id) {
        return event.item;
      }
      return item;
    });

    return {
      ...thread,
      items,
    };
  }

  // Gestion des événements workflow
  if (event.type === 'workflow.task.added') {
    const items = thread.items.map((item) => {
      if (item.id === event.item_id && item.type === 'workflow') {
        const workflow = { ...item.workflow };
        const tasks = [...workflow.tasks];
        tasks.splice(event.task_index, 0, event.task);
        return {
          ...item,
          workflow: {
            ...workflow,
            tasks,
          },
        };
      }
      return item;
    });

    return {
      ...thread,
      items,
    };
  }

  if (event.type === 'workflow.task.updated') {
    const items = thread.items.map((item) => {
      if (item.id === event.item_id && item.type === 'workflow') {
        const workflow = { ...item.workflow };
        const tasks = [...workflow.tasks];
        tasks[event.task_index] = event.task;
        return {
          ...item,
          workflow: {
            ...workflow,
            tasks,
          },
        };
      }
      return item;
    });

    return {
      ...thread,
      items,
    };
  }

  // Gestion des événements widget
  if (event.type === 'widget.root.updated') {
    const items = thread.items.map((item) => {
      if (item.id === event.item_id && item.type === 'widget') {
        return {
          ...item,
          widget: event.widget,
        };
      }
      return item;
    });

    return {
      ...thread,
      items,
    };
  }

  if (event.type === 'widget.component.updated') {
    const items = thread.items.map((item) => {
      if (item.id === event.item_id && item.type === 'widget') {
        // Fonction récursive pour mettre à jour un composant par son ID
        const updateComponent = (components: any[]): any[] => {
          return components.map((comp) => {
            if (comp.id === event.component_id) {
              return { ...comp, ...event.component };
            }
            if (comp.children) {
              return { ...comp, children: updateComponent(comp.children) };
            }
            return comp;
          });
        };

        const updatedWidget = { ...item.widget };
        if (updatedWidget.children) {
          updatedWidget.children = updateComponent(updatedWidget.children);
        }

        return {
          ...item,
          widget: updatedWidget,
        };
      }
      return item;
    });

    return {
      ...thread,
      items,
    };
  }

  if (event.type === 'widget.streaming_text.value_delta') {
    const items = thread.items.map((item) => {
      if (item.id === event.item_id && item.type === 'widget') {
        // Fonction récursive pour ajouter du texte à un composant par son ID
        const updateComponentText = (components: any[]): any[] => {
          return components.map((comp) => {
            if (comp.id === event.component_id) {
              return {
                ...comp,
                value: (comp.value || '') + event.delta,
              };
            }
            if (comp.children) {
              return { ...comp, children: updateComponentText(comp.children) };
            }
            return comp;
          });
        };

        const updatedWidget = { ...item.widget };
        if (updatedWidget.children) {
          updatedWidget.children = updateComponentText(updatedWidget.children);
        }

        return {
          ...item,
          widget: updatedWidget,
        };
      }
      return item;
    });

    return {
      ...thread,
      items,
    };
  }

  return thread;
}

/**
 * Stream des événements depuis le backend
 */
export async function streamChatKitEvents(options: StreamOptions): Promise<Thread | null> {
  const { url, headers = {}, body, onEvent, onThreadUpdate, onError, onClientToolCall, signal } = options;

  let currentThread: Thread | null = null;

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

      buffer += decoder.decode(value, { stream: true });

      // Traiter toutes les lignes complètes
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Garder la dernière ligne incomplète

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        const event = parseSSELine(trimmed);
        if (!event) {
          continue;
        }

        // Appliquer l'événement au thread
        if (currentThread || event.type === 'thread.created') {
          currentThread = applyDelta(currentThread || { id: '', items: [] }, event);
        }

        // Notifier les callbacks
        if (onEvent) {
          onEvent(event);
        }

        if (onThreadUpdate && currentThread) {
          onThreadUpdate(currentThread);
        }

        // Gérer les client tool calls
        if (event.type === 'thread.item.created' && event.item.type === 'client_tool_call') {
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
              console.error('[ChatKit] Client tool call failed:', err);
              if (onError) {
                onError(err instanceof Error ? err : new Error(String(err)));
              }
            }
          }
        }

        // Gérer les erreurs
        if (event.type === 'error') {
          const error = new Error(event.error.message);
          if (onError) {
            onError(error);
          }
        }
      }
    }

    return currentThread;
  } catch (error) {
    if (onError) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
    throw error;
  }
}

/**
 * Récupère un thread existant
 */
export async function fetchThread(options: {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
}): Promise<Thread> {
  const { url, headers = {}, threadId } = options;

  const response = await fetch(`${url}?thread_id=${threadId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.thread || data;
}

/**
 * Envoie le résultat d'un client tool call au backend
 */
export async function sendClientToolOutput(options: {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
  result: unknown;
}): Promise<void> {
  const { url, headers = {}, threadId, result } = options;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      type: 'threads.add_client_tool_output',
      params: {
        thread_id: threadId,
        result,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }
}

/**
 * Exécute une action personnalisée sur un thread
 */
export async function sendCustomAction(options: {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
  itemId: string | null;
  action: { type: string; data?: unknown };
}): Promise<void> {
  const { url, headers = {}, threadId, itemId, action } = options;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      type: 'threads.custom_action',
      params: {
        thread_id: threadId,
        item_id: itemId,
        action,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }
}

/**
 * Réessaye le traitement après un item spécifique
 */
export async function retryAfterItem(options: {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
  itemId: string;
}): Promise<void> {
  const { url, headers = {}, threadId, itemId } = options;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      type: 'threads.retry_after_item',
      params: {
        thread_id: threadId,
        item_id: itemId,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }
}

/**
 * Soumet un feedback sur des items
 */
export async function submitFeedback(options: {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
  itemIds: string[];
  kind: 'positive' | 'negative';
}): Promise<void> {
  const { url, headers = {}, threadId, itemIds, kind } = options;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      type: 'items.feedback',
      params: {
        thread_id: threadId,
        item_ids: itemIds,
        kind,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }
}

/**
 * Met à jour les métadonnées d'un thread
 */
export async function updateThreadMetadata(options: {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const { url, headers = {}, threadId, metadata } = options;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      type: 'threads.update',
      params: {
        thread_id: threadId,
        metadata,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }
}

/**
 * Liste les threads avec pagination
 */
export async function listThreads(options: {
  url: string;
  headers?: Record<string, string>;
  limit?: number;
  order?: 'asc' | 'desc';
  after?: string;
}): Promise<ThreadListResponse> {
  const { url, headers = {}, limit, order = 'desc', after } = options;

  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  params.set('order', order);
  if (after) params.set('after', after);

  const response = await fetch(`${url}?type=threads.list&${params.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data;
}

/**
 * Liste les items d'un thread avec pagination
 */
export async function listItems(options: {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
  limit?: number;
  order?: 'asc' | 'desc';
  after?: string;
  before?: string;
}): Promise<ItemListResponse> {
  const { url, headers = {}, threadId, limit, order = 'desc', after, before } = options;

  const params = new URLSearchParams();
  params.set('thread_id', threadId);
  if (limit !== undefined) params.set('limit', String(limit));
  params.set('order', order);
  if (after) params.set('after', after);
  if (before) params.set('before', before);

  const response = await fetch(`${url}?type=items.list&${params.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data;
}
