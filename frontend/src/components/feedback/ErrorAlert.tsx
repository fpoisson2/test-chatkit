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
  const typeMap = {
    error: "alert-danger",
    warning: "alert-warning",
    info: "alert-info",
  };
  const alertClass = `alert ${typeMap[type]} ${className}`.trim();

  return (
    <div className={alertClass} role="alert" aria-live="assertive">
      <div className="alert-icon">
        <AlertCircle size={20} aria-hidden="true" />
      </div>
      <div className="alert-content">
        {title && <div className="alert-title">{title}</div>}
        <div>{message}</div>
      </div>
      {dismissible && onDismiss && (
        <button
          className="alert-close"
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
