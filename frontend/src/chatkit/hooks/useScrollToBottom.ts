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

  // Auto-scroll to bottom when new messages arrive or conversation changes
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // Use instant scroll when switching conversations to avoid visual glitches
    // Use smooth scroll only for new messages in the same conversation
    const isConversationSwitch = prevThreadIdRef.current !== threadId;

    // Debug logging
    console.log('[useScrollToBottom] Effect triggered', {
      isConversationSwitch,
      prevThreadId: prevThreadIdRef.current,
      newThreadId: threadId,
      itemCount,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      currentScrollTop: container.scrollTop,
    });

    prevThreadIdRef.current = threadId;

    if (isConversationSwitch) {
      // When switching conversations, wait for DOM to settle before scrolling
      // Double rAF ensures we scroll after the browser has painted the new content
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          console.log('[useScrollToBottom] rAF scroll', {
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight,
          });
          container.scrollTop = container.scrollHeight;
        });
      });
    } else {
      // Smooth scroll for new messages in same conversation
      console.log('[useScrollToBottom] Smooth scroll to bottom');
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [itemCount, threadId]);

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
