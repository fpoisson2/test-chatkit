import type {
  CSSProperties,
  MutableRefObject,
  MouseEvent,
  ReactNode,
} from "react";

export type ActionMenuPlacement = "up" | "down";

type DisabledOptions = {
  disabled?: boolean;
};

type DangerOptions = DisabledOptions & { danger?: boolean };

const pointerState = (options?: DisabledOptions): CSSProperties => ({
  cursor: options?.disabled ? "not-allowed" : "pointer",
  opacity: options?.disabled ? 0.5 : 1,
});

export const getActionMenuStyle = (
  isMobile: boolean,
  placement: ActionMenuPlacement = "down",
): CSSProperties => ({
  position: "absolute",
  ...(isMobile
    ? placement === "up"
      ? {
          top: "auto",
          bottom: "calc(100% + 0.5rem)",
          right: "0",
          left: "auto",
        }
      : {
          top: "calc(100% + 0.5rem)",
          bottom: "auto",
          right: "0",
          left: "auto",
        }
    : placement === "up"
      ? {
          top: "auto",
          bottom: "calc(100% + 0.5rem)",
          right: "var(--chatkit-sidebar-content-padding-x)",
          left: "auto",
        }
      : {
          top: "calc(100% + 0.5rem)",
          bottom: "auto",
          right: "var(--chatkit-sidebar-content-padding-x)",
          left: "auto",
        }),
  background: "var(--surface-strong)",
  borderRadius: "var(--radius-2xl)",
  border: "1px solid var(--alpha-08)",
  boxShadow: "var(--shadow-soft)",
  padding: "calc(var(--spacing) * 3)",
  minWidth: isMobile ? "200px" : "220px",
  width: isMobile ? "max-content" : "max-content",
  maxWidth: isMobile ? "calc(100vw - 2rem)" : "min(320px, 100%)",
  display: "flex",
  flexDirection: "column",
  gap: "calc(var(--spacing) * 1.5)",
  zIndex: 40,
  pointerEvents: "auto",
});

export const getActionMenuItemStyle = (
  isMobile: boolean,
  options?: DangerOptions,
): CSSProperties => ({
  width: "100%",
  textAlign: "left",
  padding: "calc(var(--spacing) * 2) calc(var(--spacing) * 1.5)",
  borderRadius: "var(--radius-xl)",
  border: "none",
  background: "transparent",
  color: options?.danger ? "var(--danger-color)" : "var(--color-text-emphasis)",
  fontWeight: "var(--font-weight-semibold)",
  fontSize: "var(--font-text-sm-size)",
  ...pointerState(options),
});

export type WorkflowActionMenuItem = {
  key: string;
  label: ReactNode;
  onSelect?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
  hidden?: boolean;
};

export type WorkflowActionMenuProps = {
  menuId: string;
  isOpen: boolean;
  isMobileLayout: boolean;
  placement: ActionMenuPlacement;
  triggerDisabled?: boolean;
  triggerLabel: string;
  onOpen: (placement: ActionMenuPlacement) => void;
  onClose: () => void;
  triggerRef?: MutableRefObject<HTMLButtonElement | null>;
  menuRef?: MutableRefObject<HTMLDivElement | null>;
  items: WorkflowActionMenuItem[];
  containerClassName?: string;
};

const ESTIMATED_MENU_HEIGHT = 180;

export const computeWorkflowActionMenuPlacement = (
  trigger: HTMLElement,
): ActionMenuPlacement => {
  if (typeof window === "undefined") {
    return "down";
  }

  const triggerRect = trigger.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportHeight =
    viewport?.height ??
    window.innerHeight ??
    document.documentElement.clientHeight ??
    0;
  const viewportOffsetTop = viewport?.offsetTop ?? 0;
  const adjustedTop = triggerRect.top - viewportOffsetTop;
  const adjustedBottom = triggerRect.bottom - viewportOffsetTop;
  const spaceAbove = Math.max(0, adjustedTop);
  const spaceBelow = Math.max(0, viewportHeight - adjustedBottom);
  const shouldOpenUpwards = spaceBelow < ESTIMATED_MENU_HEIGHT && spaceAbove > spaceBelow;
  return shouldOpenUpwards ? "up" : "down";
};

export const WorkflowActionMenu = ({
  menuId,
  isOpen,
  isMobileLayout,
  placement,
  triggerDisabled,
  triggerLabel,
  onOpen,
  onClose,
  triggerRef,
  menuRef,
  items,
  containerClassName = "chatkit-sidebar__workflow-actions",
}: WorkflowActionMenuProps) => {
  const visibleItems = items.filter((item) => !item.hidden);

  const handleTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const trigger = event.currentTarget;
    if (triggerRef) {
      triggerRef.current = trigger;
    }
    if (isOpen) {
      onClose();
      return;
    }

    const nextPlacement = isMobileLayout ? computeWorkflowActionMenuPlacement(trigger) : "down";
    onOpen(nextPlacement);
  };

  return (
    <div className={containerClassName} data-workflow-menu-container="">
      <button
        type="button"
        className="chatkit-sidebar__workflow-action-button"
        data-workflow-menu-trigger=""
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-controls={menuId}
        disabled={triggerDisabled}
        onClick={handleTriggerClick}
      >
        <span aria-hidden="true">…</span>
        <span className="visually-hidden">{triggerLabel}</span>
      </button>
      {isOpen ? (
        <div
          id={menuId}
          role="menu"
          data-workflow-menu=""
          className="chatkit-sidebar__workflow-menu"
          style={getActionMenuStyle(isMobileLayout, placement)}
          ref={(node) => {
            if (!menuRef) {
              return;
            }
            if (node) {
              menuRef.current = node;
            } else if (menuRef.current) {
              menuRef.current = null;
            }
          }}
        >
          {visibleItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (item.disabled) {
                  return;
                }
                item.onSelect?.(event);
              }}
              disabled={item.disabled}
              style={getActionMenuItemStyle(isMobileLayout, {
                disabled: item.disabled,
                danger: item.danger,
              })}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default WorkflowActionMenu;
