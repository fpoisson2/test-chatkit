import React, { Fragment, useMemo } from "react";
import ReactMarkdown from "react-markdown";

import type { Widgets } from "@openai/chatkit";

type WidgetPreviewProps = {
  definition: Record<string, unknown>;
};

type BoxLike =
  | Widgets.Box
  | Widgets.Row
  | Widgets.Col
  | Widgets.Form
  | Widgets.BasicRoot;

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

const applyBoxStyles = (box: BoxLike): React.CSSProperties => {
  const styles: React.CSSProperties = {
    display: "flex",
    flexDirection: box.type === "Row" ? "row" : "column",
  };
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
  if ("gap" in box && box.gap !== undefined) {
    const formatted = formatSpacing(box.gap);
    if (formatted) {
      styles.gap = formatted;
    }
  }
  if ("padding" in box && box.padding !== undefined) {
    applySpacing(styles, "padding", box.padding);
  }
  return styles;
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

const renderText = (component: Widgets.TextComponent) => {
  const classNames = ["widget-preview__text"];
  if (component.weight === "semibold" || component.weight === "bold" || component.weight === "medium") {
    classNames.push("widget-preview__text--bold");
  }
  if (component.italic) {
    classNames.push("widget-preview__text--italic");
  }
  const style: React.CSSProperties = {};
  if (component.size) {
    classNames.push(`widget-preview__text--${component.size}`);
  }
  if (component.lineThrough) {
    style.textDecoration = "line-through";
  }
  if (component.textAlign) {
    style.textAlign = component.textAlign as React.CSSProperties["textAlign"];
  }
  if (component.color) {
    const color = toThemeColor(component.color);
    if (color) {
      style.color = color;
    }
  }
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
  const classNames = ["widget-preview__title"];
  if (component.size) {
    classNames.push(`widget-preview__title--${component.size}`);
  }
  const style: React.CSSProperties = {};
  if (component.textAlign) {
    style.textAlign = component.textAlign as React.CSSProperties["textAlign"];
  }
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
  const classNames = ["widget-preview__caption"];
  if (component.size) {
    classNames.push(`widget-preview__caption--${component.size}`);
  }
  const style: React.CSSProperties = {};
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
  const classNames = ["widget-preview__badge"];
  if (component.color) {
    classNames.push(`widget-preview__badge--${component.color}`);
  }
  if (component.variant) {
    classNames.push(`widget-preview__badge--${component.variant}`);
  }
  if (component.size) {
    classNames.push(`widget-preview__badge--${component.size}`);
  }
  if (component.pill) {
    classNames.push("widget-preview__badge--pill");
  }
  return <span className={classNames.join(" ")}>{component.label}</span>;
};

const renderButton = (component: Widgets.Button) => {
  const classNames = ["widget-preview__button"];
  if (component.style === "secondary") {
    classNames.push("widget-preview__button--secondary");
  }
  if (component.variant) {
    classNames.push(`widget-preview__button--${component.variant}`);
  }
  if (component.color) {
    classNames.push(`widget-preview__button--${component.color}`);
  }
  if (component.block) {
    classNames.push("widget-preview__button--block");
  }
  return <button className={classNames.join(" ")} disabled>{component.label ?? "Bouton"}</button>;
};

const renderImage = (component: Widgets.Image) => (
  <figure className="widget-preview__image">
    <img src={component.src} alt={component.alt ?? "Prévisualisation du widget"} />
    {component.caption ? <figcaption>{component.caption}</figcaption> : null}
  </figure>
);

const renderIcon = (component: Widgets.Icon) => (
  <span className="widget-preview__icon" aria-hidden>
    {component.name}
  </span>
);

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
  return <hr className="widget-preview__divider" style={style} />;
};

const renderCheckbox = (component: Widgets.Checkbox) => (
  <label className="widget-preview__control">
    <input type="checkbox" checked={Boolean(component.defaultChecked)} disabled />
    <span>{component.label ?? component.name}</span>
  </label>
);

const renderInput = (component: Widgets.Input) => (
  <label className="widget-preview__control">
    <span className="widget-preview__control-label">{component.placeholder ?? component.name}</span>
    <input type={component.inputType ?? "text"} defaultValue={component.defaultValue} disabled />
  </label>
);

const renderTextarea = (component: Widgets.Textarea) => (
  <label className="widget-preview__control">
    <span className="widget-preview__control-label">{component.placeholder ?? component.name}</span>
    <textarea rows={component.rows ?? 3} defaultValue={component.defaultValue} disabled />
  </label>
);

const renderSelect = (component: Widgets.Select) => (
  <label className="widget-preview__control">
    <span className="widget-preview__control-label">{component.placeholder ?? component.name}</span>
    <select defaultValue={component.defaultValue} disabled>
      {component.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);

const renderDatePicker = (component: Widgets.DatePicker) => (
  <label className="widget-preview__control">
    <span className="widget-preview__control-label">{component.placeholder ?? component.name}</span>
    <input type="date" defaultValue={component.defaultValue} min={component.min} max={component.max} disabled />
  </label>
);

const renderLabel = (component: Widgets.Label) => (
  <span className="widget-preview__label">{component.text}</span>
);

const renderRadioGroup = (component: Widgets.RadioGroup) => (
  <fieldset className="widget-preview__control">
    <legend className="widget-preview__control-label">{component.name}</legend>
    {component.options.map((option) => (
      <label key={option.value} className="widget-preview__radio-option">
        <input type="radio" name={component.name} defaultChecked={option.defaultChecked} disabled />
        <span>{option.label}</span>
      </label>
    ))}
  </fieldset>
);

const renderMarkdown = (component: Widgets.Markdown) => (
  <ReactMarkdown className="widget-preview__markdown">{component.value}</ReactMarkdown>
);

const renderUnsupported = (type: string) => (
  <div className="widget-preview__unsupported">Composant non pris en charge : {type}</div>
);

const renderChildren = (children: unknown[]): React.ReactNode =>
  children.map((child, index) => (
    <Fragment key={index}>{renderNode(child)}</Fragment>
  ));

const renderBox = (box: BoxLike & { children?: unknown[] }) => {
  const styles = applyBoxStyles(box);
  return <div className="widget-preview__box" style={styles}>{renderChildren(Array.isArray(box.children) ? box.children : [])}</div>;
};

const renderForm = (box: Widgets.Form) => {
  const styles = applyBoxStyles(box);
  return (
    <form className="widget-preview__box" style={styles}>
      {renderChildren(Array.isArray(box.children) ? box.children : [])}
      <p className="widget-preview__hint">Actions de formulaire désactivées en prévisualisation.</p>
    </form>
  );
};

const renderListView = (listView: Widgets.ListView) => {
  const children = Array.isArray(listView.children) ? listView.children : [];
  const limited = typeof listView.limit === "number" ? children.slice(0, listView.limit) : children;
  return (
    <div className="widget-preview__list-view">
      {limited.map((item, index) => (
        <div key={index} className="widget-preview__list-item">
          {renderChildren(Array.isArray(item.children) ? item.children : [])}
        </div>
      ))}
    </div>
  );
};

const renderCard = (card: Widgets.Card) => {
  const styles: React.CSSProperties = {};
  const background = card.background ? toThemeColor(card.background) : undefined;
  if (background) {
    styles.background = background;
  }
  if (card.padding !== undefined) {
    applySpacing(styles, "padding", card.padding);
  }
  const classNames = ["widget-preview__card"];
  if (card.size) {
    classNames.push(`widget-preview__card--${card.size}`);
  }
  if (card.collapsed) {
    classNames.push("widget-preview__card--collapsed");
  }
  return (
    <section className={classNames.join(" ")} style={styles}>
      {renderChildren(Array.isArray(card.children) ? card.children : [])}
      {card.confirm || card.cancel ? (
        <div className="widget-preview__card-actions">
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
    <div className="widget-preview__basic" style={styles}>
      {renderChildren(Array.isArray(root.children) ? root.children : [])}
    </div>
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
      return <div className="widget-preview__spacer" />;
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
    return <div className="widget-preview__unsupported">Définition du widget invalide.</div>;
  }
  return <div className="widget-preview">{renderNode(normalized)}</div>;
};
