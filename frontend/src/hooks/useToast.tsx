import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { ToastContainer } from "../components/feedback/ToastContainer";
import type { ToastProps, ToastType } from "../components/feedback/Toast";

interface ToastContextValue {
  showToast: (toast: Omit<ToastProps, "id" | "onClose">) => void;
  showSuccess: (message: string, title?: string) => void;
  showError: (message: string, title?: string) => void;
  showWarning: (message: string, title?: string) => void;
  showInfo: (message: string, title?: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

/**
 * ToastProvider - Context provider for toast notifications
 *
 * Wrap your app with this provider to enable toast notifications throughout.
 * Automatically renders the ToastContainer.
 *
 * @example
 * ```tsx
 * // In App.tsx
 * <ToastProvider>
 *   <YourApp />
 * </ToastProvider>
 * ```
 */
export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<ToastProps[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: Omit<ToastProps, "id" | "onClose">) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      const newToast: ToastProps = {
        ...toast,
        id,
        onClose: () => removeToast(id),
      };
      setToasts((prev) => [...prev, newToast]);
    },
    [removeToast]
  );

  const showSuccess = useCallback(
    (message: string, title?: string) => {
      showToast({ type: "success", message, title });
    },
    [showToast]
  );

  const showError = useCallback(
    (message: string, title?: string) => {
      showToast({ type: "error", message, title });
    },
    [showToast]
  );

  const showWarning = useCallback(
    (message: string, title?: string) => {
      showToast({ type: "warning", message, title });
    },
    [showToast]
  );

  const showInfo = useCallback(
    (message: string, title?: string) => {
      showToast({ type: "info", message, title });
    },
    [showToast]
  );

  const value: ToastContextValue = {
    showToast,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    removeToast,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onRemoveToast={removeToast} />
    </ToastContext.Provider>
  );
};

/**
 * useToast - Hook to show toast notifications
 *
 * Use this hook to display toast notifications from any component.
 *
 * @example
 * ```tsx
 * const { showSuccess, showError } = useToast();
 *
 * const handleSave = async () => {
 *   try {
 *     await saveData();
 *     showSuccess('Your changes have been saved.');
 *   } catch (error) {
 *     showError('Failed to save changes. Please try again.');
 *   }
 * };
 * ```
 */
export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};
