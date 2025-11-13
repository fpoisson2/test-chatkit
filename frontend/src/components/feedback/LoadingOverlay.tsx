import { LoadingSpinner } from "./LoadingSpinner";
import "./LoadingOverlay.css";

export interface LoadingOverlayProps {
  isVisible: boolean;
  message?: string;
  cancelable?: boolean;
  onCancel?: () => void;
  variant?: "overlay" | "fullscreen";
}

export const LoadingOverlay = ({
  isVisible,
  message,
  cancelable = false,
  onCancel,
  variant = "overlay",
}: LoadingOverlayProps) => {
  if (!isVisible) return null;

  const className = variant === "fullscreen"
    ? "loading-overlay loading-overlay--fullscreen"
    : "loading-overlay";

  return (
    <div className={className} role="dialog" aria-modal="true" aria-label="Chargement en cours">
      <div className="loading-overlay__content">
        <LoadingSpinner size="lg" text={message} />
        {cancelable && onCancel && (
          <button
            className="loading-overlay__cancel button button--subtle"
            onClick={onCancel}
            type="button"
          >
            Annuler
          </button>
        )}
      </div>
    </div>
  );
};
