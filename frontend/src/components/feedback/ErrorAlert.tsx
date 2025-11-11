import { AlertCircle, X } from "lucide-react";
import "./ErrorAlert.css";

export interface ErrorAlertProps {
  message: string;
  title?: string;
  type?: "error" | "warning" | "info";
  onDismiss?: () => void;
  dismissible?: boolean;
  className?: string;
}

export const ErrorAlert = ({
  message,
  title,
  type = "error",
  onDismiss,
  dismissible = false,
  className = "",
}: ErrorAlertProps) => {
  const alertClass = `error-alert error-alert--${type} ${className}`.trim();

  return (
    <div className={alertClass} role="alert" aria-live="assertive">
      <div className="error-alert__icon">
        <AlertCircle size={20} aria-hidden="true" />
      </div>
      <div className="error-alert__content">
        {title && <div className="error-alert__title">{title}</div>}
        <div className="error-alert__message">{message}</div>
      </div>
      {dismissible && onDismiss && (
        <button
          className="error-alert__dismiss"
          onClick={onDismiss}
          aria-label="Fermer l'alerte"
          type="button"
        >
          <X size={20} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};
