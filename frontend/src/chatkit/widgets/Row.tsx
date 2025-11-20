import React from 'react';
import type { RowWidget } from '../types';
import { WidgetRenderer } from './WidgetRenderer';
import { resolveBoxBaseStyle } from './Box';

export function RowComponent(props: RowWidget): JSX.Element {
  const { children } = props;

  const style: React.CSSProperties = {
    ...resolveBoxBaseStyle(props),
    flexDirection: 'row',
  };

  return (
    <div className="chatkit-row" style={style}>
      {children?.map((child, index) => (
        <WidgetRenderer key={child.key || child.id || `child-${index}`} widget={child} />
      ))}
    </div>
  );
}
