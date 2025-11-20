import { AlertCircle, CheckCircle, Info, X, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import "./Toast.css";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastProps {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
  onClose?: () => void;
  dismissible?: boolean;
}

/**
 * Toast - Individual toast notification component
 *
 * Displays a temporary notification that appears in the toast container.
 * Supports success, error, warning, and info types with auto-dismiss.
 *
 * @example
 * ```tsx
 * <Toast
 *   id="toast-1"
 *   type="success"
 *   title="Success"
 *   message="Your changes have been saved."
 *   duration={5000}
 *   onClose={() => console.log('closed')}
 * />
 * ```
 */
export const Toast = ({
  id,
  type,
  title,
  message,
  duration = 5000,
  onClose,
  dismissible = true,
}: ToastProps) => {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        handleClose();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [duration]);

  const handleClose = () => {
    setIsClosing(true);
    // Wait for animation to complete before calling onClose
    setTimeout(() => {
      onClose?.();
    }, 200);
  };

  const iconMap = {
    success: CheckCircle,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const Icon = iconMap[type];

  return (
    <div
      className={`toast toast--${type} ${isClosing ? "toast--closing" : ""}`.trim()}
      role="alert"
      aria-live={type === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <div className="toast__icon">
        <Icon size={20} aria-hidden="true" />
      </div>
      <div className="toast__content">
        {title && <div className="toast__title">{title}</div>}
        <div className="toast__message">{message}</div>
      </div>
      {dismissible && (
        <button
          className="toast__close"
          onClick={handleClose}
          aria-label="Fermer la notification"
          type="button"
        >
          <X size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};
