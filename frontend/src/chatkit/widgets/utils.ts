import type { ThemeColor, Spacing, Border, Borders } from '../types';

/**
 * Résout une couleur qui peut être une string ou un ThemeColor
 */
export function resolveColor(color: string | ThemeColor | undefined): string | undefined {
  if (!color) return undefined;

  if (typeof color === 'string') {
    // Si c'est un token de couleur, utiliser la variable CSS
    if (color.includes('-')) {
      return `var(--color-${color})`;
    }
    return color;
  }

  // Pour ThemeColor, utiliser la couleur light par défaut (le thème gérera le dark)
  return color.light;
}

/**
 * Résout une valeur d'espacement
 */
export function resolveSpacingValue(value: number | string | undefined): string | number | undefined {
  if (value === undefined) return undefined;

  if (typeof value === 'number') {
    return `${value}px`;
  }

  return value;
}

/**
 * Résout un objet Spacing en style CSS
 */
export function resolveSpacing(spacing: number | string | Spacing | undefined): Record<string, string | number> | undefined {
  if (!spacing) return undefined;

  if (typeof spacing === 'number' || typeof spacing === 'string') {
    const value = resolveSpacingValue(spacing);
    return {
      padding: value as string | number,
    };
  }

  const style: Record<string, string | number> = {};

  if (spacing.top !== undefined) style.paddingTop = resolveSpacingValue(spacing.top) as string | number;
  if (spacing.right !== undefined) style.paddingRight = resolveSpacingValue(spacing.right) as string | number;
  if (spacing.bottom !== undefined) style.paddingBottom = resolveSpacingValue(spacing.bottom) as string | number;
  if (spacing.left !== undefined) style.paddingLeft = resolveSpacingValue(spacing.left) as string | number;
  if (spacing.x !== undefined) {
    style.paddingLeft = resolveSpacingValue(spacing.x) as string | number;
    style.paddingRight = resolveSpacingValue(spacing.x) as string | number;
  }
  if (spacing.y !== undefined) {
    style.paddingTop = resolveSpacingValue(spacing.y) as string | number;
    style.paddingBottom = resolveSpacingValue(spacing.y) as string | number;
  }

  return style;
}

/**
 * Résout une valeur de border en style CSS
 */
export function resolveBorder(border: number | Border | Borders | undefined): Record<string, string> | undefined {
  if (!border) return undefined;

  if (typeof border === 'number') {
    return {
      border: `${border}px solid var(--color-border-default)`,
    };
  }

  // Check if it's a single Border object
  if ('size' in border) {
    const b = border as Border;
    const color = resolveColor(b.color) || 'var(--color-border-default)';
    const style = b.style || 'solid';
    return {
      border: `${b.size}px ${style} ${color}`,
    };
  }

  // It's a Borders object
  const borders = border as Borders;
  const style: Record<string, string> = {};

  const resolveSingleBorder = (val: number | Border): string => {
    if (typeof val === 'number') {
      return `${val}px solid var(--color-border-default)`;
    }
    const color = resolveColor(val.color) || 'var(--color-border-default)';
    const borderStyle = val.style || 'solid';
    return `${val.size}px ${borderStyle} ${color}`;
  };

  if (borders.top) style.borderTop = resolveSingleBorder(borders.top);
  if (borders.right) style.borderRight = resolveSingleBorder(borders.right);
  if (borders.bottom) style.borderBottom = resolveSingleBorder(borders.bottom);
  if (borders.left) style.borderLeft = resolveSingleBorder(borders.left);
  if (borders.x) {
    const val = resolveSingleBorder(borders.x);
    style.borderLeft = val;
    style.borderRight = val;
  }
  if (borders.y) {
    const val = resolveSingleBorder(borders.y);
    style.borderTop = val;
    style.borderBottom = val;
  }

  return style;
}

/**
 * Résout un objet Spacing pour margin
 */
export function resolveMargin(spacing: number | string | Spacing | undefined): Record<string, string | number> | undefined {
  if (!spacing) return undefined;

  if (typeof spacing === 'number' || typeof spacing === 'string') {
    const value = resolveSpacingValue(spacing);
    return {
      margin: value as string | number,
    };
  }

  const style: Record<string, string | number> = {};

  if (spacing.top !== undefined) style.marginTop = resolveSpacingValue(spacing.top) as string | number;
  if (spacing.right !== undefined) style.marginRight = resolveSpacingValue(spacing.right) as string | number;
  if (spacing.bottom !== undefined) style.marginBottom = resolveSpacingValue(spacing.bottom) as string | number;
  if (spacing.left !== undefined) style.marginLeft = resolveSpacingValue(spacing.left) as string | number;
  if (spacing.x !== undefined) {
    style.marginLeft = resolveSpacingValue(spacing.x) as string | number;
    style.marginRight = resolveSpacingValue(spacing.x) as string | number;
  }
  if (spacing.y !== undefined) {
    style.marginTop = resolveSpacingValue(spacing.y) as string | number;
    style.marginBottom = resolveSpacingValue(spacing.y) as string | number;
  }

  return style;
}
