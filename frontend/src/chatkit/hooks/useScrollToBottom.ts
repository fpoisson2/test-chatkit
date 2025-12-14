import { useState, useRef, useEffect, useLayoutEffect, useCallback, RefObject } from 'react';

export interface UseScrollToBottomOptions {
  /** Distance from bottom (in pixels) to consider "at bottom" */
  threshold?: number;
}

export interface UseScrollToBottomReturn {
  messagesEndRef: RefObject<HTMLDivElement | null>;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  showScrollButton: boolean;
  scrollToBottom: () => void;
}

/**
 * Hook to manage scroll-to-bottom functionality for chat messages.
 * Handles auto-scrolling on new messages and shows/hides a scroll button.
 */
export function useScrollToBottom(
  itemCount: number,
  options: UseScrollToBottomOptions = {},
  threadId?: string
): UseScrollToBottomReturn {
  const { threshold = 100 } = options;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const prevThreadIdRef = useRef<string | undefined>(threadId);
  const prevItemCountRef = useRef<number>(itemCount);
  // Track if we're in a conversation transition
  const isTransitioningRef = useRef<boolean>(false);

  // Hide container immediately on conversation switch (before paint)
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const isConversationSwitch = prevThreadIdRef.current !== threadId;

    if (isConversationSwitch) {
      isTransitioningRef.current = true;
      // Hide immediately to prevent flash of wrong content
      container.style.opacity = '0';
    }
  }, [threadId]);

  // Handle conversation switch after content loads
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const isConversationSwitch = prevThreadIdRef.current !== threadId;
    prevThreadIdRef.current = threadId;

    if (isConversationSwitch) {
      if (itemCount === 0) {
        // Content not loaded yet, stay hidden and wait
        return;
      }

      // Content is ready, scroll and reveal after async content (like Mermaid) settles
      // Use multiple rAFs + timeout to wait for async rendering
      const scrollAndReveal = () => {
        container.scrollTop = container.scrollHeight;
        // Additional delay for async content like Mermaid diagrams
        setTimeout(() => {
          container.scrollTop = container.scrollHeight;
          container.style.opacity = '1';
          isTransitioningRef.current = false;
        }, 100);
      };

      // Wait for initial DOM render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollAndReveal();
        });
      });
    }
  }, [threadId, itemCount]);

  // Handle content loading after conversation switch (when itemCount changes from 0)
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const prevCount = prevItemCountRef.current;
    const itemCountIncreased = itemCount > prevCount;
    prevItemCountRef.current = itemCount;

    // If we're transitioning and content just loaded
    if (isTransitioningRef.current && prevCount === 0 && itemCount > 0) {
      // Content just loaded, scroll and reveal
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
          setTimeout(() => {
            container.scrollTop = container.scrollHeight;
            container.style.opacity = '1';
            isTransitioningRef.current = false;
          }, 100);
        });
      });
    } else if (itemCountIncreased && !isTransitioningRef.current) {
      // New message in existing conversation - smooth scroll
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [itemCount]);

  // Track scroll position to show/hide the "scroll to bottom" button
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Consider "at bottom" if within threshold pixels from bottom
      const isAtBottom = scrollHeight - scrollTop - clientHeight < threshold;
      setShowScrollButton(!isAtBottom);
    };

    container.addEventListener('scroll', handleScroll);
    // Check initial state
    handleScroll();

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [threshold]);

  // Function to scroll to bottom (manual trigger, always smooth)
  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }, []);

  return {
    messagesEndRef,
    messagesContainerRef,
    showScrollButton,
    scrollToBottom,
  };
}
