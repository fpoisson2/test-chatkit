import React from 'react';
import { Info, AlertTriangle, AlertCircle } from 'lucide-react';
import styles from './Field.module.css';

export interface FieldProps {
  label: string;
  required?: boolean;
  error?: string;
  warning?: string;
  hint?: string;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}

export const Field: React.FC<FieldProps> = ({
  label,
  required,
  error,
  warning,
  hint,
  children,
  htmlFor,
  className = '',
}) => {
  const hasError = !!error;
  const hasWarning = !!warning && !error;

  return (
    <div className={`${styles.field} ${className}`}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
        {required && (
          <span className={styles.required} aria-label="required">
            *
          </span>
        )}
      </label>

      <div className={hasError ? styles.inputError : ''}>
        {children}
      </div>

      {hint && !error && !warning && (
        <div className={styles.hint}>
          <Info size={14} aria-hidden />
          <span>{hint}</span>
        </div>
      )}

      {warning && !error && (
        <div className={styles.warning} role="alert">
          <AlertTriangle size={14} aria-hidden />
          <span>{warning}</span>
        </div>
      )}

      {error && (
        <div className={styles.error} role="alert">
          <AlertCircle size={14} aria-hidden />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
