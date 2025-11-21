import React from 'react';
import type { TextWidget } from '../types';
import { resolveColor, resolveSpacingValue } from './utils';

export function TextComponent(props: TextWidget): JSX.Element {
  const {
    value,
    streaming,
    italic,
    lineThrough,
    color,
    weight,
    width,
    size,
    textAlign,
    truncate,
    minLines,
    maxLines,
    editable,
  } = props;

  const style: React.CSSProperties = {
    color: resolveColor(color),
    fontWeight: weight,
    width: resolveSpacingValue(width),
    fontSize: size ? `var(--text-size-${size})` : undefined,
    textAlign,
    fontStyle: italic ? 'italic' : undefined,
    textDecoration: lineThrough ? 'line-through' : undefined,
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
    ...(minLines ? {
      minHeight: `calc(${minLines} * 1.5em)`,
    } : {}),
  };

  if (editable && editable !== false) {
    return (
      <input
        type="text"
        name={editable.name}
        defaultValue={value}
        placeholder={editable.placeholder}
        autoFocus={editable.autoFocus}
        autoComplete={editable.autoComplete}
        pattern={editable.pattern}
        required={editable.required}
        style={style}
        className="chatkit-text chatkit-text-editable"
        {...(editable.autoSelect ? { onFocus: (e) => e.target.select() } : {})}
      />
    );
  }

  return (
    <span
      className={`chatkit-text${streaming ? ' chatkit-text-streaming' : ''}`}
      style={style}
    >
      {value}
    </span>
  );
}
