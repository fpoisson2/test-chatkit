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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
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

  return (
    <div style={{ position: "relative" }} ref={menuRef}>
      <button
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

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: "4px",
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
            minWidth: "200px",
            zIndex: 1000,
            overflow: "hidden",
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
                color: action.variant === "danger" ? "#ef4444" : "#1f2937",
                transition: "background-color 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!action.disabled) {
                  e.currentTarget.style.background = "#f3f4f6";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {action.icon && <span>{action.icon}</span>}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
