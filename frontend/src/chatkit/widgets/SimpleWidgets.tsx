/**
 * Composants widgets simples
 */
import React, { useState, useEffect } from 'react';
import type {
  BadgeWidget,
  DividerWidget,
  SpacerWidget,
  IconWidget,
  ImageWidget,
  ListViewItem,
  ListView,
} from '../types';
import { resolveColor, resolveSpacingValue, resolveMargin } from './utils';
import { WidgetRenderer } from './WidgetRenderer';

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
        console.error('[SimpleWidgets] Failed to convert data URL to blob:', err);
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

export function BadgeComponent(props: BadgeWidget): JSX.Element {
  const { label, color = 'secondary', variant = 'solid', size = 'md', pill } = props;

  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: size === 'sm' ? '2px 8px' : size === 'lg' ? '6px 12px' : '4px 10px',
    fontSize: size === 'sm' ? '12px' : size === 'lg' ? '16px' : '14px',
    fontWeight: 500,
    borderRadius: pill ? '999px' : '4px',
    background: variant === 'solid' ? `var(--color-${color})` : variant === 'soft' ? `var(--color-${color}-light)` : 'transparent',
    color: variant === 'solid' ? '#fff' : `var(--color-${color})`,
    border: variant === 'outline' ? `1px solid var(--color-${color})` : 'none',
  };

  return (
    <span className="chatkit-badge" style={style}>
      {label}
    </span>
  );
}

export function DividerComponent(props: DividerWidget): JSX.Element {
  const { color, size = 1, spacing, flush } = props;

  const style: React.CSSProperties = {
    borderTop: `${size}px solid ${resolveColor(color) || 'var(--color-border-default)'}`,
    margin: flush ? 0 : resolveSpacingValue(spacing || 16),
  };

  return <hr className="chatkit-divider" style={style} />;
}

export function SpacerComponent(props: SpacerWidget): JSX.Element {
  const { minSize } = props;

  const style: React.CSSProperties = {
    flex: 1,
    minHeight: resolveSpacingValue(minSize),
    minWidth: resolveSpacingValue(minSize),
  };

  return <div className="chatkit-spacer" style={style} />;
}

export function IconComponent(props: IconWidget): JSX.Element {
  const { name, color, size = 'md' } = props;

  const style: React.CSSProperties = {
    color: resolveColor(color),
    fontSize: `var(--icon-size-${size})`,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  // Pour simplifier, on affiche le nom de l'icône
  // Dans une vraie implémentation, on utiliserait une bibliothèque d'icônes
  return (
    <span className="chatkit-icon" style={style} data-icon={name}>
      {/* Icône placeholder */}
      ●
    </span>
  );
}

export function ImageComponent(props: ImageWidget): JSX.Element {
  const {
    src,
    alt,
    fit = 'cover',
    position = 'center',
    radius,
    frame,
    flush,
    height,
    width,
    size,
    minHeight,
    minWidth,
    minSize,
    maxHeight,
    maxWidth,
    maxSize,
    margin,
    background,
    aspectRatio,
    flex,
  } = props;

  const style: React.CSSProperties = {
    objectFit: fit,
    objectPosition: position,
    borderRadius: radius ? `var(--radius-${radius})` : undefined,
    border: frame ? '1px solid var(--color-border-default)' : undefined,
    margin: flush ? 0 : undefined,
    height: resolveSpacingValue(height || size),
    width: resolveSpacingValue(width || size),
    minHeight: resolveSpacingValue(minHeight || minSize),
    minWidth: resolveSpacingValue(minWidth || minSize),
    maxHeight: resolveSpacingValue(maxHeight || maxSize),
    maxWidth: resolveSpacingValue(maxWidth || maxSize),
    ...resolveMargin(margin),
    background: resolveColor(background),
    aspectRatio: typeof aspectRatio === 'number' ? aspectRatio : aspectRatio,
    flex,
  };

  return <ImageWithBlobUrl src={src} alt={alt || ''} className="chatkit-image" style={style} />;
}

export function ListViewItemComponent(props: ListViewItem): JSX.Element {
  const { children, onClickAction, gap, align } = props;
  const { onAction } = useWidgetContext();

  const style: React.CSSProperties = {
    display: 'flex',
    gap: resolveSpacingValue(gap),
    alignItems: align,
    padding: '12px',
    cursor: onClickAction ? 'pointer' : undefined,
    borderBottom: '1px solid var(--color-border-subtle)',
  };

  const handleClick = () => {
    if (onClickAction && onAction) {
      onAction(onClickAction);
    }
  };

  return (
    <div className="chatkit-list-view-item" style={style} onClick={handleClick}>
      {children.map((child, index) => (
        <WidgetRenderer key={child.key || child.id || `child-${index}`} widget={child} />
      ))}
    </div>
  );
}

export function ListViewComponent(props: ListView): JSX.Element {
  const { children, limit, status, theme } = props;

  const [showAll, setShowAll] = React.useState(false);
  const displayedItems = limit && limit !== 'auto' && !showAll ? children.slice(0, limit) : children;
  const hasMore = limit && limit !== 'auto' && children.length > limit;

  return (
    <div className="chatkit-list-view" data-theme={theme}>
      {status && (
        <div className="chatkit-list-view-status" style={{ padding: '12px', fontSize: '14px', color: '#666' }}>
          {status.text}
        </div>
      )}
      <div className="chatkit-list-view-items">
        {displayedItems.map((child, index) => (
          <WidgetRenderer key={child.key || child.id || `item-${index}`} widget={child} />
        ))}
      </div>
      {hasMore && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          style={{
            padding: '8px 16px',
            margin: '12px',
            border: '1px solid #ddd',
            background: '#fff',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Show more ({children.length - displayedItems.length} more items)
        </button>
      )}
    </div>
  );
}

// Import nécessaire pour useWidgetContext
import { useWidgetContext } from './WidgetRenderer';
