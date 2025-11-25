import React from 'react';
import ReactMarkdown from 'react-markdown';
import type {
  TextWidget,
  TitleWidget,
  CaptionWidget,
  MarkdownWidget,
} from '../../types';
import { SEMANTIC_COLORS, toThemeColor } from '../../utils';

export const renderText = (component: TextWidget): JSX.Element => {
  const classNames: string[] = [];
  const style: React.CSSProperties = {};

  if (component.weight === 'bold') {
    classNames.push('font-bold');
  } else if (component.weight === 'semibold') {
    classNames.push('font-semibold');
  } else if (component.weight === 'medium') {
    classNames.push('font-medium');
  } else if (component.weight === 'normal') {
    classNames.push('font-normal');
  }

  if (component.italic) {
    classNames.push('italic');
  }

  if (component.size === '3xs') {
    style.fontSize = 'var(--font-text-3xs-size, 0.5rem)';
    style.lineHeight = 'var(--font-text-3xs-line-height, 0.75rem)';
  } else if (component.size === '2xs') {
    style.fontSize = 'var(--font-text-2xs-size, 0.625rem)';
    style.lineHeight = 'var(--font-text-2xs-line-height, 0.875rem)';
  } else if (component.size === 'xs') {
    classNames.push('text-xs');
  } else if (component.size === 'sm') {
    classNames.push('text-sm');
  } else if (component.size === 'md') {
    classNames.push('text-base');
  } else if (component.size === 'lg') {
    classNames.push('text-lg');
  } else if (component.size === 'xl') {
    classNames.push('text-xl');
  }

  if (component.textAlign === 'center') {
    classNames.push('text-center');
  } else if (component.textAlign === 'end') {
    classNames.push('text-right');
  } else if (component.textAlign === 'start') {
    classNames.push('text-left');
  }

  if (component.color) {
    if (typeof component.color === 'string') {
      if (SEMANTIC_COLORS.includes(component.color as any)) {
        classNames.push(`text-${component.color}`);
      } else if (component.color.startsWith('alpha-')) {
        style.color = `var(--${component.color})`;
      } else if (/^(red|blue|green|yellow|purple|pink|gray|orange|teal|cyan|indigo)-\d{2,3}$/.test(component.color)) {
        style.color = `var(--${component.color})`;
      } else {
        const color = toThemeColor(component.color);
        style.color = color ?? component.color;
      }
    } else {
      const color = toThemeColor(component.color);
      if (color) {
        style.color = color;
      }
    }
  }

  if (component.width) {
    style.width = typeof component.width === 'number' ? `${component.width}px` : component.width;
  }

  return (
    <p className={classNames.join(' ')} style={style}>
      {component.value}
    </p>
  );
};

export const renderTitle = (component: TitleWidget): JSX.Element => {
  const classNames: string[] = [];

  if (component.weight === 'bold') {
    classNames.push('font-bold');
  } else if (component.weight === 'semibold') {
    classNames.push('font-semibold');
  } else if (component.weight === 'medium') {
    classNames.push('font-medium');
  } else if (component.weight === 'normal') {
    classNames.push('font-normal');
  } else {
    classNames.push('font-semibold');
  }

  if (component.size === 'xs') {
    classNames.push('text-xs');
  } else if (component.size === 'sm') {
    classNames.push('text-sm');
  } else if (component.size === 'md') {
    classNames.push('text-base');
  } else if (component.size === 'lg') {
    classNames.push('text-lg');
  } else if (component.size === 'xl') {
    classNames.push('text-xl');
  } else if (component.size === '2xl') {
    classNames.push('text-2xl');
  } else if (component.size === '3xl') {
    classNames.push('text-3xl');
  } else if (component.size === '4xl') {
    classNames.push('text-4xl');
  } else if (component.size === '5xl') {
    classNames.push('text-5xl');
  } else {
    classNames.push('text-base');
  }

  const style: React.CSSProperties = {};

  if (component.textAlign === 'center') {
    classNames.push('text-center');
  } else if (component.textAlign === 'end') {
    classNames.push('text-right');
  } else if (component.textAlign === 'start') {
    classNames.push('text-left');
  }

  if (component.color) {
    if (typeof component.color === 'string') {
      if (SEMANTIC_COLORS.includes(component.color as any)) {
        classNames.push(`text-${component.color}`);
      } else if (component.color.startsWith('alpha-')) {
        style.color = `var(--${component.color})`;
      } else if (/^(red|blue|green|yellow|purple|pink|gray|orange|teal|cyan|indigo)-\d{2,3}$/.test(component.color)) {
        style.color = `var(--${component.color})`;
      } else {
        const color = toThemeColor(component.color);
        style.color = color ?? component.color;
      }
    } else {
      const color = toThemeColor(component.color);
      if (color) {
        style.color = color;
      }
    }
  }

  return (
    <h3 className={classNames.join(' ')} style={style}>
      {component.value}
    </h3>
  );
};

export const renderCaption = (component: CaptionWidget): JSX.Element => {
  const classNames = ['text-sm', 'text-secondary'];
  const style: React.CSSProperties = {};

  if (component.textAlign === 'center') {
    classNames.push('text-center');
  } else if (component.textAlign === 'end') {
    classNames.push('text-right');
  } else if (component.textAlign === 'start') {
    classNames.push('text-left');
  }

  if (component.color) {
    if (typeof component.color === 'string') {
      const color = toThemeColor(component.color) ?? component.color;
      style.color = color;
    } else {
      const color = toThemeColor(component.color);
      if (color) style.color = color;
    }
  }

  return (
    <p className={classNames.join(' ')} style={style}>
      {component.value}
    </p>
  );
};

export const renderMarkdown = (component: MarkdownWidget): JSX.Element => (
  <div className="prose prose-sm">
    <ReactMarkdown>{component.value}</ReactMarkdown>
  </div>
);
