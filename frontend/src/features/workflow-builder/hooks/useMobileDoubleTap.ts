/**
 * useMobileDoubleTap
 *
 * Hook for detecting double-tap gestures on mobile devices.
 * Provides a reusable pattern for handling double-tap with configurable
 * timeout and automatic cleanup.
 *
 * Responsibilities:
 * - Detect double-tap gestures
 * - Configurable timeout between taps
 * - Reset mechanism
 * - Cleanup on unmount
 *
 * @phase Phase 3.7 - Custom Hooks Creation
 */

import { useCallback, useRef, useEffect } from "react";

type DoubleTapHandler = () => void;

type UseMobileDoubleTapOptions = {
  /** Callback to execute on double-tap */
  onDoubleTap: DoubleTapHandler;
  /** Timeout between taps in milliseconds (default: 300) */
  timeout?: number;
  /** Enable/disable the double-tap detection (default: true) */
  enabled?: boolean;
};

type UseMobileDoubleTapReturn = {
  /** Handler to call on each tap */
  handleTap: () => void;
  /** Reset the tap count */
  resetTap: () => void;
  /** Check if a tap is pending */
  hasPendingTap: () => boolean;
};

/**
 * Hook for detecting double-tap gestures on mobile
 *
 * This hook provides a simple way to detect double-tap gestures with
 * a configurable timeout between taps. It automatically resets after
 * the timeout and cleans up on unmount.
 *
 * @example
 * ```typescript
 * const { handleTap, resetTap } = useMobileDoubleTap({
 *   onDoubleTap: () => {
 *      *     openPropertiesPanel();
 *   },
 *   timeout: 300
 * });
 *
 * // In your component
 * const handleNodeClick = (node) => {
 *   if (isMobileLayout) {
 *     handleTap(); // Will trigger onDoubleTap on second tap
 *   } else {
 *     // Single tap behavior for desktop
 *     openPropertiesPanel();
 *   }
 * };
 * ```
 */
export function useMobileDoubleTap(options: UseMobileDoubleTapOptions): UseMobileDoubleTapReturn {
  const { onDoubleTap, timeout = 300, enabled = true } = options;

  const tapCountRef = useRef<number>(0);
  const timeoutIdRef = useRef<NodeJS.Timeout | null>(null);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    };
  }, []);

  // Reset tap count
  const resetTap = useCallback(() => {
    tapCountRef.current = 0;
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
  }, []);

  // Handle tap
  const handleTap = useCallback(() => {
    if (!enabled) {
      return;
    }

    // Increment tap count
    tapCountRef.current += 1;

    // Check if this is a double tap
    if (tapCountRef.current === 2) {
      // Execute double-tap callback
      onDoubleTap();

      // Reset
      resetTap();
    } else if (tapCountRef.current === 1) {
      // Start timeout to reset tap count
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
      }

      timeoutIdRef.current = setTimeout(() => {
        resetTap();
      }, timeout);
    } else {
      // More than 2 taps - reset
      resetTap();
    }
  }, [enabled, onDoubleTap, resetTap, timeout]);

  // Check if tap is pending
  const hasPendingTap = useCallback(() => {
    return tapCountRef.current > 0;
  }, []);

  return {
    handleTap,
    resetTap,
    hasPendingTap,
  };
}

/**
 * Alternative implementation with element tracking
 * Useful when you need to ensure double-tap is on the same element
 *
 * @example
 * ```typescript
 * const { handleTap } = useMobileDoubleTapWithElement({
 *   onDoubleTap: (elementId) => {
 *      *   },
 *   timeout: 300
 * });
 *
 * // In your component
 * const handleNodeClick = (nodeId) => {
 *   handleTap(nodeId);
 * };
 * ```
 */
export function useMobileDoubleTapWithElement(
  options: Omit<UseMobileDoubleTapOptions, "onDoubleTap"> & {
    onDoubleTap: (elementId: string) => void;
  },
): {
  handleTap: (elementId: string) => void;
  resetTap: () => void;
  hasPendingTap: () => boolean;
} {
  const { onDoubleTap, timeout = 300, enabled = true } = options;

  const lastTappedElementRef = useRef<string | null>(null);
  const tapCountRef = useRef<number>(0);
  const timeoutIdRef = useRef<NodeJS.Timeout | null>(null);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    };
  }, []);

  // Reset tap count
  const resetTap = useCallback(() => {
    tapCountRef.current = 0;
    lastTappedElementRef.current = null;
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
  }, []);

  // Handle tap with element tracking
  const handleTap = useCallback(
    (elementId: string) => {
      if (!enabled) {
        return;
      }

      // Check if tapping the same element
      if (lastTappedElementRef.current === elementId) {
        tapCountRef.current += 1;

        if (tapCountRef.current === 2) {
          // Double tap detected on same element
          onDoubleTap(elementId);
          resetTap();
        }
      } else {
        // Different element - reset and start new count
        tapCountRef.current = 1;
        lastTappedElementRef.current = elementId;

        // Start timeout
        if (timeoutIdRef.current) {
          clearTimeout(timeoutIdRef.current);
        }

        timeoutIdRef.current = setTimeout(() => {
          resetTap();
        }, timeout);
      }
    },
    [enabled, onDoubleTap, resetTap, timeout],
  );

  // Check if tap is pending
  const hasPendingTap = useCallback(() => {
    return tapCountRef.current > 0;
  }, []);

  return {
    handleTap,
    resetTap,
    hasPendingTap,
  };
}
