import { useState, useEffect, useRef, useCallback, type RefObject } from "react";

/**
 * Hook that detects if text content overflows its container.
 * Uses ResizeObserver to react to container size changes.
 *
 * @returns [ref, isOverflowing] - A ref to attach to the text element and a boolean indicating overflow
 */
export function useTextOverflow<T extends HTMLElement = HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const checkOverflow = useCallback(() => {
    const element = ref.current;
    if (element) {
      // Check if scrollWidth exceeds clientWidth (horizontal overflow)
      const hasOverflow = element.scrollWidth > element.clientWidth;
      setIsOverflowing(hasOverflow);
    }
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Initial check
    checkOverflow();

    // Create ResizeObserver to detect size changes
    const resizeObserver = new ResizeObserver(() => {
      checkOverflow();
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
