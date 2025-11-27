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
}

// Module-level storage to persist display text and previous text across component remounts
interface CachedState {
  displayText: string;
  prevText: string;
}
const stateCache = new Map<string, CachedState>();

// Track the last displayed text globally (used when mounting a component for the first time)
let lastGlobalDisplayText: string | null = null;

export function AnimatedTitle({
  children,
  className = "",
  letterDuration = 30,
  transitionDelay = 50,
  stableId,
}: AnimatedTitleProps): JSX.Element {
  // Get cached state if available
  const getInitialState = () => {
    if (stableId && stateCache.has(stableId)) {
      const cached = stateCache.get(stableId)!;
      // If the cached state matches the new children, return it as-is (no animation needed)
      // Otherwise, return the cached displayText as both display and prev to start animation from there
      if (cached.displayText === children) {
        return cached;
      }
      // New title arrived - use cached displayText as starting point for animation
      return { displayText: cached.displayText, prevText: cached.displayText };
    }

    // First time mounting with this ID - use global last text if available
    if (lastGlobalDisplayText !== null && lastGlobalDisplayText !== children) {
      return { displayText: lastGlobalDisplayText, prevText: lastGlobalDisplayText };
    }

    // No cache and no suitable lastGlobalDisplayText
    // Start from empty string to animate the title appearing letter by letter
    return { displayText: "", prevText: "" };
  };

  const initialState = getInitialState();
  const [displayText, setDisplayText] = useState(initialState.displayText);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevTextRef = useRef(initialState.prevText);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update global last text whenever displayText changes
  useLayoutEffect(() => {
    lastGlobalDisplayText = displayText;
  }, [displayText]);

  // Update cache only at stable states (not during animation)
  // This prevents the cache from containing intermediate animation states
  // which would cause a flash if the component is remounted during animation
  useLayoutEffect(() => {
    if (stableId && !isAnimating) {
      stateCache.set(stableId, {
        displayText: displayText,
        prevText: prevTextRef.current,
      });
    }
  }, [displayText, stableId, isAnimating]);

  useLayoutEffect(() => {
    // Clear any ongoing animation
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
    }

    // Check if text has actually changed
    if (prevTextRef.current === children) {
      return;
    }

    const oldText = prevTextRef.current;
    const newText = children;

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

    // Cleanup
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, [children, letterDuration, transitionDelay]);

  return (
    <span
      className={`animated-title${isAnimating ? " animated-title--animating" : ""} ${className}`}
      data-animating={isAnimating ? "true" : undefined}
    >
      {displayText}
    </span>
  );
}
