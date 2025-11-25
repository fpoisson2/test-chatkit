/**
 * Constantes partagées du module ChatKit
 */

// ===== Timeouts et délais =====

/** Délai minimum d'affichage d'un workflow (en ms) */
export const WORKFLOW_MIN_DISPLAY_TIME_MS = 2000;

/** Délai avant de masquer le message "copié" (en ms) */
export const COPY_FEEDBACK_DELAY_MS = 2000;

// ===== Dimensions UI =====

/** Hauteur maximale du textarea du composer (en px) */
export const TEXTAREA_MAX_HEIGHT_PX = 200;

/** Hauteur minimale du textarea (calculée via CSS) */
export const TEXTAREA_MIN_HEIGHT_PX = 24;

/** Taille des icônes dans les tâches */
export const TASK_ICON_SIZE = 18;

/** ViewBox des icônes de tâches */
export const TASK_ICON_VIEWBOX = '0 0 20 20';

// ===== Valeurs par défaut =====

/** Nombre de lignes par défaut pour un textarea */
export const DEFAULT_TEXTAREA_ROWS = 3;

/** Couleur de bordure par défaut */
export const DEFAULT_BORDER_COLOR = 'rgba(148, 163, 184, 0.38)';

// ===== Map des rayons de bordure =====

export const RADIUS_MAP: Record<string, string> = {
  '2xs': '6px',
  xs: '8px',
  sm: '10px',
  md: '14px',
  lg: '18px',
  xl: '22px',
  '2xl': '26px',
  '3xl': '32px',
  '4xl': '40px',
  full: '9999px',
  '100%': '100%',
  none: '0px',
};

// ===== Map des tailles d'icônes de boutons =====

export const BUTTON_ICON_SIZE_MAP: Record<string, string> = {
  sm: '0.9rem',
  md: '1rem',
  lg: '1.1rem',
  xl: '1.25rem',
  '2xl': '1.4rem',
};

// ===== Couleurs sémantiques =====

export const SEMANTIC_COLORS = [
  'prose',
  'primary',
  'emphasis',
  'secondary',
  'tertiary',
  'success',
  'warning',
  'danger',
] as const;

export type SemanticColor = typeof SEMANTIC_COLORS[number];
