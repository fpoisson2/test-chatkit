import { Toast, type ToastProps } from "./Toast";
import "./Toast.css";

export interface ToastContainerProps {
  toasts: ToastProps[];
  onRemoveToast: (id: string) => void;
}

/**
 * ToastContainer - Container for managing multiple toast notifications
 *
 * Renders a fixed-position container that displays toast notifications
 * in the top-right corner of the screen.
 *
 * @example
 * ```tsx
 * const [toasts, setToasts] = useState<ToastProps[]>([]);
 *
 * const removeToast = (id: string) => {
 *   setToasts(prev => prev.filter(t => t.id !== id));
 * };
 *
 * <ToastContainer toasts={toasts} onRemoveToast={removeToast} />
 * ```
 */
export const ToastContainer = ({ toasts, onRemoveToast }: ToastContainerProps) => {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          {...toast}
          onClose={() => onRemoveToast(toast.id)}
        />
      ))}
    </div>
  );
};
