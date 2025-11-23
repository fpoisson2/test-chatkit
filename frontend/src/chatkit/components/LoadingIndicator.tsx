import React from 'react';
import './LoadingIndicator.css';

export interface LoadingIndicatorProps {
  label?: string;
  size?: 'small' | 'medium' | 'large';
}

export function LoadingIndicator({ label, size = 'medium' }: LoadingIndicatorProps): JSX.Element {
  return (
    <div className={`chatkit-loading chatkit-loading--${size}`} role="status" aria-live="polite">
      <div className="chatkit-loading__spinner">
        <span className="chatkit-loading__arc chatkit-loading__arc--primary" />
        <span className="chatkit-loading__arc chatkit-loading__arc--secondary" />
        <span className="chatkit-loading__dot" />
      </div>
      {label && <span className="chatkit-loading__label">{label}</span>}
    </div>
  );
}
