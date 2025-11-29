import { useState, useRef, useEffect, RefObject } from 'react';

export interface UseKeyboardOffsetReturn {
  keyboardOffset: number;
}

/**
 * Hook to manage virtual keyboard offset on mobile devices.
 * Adjusts the layout when the keyboard appears/disappears.
 */
export function useKeyboardOffset(
  messagesContainerRef: RefObject<HTMLDivElement | null>
): UseKeyboardOffsetReturn {
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const previousKeyboardOffsetRef = useRef(0);

  // Adjust keyboard offset when virtual keyboard appears/disappears on mobile
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const viewport = window.visualViewport;

    const updateKeyboardOffset = () => {
      const heightDiff = window.innerHeight - viewport.height;
      const offsetTop = viewport.offsetTop ?? 0;
      const offset = Math.max(0, heightDiff - offsetTop);
      setKeyboardOffset(offset);
    };

    updateKeyboardOffset();
    viewport.addEventListener('resize', updateKeyboardOffset);
    viewport.addEventListener('scroll', updateKeyboardOffset);

    return () => {
      viewport.removeEventListener('resize', updateKeyboardOffset);
      viewport.removeEventListener('scroll', updateKeyboardOffset);
    };
  }, []);

  // Preserve visible portion of chat when keyboard adjusts the viewport
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const delta = keyboardOffset - previousKeyboardOffsetRef.current;
    if (delta !== 0) {
      container.scrollTop += delta;
      previousKeyboardOffsetRef.current = keyboardOffset;
    }
  }, [keyboardOffset, messagesContainerRef]);

  return { keyboardOffset };
}
