/**
 * Module utils - Utilitaires partagés du module ChatKit
 */

// Composants
export { ImageWithBlobUrl } from './ImageWithBlobUrl';
export type { ImageWithBlobUrlProps } from './ImageWithBlobUrl';

// Constantes
export * from './constants';

// Helpers de style
export {
  isRecord,
  formatSpacing,
  formatDimension,
  formatRadius,
  toThemeColor,
  formatBorderValue,
  applySpacing,
  applyBorderStyles,
  applyBlockProps,
  applyBoxStyles,
  applyTextStyles,
} from './styleHelpers';
export type { TextStyleProps } from './styleHelpers';
