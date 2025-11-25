import React from 'react';
import type { TitleWidget } from '../types';
import { applyTextStyles } from '../utils/styleHelpers';

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
    ...applyTextStyles({
      color,
      weight,
      size,
      sizePrefix: 'title',
      textAlign,
      truncate,
      maxLines,
    }),
    margin: 0,
  };

  return (
    <h2 className="chatkit-title" style={style}>
      {value}
    </h2>
  );
}
