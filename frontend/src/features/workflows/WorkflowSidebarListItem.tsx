import { type ReactNode } from "react";

import WorkflowActionMenu, {
  type WorkflowActionMenuProps,
} from "./WorkflowActionMenu";

export type WorkflowSidebarListItemMenuProps = Omit<WorkflowActionMenuProps, "containerClassName">;

export type WorkflowSidebarListItemProps = {
  isPinned: boolean;
  menuProps?: WorkflowSidebarListItemMenuProps | null;
  hasActions?: boolean;
  dataAttributes?: Record<string, boolean | string | null | undefined>;
  className?: string;
  children: ReactNode;
  trailingContent?: ReactNode;
};

const WorkflowSidebarListItem = ({
  isPinned,
  menuProps,
  hasActions,
  dataAttributes,
  className,
  children,
  trailingContent,
}: WorkflowSidebarListItemProps) => {
  const baseClassName = "chatkit-sidebar__workflow-list-item";
  const listItemClassName = [
    baseClassName,
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
      {children}
      {menuProps ? <WorkflowActionMenu {...menuProps} /> : null}
      {trailingContent}
    </li>
  );
};

export default WorkflowSidebarListItem;
