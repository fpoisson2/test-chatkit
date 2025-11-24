import React, { Fragment, useMemo, useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { renderWidgetIcon } from '../../components/widgetIcons';
import type {
  ActionConfig,
  BadgeWidget,
  BoxWidget,
  ButtonWidget,
  CaptionWidget,
  CardWidget,
  CheckboxWidget,
  ColWidget,
  DatePickerWidget,
  DividerWidget,
  FormWidget,
  IconWidget,
  ImageWidget,
  InputWidget,
  LabelWidget,
  ListViewItem,
  ListViewWidget,
  MarkdownWidget,
  RadioGroupWidget,
  RowWidget,
  SelectWidget,
  SpacerWidget,
  TextWidget,
  TextareaWidget,
  TitleWidget,
  TransitionWidget,
  WidgetComponent,
  WidgetRoot,
} from '../types';

type BoxLike = BoxWidget | RowWidget | ColWidget | FormWidget | WidgetRoot;

type WidgetNode = WidgetComponent | WidgetRoot | TransitionWidget | ListViewItem;

/**
 * Component to display images with Blob URL conversion to avoid 414 errors
 */
function ImageWithBlobUrl({ src, alt = '', className = '', style = {} }: { src: string; alt?: string; className?: string; style?: React.CSSProperties }): JSX.Element | null {
  const [blobUrl, setBlobUrl] = useState<string>('');

  useEffect(() => {
    let objectUrl: string | null = null;

    if (src.startsWith('data:')) {
      // Convert data URL to blob to avoid 414 errors with very long URLs
      try {
        const parts = src.split(',');
        const mimeMatch = parts[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : '';
        const bstr = atob(parts[1]);
        const n = bstr.length;
        const u8arr = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
          u8arr[i] = bstr.charCodeAt(i);
        }
        const blob = new Blob([u8arr], { type: mime });
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch (err) {
        console.error('[WidgetRenderer] Failed to convert data URL to blob:', err);
      }
    } else {
      setBlobUrl(src);
    }

    return () => {
      if (objectUrl && objectUrl.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src]);

  if (!blobUrl) return null;

  return <img src={blobUrl} alt={alt} className={className} style={style} />;
}

const DEFAULT_BORDER_COLOR = 'rgba(148, 163, 184, 0.38)';

const radiusMap: Record<string, string> = {
  '2xs': '6px',
  xs: '8px',
  sm: '10px',
  md: '14px',
  lg: '18px',
  xl: '22px',
  '2xl': '26px',
  '3xl': '32px',
  '4xl': '40px',
  full: '9999px',
  '100%': '100%',
  none: '0px',
};

const buttonIconSizeMap: Record<NonNullable<ButtonWidget['iconSize']>, string> = {
  sm: '0.9rem',
  md: '1rem',
  lg: '1.1rem',
  xl: '1.25rem',
  '2xl': '1.4rem',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const formatSpacing = (value: unknown): string | undefined => {
  if (typeof value === 'number') {
    return `calc(var(--spacing, 4px) * ${value})`;
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
};

const formatDimension = (value: unknown): string | undefined => {
  if (typeof value === 'number') {
    return `${value}px`;
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
};

const formatRadius = (value: unknown): string | undefined => {
  if (typeof value === 'number') {
    return `${value}px`;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  return radiusMap[value] ?? value;
};

const applySpacing = (
  target: React.CSSProperties,
  prefix: 'padding' | 'margin',
  spacing: unknown,
) => {
  if (!spacing) {
    return;
  }
  if (typeof spacing === 'number' || typeof spacing === 'string') {
    target[prefix] = formatSpacing(spacing);
    return;
  }
  if (!isRecord(spacing)) {
    return;
  }
  const { top, right, bottom, left, x, y } = spacing as Record<string, unknown>;
  const xValue = formatSpacing(x);
  const yValue = formatSpacing(y);
  const topValue = formatSpacing(top) ?? yValue;
  const bottomValue = formatSpacing(bottom) ?? yValue;
  const leftValue = formatSpacing(left) ?? xValue;
  const rightValue = formatSpacing(right) ?? xValue;
  if (topValue) {
    target[`${prefix}Top`] = topValue;
  }
  if (rightValue) {
    target[`${prefix}Right`] = rightValue;
  }
  if (bottomValue) {
    target[`${prefix}Bottom`] = bottomValue;
  }
  if (leftValue) {
    target[`${prefix}Left`] = leftValue;
  }
};

const toThemeColor = (value: unknown): string | undefined => {
  if (!value) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (isRecord(value)) {
    const light = value.light;
    return typeof light === 'string' ? light : undefined;
  }
  return undefined;
};

const formatBorderValue = (value: unknown): string | undefined => {
  if (typeof value === 'number') {
    return `${value}px solid ${DEFAULT_BORDER_COLOR}`;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const size = typeof value.size === 'number' ? value.size : undefined;
  if (typeof size !== 'number') {
    return undefined;
  }
  const style = typeof value.style === 'string' ? value.style : 'solid';
  const colorCandidate = value.color;
  const color =
    toThemeColor(colorCandidate) ??
    (typeof colorCandidate === 'string' ? colorCandidate : DEFAULT_BORDER_COLOR);
  return `${size}px ${style} ${color}`;
};

const applyBorderStyles = (styles: React.CSSProperties, border: unknown) => {
  if (!border) {
    return;
  }
  const apply = (property: keyof React.CSSProperties, value: unknown) => {
    const formatted = formatBorderValue(value);
    if (formatted) {
      styles[property] = formatted;
    }
  };

  if (typeof border === 'number' || (isRecord(border) && typeof border.size === 'number')) {
    const formatted = formatBorderValue(border);
    if (formatted) {
      styles.border = formatted;
    }
    return;
  }

  if (!isRecord(border)) {
    return;
  }

  const segments = border as Record<string, unknown>;
  if (segments.x !== undefined) {
    const formatted = formatBorderValue(segments.x);
    if (formatted) {
      styles.borderLeft = formatted;
      styles.borderRight = formatted;
    }
  }
  if (segments.y !== undefined) {
    const formatted = formatBorderValue(segments.y);
    if (formatted) {
      styles.borderTop = formatted;
      styles.borderBottom = formatted;
    }
  }

  apply('borderTop', segments.top);
  apply('borderRight', segments.right);
  apply('borderBottom', segments.bottom);
  apply('borderLeft', segments.left);
};

const applyBlockProps = (styles: React.CSSProperties, props: Record<string, unknown>) => {
  if (props.height !== undefined) {
    const formatted = formatDimension(props.height);
    if (formatted) {
      styles.height = formatted;
    }
  }
  if (props.width !== undefined) {
    const formatted = formatDimension(props.width);
    if (formatted) {
      styles.width = formatted;
    }
  }
  if (props.size !== undefined) {
    const formatted = formatDimension(props.size);
    if (formatted) {
      styles.width = formatted;
      styles.height = formatted;
    }
  }
  if (props.minHeight !== undefined) {
    const formatted = formatDimension(props.minHeight);
    if (formatted) {
      styles.minHeight = formatted;
    }
  }
  if (props.minWidth !== undefined) {
    const formatted = formatDimension(props.minWidth);
    if (formatted) {
      styles.minWidth = formatted;
    }
  }
  if (props.minSize !== undefined) {
    const formatted = formatDimension(props.minSize);
    if (formatted) {
      styles.minWidth = formatted;
      styles.minHeight = formatted;
    }
  }
  if (props.maxHeight !== undefined) {
    const formatted = formatDimension(props.maxHeight);
    if (formatted) {
      styles.maxHeight = formatted;
    }
  }
  if (props.maxWidth !== undefined) {
    const formatted = formatDimension(props.maxWidth);
    if (formatted) {
      styles.maxWidth = formatted;
    }
  }
  if (props.maxSize !== undefined) {
    const formatted = formatDimension(props.maxSize);
    if (formatted) {
      styles.maxWidth = formatted;
      styles.maxHeight = formatted;
    }
  }
  if (props.aspectRatio !== undefined) {
    if (typeof props.aspectRatio === 'number') {
      styles.aspectRatio = `${props.aspectRatio}`;
    } else if (typeof props.aspectRatio === 'string') {
      styles.aspectRatio = props.aspectRatio;
    }
  }
  if (props.radius !== undefined) {
    const formatted = formatRadius(props.radius);
    if (formatted) {
      styles.borderRadius = formatted;
    }
  }
  if (props.margin !== undefined) {
    applySpacing(styles, 'margin', props.margin);
  }
};

const applyBoxStyles = (box: BoxLike): React.CSSProperties => {
  const styles: React.CSSProperties = {
    display: 'flex',
    flexDirection: box.type === 'Row' ? 'row' : 'column',
  };
  applyBlockProps(styles, box as unknown as Record<string, unknown>);

  if ('direction' in box && box.direction) {
    styles.flexDirection = box.direction === 'row' ? 'row' : 'column';
  }
  if ('align' in box && box.align) {
    styles.alignItems = box.align === 'start' ? 'flex-start' : box.align === 'end' ? 'flex-end' : box.align;
  }
  if ('justify' in box && box.justify) {
    styles.justifyContent =
      box.justify === 'start'
        ? 'flex-start'
        : box.justify === 'end'
          ? 'flex-end'
          : box.justify;
  }
  if ('wrap' in box && box.wrap) {
    styles.flexWrap = box.wrap;
  }
  if ('flex' in box && box.flex !== undefined) {
    styles.flex = box.flex as number | string;
  }
  if ('gap' in box && box.gap !== undefined) {
    const formatted = formatSpacing(box.gap);
    if (formatted) {
      styles.gap = formatted;
    }
  }
  if ('padding' in box && box.padding !== undefined) {
    applySpacing(styles, 'padding', box.padding);
  }
  if ('background' in box && box.background) {
    const background = toThemeColor(box.background) ?? (typeof box.background === 'string' ? box.background : undefined);
    if (background) {
      styles.background = background;
    }
  }
  if ('border' in box && box.border !== undefined) {
    applyBorderStyles(styles, box.border);
  }
  return styles;
};

const WidgetContextProvider = React.createContext<WidgetContext>({});

export interface WidgetContext {
  onAction?: (action: ActionConfig) => void;
  onFormData?: (data: FormData) => void;
}

export const useWidgetContext = () => React.useContext(WidgetContextProvider);

const renderUnsupported = (type: string) => (
  <div className="alert alert-warning text-sm">Widget non pris en charge : {type}</div>
);

const renderStatus = (status?: { text: string; icon?: string; favicon?: string; frame?: boolean }) => {
  if (!status) return null;
  return (
    <div className="widget-status flex items-center gap-2 text-sm text-secondary">
      {status.favicon ? <img src={status.favicon} alt="favicon" className="h-4 w-4" /> : null}
      {status.icon ? renderWidgetIcon(status.icon as any) : null}
      <span>{status.text}</span>
    </div>
  );
};

const renderText = (component: TextWidget) => {
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
      const semanticColors = ['prose', 'primary', 'emphasis', 'secondary', 'tertiary', 'success', 'warning', 'danger'];
      if (semanticColors.includes(component.color)) {
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

const renderTitle = (component: TitleWidget) => {
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
      const semanticColors = ['prose', 'primary', 'emphasis', 'secondary', 'tertiary', 'success', 'warning', 'danger'];
      if (semanticColors.includes(component.color)) {
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

const renderCaption = (component: CaptionWidget) => {
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

const renderBadge = (component: BadgeWidget) => {
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

const renderMarkdown = (component: MarkdownWidget) => (
  <div className="prose prose-sm">
    <ReactMarkdown>{component.value}</ReactMarkdown>
  </div>
);

const renderButton = (component: ButtonWidget, context: WidgetContext) => {
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

  const iconStyle = component.iconSize ? { fontSize: buttonIconSizeMap[component.iconSize] } : undefined;
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

const renderImage = (component: ImageWidget) => {
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

const renderIcon = (component: IconWidget) => {
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

const renderDivider = (component: DividerWidget) => {
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

const renderCheckbox = (component: CheckboxWidget, context: WidgetContext) => (
  <label className="flex items-center gap-3">
    <input
      type="checkbox"
      name={component.name}
      defaultChecked={component.defaultChecked === 'true'}
      disabled={component.disabled}
      required={component.required}
      onChange={() => component.onChangeAction && context.onAction?.(component.onChangeAction)}
    />
    <span>{component.label ?? 'Case à cocher'}</span>
  </label>
);

const renderInput = (component: InputWidget) => (
  <input
    type={component.inputType ?? 'text'}
    name={component.name}
    defaultValue={component.defaultValue}
    placeholder={component.placeholder}
    required={component.required}
    pattern={component.pattern}
    disabled={component.disabled}
    className="input"
  />
);

const renderTextarea = (component: TextareaWidget) => (
  <textarea
    name={component.name}
    defaultValue={component.defaultValue}
    placeholder={component.placeholder}
    required={component.required}
    disabled={component.disabled}
    rows={component.rows ?? 3}
    className="textarea"
  />
);

const renderSelect = (component: SelectWidget, context: WidgetContext) => (
  <select
    name={component.name}
    defaultValue={component.defaultValue}
    disabled={component.disabled}
    className="select"
    onChange={() => component.onChangeAction && context.onAction?.(component.onChangeAction)}
  >
    {component.placeholder ? <option value="">{component.placeholder}</option> : null}
    {(component.options ?? []).map((option) => (
      <option key={option.value} value={option.value} disabled={option.disabled}>
        {option.label}
      </option>
    ))}
  </select>
);

const renderDatePicker = (component: DatePickerWidget, context: WidgetContext) => (
  <input
    type="date"
    name={component.name}
    defaultValue={component.defaultValue}
    min={component.min}
    max={component.max}
    placeholder={component.placeholder}
    disabled={component.disabled}
    className="input"
    onChange={() => component.onChangeAction && context.onAction?.(component.onChangeAction)}
  />
);

const renderLabel = (component: LabelWidget) => (
  <label className="form-label" htmlFor={component.name}>
    {component.label ?? component.name}
  </label>
);

const renderRadioGroup = (component: RadioGroupWidget, context: WidgetContext) => (
  <div className="flex flex-col gap-2" role="radiogroup" aria-label={component.name}>
    {(component.options ?? []).map((option) => (
      <label key={option.value} className="flex items-center gap-2">
        <input
          type="radio"
          name={component.name}
          value={option.value}
          defaultChecked={option.default}
          disabled={option.disabled}
          onChange={() => component.onChangeAction && context.onAction?.(component.onChangeAction)}
        />
        <span>{option.label}</span>
      </label>
    ))}
  </div>
);

const renderForm = (box: FormWidget, context: WidgetContext) => {
  const styles = applyBoxStyles(box);
  return (
    <form
      className="flex flex-col gap-4"
      style={styles}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        context.onFormData?.(formData);
        if (box.onSubmitAction) {
          context.onAction?.(box.onSubmitAction);
        }
      }}
    >
      {renderChildren(Array.isArray(box.children) ? box.children : [], context)}
    </form>
  );
};

const renderListView = (listView: ListViewWidget, context: WidgetContext) => {
  const children = Array.isArray(listView.children) ? listView.children : [];
  const limited = typeof listView.limit === 'number' ? children.slice(0, listView.limit) : children;
  const wrapperClassNames = ['flex flex-col gap-3 p-4'];
  const wrapperStyles: React.CSSProperties = {};
  applyBlockProps(wrapperStyles, listView as unknown as Record<string, unknown>);

  return (
    <section className={wrapperClassNames.join(' ')} style={wrapperStyles} data-theme={listView.theme}>
      {renderStatus(listView.status)}
      <div className="flex flex-col gap-3">
        {limited.map((item, index) => {
          const entry = item as ListViewItem;
          const itemClassNames = ['flex flex-col gap-3 p-3'];
          if (entry.onClickAction) {
            itemClassNames.push('cursor-pointer hover:bg-surface-elevated rounded-lg transition-colors');
          }
          const itemStyles: React.CSSProperties = {};
          if (entry.align) {
            itemStyles.alignItems =
              entry.align === 'start'
                ? 'flex-start'
                : entry.align === 'end'
                  ? 'flex-end'
                  : entry.align;
          }
          if (entry.gap !== undefined) {
            const formatted = formatSpacing(entry.gap);
            if (formatted) {
              itemStyles.gap = formatted;
            }
          }
          return (
            <div
              key={index}
              className={itemClassNames.join(' ')}
              style={itemStyles}
              onClick={() => entry.onClickAction && context.onAction?.(entry.onClickAction)}
              role={entry.onClickAction ? 'button' : undefined}
              tabIndex={entry.onClickAction ? 0 : undefined}
            >
              {renderChildren(Array.isArray(entry.children) ? entry.children : [], context)}
            </div>
          );
        })}
      </div>
    </section>
  );
};

const renderCard = (card: CardWidget, context: WidgetContext) => {
  const styles: React.CSSProperties = {};
  applyBlockProps(styles, card as unknown as Record<string, unknown>);
  const background = card.background
    ? toThemeColor(card.background) ?? (typeof card.background === 'string' ? card.background : undefined)
    : undefined;
  if (background) {
    styles.background = background;
  }
  if (card.padding !== undefined) {
    (styles as any)['--card-body-padding'] = '0';
    applySpacing(styles, 'padding', card.padding);
  }
  const classNames = ['card'];

  if (card.size === 'sm') {
    classNames.push('card-sm');
  } else if (card.size === 'md') {
    classNames.push('card-md');
  } else if (card.size === 'lg') {
    classNames.push('card-lg');
  }

  return (
    <section className={classNames.join(' ')} style={styles} data-theme={card.theme}>
      {renderStatus(card.status)}
      <div className="card-body">
        {renderChildren(Array.isArray(card.children) ? card.children : [], context)}
      </div>
      {card.confirm || card.cancel ? (
        <div className="card-footer flex items-center gap-3 justify-end">
          {card.confirm ? renderButton({
            type: 'Button',
            label: card.confirm.label ?? 'Confirmer',
            style: 'primary',
          } as ButtonWidget, context) : null}
          {card.cancel ? renderButton({
            type: 'Button',
            label: card.cancel.label ?? 'Annuler',
            style: 'secondary',
          } as ButtonWidget, context) : null}
        </div>
      ) : null}
    </section>
  );
};

const renderBox = (node: BoxLike, context: WidgetContext) => {
  const styles = applyBoxStyles(node);
  return (
    <div className="flex" style={styles} data-theme={(node as any).theme}>
      {renderChildren(Array.isArray((node as any).children) ? (node as any).children : [], context)}
    </div>
  );
};

const renderBasicRoot = (root: WidgetRoot, context: WidgetContext) => {
  const styles = applyBoxStyles(root);
  return (
    <section className="p-4" style={styles} data-theme={root.theme}>
      {renderChildren(Array.isArray(root.children) ? root.children : [], context)}
    </section>
  );
};

const renderChildren = (children: WidgetNode[], context: WidgetContext): React.ReactNode => (
  <>
    {children.map((child, index) => (
      <Fragment key={(child as any).key || (child as any).id || `child-${index}`}>
        {renderNode(child, context)}
      </Fragment>
    ))}
  </>
);

const renderNode = (node: WidgetNode, context: WidgetContext): React.ReactNode => {
  if (!isRecord(node) || typeof node.type !== 'string') {
    return null;
  }
  const type = node.type;
  switch (type) {
    case 'Card':
      return renderCard(node as CardWidget, context);
    case 'Basic':
      return renderBasicRoot(node as WidgetRoot, context);
    case 'ListView':
      return renderListView(node as ListViewWidget, context);
    case 'Row':
    case 'Col':
    case 'Box':
      return renderBox(node as BoxLike & { children?: unknown[] }, context);
    case 'Form':
      return renderForm(node as FormWidget, context);
    case 'Text':
      return renderText(node as TextWidget);
    case 'Title':
      return renderTitle(node as TitleWidget);
    case 'Caption':
      return renderCaption(node as CaptionWidget);
    case 'Badge':
      return renderBadge(node as BadgeWidget);
    case 'Markdown':
      return renderMarkdown(node as MarkdownWidget);
    case 'Button':
      return renderButton(node as ButtonWidget, context);
    case 'Image':
      return renderImage(node as ImageWidget);
    case 'Icon':
      return renderIcon(node as IconWidget);
    case 'Divider':
      return renderDivider(node as DividerWidget);
    case 'Checkbox':
      return renderCheckbox(node as CheckboxWidget, context);
    case 'Input':
      return renderInput(node as InputWidget);
    case 'Textarea':
      return renderTextarea(node as TextareaWidget);
    case 'Select':
      return renderSelect(node as SelectWidget, context);
    case 'DatePicker':
      return renderDatePicker(node as DatePickerWidget, context);
    case 'Label':
      return renderLabel(node as LabelWidget);
    case 'RadioGroup':
      return renderRadioGroup(node as RadioGroupWidget, context);
    case 'Transition':
      return renderNode((node as TransitionWidget).children as WidgetNode, context);
    case 'Spacer':
      return <div className="h-4" />;
    case 'Chart':
      return <div className="alert alert-info text-sm">Les graphiques ne sont pas pris en charge en prévisualisation.</div>;
    default:
      return renderUnsupported(type);
  }
};

const normalizeDefinition = (definition: Record<string, unknown>): WidgetRoot | null => {
  if (!isRecord(definition) || typeof definition.type !== 'string') {
    return null;
  }
  return definition as WidgetRoot;
};

export interface WidgetRendererProps {
  widget: WidgetComponent | WidgetRoot;
  context?: WidgetContext;
}

export function WidgetRenderer({ widget, context = {} }: WidgetRendererProps): JSX.Element | null {
  const normalized = useMemo(() => normalizeDefinition(widget as Record<string, unknown>), [widget]);
  const contextValue = useMemo(() => context, [context]);

  if (!normalized) {
    console.warn('[WidgetRenderer] Invalid widget:', widget);
    return null;
  }

  return (
    <WidgetContextProvider.Provider value={contextValue}>
      {renderNode(normalized, contextValue) as JSX.Element}
    </WidgetContextProvider.Provider>
  );
}

export interface WidgetListRendererProps {
  widgets: (WidgetComponent | WidgetRoot)[];
  context?: WidgetContext;
}

export function WidgetListRenderer({ widgets, context = {} }: WidgetListRendererProps): JSX.Element {
  const contextValue = useMemo(() => context, [context]);
  return (
    <WidgetContextProvider.Provider value={contextValue}>
      <div className="widget-list">
        {widgets.map((child, index) => (
          <Fragment key={child.key || child.id || `widget-${index}`}>
            {renderNode(child, contextValue)}
          </Fragment>
        ))}
      </div>
    </WidgetContextProvider.Provider>
  );
}
