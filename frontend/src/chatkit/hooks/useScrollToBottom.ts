import { useState, useRef, useEffect, useCallback, RefObject } from 'react';

export interface UseScrollToBottomOptions {
  /** Distance from bottom (in pixels) to consider "at bottom" */
  threshold?: number;
}

export interface UseScrollToBottomReturn {
  messagesEndRef: RefObject<HTMLDivElement | null>;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  showScrollButton: boolean;
  scrollToBottom: () => void;
  scrollItemToTop: (itemId: string) => void;
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
  const autoScrollActiveRef = useRef(false);

  // Auto-scroll to bottom only when switching conversations
  // For new messages, do NOT force scroll - user stays at current position
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const isConversationSwitch = prevThreadIdRef.current !== threadId;
    prevThreadIdRef.current = threadId;

    if (isConversationSwitch) {
      // When switching conversations, wait for DOM to settle before scrolling
      // Double rAF ensures we scroll after the browser has painted the new content
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth',
          });
        });
      });
    }
  }, [itemCount, threadId]);

  // Auto-scroll to bottom as new content arrives (during streaming)
  useEffect(() => {
    if (!autoScrollActiveRef.current) return;

    const container = messagesContainerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'instant',
    });
  }, [itemCount]);

  // Track scroll position to show/hide the "scroll to bottom" button
  // and disable auto-scroll if user scrolls up manually
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Consider "at bottom" if within threshold pixels from bottom
      const isAtBottom = scrollHeight - scrollTop - clientHeight < threshold;
      setShowScrollButton(!isAtBottom);

      // If user scrolls away from bottom, stop auto-scrolling
      if (!isAtBottom && autoScrollActiveRef.current) {
        const scrolledUpSignificantly = scrollHeight - scrollTop - clientHeight > 200;
        if (scrolledUpSignificantly) {
          autoScrollActiveRef.current = false;
        }
      }
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

  // Scroll to bottom and enable auto-scroll for streaming content
  const scrollItemToTop = useCallback((_itemId: string) => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // Activate auto-scroll so new streaming content stays visible
    autoScrollActiveRef.current = true;

    setTimeout(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'instant',
      });
    }, 50);
  }, []);

  return {
    messagesEndRef,
    messagesContainerRef,
    showScrollButton,
    scrollToBottom,
    scrollItemToTop,
  };
}
