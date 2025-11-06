/**
 * Generic helper utilities for the workflow builder
 */

export type ClassValue =
  | string
  | false
  | null
  | undefined
  | Record<string, boolean | null | undefined>;

/**
 * Utility for combining classnames conditionally
 */
export const cx = (...values: ClassValue[]): string => {
  const classes: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (typeof value === "string") {
      classes.push(value);
      continue;
    }
    for (const [className, condition] of Object.entries(value)) {
      if (condition) {
        classes.push(className);
      }
    }
  }
  return classes.join(" ");
};
