import { useEffect } from "react";

type ClickOutsideHandlerOptions = {
  enabled: boolean;
  onClickOutside: () => void;
  shouldIgnoreEvent?: (target: Node) => boolean;
  onEscape?: (event: KeyboardEvent) => void;
};

export const useClickOutsideHandler = ({
  enabled,
  onClickOutside,
  shouldIgnoreEvent,
  onEscape,
}: ClickOutsideHandlerOptions) => {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (shouldIgnoreEvent?.(target)) {
        return;
      }
      onClickOutside();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onEscape?.(event);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    if (onEscape) {
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      if (onEscape) {
        window.removeEventListener("keydown", handleKeyDown);
      }
    };
  }, [enabled, onClickOutside, onEscape, shouldIgnoreEvent]);
};
