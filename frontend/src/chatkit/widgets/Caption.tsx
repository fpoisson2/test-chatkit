import React from 'react';
import type { CaptionWidget } from '../types';
import { resolveColor } from './utils';

export function CaptionComponent(props: CaptionWidget): JSX.Element {
  const {
    value,
    color,
    weight,
    size = 'md',
    textAlign,
    truncate,
    maxLines,
  } = props;

  const style: React.CSSProperties = {
    color: resolveColor(color),
    fontWeight: weight,
    fontSize: `var(--caption-size-${size})`,
    textAlign,
    ...(truncate ? {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    } : {}),
    ...(maxLines ? {
      display: '-webkit-box',
      WebkitLineClamp: maxLines,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
    } : {}),
  };

  return (
    <span className="chatkit-caption" style={style}>
      {value}
    </span>
  );
}
