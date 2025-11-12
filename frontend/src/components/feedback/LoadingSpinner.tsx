import type { CSSProperties } from "react";

import { useI18n } from "../../i18n";

import "./LoadingSpinner.css";

export interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  text?: string;
  className?: string;
  fullScreen?: boolean;
  overlay?: boolean;
  ariaLabel?: string;
}

const SIZE_STYLES: Record<NonNullable<LoadingSpinnerProps["size"]>, CSSProperties> = {
  sm: {
    "--spinner-size": "1.5rem",
    "--spinner-thickness": "2px",
  } as CSSProperties,
  md: {
    "--spinner-size": "2.5rem",
    "--spinner-thickness": "4px",
  } as CSSProperties,
  lg: {
    "--spinner-size": "3.5rem",
    "--spinner-thickness": "5px",
  } as CSSProperties,
};

export const LoadingSpinner = ({
  size = "md",
  text,
  className = "",
  fullScreen = false,
  overlay = false,
  ariaLabel,
}: LoadingSpinnerProps) => {
  const { t } = useI18n();

  const containerClass = [
    "loading-spinner-container",
    className,
    fullScreen ? "loading-spinner-container--fullscreen" : "",
    overlay ? "loading-spinner-container--overlay" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const resolvedAriaLabel = ariaLabel ?? text ?? t("feedback.loading.ariaLabel");

  return (
    <div className={containerClass}>
      <div className="loading-spinner" role="status" aria-live="polite" aria-busy="true" aria-label={resolvedAriaLabel}>
        <span className="loading-spinner__icon" style={SIZE_STYLES[size]} aria-hidden="true">
          <span className="loading-spinner__pulse" />
        </span>
      </div>
      {text && <p className="loading-spinner-text">{text}</p>}
    </div>
  );
};
