import { useState, useLayoutEffect, useRef, useCallback, type RefObject } from "react";

/**
 * Hook that detects if text content overflows its container.
 * Uses ResizeObserver to react to container size changes.
 *
 * IMPORTANT: Uses useLayoutEffect to prevent visual flashing during layout changes.
 * The overflow check happens synchronously before paint.
 *
 * @returns [ref, isOverflowing] - A ref to attach to the text element and a boolean indicating overflow
 */
export function useTextOverflow<T extends HTMLElement = HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  // Track the last known overflow state to avoid unnecessary state updates
  const lastOverflowRef = useRef(false);

  const checkOverflow = useCallback(() => {
    const element = ref.current;
    if (element) {
      // Check if scrollWidth exceeds clientWidth (horizontal overflow)
      const hasOverflow = element.scrollWidth > element.clientWidth;
      // Only update state if the value actually changed
      if (hasOverflow !== lastOverflowRef.current) {
        lastOverflowRef.current = hasOverflow;
        setIsOverflowing(hasOverflow);
      }
    }
  }, []);

  // Use useLayoutEffect to check overflow BEFORE paint (prevents flash)
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Initial check (synchronous, before paint)
    checkOverflow();

    // Create ResizeObserver to detect size changes
    const resizeObserver = new ResizeObserver(() => {
      // Use requestAnimationFrame to batch resize callbacks
      // This prevents multiple rapid state updates
      requestAnimationFrame(checkOverflow);
    });

    resizeObserver.observe(element);

    // Also observe parent for layout changes
    if (element.parentElement) {
      resizeObserver.observe(element.parentElement);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [checkOverflow]);

  return [ref, isOverflowing];
}
