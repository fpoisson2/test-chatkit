import { useState, useRef, useEffect, useLayoutEffect, useCallback, RefObject } from 'react';

export interface UseScrollToBottomOptions {
  /** Distance from bottom (in pixels) to consider "at bottom" */
  threshold?: number;
  /** Thread ID to detect thread changes */
  threadId?: string | null;
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
  options: UseScrollToBottomOptions = {}
): UseScrollToBottomReturn {
  const { threshold = 100, threadId } = options;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const prevThreadIdRef = useRef<string | null | undefined>(threadId);
  const prevItemCountRef = useRef<number>(itemCount);

  // Scroll to bottom BEFORE paint for thread changes (useLayoutEffect)
  // This prevents the "grey zone" flash by scrolling before the browser paints
  useLayoutEffect(() => {
    const isThreadChange = prevThreadIdRef.current !== threadId;

    console.log('[useScrollToBottom] useLayoutEffect:', {
      isThreadChange,
      prevThreadId: prevThreadIdRef.current,
      threadId,
      itemCount,
    });

    if (isThreadChange && threadId) {
      // Thread change: scroll to bottom INSTANTLY before paint
      // Using scrollTop directly is more reliable than scrollIntoView for sync scroll
      const container = messagesContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
      // Also try scrollIntoView as fallback
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
    }

    prevThreadIdRef.current = threadId;
  }, [threadId, itemCount]);

  // Scroll smoothly for new messages in the same thread (useEffect - after paint is OK)
  useEffect(() => {
    const isNewMessage = itemCount > prevItemCountRef.current;

    if (isNewMessage) {
      console.log('[useScrollToBottom] useEffect: New message, smooth scroll');
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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

  // Function to scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return {
    messagesEndRef,
    messagesContainerRef,
    showScrollButton,
    scrollToBottom,
  };
}
