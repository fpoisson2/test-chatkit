import { useState, useRef, useEffect } from "react";

interface ActionsMenuProps {
  actions: Array<{
    label: string;
    icon?: string;
    onClick: () => void;
    variant?: "default" | "danger";
    disabled?: boolean;
  }>;
}

export const ActionsMenu = ({ actions }: ActionsMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpwards, setOpenUpwards] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    const updatePosition = () => {
      if (!buttonRef.current || !menuRef.current) return;

      const buttonRect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const spaceBelow = viewportHeight - buttonRect.bottom;
      const estimatedMenuHeight = actions.length * 44 + 16; // 44px per item + padding
      const shouldOpenUpwards = spaceBelow < estimatedMenuHeight && buttonRect.top > estimatedMenuHeight;

      // Calculate menu width
      const menuWidth = 200;

      // Calculate position: try to align right edge of menu with right edge of button
      const preferredLeft = buttonRect.right - menuWidth;

      // Ensure menu stays within viewport with 8px margin
      let finalLeft = preferredLeft;
      if (finalLeft < 8) {
        finalLeft = 8; // Too far left, push right
      } else if (finalLeft + menuWidth > viewportWidth - 8) {
        finalLeft = viewportWidth - menuWidth - 8; // Too far right, push left
      }

      // Update DOM directly for instant synchronization
      const menu = menuRef.current;
      menu.style.left = `${finalLeft}px`;

      if (shouldOpenUpwards) {
        menu.style.bottom = `${viewportHeight - buttonRect.top + 4}px`;
        menu.style.top = 'auto';
      } else {
        menu.style.top = `${buttonRect.bottom + 4}px`;
        menu.style.bottom = 'auto';
      }

      // Update state only if direction changes (rare)
      if (shouldOpenUpwards !== openUpwards) {
        setOpenUpwards(shouldOpenUpwards);
      }
    };

    if (isOpen) {
      updatePosition();

      // Update position immediately on scroll to keep menu next to button
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);

      return () => {
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }
  }, [isOpen, actions.length, openUpwards]);

  return (
    <>
      <div style={{ position: "relative" }} ref={containerRef}>
        <button
          ref={buttonRef}
          type="button"
          className="btn btn-sm btn-subtle"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Actions"
          style={{
            padding: "4px 8px",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          Actions
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            style={{
              transition: "transform 0.2s",
              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div
          ref={menuRef}
          className="actions-menu-dropdown"
          style={{
            position: "fixed",
            width: "200px",
            maxHeight: "400px",
            overflowY: "auto",
            zIndex: 1000,
          }}
        >
          {actions.map((action, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                action.onClick();
                setIsOpen(false);
              }}
              disabled={action.disabled}
              className={`actions-menu-item ${action.variant === "danger" ? "actions-menu-item--danger" : ""}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                width: "100%",
                padding: "10px 14px",
                border: "none",
                background: "transparent",
                textAlign: "left",
                fontSize: "14px",
                cursor: action.disabled ? "not-allowed" : "pointer",
                opacity: action.disabled ? 0.5 : 1,
              }}
            >
              {action.icon && <span>{action.icon}</span>}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
};
