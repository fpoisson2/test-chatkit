import React, { Fragment, useMemo } from "react";
import ReactMarkdown from "react-markdown";

import type { Widgets } from "@openai/chatkit";

import { renderWidgetIcon } from "./widgetIcons";

type WidgetPreviewProps = {
  definition: Record<string, unknown>;
};

type BoxLike =
  | Widgets.Box
  | Widgets.Row
  | Widgets.Col
  | Widgets.Form
  | Widgets.BasicRoot;

const DEFAULT_BORDER_COLOR = "rgba(148, 163, 184, 0.38)";

const radiusMap: Record<string, string> = {
  "2xs": "6px",
  xs: "8px",
  sm: "10px",
  md: "14px",
  lg: "18px",
  xl: "22px",
  "2xl": "26px",
  "3xl": "32px",
  "4xl": "40px",
  full: "9999px",
  "100%": "100%",
  none: "0px",
};

const buttonIconSizeMap: Record<NonNullable<Widgets.Button["iconSize"]>, string> = {
  sm: "0.9rem",
  md: "1rem",
  lg: "1.1rem",
  xl: "1.25rem",
  "2xl": "1.4rem",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const formatSpacing = (value: unknown): string | undefined => {
  if (typeof value === "number") {
    return `${value}px`;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
};

const formatDimension = (value: unknown): string | undefined => {
  if (typeof value === "number") {
    return `${value}px`;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
};

const formatRadius = (value: unknown): string | undefined => {
  if (typeof value === "number") {
    return `${value}px`;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  return radiusMap[value] ?? value;
};

const applySpacing = (
  target: React.CSSProperties,
  prefix: "padding" | "margin",
  spacing: unknown,
) => {
  if (!spacing) {
    return;
  }
  if (typeof spacing === "number" || typeof spacing === "string") {
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
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value)) {
    const light = value.light;
    return typeof light === "string" ? light : undefined;
  }
  return undefined;
};

const formatBorderValue = (value: unknown): string | undefined => {
  if (typeof value === "number") {
    return `${value}px solid ${DEFAULT_BORDER_COLOR}`;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const size = typeof value.size === "number" ? value.size : undefined;
  if (typeof size !== "number") {
    return undefined;
  }
  const style = typeof value.style === "string" ? value.style : "solid";
  const colorCandidate = value.color;
  const color =
    toThemeColor(colorCandidate) ??
    (typeof colorCandidate === "string" ? colorCandidate : DEFAULT_BORDER_COLOR);
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

  if (typeof border === "number" || isRecord(border) && typeof border.size === "number") {
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

  apply("borderTop", segments.top);
  apply("borderRight", segments.right);
  apply("borderBottom", segments.bottom);
  apply("borderLeft", segments.left);
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
    if (typeof props.aspectRatio === "number") {
      styles.aspectRatio = `${props.aspectRatio}`;
    } else if (typeof props.aspectRatio === "string") {
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
    applySpacing(styles, "margin", props.margin);
  }
};

const applyBoxStyles = (box: BoxLike): React.CSSProperties => {
  const styles: React.CSSProperties = {
    display: "flex",
    flexDirection: box.type === "Row" ? "row" : "column",
  };
  applyBlockProps(styles, box as unknown as Record<string, unknown>);

  if ("direction" in box && box.direction) {
    styles.flexDirection = box.direction === "row" ? "row" : "column";
  }
  if ("align" in box && box.align) {
    styles.alignItems = box.align === "start" ? "flex-start" : box.align === "end" ? "flex-end" : box.align;
  }
  if ("justify" in box && box.justify) {
    styles.justifyContent =
      box.justify === "start"
        ? "flex-start"
        : box.justify === "end"
          ? "flex-end"
          : box.justify;
  }
  if ("wrap" in box && box.wrap) {
    styles.flexWrap = box.wrap;
  }
  if ("flex" in box && box.flex !== undefined) {
    styles.flex = box.flex as number | string;
  }
  if ("gap" in box && box.gap !== undefined) {
    const formatted = formatSpacing(box.gap);
    if (formatted) {
      styles.gap = formatted;
    }
  }
  if ("padding" in box && box.padding !== undefined) {
    applySpacing(styles, "padding", box.padding);
  }
  if ("background" in box && box.background) {
    const background = toThemeColor(box.background) ?? (typeof box.background === "string" ? box.background : undefined);
    if (background) {
      styles.background = background;
    }
  }
  if ("border" in box && box.border !== undefined) {
    applyBorderStyles(styles, box.border);
  }
  return styles;
};

const renderText = (component: Widgets.TextComponent) => {
  const classNames: string[] = [];

  const style: React.CSSProperties = {};

  // Weight mapping
  if (component.weight === "bold") {
    classNames.push("font-bold");
  } else if (component.weight === "semibold") {
    classNames.push("font-semibold");
  } else if (component.weight === "medium") {
    classNames.push("font-medium");
  } else if (component.weight === "normal") {
    classNames.push("font-normal");
  }

  // Italic
  if (component.italic) {
    classNames.push("italic");
  }

  // Size mapping - extended range
  if (component.size === "3xs") {
    style.fontSize = "var(--font-text-3xs-size, 0.5rem)";
    style.lineHeight = "var(--font-text-3xs-line-height, 0.75rem)";
  } else if (component.size === "2xs") {
    style.fontSize = "var(--font-text-2xs-size, 0.625rem)";
    style.lineHeight = "var(--font-text-2xs-line-height, 0.875rem)";
  } else if (component.size === "xs") {
    classNames.push("text-xs");
  } else if (component.size === "sm") {
    classNames.push("text-sm");
  } else if (component.size === "md") {
    classNames.push("text-base");
  } else if (component.size === "lg") {
    classNames.push("text-lg");
  } else if (component.size === "xl") {
    classNames.push("text-xl");
  } else if (component.size === "2xl") {
    classNames.push("text-2xl");
  } else if (component.size === "3xl") {
    classNames.push("text-3xl");
  } else if (component.size === "4xl") {
    classNames.push("text-4xl");
  } else if (component.size === "5xl") {
    classNames.push("text-5xl");
  } else {
    classNames.push("text-base");
  }

  // Line through
  if (component.lineThrough) {
    classNames.push("line-through");
  }

  // Text alignment
  if (component.textAlign === "center") {
    classNames.push("text-center");
  } else if (component.textAlign === "right") {
    classNames.push("text-right");
  } else if (component.textAlign === "left") {
    classNames.push("text-left");
  }

  // Color handling - support semantic colors and alpha values
  if (component.color) {
    if (typeof component.color === "string") {
      // Handle semantic color names
      if (component.color === "emphasis") {
        classNames.push("text-emphasis");
      } else if (component.color === "secondary") {
        classNames.push("text-secondary");
      } else if (component.color === "tertiary") {
        classNames.push("text-tertiary");
      } else if (component.color.startsWith("alpha-")) {
        // Handle alpha colors like "alpha-70"
        const alphaValue = component.color.replace("alpha-", "");
        const alpha = parseInt(alphaValue, 10);
        if (!isNaN(alpha)) {
          style.opacity = alpha / 100;
        }
      } else {
        // Try to use it as a theme color
        const color = toThemeColor(component.color);
        if (color) {
          style.color = color;
        }
      }
    } else {
      // Object color (with light/dark variants)
      const color = toThemeColor(component.color);
      if (color) {
        style.color = color;
      }
    }
  }

  // Width
  if (component.width) {
    style.width = typeof component.width === "number" ? `${component.width}px` : component.width;
  }

  return (
    <p className={classNames.join(" ")} style={style}>
      {component.value}
    </p>
  );
};

const renderTitle = (component: Widgets.Title) => {
  const classNames = ["font-semibold"];

  // Size mapping to headings
  if (component.size === "xs") {
    classNames.push("text-base");
  } else if (component.size === "sm") {
    classNames.push("text-lg");
  } else if (component.size === "md") {
    classNames.push("text-xl");
  } else if (component.size === "lg") {
    classNames.push("text-2xl");
  } else if (component.size === "xl") {
    classNames.push("text-3xl");
  } else {
    classNames.push("text-xl");
  }

  const style: React.CSSProperties = {};

  // Text alignment
  if (component.textAlign === "center") {
    classNames.push("text-center");
  } else if (component.textAlign === "right") {
    classNames.push("text-right");
  } else if (component.textAlign === "left") {
    classNames.push("text-left");
  }

  // Custom color
  if (component.color) {
    const color = toThemeColor(component.color);
    if (color) {
      style.color = color;
    }
  }

  return (
    <h3 className={classNames.join(" ")} style={style}>
      {component.value}
    </h3>
  );
};

const renderCaption = (component: Widgets.Caption) => {
  const classNames = ["text-secondary"];

  // Size mapping
  if (component.size === "xs") {
    classNames.push("text-xs");
  } else if (component.size === "sm") {
    classNames.push("text-sm");
  } else {
    classNames.push("text-sm");
  }

  const style: React.CSSProperties = {};

  // Custom color
  if (component.color) {
    const color = toThemeColor(component.color);
    if (color) {
      style.color = color;
    }
  }

  return (
    <p className={classNames.join(" ")} style={style}>
      {component.value}
    </p>
  );
};

const renderBadge = (component: Widgets.Badge) => {
  const classNames = ["badge"];

  // Color variants
  if (component.color === "primary" || component.color === "blue") {
    classNames.push("badge-primary");
  } else if (component.color === "secondary" || component.color === "gray") {
    classNames.push("badge-secondary");
  } else if (component.color === "danger" || component.color === "red") {
    classNames.push("badge-danger");
  } else if (component.color === "success" || component.color === "green") {
    classNames.push("badge-success");
  } else if (component.color === "warning" || component.color === "yellow") {
    classNames.push("badge-warning");
  } else if (component.color === "info" || component.color === "cyan") {
    classNames.push("badge-info");
  }

  // Variant (solid, outline, soft)
  if (component.variant === "outline") {
    classNames.push("badge-outline");
  } else if (component.variant === "soft") {
    classNames.push("badge-soft");
  }

  // Size
  if (component.size === "sm") {
    classNames.push("badge-sm");
  } else if (component.size === "lg") {
    classNames.push("badge-lg");
  }

  return <span className={classNames.join(" ")}>{component.label}</span>;
};

const renderStatus = (status?: Widgets.WidgetStatus) => {
  if (!status) {
    return null;
  }
  const classNames = ["flex items-center gap-2 text-sm"];
  if ("frame" in status && status.frame) {
    classNames.push("p-3 rounded-lg bg-surface-elevated border");
  }
  const iconName = "icon" in status ? status.icon : undefined;
  const favicon = "favicon" in status ? status.favicon : undefined;
  return (
    <div className={classNames.join(" ")} role="status">
      {favicon ? (
        <span className="inline-flex w-4 h-4" aria-hidden>
          <img src={favicon} alt="" className="w-full h-full object-contain" />
        </span>
      ) : null}
      {iconName ? (
        <span className="inline-flex w-4 h-4 text-secondary" aria-hidden>
          {renderWidgetIcon(iconName)}
        </span>
      ) : null}
      <span className="text-secondary">{status.text}</span>
    </div>
  );
};

const renderButton = (component: Widgets.Button) => {
  const classNames = ["btn"];

  // Style mapping: primary (default) or secondary
  if (component.style === "secondary") {
    classNames.push("btn-secondary");
  } else {
    classNames.push("btn-primary");
  }

  // Variant mapping (solid, outline, ghost)
  if (component.variant === "outline") {
    classNames.push("btn-outline");
  } else if (component.variant === "ghost") {
    classNames.push("btn-ghost");
  }

  // Color variants
  if (component.color === "danger" || component.color === "red") {
    classNames.push("btn-danger");
  } else if (component.color === "success" || component.color === "green") {
    classNames.push("btn-success");
  }

  // Size variants
  if (component.size === "sm") {
    classNames.push("btn-sm");
  } else if (component.size === "lg") {
    classNames.push("btn-lg");
  }

  // Block button (full width)
  if (component.block || component.uniform) {
    classNames.push("w-full");
  }

  const iconStyle = component.iconSize ? { fontSize: buttonIconSizeMap[component.iconSize] } : undefined;
  return (
    <button
      className={classNames.join(" ")}
      type={component.submit ? "submit" : "button"}
      disabled={component.disabled}
      aria-disabled={component.disabled ?? false}
    >
      {component.iconStart ? (
        <span className="btn-icon" style={iconStyle} aria-hidden>
          {renderWidgetIcon(component.iconStart)}
        </span>
      ) : null}
      <span>{component.label ?? "Bouton"}</span>
      {component.iconEnd ? (
        <span className="btn-icon" style={iconStyle} aria-hidden>
          {renderWidgetIcon(component.iconEnd)}
        </span>
      ) : null}
    </button>
  );
};

const renderImage = (component: Widgets.Image) => {
  const style: React.CSSProperties = {};
  const props = component as unknown as Record<string, unknown>;

  // Handle size, width, and height properties
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

  // Apply radius if specified
  if (props.radius !== undefined) {
    const formatted = formatRadius(props.radius);
    if (formatted) {
      style.borderRadius = formatted;
    }
  }

  // Default classes - use object-cover when size is specified, otherwise responsive
  const hasFixedSize = style.width !== undefined || style.height !== undefined;
  const imgClasses = hasFixedSize
    ? "rounded-lg object-cover"
    : "w-full h-auto rounded-lg";

  return (
    <figure className="my-4">
      <img
        src={component.src}
        alt={component.alt ?? "Prévisualisation du widget"}
        className={imgClasses}
        style={Object.keys(style).length > 0 ? style : undefined}
      />
      {component.caption ? (
        <figcaption className="text-sm text-secondary mt-2 text-center">
          {component.caption}
        </figcaption>
      ) : null}
    </figure>
  );
};

const renderIcon = (component: Widgets.Icon) => {
  const classNames = ["inline-flex"];

  // Size mapping
  if (component.size === "xs") {
    classNames.push("w-3 h-3");
  } else if (component.size === "sm") {
    classNames.push("w-4 h-4");
  } else if (component.size === "md") {
    classNames.push("w-5 h-5");
  } else if (component.size === "lg") {
    classNames.push("w-6 h-6");
  } else if (component.size === "xl") {
    classNames.push("w-8 h-8");
  } else {
    classNames.push("w-5 h-5");
  }

  const style: React.CSSProperties = {};
  if (component.color) {
    const color = toThemeColor(component.color);
    if (color) {
      style.color = color;
    }
  }

  const iconElement = renderWidgetIcon(component.name);
  return (
    <span className={classNames.join(" ")} aria-hidden style={style}>
      {iconElement ?? (
        <span className="inline-flex items-center justify-center text-xs bg-surface-elevated rounded px-1">
          {component.name}
        </span>
      )}
    </span>
  );
};

const renderDivider = (component: Widgets.Divider) => {
  const style: React.CSSProperties = {};
  if (component.color) {
    const color = toThemeColor(component.color);
    if (color) {
      style.borderColor = color;
    }
  }
  if (component.size) {
    style.borderWidth = typeof component.size === "number" ? `${component.size}px` : component.size;
  }
  if (component.flush) {
    style.marginInline = 0;
  }
  if (component.spacing) {
    applySpacing(style, "margin", component.spacing);
  }
  return <hr className="divider" style={style} />;
};

const renderCheckbox = (component: Widgets.Checkbox) => (
  <label className="checkbox">
    <input type="checkbox" checked={Boolean(component.defaultChecked)} disabled />
    <span>{component.label ?? component.name}</span>
  </label>
);

const renderInput = (component: Widgets.Input) => (
  <div className="form-group">
    <label className="form-label">{component.placeholder ?? component.name}</label>
    <input className="input" type={component.inputType ?? "text"} defaultValue={component.defaultValue} disabled />
  </div>
);

const renderTextarea = (component: Widgets.Textarea) => (
  <div className="form-group">
    <label className="form-label">{component.placeholder ?? component.name}</label>
    <textarea className="textarea" rows={component.rows ?? 3} defaultValue={component.defaultValue} disabled />
  </div>
);

const renderSelect = (component: Widgets.Select) => (
  <div className="form-group">
    <label className="form-label">{component.placeholder ?? component.name}</label>
    <select className="input" defaultValue={component.defaultValue} disabled>
      {component.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </div>
);

const renderDatePicker = (component: Widgets.DatePicker) => (
  <div className="form-group">
    <label className="form-label">{component.placeholder ?? component.name}</label>
    <input className="input" type="date" defaultValue={component.defaultValue} min={component.min} max={component.max} disabled />
  </div>
);

const renderLabel = (component: Widgets.Label) => (
  <span className="form-label">{component.text}</span>
);

const renderRadioGroup = (component: Widgets.RadioGroup) => (
  <fieldset className="form-group">
    <legend className="form-label">{component.name}</legend>
    <div className="flex flex-col gap-2">
      {component.options.map((option) => (
        <label key={option.value} className="radio">
          <input type="radio" name={component.name} defaultChecked={option.defaultChecked} disabled />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  </fieldset>
);

const renderMarkdown = (component: Widgets.Markdown) => (
  <div className="prose prose-sm max-w-none">
    <ReactMarkdown>{component.value}</ReactMarkdown>
  </div>
);

const renderUnsupported = (type: string) => (
  <div className="alert alert-warning text-sm">Composant non pris en charge : {type}</div>
);

const renderChildren = (children: unknown[]): React.ReactNode =>
  children.map((child, index) => (
    <Fragment key={index}>{renderNode(child)}</Fragment>
  ));

const renderBox = (box: BoxLike & { children?: unknown[] }) => {
  const styles = applyBoxStyles(box);
  const orientation = styles.flexDirection === "row" ? "row" : "column";
  return (
    <div className="flex" style={styles} data-orientation={orientation}>
      {renderChildren(Array.isArray(box.children) ? box.children : [])}
    </div>
  );
};

const renderForm = (box: Widgets.Form) => {
  const styles = applyBoxStyles(box);
  return (
    <form className="flex flex-col gap-4" style={styles}>
      {renderChildren(Array.isArray(box.children) ? box.children : [])}
      <p className="form-hint text-sm">Actions de formulaire désactivées en prévisualisation.</p>
    </form>
  );
};

const renderListView = (listView: Widgets.ListView) => {
  const children = Array.isArray(listView.children) ? listView.children : [];
  const limited = typeof listView.limit === "number" ? children.slice(0, listView.limit) : children;
  const wrapperClassNames = ["flex flex-col gap-3 p-4"];
  // Theme is handled via data-theme attribute
  const wrapperStyles: React.CSSProperties = {};
  applyBlockProps(wrapperStyles, listView as unknown as Record<string, unknown>);

  return (
    <section className={wrapperClassNames.join(" ")} style={wrapperStyles} data-theme={listView.theme}>
      {renderStatus(listView.status)}
      <div className="flex flex-col gap-3">
        {limited.map((item, index) => {
          const entry = item as Widgets.ListViewItem;
          const itemClassNames = ["flex flex-col gap-3 p-3"];
          if (entry.onClickAction) {
            itemClassNames.push("cursor-pointer hover:bg-surface-elevated rounded-lg transition-colors");
          }
          const itemStyles: React.CSSProperties = {};
          if (entry.align) {
            itemStyles.alignItems =
              entry.align === "start"
                ? "flex-start"
                : entry.align === "end"
                  ? "flex-end"
                  : entry.align;
          }
          if (entry.gap !== undefined) {
            const formatted = formatSpacing(entry.gap);
            if (formatted) {
              itemStyles.gap = formatted;
            }
          }
          return (
            <div key={index} className={itemClassNames.join(" ")} style={itemStyles}>
              {renderChildren(Array.isArray(entry.children) ? entry.children : [])}
            </div>
          );
        })}
      </div>
    </section>
  );
};

const renderCard = (card: Widgets.Card) => {
  const styles: React.CSSProperties = {};
  applyBlockProps(styles, card as unknown as Record<string, unknown>);
  const background = card.background
    ? toThemeColor(card.background) ?? (typeof card.background === "string" ? card.background : undefined)
    : undefined;
  if (background) {
    styles.background = background;
  }
  if (card.padding !== undefined) {
    // Disable card-body's default padding when widget has custom padding
    (styles as any)['--card-body-padding'] = '0';
    // Apply widget's padding to the section element
    applySpacing(styles, "padding", card.padding);
  }
  const classNames = ["card"];

  // Size variants - only control width
  if (card.size === "sm") {
    classNames.push("card-sm");
  } else if (card.size === "md") {
    classNames.push("card-md");
  } else if (card.size === "lg") {
    classNames.push("card-lg");
  }

  return (
    <section className={classNames.join(" ")} style={styles} data-theme={card.theme}>
      {renderStatus(card.status)}
      <div className="card-body">
        {renderChildren(Array.isArray(card.children) ? card.children : [])}
      </div>
      {card.confirm || card.cancel ? (
        <div className="card-footer flex items-center gap-3 justify-end">
          {card.confirm ? renderButton({
            type: "Button",
            label: card.confirm.label ?? "Confirmer",
            style: "primary",
          } as Widgets.Button) : null}
          {card.cancel ? renderButton({
            type: "Button",
            label: card.cancel.label ?? "Annuler",
            style: "secondary",
          } as Widgets.Button) : null}
        </div>
      ) : null}
    </section>
  );
};

const renderBasicRoot = (root: Widgets.BasicRoot) => {
  const styles = applyBoxStyles(root);
  return (
    <section className="p-4" style={styles} data-theme={root.theme}>
      {renderChildren(Array.isArray(root.children) ? root.children : [])}
    </section>
  );
};

const renderNode = (node: unknown): React.ReactNode => {
  if (!isRecord(node) || typeof node.type !== "string") {
    return null;
  }
  const type = node.type;
  switch (type) {
    case "Card":
      return renderCard(node as Widgets.Card);
    case "Basic":
      return renderBasicRoot(node as Widgets.BasicRoot);
    case "ListView":
      return renderListView(node as Widgets.ListView);
    case "Row":
    case "Col":
    case "Box":
      return renderBox(node as BoxLike & { children?: unknown[] });
    case "Form":
      return renderForm(node as Widgets.Form);
    case "Text":
      return renderText(node as Widgets.TextComponent);
    case "Title":
      return renderTitle(node as Widgets.Title);
    case "Caption":
      return renderCaption(node as Widgets.Caption);
    case "Badge":
      return renderBadge(node as Widgets.Badge);
    case "Markdown":
      return renderMarkdown(node as Widgets.Markdown);
    case "Button":
      return renderButton(node as Widgets.Button);
    case "Image":
      return renderImage(node as Widgets.Image);
    case "Icon":
      return renderIcon(node as Widgets.Icon);
    case "Divider":
      return renderDivider(node as Widgets.Divider);
    case "Checkbox":
      return renderCheckbox(node as Widgets.Checkbox);
    case "Input":
      return renderInput(node as Widgets.Input);
    case "Textarea":
      return renderTextarea(node as Widgets.Textarea);
    case "Select":
      return renderSelect(node as Widgets.Select);
    case "DatePicker":
      return renderDatePicker(node as Widgets.DatePicker);
    case "Label":
      return renderLabel(node as Widgets.Label);
    case "RadioGroup":
      return renderRadioGroup(node as Widgets.RadioGroup);
    case "Transition":
      return renderNode((node as Widgets.Transition).children);
    case "Spacer":
      return <div className="h-4" />;
    default:
      return renderUnsupported(type);
  }
};

const normalizeDefinition = (
  definition: Record<string, unknown>,
): Widgets.WidgetRoot | null => {
  if (!isRecord(definition) || typeof definition.type !== "string") {
    return null;
  }
  return definition as Widgets.WidgetRoot;
};

export const WidgetPreview = ({ definition }: WidgetPreviewProps) => {
  const normalized = useMemo(() => normalizeDefinition(definition), [definition]);
  if (!normalized) {
    return <div className="alert alert-danger text-sm">Définition du widget invalide.</div>;
  }
  return <div className="widget-preview">{renderNode(normalized)}</div>;
};
