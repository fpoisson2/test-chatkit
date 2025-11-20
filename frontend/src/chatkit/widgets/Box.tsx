import React from 'react';
import type { BoxWidget, BoxBase } from '../types';
import { WidgetRenderer } from './WidgetRenderer';
import { resolveColor, resolveSpacingValue, resolveSpacing, resolveMargin, resolveBorder } from './utils';

export function resolveBoxBaseStyle(props: BoxBase): React.CSSProperties {
  const {
    align,
    justify,
    wrap,
    flex,
    gap,
    height,
    width,
    size,
    minHeight,
    minWidth,
    minSize,
    maxHeight,
    maxWidth,
    maxSize,
    padding,
    margin,
    border,
    radius,
    background,
    aspectRatio,
  } = props;

  return {
    display: 'flex',
    alignItems: align,
    justifyContent: justify,
    flexWrap: wrap,
    flex,
    gap: resolveSpacingValue(gap),
    height: resolveSpacingValue(height || size),
    width: resolveSpacingValue(width || size),
    minHeight: resolveSpacingValue(minHeight || minSize),
    minWidth: resolveSpacingValue(minWidth || minSize),
    maxHeight: resolveSpacingValue(maxHeight || maxSize),
    maxWidth: resolveSpacingValue(maxWidth || maxSize),
    ...resolveSpacing(padding),
    ...resolveMargin(margin),
    ...resolveBorder(border),
    borderRadius: radius ? `var(--radius-${radius})` : undefined,
    background: resolveColor(background),
    aspectRatio: typeof aspectRatio === 'number' ? aspectRatio : aspectRatio,
  };
}

export function BoxComponent(props: BoxWidget): JSX.Element {
  const { children, direction = 'row' } = props;

  const style: React.CSSProperties = {
    ...resolveBoxBaseStyle(props),
    flexDirection: direction,
  };

  return (
    <div className="chatkit-box" style={style}>
      {children?.map((child, index) => (
        <WidgetRenderer key={child.key || child.id || `child-${index}`} widget={child} />
      ))}
    </div>
  );
}
