import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

type HelpTooltipProps = {
  label: string;
};

const helpTooltipContainerStyle: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
};

const helpTooltipButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.35rem",
  height: "1.35rem",
  borderRadius: "9999px",
  border: "1px solid var(--surface-border)",
  backgroundColor: "var(--surface-color)",
  color: "var(--text-color)",
  fontSize: "0.8rem",
  fontWeight: 700,
  cursor: "pointer",
  transition: "background-color 150ms ease, transform 150ms ease",
};

const helpTooltipButtonActiveStyle: CSSProperties = {
  backgroundColor: "#2563eb",
  borderColor: "rgba(37, 99, 235, 0.7)",
  color: "#ffffff",
};

const helpTooltipBubbleStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 0.5rem)",
  right: 0,
  zIndex: 10,
  maxWidth: "18rem",
  padding: "0.65rem 0.75rem",
  borderRadius: "0.75rem",
  backgroundColor: "var(--text-color)",
  color: "var(--main-background)",
  fontSize: "0.8rem",
  lineHeight: 1.4,
  boxShadow: "var(--shadow-card)",
};

const helpTooltipBubbleHiddenStyle: CSSProperties = {
  opacity: 0,
  transform: "translateY(-4px)",
  pointerEvents: "none",
};

const helpTooltipBubbleVisibleStyle: CSSProperties = {
  opacity: 1,
  transform: "translateY(0)",
};

export const HelpTooltip = ({ label }: HelpTooltipProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipId = useId();
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleBlur = () => {
    requestAnimationFrame(() => {
      if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
        setIsOpen(false);
      }
    });
  };

  return (
    <span ref={containerRef} style={helpTooltipContainerStyle}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        aria-controls={tooltipId}
        onClick={() => setIsOpen((value) => !value)}
        onBlur={handleBlur}
        style={{
          ...helpTooltipButtonStyle,
          ...(isOpen ? helpTooltipButtonActiveStyle : {}),
        }}
      >
        ?
      </button>
      <span
        role="tooltip"
        id={tooltipId}
        aria-hidden={!isOpen}
        style={{
          ...helpTooltipBubbleStyle,
          ...(isOpen ? helpTooltipBubbleVisibleStyle : helpTooltipBubbleHiddenStyle),
        }}
      >
        {label}
      </span>
    </span>
  );
};
