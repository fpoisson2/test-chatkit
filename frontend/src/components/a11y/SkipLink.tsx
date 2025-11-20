import "./SkipLink.css";

export interface SkipLinkProps {
  href?: string;
  text?: string;
}

/**
 * SkipLink - Accessibility skip navigation link
 *
 * Provides a hidden link that becomes visible on keyboard focus,
 * allowing keyboard users to skip directly to main content.
 *
 * @example
 * ```tsx
 * // In your main layout
 * <SkipLink href="#main-content" text="Skip to main content" />
 * <header>...</header>
 * <main id="main-content">...</main>
 * ```
 */
export const SkipLink = ({
  href = "#main-content",
  text = "Skip to main content",
}: SkipLinkProps) => {
  return (
    <a href={href} className="skip-link">
      {text}
    </a>
  );
};
