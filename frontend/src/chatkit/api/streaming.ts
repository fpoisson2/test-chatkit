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
  // Gestion des événements wrapper thread.item.updated
  // Le backend envoie des événements dans un format wrapper avec l'événement réel dans 'update'
  if (event.type === 'thread.item.updated' && 'update' in event) {
    const wrappedEvent = event as any;
    const realEvent = {
      ...wrappedEvent.update,
      item_id: wrappedEvent.item_id,
    } as ThreadStreamEvent;

    console.log('[ChatKit] Unwrapping thread.item.updated event:', realEvent);
    return applyDelta(thread, realEvent);
  }

  if (event.type === 'thread.created') {
    // Le backend peut envoyer items comme structure de pagination {"data": [], "has_more": false}
    const threadItems = event.thread.items as any;
    let normalizedItems: ThreadItem[];

    if (threadItems && typeof threadItems === 'object' && 'data' in threadItems) {
      // Structure de pagination
      normalizedItems = Array.isArray(threadItems.data) ? threadItems.data : [];
    } else if (Array.isArray(threadItems)) {
      normalizedItems = threadItems;
    } else {
      normalizedItems = [];
    }

    return {
      ...event.thread,
      items: normalizedItems,
    };
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

  // Nouveaux événements thread
  if (event.type === 'thread.updated') {
    // Le backend peut envoyer items comme structure de pagination {"data": [], "has_more": false}
    const threadItems = event.thread.items as any;
    let normalizedItems: ThreadItem[];

    if (threadItems && typeof threadItems === 'object' && 'data' in threadItems) {
      // Structure de pagination
      normalizedItems = Array.isArray(threadItems.data) ? threadItems.data : [];

      // Si les items sont vides dans la réponse, préserver les items locaux existants
      // pour éviter de perdre les items accumulés via thread.item.added et deltas
      if (normalizedItems.length === 0 && thread.items.length > 0) {
        console.log('[ChatKit] Preserving local items on thread.updated with empty remote items');
        normalizedItems = thread.items;
      }
    } else if (Array.isArray(threadItems)) {
      normalizedItems = threadItems;
    } else {
      // Si items est absent ou invalide, préserver les items locaux
      normalizedItems = thread.items;
    }

    return {
      ...event.thread,
      items: normalizedItems,
    };
  }

  if (event.type === 'thread.item.added') {
    const exists = thread.items.find((item) => item.id === event.item.id);
    if (exists) {
      return thread;
    }

    return {
      ...thread,
      items: [...thread.items, event.item],
    };
  }

  if (event.type === 'thread.item.done') {
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

  if (event.type === 'thread.item.removed') {
    const items = thread.items.filter((item) => item.id !== event.item_id);

    return {
      ...thread,
      items,
    };
  }

  if (event.type === 'thread.item.replaced') {
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

  // Gestion de thread.item.updated (délègue aux handlers spécifiques)
  if (event.type === 'thread.item.updated') {
    return applyDelta(thread, event.update);
  }

  // Événements de contenu assistant
  if (event.type === 'assistant_message.content_part.added') {
    const items = thread.items.map((item) => {
      if (item.id === event.item_id && item.type === 'assistant_message') {
        const content = [...item.content];
        while (content.length <= event.content_index) {
          content.push({ type: 'output_text' as const, text: '' });
        }
        content[event.content_index] = event.content;
        return {
          ...item,
          content,
        };
      }
      return item;
    });

    return {
      ...thread,
      items,
    };
  }

  if (event.type === 'assistant_message.content_part.text_delta') {
    // Vérifier si l'item existe déjà
    let itemExists = thread.items.some((item) => item.id === event.item_id);

    // Si l'item n'existe pas et que c'est un ID temporaire, créer l'item
    if (!itemExists && event.item_id.startsWith('__fake_id__')) {
      const newItem: AssistantMessageItem = {
        type: 'assistant_message',
        id: event.item_id,
        role: 'assistant',
        content: [],
        created_at: new Date().toISOString(),
      };

      thread = {
        ...thread,
        items: [...thread.items, newItem],
      };
      itemExists = true;
    }

    const items = thread.items.map((item) => {
      if (item.id === event.item_id && item.type === 'assistant_message') {
        const content = [...item.content];

        // S'assurer que l'index de contenu existe
        while (content.length <= event.content_index) {
          content.push({
            type: 'output_text',
            text: '',
          });
        }

        const existing = content[event.content_index];
        if (existing && existing.type === 'output_text') {
          content[event.content_index] = {
            ...existing,
            text: (existing.text || '') + event.delta,
          };
        } else if (!existing || existing.type !== 'output_text') {
          // Créer le content part si inexistant
          content[event.content_index] = {
            type: 'output_text',
            text: event.delta,
          };
        }

        return {
          ...item,
          content,
        };
      }
      return item;
    });

    return {
      ...thread,
      items,
    };
  }

  if (event.type === 'assistant_message.content_part.annotation_added') {
    const items = thread.items.map((item) => {
      if (item.id === event.item_id && item.type === 'assistant_message') {
        const content = [...item.content];
        const existing = content[event.content_index];
        if (existing && existing.type === 'output_text') {
          const annotations = [...(existing.annotations || [])];
          while (annotations.length <= event.annotation_index) {
            annotations.push(event.annotation);
          }
          annotations[event.annotation_index] = event.annotation;
          content[event.content_index] = {
            ...existing,
            annotations,
          };
        }
        return {
          ...item,
          content,
        };
      }
      return item;
    });

    return {
      ...thread,
      items,
    };
  }

  if (event.type === 'assistant_message.content_part.done') {
    const items = thread.items.map((item) => {
      if (item.id === event.item_id && item.type === 'assistant_message') {
        const content = [...item.content];
        content[event.content_index] = event.content;
        return {
          ...item,
          content,
        };
      }
      return item;
    });

    return {
      ...thread,
      items,
    };
  }

  // Les événements progress_update et notice ne modifient pas le thread
  // Ils sont gérés par les callbacks onEvent

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

    const contentType = response.headers.get('content-type') || '';
    console.log('[ChatKit] Response Content-Type:', contentType);

    // Si la réponse est du JSON (non-streaming), parser directement
    if (contentType.includes('application/json')) {
      try {
        const data = await response.json();
        console.log('[ChatKit] Received JSON response:', data);

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
        console.error('[ChatKit] Failed to parse JSON response:', err);
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
    let chunkCount = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        console.log('[ChatKit] SSE stream ended after', chunkCount, 'chunks');
        break;
      }

      chunkCount++;
      const chunk = decoder.decode(value, { stream: true });
      console.log('[ChatKit] Received SSE chunk', chunkCount, ':', chunk.substring(0, 200));
      buffer += chunk;

      // Traiter toutes les lignes complètes
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Garder la dernière ligne incomplète

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        console.log('[ChatKit] Parsing SSE line:', trimmed.substring(0, 100));
        const event = parseSSELine(trimmed);
        if (!event) {
          console.log('[ChatKit] Failed to parse SSE line (not an event)');
          continue;
        }

        console.log('[ChatKit] Received SSE event:', event.type, event);

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

        // Gérer les client tool calls (support des deux formats)
        if ((event.type === 'thread.item.added' || event.type === 'thread.item.created') &&
            event.item.type === 'client_tool_call') {
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
          console.error('[ChatKit] Received error event:', event);
          const errorMessage = event.message || 'Unknown error';
          const error = new Error(`[ChatKit] ${errorMessage}`);
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

  const payload = {
    type: 'threads.get_by_id',
    params: {
      thread_id: threadId,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const thread = data.thread || data;

  // Normaliser le thread pour garantir que items est un tableau
  return {
    ...thread,
    items: Array.isArray(thread.items) ? thread.items : [],
  };
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

  const payload: any = {
    type: 'threads.list',
    params: {
      order,
    },
  };

  if (limit !== undefined) {
    payload.params.limit = limit;
  }
  if (after) {
    payload.params.after = after;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
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
}): Promise<ItemListResponse> {
  const { url, headers = {}, threadId, limit, order = 'desc', after } = options;

  const payload: any = {
    type: 'items.list',
    params: {
      thread_id: threadId,
      order,
    },
  };

  if (limit !== undefined) {
    payload.params.limit = limit;
  }
  if (after) {
    payload.params.after = after;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data;
}
