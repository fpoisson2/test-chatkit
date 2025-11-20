import { useEffect, useState } from "react";
import "./LiveRegion.css";

export interface LiveRegionProps {
  message: string;
  priority?: "polite" | "assertive";
  clearOnUnmount?: boolean;
}

/**
 * LiveRegion - Screen reader announcement component
 *
 * Provides an ARIA live region for announcing dynamic content changes
 * to screen reader users. Useful for status updates, form validation,
 * and notifications.
 *
 * @example
 * ```tsx
 * const [statusMessage, setStatusMessage] = useState('');
 *
 * const handleSave = async () => {
 *   setStatusMessage('Saving...');
 *   await save();
 *   setStatusMessage('Saved successfully!');
 * };
 *
 * <LiveRegion message={statusMessage} priority="polite" />
 * ```
 */
export const LiveRegion = ({
  message,
  priority = "polite",
  clearOnUnmount = true,
}: LiveRegionProps) => {
  const [announcement, setAnnouncement] = useState(message);

  useEffect(() => {
    // Small delay ensures screen readers pick up the change
    const timer = setTimeout(() => {
      setAnnouncement(message);
    }, 100);

    return () => {
      clearTimeout(timer);
      if (clearOnUnmount) {
        setAnnouncement("");
      }
    };
  }, [message, clearOnUnmount]);

  return (
    <div
      role="status"
      aria-live={priority}
      aria-atomic="true"
      className="live-region"
    >
      {announcement}
    </div>
  );
};
