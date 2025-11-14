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
  showPinButton?: boolean;
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
  showPinButton = true,
}: WorkflowSidebarListItemProps) => {
  const baseClassName = "chatkit-sidebar__workflow-list-item";
  const listItemClassName = [
    baseClassName,
    showPinButton ? "chatkit-sidebar__workflow-list-item--with-pin" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
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
      {showPinButton ? (
        <button
          type="button"
          className="chatkit-sidebar__workflow-action-button chatkit-sidebar__workflow-pin-button chatkit-sidebar__workflow-pin-button--leading"
          aria-label={pinLabel}
          title={pinButtonTitle ?? pinLabel}
          aria-pressed={isPinned}
          onClick={onTogglePin}
        >
          <Star aria-hidden="true" className="chatkit-sidebar__workflow-pin-icon" />
        </button>
      ) : null}
      {children}
      {menuProps ? <WorkflowActionMenu {...menuProps} /> : null}
      {trailingContent}
    </li>
  );
};

export default WorkflowSidebarListItem;
