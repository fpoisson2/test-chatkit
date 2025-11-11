import { type ReactNode } from "react";
import "./ResponsiveCard.css";

export interface ResponsiveCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * ResponsiveCard - A card component optimized for mobile responsiveness
 *
 * Features:
 * - Prevents horizontal overflow on mobile
 * - Handles long text with proper word-wrapping
 * - Responsive padding and spacing
 * - Works with form inputs and complex content
 *
 * @example
 * ```tsx
 * <ResponsiveCard>
 *   <h2>Provider Configuration</h2>
 *   <input type="text" placeholder="Long URL..." />
 * </ResponsiveCard>
 * ```
 */
export const ResponsiveCard = ({ children, className = "" }: ResponsiveCardProps) => {
  return (
    <div className={`responsive-card ${className}`}>
      {children}
    </div>
  );
};
