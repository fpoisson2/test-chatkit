import type { CSSProperties } from "react";
import "./LoadingSpinner.css";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  text?: string;
  className?: string;
}

export const LoadingSpinner = ({
  size = "md",
  text = "Loading...",
  className = "",
}: LoadingSpinnerProps) => {
  const sizeStyles: Record<string, CSSProperties> = {
    sm: { width: "20px", height: "20px", borderWidth: "2px" },
    md: { width: "40px", height: "40px", borderWidth: "4px" },
    lg: { width: "60px", height: "60px", borderWidth: "6px" },
  };

  return (
    <div className={`loading-spinner-container ${className}`}>
      <div
        className="loading-spinner"
        style={sizeStyles[size]}
        role="status"
        aria-label={text}
      />
      {text && <p className="loading-spinner-text">{text}</p>}
    </div>
  );
};
