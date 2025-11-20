import { AlertCircle, X, CheckCircle, AlertTriangle, Info } from "lucide-react";
import "./ErrorAlert.css";

export interface ErrorAlertProps {
  message: string;
  title?: string;
  type?: "error" | "warning" | "info" | "success";
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
    success: "alert-success",
  };

  const iconMap = {
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
    success: CheckCircle,
  };

  const alertClass = `alert ${typeMap[type]} ${className}`.trim();
  const Icon = iconMap[type];

  return (
    <div className={alertClass} role="alert" aria-live="assertive">
      <div className="alert-icon">
        <Icon size={20} aria-hidden="true" />
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
