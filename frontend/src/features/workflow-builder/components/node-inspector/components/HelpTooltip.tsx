import { useEffect, useId, useRef, useState } from "react";

import styles from "../NodeInspector.module.css";

type HelpTooltipProps = {
  label: string;
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

  const buttonClassName = [
    styles.nodeInspectorHelpTooltipTrigger,
    isOpen ? styles.nodeInspectorHelpTooltipTriggerActive : "",
  ]
    .filter(Boolean)
    .join(" ");

  const bubbleClassName = [
    styles.nodeInspectorHelpTooltipBubble,
    isOpen ? styles.nodeInspectorHelpTooltipBubbleVisible : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span ref={containerRef} className={styles.nodeInspectorHelpTooltip}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        aria-controls={tooltipId}
        onClick={() => setIsOpen((value) => !value)}
        onBlur={handleBlur}
        className={buttonClassName}
      >
        ?
      </button>
      <span
        role="tooltip"
        id={tooltipId}
        aria-hidden={!isOpen}
        className={bubbleClassName}
      >
        {label}
      </span>
    </span>
  );
};
