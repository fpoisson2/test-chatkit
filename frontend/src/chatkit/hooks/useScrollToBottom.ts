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
  options: UseScrollToBottomOptions = {}
): UseScrollToBottomReturn {
  const { threshold = 100 } = options;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const container = messagesContainerRef.current;

    const cleanupFrames: number[] = [];

    const scrollAfterLayout = () => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    };

    const scheduleScroll = () => {
      // Use two rAF ticks to wait for layout/paint to settle before scrolling
      const frame1 = requestAnimationFrame(() => {
        const frame2 = requestAnimationFrame(scrollAfterLayout);
        cleanupFrames.push(frame2);
      });
      cleanupFrames.push(frame1);
    };

    // Wait for images to finish loading to avoid jumping while height adjusts
    const images = container?.querySelectorAll('img') ?? [];
    const pendingImages = Array.from(images).filter(img => !img.complete);

    if (pendingImages.length === 0) {
      scheduleScroll();
    } else {
      const handleImageLoad = () => {
        scheduleScroll();
      };
      pendingImages.forEach(img => img.addEventListener('load', handleImageLoad, { once: true }));

      return () => {
        pendingImages.forEach(img => img.removeEventListener('load', handleImageLoad));
        cleanupFrames.forEach(frameId => cancelAnimationFrame(frameId));
      };
    }

    return () => {
      cleanupFrames.forEach(frameId => cancelAnimationFrame(frameId));
    };
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
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    });
  }, []);

  return {
    messagesEndRef,
    messagesContainerRef,
    showScrollButton,
    scrollToBottom,
  };
}
