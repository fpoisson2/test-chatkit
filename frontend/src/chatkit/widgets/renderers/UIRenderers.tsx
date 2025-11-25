import React from 'react';
import type {
  BadgeWidget,
  ButtonWidget,
  DividerWidget,
  IconWidget,
  ImageWidget,
} from '../../types';
import {
  BUTTON_ICON_SIZE_MAP,
  formatDimension,
  formatRadius,
  formatSpacing,
  ImageWithBlobUrl,
  toThemeColor,
} from '../../utils';
import { renderWidgetIcon } from '../../../components/widgetIcons';
import type { WidgetContext } from './types';

export const renderBadge = (component: BadgeWidget): JSX.Element => {
  const classNames = ['badge'];

  if (component.variant === 'outline') {
    classNames.push('badge-outline');
  } else if (component.variant === 'soft') {
    classNames.push('badge-soft');
  }

  if (component.color) {
    classNames.push(`badge-${component.color}`);
  }
  if (component.size === 'sm') {
    classNames.push('badge-sm');
  } else if (component.size === 'lg') {
    classNames.push('badge-lg');
  }
  if (component.pill) {
    classNames.push('badge-pill');
  }
  return <span className={classNames.join(' ')}>{component.label}</span>;
};

export const renderButton = (component: ButtonWidget, context: WidgetContext): JSX.Element => {
  const classNames = ['btn'];

  if (component.style === 'secondary') {
    classNames.push('btn-secondary');
  } else {
    classNames.push('btn-primary');
  }

  if (component.variant === 'outline') {
    classNames.push('btn-outline');
  } else if (component.variant === 'ghost') {
    classNames.push('btn-ghost');
  }

  if (component.color === 'danger' || component.color === 'red') {
    classNames.push('btn-danger');
  } else if (component.color === 'success' || component.color === 'green') {
    classNames.push('btn-success');
  }

  if (component.size === 'sm') {
    classNames.push('btn-sm');
  } else if (component.size === 'lg') {
    classNames.push('btn-lg');
  }

  if (component.block || component.uniform) {
    classNames.push('w-full');
  }

  const iconStyle = component.iconSize ? { fontSize: BUTTON_ICON_SIZE_MAP[component.iconSize] } : undefined;
  return (
    <button
      className={classNames.join(' ')}
      type={component.submit ? 'submit' : 'button'}
      disabled={component.disabled}
      aria-disabled={component.disabled ?? false}
      onClick={() => component.onClickAction && context.onAction?.(component.onClickAction)}
    >
      {component.iconStart ? (
        <span className="btn-icon" style={iconStyle} aria-hidden>
          {renderWidgetIcon(component.iconStart)}
        </span>
      ) : null}
      <span>{component.label ?? 'Bouton'}</span>
      {component.iconEnd ? (
        <span className="btn-icon" style={iconStyle} aria-hidden>
          {renderWidgetIcon(component.iconEnd)}
        </span>
      ) : null}
    </button>
  );
};

export const renderImage = (component: ImageWidget): JSX.Element => {
  const style: React.CSSProperties = {};
  const props = component as unknown as Record<string, unknown>;

  if (props.size !== undefined) {
    const formatted = formatDimension(props.size);
    if (formatted) {
      style.width = formatted;
      style.height = formatted;
    }
  } else {
    if (props.width !== undefined) {
      const formatted = formatDimension(props.width);
      if (formatted) {
        style.width = formatted;
      }
    }
    if (props.height !== undefined) {
      const formatted = formatDimension(props.height);
      if (formatted) {
        style.height = formatted;
      }
    }
  }

  if (component.radius) {
    const formatted = formatRadius(component.radius);
    if (formatted) {
      style.borderRadius = formatted;
    }
  }

  return (
    <ImageWithBlobUrl
      src={component.src}
      alt={component.alt ?? 'Image de widget'}
      style={style}
      className="object-cover"
    />
  );
};

export const renderIcon = (component: IconWidget): JSX.Element => {
  const style: React.CSSProperties = {};
  const props = component as unknown as Record<string, unknown>;
  if (props.size !== undefined) {
    const formatted = formatDimension(props.size);
    if (formatted) {
      style.fontSize = formatted;
      style.width = formatted;
      style.height = formatted;
    }
  }
  if (props.color) {
    style.color = typeof props.color === 'string' ? props.color : toThemeColor(props.color);
  }
  return <span style={style}>{renderWidgetIcon(component.name)}</span>;
};

export const renderDivider = (component: DividerWidget): JSX.Element => {
  const style: React.CSSProperties = {
    borderColor: component.color ? toThemeColor(component.color) ?? (component.color as string) : undefined,
  };
  if (component.size !== undefined) {
    const formatted = formatDimension(component.size);
    if (formatted) {
      style.borderWidth = formatted;
    }
  }
  const classNames = ['w-full border-b border-gray-200'];
  if (component.flush) {
    classNames.push('my-0');
  } else if (component.spacing !== undefined) {
    const formatted = formatSpacing(component.spacing);
    if (formatted) {
      style.marginTop = formatted;
      style.marginBottom = formatted;
    }
  }
  return <hr className={classNames.join(' ')} style={style} />;
};
