import { Star } from "lucide-react";
import { type MouseEvent, type ReactNode } from "react";

import WorkflowActionMenu, {
  type WorkflowActionMenuProps,
} from "./WorkflowActionMenu";

export type WorkflowSidebarListItemMenuProps = Omit<WorkflowActionMenuProps, "containerClassName">;

export type WorkflowSidebarListItemProps = {
  isPinned: boolean;
  pinLabel: string;
  onTogglePin: (event: MouseEvent<HTMLButtonElement>) => void;
  menuProps?: WorkflowSidebarListItemMenuProps | null;
  hasActions?: boolean;
  dataAttributes?: Record<string, boolean | string | null | undefined>;
  className?: string;
  pinButtonTitle?: string;
  children: ReactNode;
  trailingContent?: ReactNode;
};

const WorkflowSidebarListItem = ({
  isPinned,
  pinLabel,
  onTogglePin,
  menuProps,
  hasActions,
  dataAttributes,
  className,
  pinButtonTitle,
  children,
  trailingContent,
}: WorkflowSidebarListItemProps) => {
  const baseClassName =
    "app-sidebar__workflow-list-item app-sidebar__workflow-list-item--with-pin";
  const listItemClassName = className ? `${baseClassName} ${className}` : baseClassName;
  const showActions = hasActions ?? Boolean(menuProps);
  const mergedDataAttributes: Record<string, string | undefined> = {
    "data-pinned": isPinned ? "" : undefined,
    "data-has-actions": showActions && menuProps ? "" : undefined,
  };

  if (dataAttributes) {
    for (const [name, value] of Object.entries(dataAttributes)) {
      if (value === null || value === undefined || value === false) {
        continue;
      }
      mergedDataAttributes[name] = value === true ? "" : value;
    }
  }

  return (
    <li className={listItemClassName} {...mergedDataAttributes}>
      <button
        type="button"
        className="app-sidebar__workflow-action-button app-sidebar__workflow-pin-button app-sidebar__workflow-pin-button--leading"
        aria-pressed={isPinned}
        aria-label={pinLabel}
        title={pinButtonTitle ?? pinLabel}
        onClick={onTogglePin}
      >
        <Star
          aria-hidden="true"
          className="app-sidebar__workflow-pin-icon"
          size={18}
          strokeWidth={isPinned ? 1.75 : 2}
          fill={isPinned ? "currentColor" : "none"}
        />
      </button>
      {children}
      {menuProps ? <WorkflowActionMenu {...menuProps} /> : null}
      {trailingContent}
    </li>
  );
};

export default WorkflowSidebarListItem;
