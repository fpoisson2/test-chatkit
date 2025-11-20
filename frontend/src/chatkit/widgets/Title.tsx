import React from 'react';
import type { TitleWidget } from '../types';
import { resolveColor } from './utils';

export function TitleComponent(props: TitleWidget): JSX.Element {
  const {
    value,
    color,
    weight,
    size = 'lg',
    textAlign,
    truncate,
    maxLines,
  } = props;

  const style: React.CSSProperties = {
    color: resolveColor(color),
    fontWeight: weight,
    fontSize: `var(--title-size-${size})`,
    textAlign,
    margin: 0,
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
    <h2 className="chatkit-title" style={style}>
      {value}
    </h2>
  );
}
