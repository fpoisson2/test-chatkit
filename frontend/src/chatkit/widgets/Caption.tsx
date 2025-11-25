import React from 'react';
import type { CaptionWidget } from '../types';
import { applyTextStyles } from '../utils/styleHelpers';

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

  const style = applyTextStyles({
    color,
    weight,
    size,
    sizePrefix: 'caption',
    textAlign,
    truncate,
    maxLines,
  });

  return (
    <span className="chatkit-caption" style={style}>
      {value}
    </span>
  );
}
