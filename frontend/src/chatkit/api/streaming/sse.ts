/**
 * Parsing et traitement des événements Server-Sent Events (SSE)
 */
import type { ThreadStreamEvent } from '../../types';

/**
 * Parse une ligne d'événement server-sent events
 */
export function parseSSELine(line: string): ThreadStreamEvent | null {
  // Format: data: {json}
  if (!line.startsWith('data: ')) {
    return null;
  }

  const jsonStr = line.slice(6); // Enlever "data: "

  if (jsonStr === '[DONE]') {
    return null;
  }

  try {
    const event = JSON.parse(jsonStr) as ThreadStreamEvent;
    // Debug: Log thread.updated events with title info
    if (event.type === 'thread.updated' && 'thread' in event) {
      const threadEvent = event as { type: string; thread: { id?: string; title?: string; metadata?: unknown } };
      console.debug('[ChatKit SSE] thread.updated event:', {
        threadId: threadEvent.thread?.id,
        title: threadEvent.thread?.title,
        metadata: threadEvent.thread?.metadata,
      });
    }
    return event;
  } catch (error) {
    console.warn('[ChatKit] Failed to parse SSE line:', line, error);
    return null;
  }
}

/**
 * Traite un buffer de données SSE et extrait les événements complets
 * Retourne les événements parsés et le reste du buffer (ligne incomplète)
 */
export function processSSEBuffer(buffer: string): {
  events: ThreadStreamEvent[];
  remainder: string;
} {
  const events: ThreadStreamEvent[] = [];
  const lines = buffer.split('\n');
  const remainder = lines.pop() || ''; // Garder la dernière ligne incomplète

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const event = parseSSELine(trimmed);
    if (event) {
      events.push(event);
    }
  }

  return { events, remainder };
}
