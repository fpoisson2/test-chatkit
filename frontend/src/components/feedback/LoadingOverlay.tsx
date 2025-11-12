import { useI18n } from "../../i18n";

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

  const { t } = useI18n();
  const overlayLabel = t("feedback.loading.overlayLabel");
  const cancelLabel = t("feedback.loading.cancel");
  const messageId = message ? "loading-overlay-message" : undefined;

  return (
    <div className="loading-overlay" role="dialog" aria-modal="true" aria-label={overlayLabel} aria-describedby={messageId}>
      <div className="loading-overlay__content">
        <LoadingSpinner size="lg" ariaLabel={overlayLabel} />
        {message && (
          <p id={messageId} className="loading-overlay__message">
            {message}
          </p>
        )}
        {cancelable && onCancel && (
          <button
            className="loading-overlay__cancel button button--subtle"
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
        )}
      </div>
    </div>
  );
};
