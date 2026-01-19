/**
 * Fonctions d'API pour interagir avec le backend ChatKit
 */
import type {
  Thread,
  ThreadItem,
  ThreadListResponse,
  ItemListResponse,
} from '../../types';
import { normalizeThreadItems, normalizeThreadItemsWithPagination } from './normalizers';

export interface FetchThreadOptions {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
}

export interface SendClientToolOutputOptions {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
  result: unknown;
}

export interface SendCustomActionOptions {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
  itemId: string | null;
  action: { type: string; data?: unknown };
}

export interface RetryAfterItemOptions {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
  itemId: string;
}

export interface SubmitFeedbackOptions {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
  itemIds: string[];
  kind: 'positive' | 'negative';
}

export interface UpdateThreadMetadataOptions {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
  metadata: Record<string, unknown>;
}

export interface UpdateThreadTitleOptions {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
  title: string;
}

export interface ListThreadsOptions {
  url: string;
  headers?: Record<string, string>;
  limit?: number;
  order?: 'asc' | 'desc';
  after?: string;
  allWorkflows?: boolean;
}

export interface DeleteThreadOptions {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
}

export interface ListItemsOptions {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
  limit?: number;
  order?: 'asc' | 'desc';
  after?: string;
}

/**
 * Récupère un thread existant
 */
export async function fetchThread(options: FetchThreadOptions): Promise<Thread> {
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
  const { items, has_more, pagination_cursor } = normalizeThreadItemsWithPagination(thread.items);

  return {
    ...thread,
    items,
    has_more_items: has_more,
    pagination_cursor,
  };
}

/**
 * Envoie le résultat d'un client tool call au backend
 */
export async function sendClientToolOutput(options: SendClientToolOutputOptions): Promise<void> {
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
export async function sendCustomAction(options: SendCustomActionOptions): Promise<void> {
  const { url, headers = {}, threadId, itemId, action } = options;

  // Convert 'data' to 'payload' for backend compatibility
  const backendAction = {
    type: action.type,
    payload: action.data,
  };

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
        action: backendAction,
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
export async function retryAfterItem(options: RetryAfterItemOptions): Promise<void> {
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
export async function submitFeedback(options: SubmitFeedbackOptions): Promise<void> {
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
export async function updateThreadMetadata(options: UpdateThreadMetadataOptions): Promise<void> {
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
 * Met à jour le titre d'un thread
 */
export async function updateThreadTitle(options: UpdateThreadTitleOptions): Promise<void> {
  const { url, headers = {}, threadId, title } = options;

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
        title,
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
export async function listThreads(options: ListThreadsOptions): Promise<ThreadListResponse> {
  const { url, headers = {}, limit, order = 'desc', after, allWorkflows = false } = options;

  const payload: any = {
    type: 'threads.list',
    params: {
      order,
      all_workflows: allWorkflows,
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
 * Supprime un thread
 */
export async function deleteThread(options: DeleteThreadOptions): Promise<void> {
  const { url, headers = {}, threadId } = options;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      type: 'threads.delete',
      params: {
        thread_id: threadId,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }
}

/**
 * Liste les items d'un thread avec pagination
 */
export async function listItems(options: ListItemsOptions): Promise<ItemListResponse> {
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

export interface LoadOlderItemsOptions {
  url: string;
  headers?: Record<string, string>;
  threadId: string;
  cursor: string;
  limit?: number;
}

export interface LoadOlderItemsResponse {
  items: ThreadItem[];
  has_more: boolean;
  cursor?: string;
}

/**
 * Charge les messages plus anciens d'un thread
 */
export async function loadOlderItems(options: LoadOlderItemsOptions): Promise<LoadOlderItemsResponse> {
  const { url, headers = {}, threadId, cursor, limit = 50 } = options;

  const response = await listItems({
    url,
    headers,
    threadId,
    limit,
    order: 'desc',
    after: cursor,
  });

  // Les items sont retournés du plus récent au plus ancien (desc)
  // On les inverse pour avoir l'ordre chronologique
  const items = [...response.data].reverse();

  return {
    items,
    has_more: response.has_more,
    cursor: response.after,
  };
}
