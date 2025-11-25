import React from 'react';
import type { TextWidget } from '../types';
import { applyTextStyles } from '../utils/styleHelpers';

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

  const style = applyTextStyles({
    color,
    weight,
    size,
    sizePrefix: 'text',
    textAlign,
    italic,
    lineThrough,
    truncate,
    minLines,
    maxLines,
    width,
  });

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
