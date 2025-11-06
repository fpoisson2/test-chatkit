import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";

type OutsidePointerDownRef =
  | MutableRefObject<HTMLElement | null>
  | RefObject<HTMLElement | null>;

type UseOutsidePointerDownOptions = {
  enabled?: boolean;
};

const isNode = (value: unknown): value is Node =>
  typeof window !== "undefined" && value instanceof Node;

export const useOutsidePointerDown = (
  refs: ReadonlyArray<OutsidePointerDownRef>,
  onOutsidePointerDown: () => void,
  options: UseOutsidePointerDownOptions = {},
): void => {
  const { enabled = true } = options;
  const refsRef = useRef(refs);
  const handlerRef = useRef(onOutsidePointerDown);

  refsRef.current = refs;

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
