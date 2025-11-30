import { useEffect, useCallback } from 'react';

/**
 * Hook to automatically dismiss errors after a certain duration
 *
 * @param error The current error object or null
 * @param clearError Function to clear the error
 * @param timeoutMs Duration in milliseconds before auto-dismissing (default: 5000)
 */
export function useAutoDismissError(
  error: Error | null,
  clearError: () => void,
  timeoutMs: number = 5000
) {
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        clearError();
      }, timeoutMs);

      return () => clearTimeout(timer);
    }
  }, [error, clearError, timeoutMs]);
}
