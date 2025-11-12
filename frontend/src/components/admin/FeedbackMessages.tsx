import { ErrorAlert } from "../feedback/ErrorAlert";

export interface FeedbackMessagesProps {
  error?: string | null;
  success?: string | null;
  info?: string | null;
  onDismissError?: () => void;
  onDismissSuccess?: () => void;
  onDismissInfo?: () => void;
  className?: string;
}

/**
 * FeedbackMessages - Unified feedback display for admin pages
 *
 * Displays error, success, and info messages in a consistent way across all admin pages.
 * Uses ErrorAlert component for consistent styling and behavior.
 *
 * @example
 * ```tsx
 * const [error, setError] = useState<string | null>(null);
 * const [success, setSuccess] = useState<string | null>(null);
 *
 * <FeedbackMessages
 *   error={error}
 *   success={success}
 *   onDismissError={() => setError(null)}
 *   onDismissSuccess={() => setSuccess(null)}
 * />
 * ```
 */
export const FeedbackMessages = ({
  error,
  success,
  info,
  onDismissError,
  onDismissSuccess,
  onDismissInfo,
  className = "",
}: FeedbackMessagesProps) => {
  const hasMessages = error || success || info;

  if (!hasMessages) {
    return null;
  }

  return (
    <div className={`feedback-messages ${className}`.trim()} style={{ display: "grid", gap: "12px" }}>
      {error && (
        <ErrorAlert
          type="error"
          message={error}
          dismissible={!!onDismissError}
          onDismiss={onDismissError}
        />
      )}
      {success && (
        <ErrorAlert
          type="info"
          message={success}
          dismissible={!!onDismissSuccess}
          onDismiss={onDismissSuccess}
        />
      )}
      {info && (
        <ErrorAlert
          type="info"
          message={info}
          dismissible={!!onDismissInfo}
          onDismiss={onDismissInfo}
        />
      )}
    </div>
  );
};
