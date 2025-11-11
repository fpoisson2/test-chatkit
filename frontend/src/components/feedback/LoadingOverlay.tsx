import { LoadingSpinner } from "./LoadingSpinner";
import "./LoadingOverlay.css";

export interface LoadingOverlayProps {
  isVisible: boolean;
  message?: string;
  cancelable?: boolean;
  onCancel?: () => void;
}

export const LoadingOverlay = ({
  isVisible,
  message,
  cancelable = false,
  onCancel,
}: LoadingOverlayProps) => {
  if (!isVisible) return null;

  return (
    <div className="loading-overlay" role="dialog" aria-modal="true" aria-label="Chargement en cours">
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
