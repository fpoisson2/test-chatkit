import { useCallback, useId, useRef, useState } from "react";

import styles from "../NodeInspector.module.css";
import { useClickOutsideHandler } from "../../../../../hooks/useClickOutsideHandler";

type HelpTooltipProps = {
  label: string;
};

export const HelpTooltip = ({ label }: HelpTooltipProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipId = useId();
  const containerRef = useRef<HTMLSpanElement | null>(null);

  const closeTooltip = useCallback(() => {
    setIsOpen(false);
  }, []);

  const shouldIgnoreTooltipEvent = useCallback(
    (target: Node) => containerRef.current?.contains(target) ?? false,
    []
  );

  const handleTooltipEscape = useCallback(
    (_event: KeyboardEvent) => {
      closeTooltip();
    },
    [closeTooltip]
  );

  useClickOutsideHandler({
    enabled: isOpen,
    onClickOutside: closeTooltip,
    onEscape: handleTooltipEscape,
    shouldIgnoreEvent: shouldIgnoreTooltipEvent,
  });

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
