import type { CSSProperties } from "react";
import "./LoadingSpinner.css";

export interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  text?: string;
  className?: string;
  fullScreen?: boolean;
  overlay?: boolean;
}

export const LoadingSpinner = ({
  size = "md",
  text,
  className = "",
  fullScreen = false,
  overlay = false,
}: LoadingSpinnerProps) => {
  const sizeStyles: Record<string, CSSProperties> = {
    sm: { width: "20px", height: "20px", borderWidth: "2px" },
    md: { width: "40px", height: "40px", borderWidth: "4px" },
    lg: { width: "60px", height: "60px", borderWidth: "6px" },
  };

  const containerClass = `loading-spinner-container ${className} ${
    fullScreen ? "loading-spinner-container--fullscreen" : ""
  } ${overlay ? "loading-spinner-container--overlay" : ""}`.trim();

  return (
    <div className={containerClass}>
      <div
        className="loading-spinner"
        style={sizeStyles[size]}
        role="status"
        aria-label={text || "Loading"}
        aria-live="polite"
      />
      {text && <p className="loading-spinner-text">{text}</p>}
    </div>
  );
};
