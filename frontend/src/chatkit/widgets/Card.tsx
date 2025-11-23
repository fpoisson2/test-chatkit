import React from 'react';
import type { Card } from '../types';
import { WidgetRenderer, useWidgetContext } from './WidgetRenderer';
import { resolveColor, resolveSpacing } from './utils';

export function CardComponent(props: Card): JSX.Element {
  const {
    asForm,
    children,
    background,
    size = 'md',
    padding = 16,
    status,
    collapsed,
    confirm,
    cancel,
    theme,
  } = props;

  const { onAction, onFormData } = useWidgetContext();

  const style: React.CSSProperties = {
    background: resolveColor(background) || 'var(--color-surface-background)',
    borderRadius: '0.75rem',
    border: '1px solid var(--color-border-default)',
    ...resolveSpacing(padding),
    ...(size === 'full' ? { width: '100%' } : {}),
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    if (confirm && onAction) {
      onAction(confirm.action);
    }

    if (onFormData) {
      onFormData(formData);
    }
  };

  const content = (
    <>
      {status && (
        <div className="chatkit-card-status" style={{ marginBottom: '12px', fontSize: '14px', color: '#666' }}>
          {status.text}
        </div>
      )}
      {!collapsed && (
        <div className="chatkit-card-body">
          {children.map((child, index) => (
            <WidgetRenderer key={child.key || child.id || `child-${index}`} widget={child} />
          ))}
        </div>
      )}
      {(confirm || cancel) && (
        <div className="chatkit-card-footer" style={{ marginTop: '16px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          {cancel && (
            <button
              type="button"
              onClick={() => onAction?.(cancel.action)}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid #ddd',
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              {cancel.label}
            </button>
          )}
          {confirm && (
            <button
              type={asForm ? 'submit' : 'button'}
              onClick={!asForm ? () => onAction?.(confirm.action) : undefined}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                background: '#0066ff',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              {confirm.label}
            </button>
          )}
        </div>
      )}
    </>
  );

  if (asForm) {
    return (
      <form className="chatkit-card" style={style} onSubmit={handleSubmit} data-theme={theme}>
        {content}
      </form>
    );
  }

  return (
    <div className="chatkit-card" style={style} data-theme={theme}>
      {content}
    </div>
  );
}
