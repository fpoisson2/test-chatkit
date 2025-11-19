import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import "../../styles/components/admin.css";

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

  return (
    <DropdownMenu.Root open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="btn btn-sm btn-subtle"
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
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="actions-menu-dropdown"
          sideOffset={5}
          align="end"
          style={{
            zIndex: 110000, // Ensure it's above everything including Radix Dialogs
            minWidth: "200px",
            padding: "4px",
          }}
        >
          {actions.map((action, index) => (
            <DropdownMenu.Item
              key={index}
              disabled={action.disabled}
              className={`actions-menu-item ${action.variant === "danger" ? "actions-menu-item--danger" : ""}`}
              onSelect={(event) => {
                event.preventDefault(); // Prevent default closing to handle it manually if needed, or let it close
                action.onClick();
                setIsOpen(false);
              }}
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
                outline: "none",
              }}
            >
              {action.icon && <span>{action.icon}</span>}
              <span>{action.label}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
