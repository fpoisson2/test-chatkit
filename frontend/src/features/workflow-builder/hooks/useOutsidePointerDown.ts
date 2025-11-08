import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";

type OutsidePointerDownRef =
  | MutableRefObject<HTMLElement | null>
  | RefObject<HTMLElement | null>;

type UseOutsidePointerDownOptions = {
  enabled?: boolean;
  excludeSelectors?: string[];
};

const isNode = (value: unknown): value is Node =>
  typeof window !== "undefined" && value instanceof Node;

export const useOutsidePointerDown = (
  refs: ReadonlyArray<OutsidePointerDownRef>,
  onOutsidePointerDown: () => void,
  options: UseOutsidePointerDownOptions = {},
): void => {
  const { enabled = true, excludeSelectors = [] } = options;
  const refsRef = useRef(refs);
  const handlerRef = useRef(onOutsidePointerDown);
  const excludeSelectorsRef = useRef(excludeSelectors);

  refsRef.current = refs;
  excludeSelectorsRef.current = excludeSelectors;

  useEffect(() => {
    handlerRef.current = onOutsidePointerDown;
  }, [onOutsidePointerDown]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!isNode(target)) {
        return;
      }

      // Check if target matches any excluded selectors
      if (target instanceof Element && excludeSelectorsRef.current.length > 0) {
        for (const selector of excludeSelectorsRef.current) {
          const closest = target.closest(selector);
          if (closest) {
            console.log('[useOutsidePointerDown] Ignoring click on excluded selector:', selector, 'target:', target, 'closest:', closest);
            return;
          }
        }
      }

      // Check if click is inside any of the provided refs
      let hasAtLeastOneValidRef = false;
      for (const ref of refsRef.current) {
        const element = ref?.current;
        if (element) {
          hasAtLeastOneValidRef = true;
          if (element.contains(target)) {
            console.log('[useOutsidePointerDown] Click inside ref, ignoring');
            return;
          }
        }
      }

      // If no refs are assigned yet, don't trigger outside click
      // This prevents false positives during component mount
      if (!hasAtLeastOneValidRef) {
        console.log('[useOutsidePointerDown] No valid refs assigned yet, ignoring click');
        return;
      }

      console.log('[useOutsidePointerDown] Outside click detected, calling handler. Target:', target, 'excludeSelectors:', excludeSelectorsRef.current);
      handlerRef.current();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [enabled]);
};

export default useOutsidePointerDown;
