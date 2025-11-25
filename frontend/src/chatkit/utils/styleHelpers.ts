/**
 * Fonctions utilitaires pour la gestion des styles dans les widgets
 */
import { RADIUS_MAP, DEFAULT_BORDER_COLOR } from './constants';
import type { ThemeColor, Spacing, Border, Borders, BoxBase } from '../types';

/**
 * Vérifie si une valeur est un objet Record
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Formate une valeur d'espacement
 */
export function formatSpacing(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return `calc(var(--spacing, 4px) * ${value})`;
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

/**
 * Formate une dimension (largeur, hauteur, etc.)
 */
export function formatDimension(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return `${value}px`;
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

/**
 * Formate une valeur de rayon de bordure
 */
export function formatRadius(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return `${value}px`;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  return RADIUS_MAP[value] ?? value;
}

/**
 * Extrait la couleur pour le thème courant (light par défaut)
 */
export function toThemeColor(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (isRecord(value)) {
    const light = value.light;
    return typeof light === 'string' ? light : undefined;
  }
  return undefined;
}

/**
 * Formate une valeur de bordure
 */
export function formatBorderValue(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return `${value}px solid ${DEFAULT_BORDER_COLOR}`;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const size = typeof value.size === 'number' ? value.size : undefined;
  if (typeof size !== 'number') {
    return undefined;
  }
  const style = typeof value.style === 'string' ? value.style : 'solid';
  const colorCandidate = value.color;
  const color =
    toThemeColor(colorCandidate) ??
    (typeof colorCandidate === 'string' ? colorCandidate : DEFAULT_BORDER_COLOR);
  return `${size}px ${style} ${color}`;
}

/**
 * Applique les styles d'espacement (padding ou margin) à un objet de styles
 */
export function applySpacing(
  target: React.CSSProperties,
  prefix: 'padding' | 'margin',
  spacing: unknown,
): void {
  if (!spacing) {
    return;
  }
  if (typeof spacing === 'number' || typeof spacing === 'string') {
    target[prefix] = formatSpacing(spacing);
    return;
  }
  if (!isRecord(spacing)) {
    return;
  }
  const { top, right, bottom, left, x, y } = spacing as Record<string, unknown>;
  const xValue = formatSpacing(x);
  const yValue = formatSpacing(y);
  const topValue = formatSpacing(top) ?? yValue;
  const bottomValue = formatSpacing(bottom) ?? yValue;
  const leftValue = formatSpacing(left) ?? xValue;
  const rightValue = formatSpacing(right) ?? xValue;
  if (topValue) {
    target[`${prefix}Top`] = topValue;
  }
  if (rightValue) {
    target[`${prefix}Right`] = rightValue;
  }
  if (bottomValue) {
    target[`${prefix}Bottom`] = bottomValue;
  }
  if (leftValue) {
    target[`${prefix}Left`] = leftValue;
  }
}

/**
 * Applique les styles de bordure à un objet de styles
 */
export function applyBorderStyles(styles: React.CSSProperties, border: unknown): void {
  if (!border) {
    return;
  }
  const apply = (property: keyof React.CSSProperties, value: unknown) => {
    const formatted = formatBorderValue(value);
    if (formatted) {
      (styles as any)[property] = formatted;
    }
  };

  if (typeof border === 'number' || (isRecord(border) && typeof border.size === 'number')) {
    const formatted = formatBorderValue(border);
    if (formatted) {
      styles.border = formatted;
    }
    return;
  }

  if (!isRecord(border)) {
    return;
  }

  const segments = border as Record<string, unknown>;
  if (segments.x !== undefined) {
    const formatted = formatBorderValue(segments.x);
    if (formatted) {
      styles.borderLeft = formatted;
      styles.borderRight = formatted;
    }
  }
  if (segments.y !== undefined) {
    const formatted = formatBorderValue(segments.y);
    if (formatted) {
      styles.borderTop = formatted;
      styles.borderBottom = formatted;
    }
  }

  apply('borderTop', segments.top);
  apply('borderRight', segments.right);
  apply('borderBottom', segments.bottom);
  apply('borderLeft', segments.left);
}

/**
 * Applique les propriétés de bloc (dimensions, marges, etc.) à un objet de styles
 */
export function applyBlockProps(styles: React.CSSProperties, props: Record<string, unknown>): void {
  if (props.height !== undefined) {
    const formatted = formatDimension(props.height);
    if (formatted) {
      styles.height = formatted;
    }
  }
  if (props.width !== undefined) {
    const formatted = formatDimension(props.width);
    if (formatted) {
      styles.width = formatted;
    }
  }
  if (props.size !== undefined) {
    const formatted = formatDimension(props.size);
    if (formatted) {
      styles.width = formatted;
      styles.height = formatted;
    }
  }
  if (props.minHeight !== undefined) {
    const formatted = formatDimension(props.minHeight);
    if (formatted) {
      styles.minHeight = formatted;
    }
  }
  if (props.minWidth !== undefined) {
    const formatted = formatDimension(props.minWidth);
    if (formatted) {
      styles.minWidth = formatted;
    }
  }
  if (props.minSize !== undefined) {
    const formatted = formatDimension(props.minSize);
    if (formatted) {
      styles.minWidth = formatted;
      styles.minHeight = formatted;
    }
  }
  if (props.maxHeight !== undefined) {
    const formatted = formatDimension(props.maxHeight);
    if (formatted) {
      styles.maxHeight = formatted;
    }
  }
  if (props.maxWidth !== undefined) {
    const formatted = formatDimension(props.maxWidth);
    if (formatted) {
      styles.maxWidth = formatted;
    }
  }
  if (props.maxSize !== undefined) {
    const formatted = formatDimension(props.maxSize);
    if (formatted) {
      styles.maxWidth = formatted;
      styles.maxHeight = formatted;
    }
  }
  if (props.aspectRatio !== undefined) {
    if (typeof props.aspectRatio === 'number') {
      styles.aspectRatio = `${props.aspectRatio}`;
    } else if (typeof props.aspectRatio === 'string') {
      styles.aspectRatio = props.aspectRatio;
    }
  }
  if (props.radius !== undefined) {
    const formatted = formatRadius(props.radius);
    if (formatted) {
      styles.borderRadius = formatted;
    }
  }
  if (props.margin !== undefined) {
    applySpacing(styles, 'margin', props.margin);
  }
}

/**
 * Type pour les widgets de type Box (Box, Row, Col, Form)
 */
type BoxLike = BoxBase & {
  type: string;
  direction?: 'row' | 'col';
  theme?: string;
};

/**
 * Applique les styles flexbox pour un composant de type Box
 */
export function applyBoxStyles(box: BoxLike): React.CSSProperties {
  const styles: React.CSSProperties = {
    display: 'flex',
    flexDirection: box.type === 'Row' ? 'row' : 'column',
  };
  applyBlockProps(styles, box as unknown as Record<string, unknown>);

  if (box.direction) {
    styles.flexDirection = box.direction === 'row' ? 'row' : 'column';
  }
  if (box.align) {
    styles.alignItems =
      box.align === 'start' ? 'flex-start' : box.align === 'end' ? 'flex-end' : box.align;
  }
  if (box.justify) {
    styles.justifyContent =
      box.justify === 'start'
        ? 'flex-start'
        : box.justify === 'end'
          ? 'flex-end'
          : box.justify;
  }
  if (box.wrap) {
    styles.flexWrap = box.wrap;
  }
  if (box.flex !== undefined) {
    styles.flex = box.flex as number | string;
  }
  if (box.gap !== undefined) {
    const formatted = formatSpacing(box.gap);
    if (formatted) {
      styles.gap = formatted;
    }
  }
  if (box.padding !== undefined) {
    applySpacing(styles, 'padding', box.padding);
  }
  if (box.background) {
    const background =
      toThemeColor(box.background) ??
      (typeof box.background === 'string' ? box.background : undefined);
    if (background) {
      styles.background = background;
    }
  }
  if (box.border !== undefined) {
    applyBorderStyles(styles, box.border);
  }
  return styles;
}
