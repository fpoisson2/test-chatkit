/**
 * TruncatedText - A component that applies a gradient fade effect only when text overflows
 */
import { useTextOverflow } from "../hooks/useTextOverflow";

export interface TruncatedTextProps {
  /** The text content to display */
  children: string;
  /** Base CSS class name */
  className: string;
  /** Additional class name to add when text is truncated (defaults to `${className}--truncated`) */
  truncatedClassName?: string;
}

/**
 * A span component that conditionally applies a gradient fade effect
 * only when the text content overflows its container.
 *
 * Usage:
 * ```tsx
 * <TruncatedText className="my-label">Some long text here</TruncatedText>
 * ```
 *
 * The component will apply `my-label--truncated` class when the text overflows.
 */
export function TruncatedText({
  children,
  className,
  truncatedClassName,
}: TruncatedTextProps): JSX.Element {
  const [ref, isOverflowing] = useTextOverflow<HTMLSpanElement>();
  const truncatedClass = truncatedClassName ?? `${className}--truncated`;

  return (
    <span
      ref={ref}
      className={`${className}${isOverflowing ? ` ${truncatedClass}` : ""}`}
    >
      {children}
    </span>
  );
}
