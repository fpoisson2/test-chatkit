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
    return event;
  } catch {
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
