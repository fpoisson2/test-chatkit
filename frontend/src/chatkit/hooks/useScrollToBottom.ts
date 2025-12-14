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
  const isTransitioningRef = useRef<boolean>(false);

  // Handle conversation switch: hide content, scroll, then show
  // This prevents the flash of content higher up during transition
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const isConversationSwitch = prevThreadIdRef.current !== threadId;
    prevThreadIdRef.current = threadId;

    if (isConversationSwitch) {
      isTransitioningRef.current = true;
      // Hide content immediately to prevent flash
      container.style.visibility = 'hidden';

      // Wait for content to render, then scroll and show
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
          container.style.visibility = 'visible';
          isTransitioningRef.current = false;
        });
      });
    }
  }, [threadId]);

  // Smooth scroll for new messages in the same conversation
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // Skip if we're in a conversation transition (handled by useLayoutEffect above)
    if (isTransitioningRef.current) {
      prevItemCountRef.current = itemCount;
      return;
    }

    // Only scroll if item count actually increased
    if (itemCount > prevItemCountRef.current) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }
    prevItemCountRef.current = itemCount;
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
