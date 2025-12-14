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
  const prevItemCountRef = useRef<number>(itemCount);
  // Track if we're waiting for content to load after a conversation switch
  const waitingForContentRef = useRef<boolean>(false);

  // Handle conversation switch
  useEffect(() => {
    const isConversationSwitch = prevThreadIdRef.current !== threadId;
    prevThreadIdRef.current = threadId;

    if (isConversationSwitch) {
      if (itemCount === 0) {
        // Content not loaded yet, wait for it
        waitingForContentRef.current = true;
      } else {
        // Content already available (cached), scroll now
        waitingForContentRef.current = false;
        const container = messagesContainerRef.current;
        if (container) {
          container.scrollTop = container.scrollHeight;
          // Follow-up scroll after content settles
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              container.scrollTop = container.scrollHeight;
            });
          });
        }
      }
    }
  }, [threadId, itemCount]);

  // Handle content loading after conversation switch, or new messages
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const itemCountChanged = itemCount !== prevItemCountRef.current;
    const itemCountIncreased = itemCount > prevItemCountRef.current;
    prevItemCountRef.current = itemCount;

    if (!itemCountChanged) return;

    if (waitingForContentRef.current && itemCount > 0) {
      // Content just loaded after conversation switch - instant scroll
      waitingForContentRef.current = false;
      container.scrollTop = container.scrollHeight;
      // Follow-up scroll after content settles
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      });
    } else if (itemCountIncreased && !waitingForContentRef.current) {
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
