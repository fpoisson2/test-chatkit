import React from 'react';
import type {
  BoxWidget,
  CardWidget,
  ColWidget,
  FormWidget,
  ListViewItem,
  ListViewWidget,
  RowWidget,
  ButtonWidget,
  WidgetRoot,
} from '../../types';
import {
  applyBlockProps,
  applyBoxStyles,
  applySpacing,
  formatSpacing,
  toThemeColor,
} from '../../utils';
import { renderWidgetIcon } from '../../../components/widgetIcons';
import type { WidgetContext, RenderChildrenFn } from './types';
import { renderButton } from './UIRenderers';

type BoxLike = BoxWidget | RowWidget | ColWidget | FormWidget | WidgetRoot;

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

export const renderListView = (
  listView: ListViewWidget,
  context: WidgetContext,
  renderChildren: RenderChildrenFn
): JSX.Element => {
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

export const renderCard = (
  card: CardWidget,
  context: WidgetContext,
  renderChildren: RenderChildrenFn
): JSX.Element => {
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

export const renderBox = (
  node: BoxLike,
  context: WidgetContext,
  renderChildren: RenderChildrenFn
): JSX.Element => {
  const styles = applyBoxStyles(node);
  return (
    <div className="flex" style={styles} data-theme={(node as any).theme}>
      {renderChildren(Array.isArray((node as any).children) ? (node as any).children : [], context)}
    </div>
  );
};

export const renderBasicRoot = (
  root: WidgetRoot,
  context: WidgetContext,
  renderChildren: RenderChildrenFn
): JSX.Element => {
  const styles = applyBoxStyles(root);
  return (
    <section className="p-4" style={styles} data-theme={root.theme}>
      {renderChildren(Array.isArray(root.children) ? root.children : [], context)}
    </section>
  );
};
