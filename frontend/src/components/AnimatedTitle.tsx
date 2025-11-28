/**
 * AnimatedTitle - Component that animates text changes letter by letter
 */
import { useState, useLayoutEffect, useRef } from "react";
import "./AnimatedTitle.css";

export interface AnimatedTitleProps {
  children: string;
  className?: string;
  /** Duration in ms for each letter animation (default: 30ms) */
  letterDuration?: number;
  /** Delay in ms between disappear and appear animations (default: 50ms) */
  transitionDelay?: number;
  /** Stable identifier to maintain animation state across remounts (e.g., thread.id) */
  stableId?: string;
  /** When true, disables animation and shows text directly (useful during streaming) */
  disabled?: boolean;
}

// Module-level storage to persist display text and previous text across component remounts
interface CachedState {
  displayText: string;
  prevText: string;
}
const stateCache = new Map<string, CachedState>();

export function AnimatedTitle({
  children,
  className = "",
  letterDuration = 30,
  transitionDelay = 50,
  stableId,
  disabled = false,
}: AnimatedTitleProps): JSX.Element {
  // Get cached state if available
  const getInitialState = () => {
    // When disabled, always show text directly without any animation setup
    // This prevents flash when component mounts during streaming
    if (disabled) {
      return { displayText: children, prevText: children };
    }

    if (stableId && stateCache.has(stableId)) {
      // Component was previously mounted with this ID - use cached state
      return stateCache.get(stableId)!;
    }

    // First time mounting with this ID - start with empty string to animate appearance
    // This prevents the "overwriting" effect where a new thread appears to erase another title
    if (stableId) {
      return { displayText: "", prevText: "" };
    }

    return { displayText: children, prevText: children };
  };

  const initialState = getInitialState();
  const [displayText, setDisplayText] = useState(initialState.displayText);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevTextRef = useRef(initialState.prevText);
  const targetTextRef = useRef(children); // Track the target text for cleanup
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update cache whenever displayText changes
  useLayoutEffect(() => {
    if (stableId) {
      stateCache.set(stableId, {
        displayText: displayText,
        prevText: prevTextRef.current,
      });
    }
  }, [displayText, stableId]);

  useLayoutEffect(() => {
    // Clear any ongoing animation and finalize to target text
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = null;
    }

    const newText = children;
    targetTextRef.current = newText;

    // If disabled, always ensure displayText matches children (no animation)
    // This handles both text changes and disabled state changes
    if (disabled) {
      if (displayText !== newText || prevTextRef.current !== newText) {
        setDisplayText(newText);
        setIsAnimating(false);
        prevTextRef.current = newText;
      }
      return;
    }

    // Check if text has actually changed
    if (prevTextRef.current === children) {
      return;
    }

    const oldText = prevTextRef.current;

    // Ensure display shows old text before animation starts
    setDisplayText(oldText);
    setIsAnimating(true);

    // Phase 1: Disappear old text letter by letter (from end to start)
    const disappearPhase = () => {
      return new Promise<void>((resolve) => {
        let currentLength = oldText.length;

        const tick = () => {
          currentLength--;
          if (currentLength <= 0) {
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            setDisplayText("");
            resolve();
          } else {
            setDisplayText(oldText.substring(0, currentLength));
          }
        };

        // Execute first tick immediately to avoid delay
        tick();

        // Continue with interval if not finished
        if (currentLength > 0) {
          intervalRef.current = setInterval(tick, letterDuration);
        }
      });
    };

    // Phase 2: Appear new text letter by letter (from start to end)
    const appearPhase = () => {
      return new Promise<void>((resolve) => {
        let currentLength = 0;

        const tick = () => {
          currentLength++;
          setDisplayText(newText.substring(0, currentLength));

          if (currentLength >= newText.length) {
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            resolve();
          }
        };

        // Execute first tick immediately to avoid delay
        tick();

        // Continue with interval if not finished
        if (currentLength < newText.length) {
          intervalRef.current = setInterval(tick, letterDuration);
        }
      });
    };

    // Execute animation sequence
    const animate = async () => {
      await disappearPhase();

      // Small delay between phases
      await new Promise(resolve => {
        animationTimeoutRef.current = setTimeout(resolve, transitionDelay);
      });

      await appearPhase();

      // Animation complete
      setIsAnimating(false);
      prevTextRef.current = newText;
    };

    animate();

    // Cleanup: finalize animation state if interrupted
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
      // Update cache with final target text to prevent incomplete titles on remount
      if (stableId) {
        stateCache.set(stableId, {
          displayText: targetTextRef.current,
          prevText: targetTextRef.current,
        });
      }
    };
  // Note: displayText is intentionally not in deps to avoid re-running during animation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, letterDuration, transitionDelay, disabled]);

  return (
    <span
      className={`animated-title${isAnimating ? " animated-title--animating" : ""} ${className}`}
      data-animating={isAnimating ? "true" : undefined}
    >
      {displayText}
    </span>
  );
}
