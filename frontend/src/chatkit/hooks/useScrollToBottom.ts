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
  // Track if we recently switched conversations (within last few renders)
  // to use instant scroll instead of smooth scroll for initial content load
  const recentSwitchCountRef = useRef<number>(0);

  // Instant scroll on conversation switch - runs BEFORE browser paint to prevent flash
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const isConversationSwitch = prevThreadIdRef.current !== threadId;
    prevThreadIdRef.current = threadId;

    if (isConversationSwitch) {
      // Mark that we recently switched - allow a few renders for async data to load
      recentSwitchCountRef.current = 3;
      // Synchronous scroll before paint prevents the flash of content higher up
      container.scrollTop = container.scrollHeight;
    }
  }, [threadId]);

  // Scroll when items change - instant after switch, smooth for new messages
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const itemCountChanged = itemCount !== prevItemCountRef.current;
    prevItemCountRef.current = itemCount;

    if (!itemCountChanged) return;

    // If we recently switched conversations, use instant scroll to prevent flash
    // This handles async data loading after the initial switch
    if (recentSwitchCountRef.current > 0) {
      recentSwitchCountRef.current--;
      container.scrollTop = container.scrollHeight;
    } else {
      // Normal new message in existing conversation - smooth scroll
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
