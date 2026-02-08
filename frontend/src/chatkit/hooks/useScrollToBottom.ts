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
  const pinnedItemIdRef = useRef<string | null>(null);
  const smoothScrollingRef = useRef(false);

  // Helper to clear pin and spacer
  const clearPin = useCallback(() => {
    pinnedItemIdRef.current = null;
    const anchor = messagesEndRef.current;
    if (anchor) anchor.style.minHeight = '0px';
  }, []);

  // Auto-scroll to bottom only when switching conversations
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const isConversationSwitch = prevThreadIdRef.current !== threadId;
    prevThreadIdRef.current = threadId;

    if (isConversationSwitch) {
      clearPin();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth',
          });
        });
      });
    }
  }, [itemCount, threadId, clearPin]);

  // When itemCount changes and we have a pinned item, adjust spacer and scroll
  useEffect(() => {
    const pinnedId = pinnedItemIdRef.current;
    if (!pinnedId) return;
    if (smoothScrollingRef.current) return;

    const container = messagesContainerRef.current;
    const anchor = messagesEndRef.current;
    if (!container || !anchor) return;

    const element = container.querySelector(`[data-item-id="${pinnedId}"]`) as HTMLElement | null;
    if (!element) return;

    // Save scroll position before measuring
    const savedScrollTop = container.scrollTop;

    // Temporarily remove anchor height to measure real content height
    anchor.style.minHeight = '0px';
    const contentScrollHeight = container.scrollHeight;

    const elementRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const elementTopInContent = elementRect.top - containerRect.top + container.scrollTop;
    const contentBelowElement = contentScrollHeight - elementTopInContent;
    const neededSpacer = Math.max(0, container.clientHeight - contentBelowElement);

    // Restore spacer and scroll position
    anchor.style.minHeight = `${neededSpacer}px`;
    container.scrollTop = savedScrollTop;

    if (neededSpacer <= 0) {
      pinnedItemIdRef.current = null;
    }

    // Scroll to keep the pinned element at the top
    requestAnimationFrame(() => {
      const updatedRect = element.getBoundingClientRect();
      const updatedContainerRect = container.getBoundingClientRect();
      const targetScrollTop = updatedRect.top - updatedContainerRect.top + container.scrollTop;
      container.scrollTop = targetScrollTop;
    });

  }, [itemCount]);

  // Spacer is cleaned up naturally when:
  // - A new message is sent (new pin replaces old)
  // - User clicks scroll-to-bottom button
  // - Conversation switch

  // Track scroll position to show/hide the "scroll to bottom" button
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < threshold;
      setShowScrollButton(!isAtBottom);
    };

    container.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [threshold]);

  // Function to scroll to bottom (manual trigger, always smooth)
  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    clearPin();
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }, [clearPin]);

  // Pin an item to the top of the visible area
  const scrollItemToTop = useCallback((itemId: string) => {
    const container = messagesContainerRef.current;
    const anchor = messagesEndRef.current;
    if (!container || !anchor) return;

    pinnedItemIdRef.current = itemId;
    smoothScrollingRef.current = true;

    setTimeout(() => {
      const element = container.querySelector(`[data-item-id="${itemId}"]`) as HTMLElement | null;
      if (!element) return;

      // Save current scroll position before measuring
      const savedScrollTop = container.scrollTop;

      // Temporarily remove spacer to measure real content
      anchor.style.minHeight = '0px';
      const contentScrollHeight = container.scrollHeight;

      const elementRect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const elementTopInContent = elementRect.top - containerRect.top + container.scrollTop;
      const contentBelowElement = contentScrollHeight - elementTopInContent;
      const neededSpacer = Math.max(0, container.clientHeight - contentBelowElement);

      // Set spacer and restore scroll position to avoid visual jump
      anchor.style.minHeight = `${neededSpacer}px`;
      container.scrollTop = savedScrollTop;

      requestAnimationFrame(() => {
        const updatedRect = element.getBoundingClientRect();
        const updatedContainerRect = container.getBoundingClientRect();
        const targetScrollTop = updatedRect.top - updatedContainerRect.top + container.scrollTop;
        container.scrollTo({
          top: targetScrollTop,
          behavior: 'smooth',
        });

        setTimeout(() => {
          smoothScrollingRef.current = false;
        }, 600);
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
