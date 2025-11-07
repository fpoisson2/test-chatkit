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
          if (target.closest(selector)) {
            return;
          }
        }
      }

      for (const ref of refsRef.current) {
        const element = ref?.current;
        if (element && element.contains(target)) {
          return;
        }
      }

      handlerRef.current();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [enabled]);
};

export default useOutsidePointerDown;
