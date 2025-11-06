import { useEffect } from "react";

interface UseEscapeKeyHandlerOptions {
  enabled?: boolean;
  preventDefault?: boolean;
}

export const useEscapeKeyHandler = (
  onEscape: (event: KeyboardEvent) => void,
  { enabled = true, preventDefault = false }: UseEscapeKeyHandlerOptions = {},
) => {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!enabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (preventDefault) {
        event.preventDefault();
      }

      onEscape(event);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, onEscape, preventDefault]);
};
