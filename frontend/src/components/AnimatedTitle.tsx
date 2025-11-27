/**
 * AnimatedTitle - Component that animates text changes letter by letter
 */
import { useState, useEffect, useRef } from "react";
import "./AnimatedTitle.css";

export interface AnimatedTitleProps {
  children: string;
  className?: string;
  /** Duration in ms for each letter animation (default: 30ms) */
  letterDuration?: number;
  /** Delay in ms between disappear and appear animations (default: 50ms) */
  transitionDelay?: number;
}

export function AnimatedTitle({
  children,
  className = "",
  letterDuration = 30,
  transitionDelay = 50,
}: AnimatedTitleProps): JSX.Element {
  const [displayText, setDisplayText] = useState(children);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevTextRef = useRef(children);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear any ongoing animation
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
    }

    // Check if text has actually changed
    if (prevTextRef.current === children) {
      return;
    }

    const oldText = prevTextRef.current;
    const newText = children;

    // Start animation
    setIsAnimating(true);

    // Phase 1: Disappear old text letter by letter (from end to start)
    const disappearPhase = () => {
      return new Promise<void>((resolve) => {
        let currentLength = oldText.length;

        const disappearInterval = setInterval(() => {
          currentLength--;
          if (currentLength <= 0) {
            clearInterval(disappearInterval);
            setDisplayText("");
            resolve();
          } else {
            setDisplayText(oldText.substring(0, currentLength));
          }
        }, letterDuration);
      });
    };

    // Phase 2: Appear new text letter by letter (from start to end)
    const appearPhase = () => {
      return new Promise<void>((resolve) => {
        let currentLength = 0;

        const appearInterval = setInterval(() => {
          currentLength++;
          setDisplayText(newText.substring(0, currentLength));

          if (currentLength >= newText.length) {
            clearInterval(appearInterval);
            resolve();
          }
        }, letterDuration);
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
