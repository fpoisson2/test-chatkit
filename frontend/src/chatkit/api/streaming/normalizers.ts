/**
 * Fonctions de normalisation des données ChatKit
 */
import type { ThreadItem } from '../../types';

export interface NormalizedItems {
  items: ThreadItem[];
  has_more: boolean;
  pagination_cursor?: string;
}

/**
 * Normalise les items d'un thread et extrait les infos de pagination
 * Le backend peut envoyer items comme structure de pagination {"data": [], "has_more": false, "after": "cursor"}
 * ou comme tableau simple
 */
export function normalizeThreadItemsWithPagination(items: unknown): NormalizedItems {
  if (items && typeof items === 'object' && 'data' in items) {
    // Structure de pagination
    const pageData = items as { data: unknown; has_more?: boolean; after?: string };
    return {
      items: Array.isArray(pageData.data) ? (pageData.data as ThreadItem[]) : [],
      has_more: pageData.has_more ?? false,
      pagination_cursor: pageData.after,
    };
  }

  if (Array.isArray(items)) {
    return { items, has_more: false };
  }

  return { items: [], has_more: false };
}

/**
 * Normalise les items d'un thread (legacy - sans info de pagination)
 */
export function normalizeThreadItems(items: unknown): ThreadItem[] {
  return normalizeThreadItemsWithPagination(items).items;
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
