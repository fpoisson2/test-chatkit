import React from 'react';
import type { ColWidget } from '../types';
import { WidgetRenderer } from './WidgetRenderer';
import { resolveBoxBaseStyle } from './Box';

export function ColComponent(props: ColWidget): JSX.Element {
  const { children } = props;

  const style: React.CSSProperties = {
    ...resolveBoxBaseStyle(props),
    flexDirection: 'column',
  };

  return (
    <div className="chatkit-col" style={style}>
      {children?.map((child, index) => (
        <WidgetRenderer key={child.key || child.id || `child-${index}`} widget={child} />
      ))}
    </div>
  );
}
