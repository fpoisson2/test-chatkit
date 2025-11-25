/**
 * Fonctions de normalisation des données ChatKit
 */
import type { ThreadItem } from '../../types';

/**
 * Normalise les items d'un thread
 * Le backend peut envoyer items comme structure de pagination {"data": [], "has_more": false}
 * ou comme tableau simple
 */
export function normalizeThreadItems(items: unknown): ThreadItem[] {
  if (items && typeof items === 'object' && 'data' in items) {
    // Structure de pagination
    return Array.isArray((items as { data: unknown }).data)
      ? ((items as { data: ThreadItem[] }).data)
      : [];
  }

  if (Array.isArray(items)) {
    return items;
  }

  return [];
}

/**
 * Normalise les items en préservant les items locaux existants si la réponse est vide
 */
export function normalizeThreadItemsWithFallback(
  items: unknown,
  fallbackItems: ThreadItem[]
): ThreadItem[] {
  const normalizedItems = normalizeThreadItems(items);

  // Si les items sont vides dans la réponse, préserver les items locaux existants
  if (normalizedItems.length === 0 && fallbackItems.length > 0) {
    return fallbackItems;
  }

  return normalizedItems;
}
