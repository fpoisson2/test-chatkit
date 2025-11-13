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
  const baseClassName = "chatkit-sidebar__workflow-list-item";
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
      {children}
      {menuProps ? <WorkflowActionMenu {...menuProps} /> : null}
      {trailingContent}
    </li>
  );
};

export default WorkflowSidebarListItem;
