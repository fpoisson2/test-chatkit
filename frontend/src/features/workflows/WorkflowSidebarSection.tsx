import { type ReactNode } from "react";

import WorkflowSidebarListItem, {
  type WorkflowSidebarListItemMenuProps,
} from "./WorkflowSidebarListItem";

type WorkflowSidebarFloatingAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  icon?: ReactNode;
};

type WorkflowSidebarCompactEntry = {
  key?: string;
  label: string;
  initials: string;
  onClick?: () => void;
  disabled?: boolean;
  isActive?: boolean;
  ariaLabel?: string;
  hiddenLabelSuffix?: string;
};

export type WorkflowSidebarSectionEntry = {
  key: string;
  kind: "local" | "hosted";
  isPinned: boolean;
  menuProps?: WorkflowSidebarListItemMenuProps | null;
  hasActions?: boolean;
  dataAttributes?: Record<string, boolean | string | null | undefined>;
  content: ReactNode;
  trailingContent?: ReactNode;
  compact?: WorkflowSidebarCompactEntry | null;
};

export type WorkflowSidebarSectionProps = {
  sectionId: string;
  title: string;
  entries: WorkflowSidebarSectionEntry[];
  pinnedSectionTitle: string;
  defaultSectionTitle: string;
  floatingAction?: WorkflowSidebarFloatingAction;
  beforeGroups?: ReactNode;
  emptyState?: ReactNode;
  footerContent?: ReactNode;
  className?: string;
  variant?: "default" | "overlay";
};

export type WorkflowSidebarCompactProps = {
  entries: WorkflowSidebarSectionEntry[];
  pinnedSectionTitle: string;
  defaultSectionTitle: string;
  isSidebarCollapsed: boolean;
};

type WithPin<T> = T & { isPinned: boolean };

const splitEntriesByPin = <T extends WithPin<T>>(entries: T[]) => {
  const pinned: T[] = [];
  const regular: T[] = [];

  for (const entry of entries) {
    if (entry.isPinned) {
      pinned.push(entry);
    } else {
      regular.push(entry);
    }
  }

  return { pinned, regular };
};

const WorkflowSidebarSection = ({
  sectionId,
  title,
  entries,
  pinnedSectionTitle,
  defaultSectionTitle,
  floatingAction,
  beforeGroups,
  emptyState,
  footerContent,
  className,
  variant = "default",
}: WorkflowSidebarSectionProps) => {
  const { pinned, regular } = splitEntriesByPin(entries);
  const hasEntries = pinned.length > 0 || regular.length > 0;

  const baseClassName = "chatkit-sidebar__section";
  const floatingActionClass = floatingAction
    ? `${baseClassName} chatkit-sidebar__section--with-floating-action`
    : baseClassName;
  const sectionClassName = className
    ? `${floatingActionClass} ${className}`
    : floatingActionClass;

  const titleId = `${sectionId}-title`;

  return (
    <section
      className={sectionClassName}
      aria-labelledby={titleId}
      data-variant={variant === "overlay" ? "overlay" : undefined}
    >
      <div className="chatkit-sidebar__section-header">
        <h2 id={titleId} className="chatkit-sidebar__section-title">
          {title}
        </h2>
        {floatingAction ? (
          <div className="chatkit-sidebar__section-floating-action">
            <button
              type="button"
              className="chatkit-sidebar__section-icon-button"
              onClick={floatingAction.onClick}
              aria-label={floatingAction.label}
              title={floatingAction.title ?? floatingAction.label}
              disabled={floatingAction.disabled}
            >
              {floatingAction.icon ?? <span aria-hidden="true">+</span>}
            </button>
          </div>
        ) : null}
      </div>
      {beforeGroups}
      {hasEntries ? (
        <>
          {pinned.length > 0 ? (
            <div
              className="chatkit-sidebar__workflow-group chatkit-sidebar__workflow-group--pinned"
              data-workflow-group="pinned"
            >
              <h3 className="chatkit-sidebar__workflow-group-title">{pinnedSectionTitle}</h3>
              <ul className="chatkit-sidebar__workflow-list chatkit-sidebar__workflow-list--grouped">
                {pinned.map((entry) => (
                  <WorkflowSidebarListItem
                    key={entry.key}
                    isPinned={entry.isPinned}
                    menuProps={entry.menuProps}
                    hasActions={entry.hasActions}
                    dataAttributes={entry.dataAttributes}
                    trailingContent={entry.trailingContent}
                  >
                    {entry.content}
                  </WorkflowSidebarListItem>
                ))}
              </ul>
            </div>
          ) : null}
          {regular.length > 0 ? (
            <div className="chatkit-sidebar__workflow-group" data-workflow-group="default">
              <h3 className="chatkit-sidebar__workflow-group-title">{defaultSectionTitle}</h3>
              <ul className="chatkit-sidebar__workflow-list chatkit-sidebar__workflow-list--grouped">
                {regular.map((entry) => (
                  <WorkflowSidebarListItem
                    key={entry.key}
                    isPinned={entry.isPinned}
                    menuProps={entry.menuProps}
                    hasActions={entry.hasActions}
                    dataAttributes={entry.dataAttributes}
                    trailingContent={entry.trailingContent}
                  >
                    {entry.content}
                  </WorkflowSidebarListItem>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        emptyState ?? null
      )}
      {footerContent}
    </section>
  );
};

export const WorkflowSidebarCompact = ({
  entries,
  pinnedSectionTitle,
  defaultSectionTitle,
  isSidebarCollapsed,
}: WorkflowSidebarCompactProps) => {
  const compactEntries = entries
    .map((entry) =>
      entry.compact
        ? {
            key: entry.compact.key ?? entry.key,
            label: entry.compact.label,
            initials: entry.compact.initials,
            onClick: entry.compact.onClick,
            disabled: entry.compact.disabled,
            isActive: entry.compact.isActive,
            ariaLabel: entry.compact.ariaLabel ?? entry.compact.label,
            hiddenLabelSuffix: entry.compact.hiddenLabelSuffix,
            kind: entry.kind,
            isPinned: entry.isPinned,
          }
        : null,
    )
    .filter((entry): entry is {
      key: string;
      label: string;
      initials: string;
      onClick?: () => void;
      disabled?: boolean;
      isActive?: boolean;
      ariaLabel: string;
      kind: "local" | "hosted";
      isPinned: boolean;
      hiddenLabelSuffix?: string;
    } => entry !== null);

  if (compactEntries.length === 0) {
    return null;
  }

  const { pinned, regular } = splitEntriesByPin(compactEntries);

  const renderCompactEntry = (entry: (typeof compactEntries)[number]) => (
    <li
      key={entry.key}
      className="chatkit-sidebar__workflow-compact-item"
      data-pinned={entry.isPinned ? "" : undefined}
    >
      <button
        type="button"
        className={`chatkit-sidebar__workflow-compact-button${
          entry.isActive ? " chatkit-sidebar__workflow-compact-button--active" : ""
        }${
          entry.kind === "hosted"
            ? " chatkit-sidebar__workflow-compact-button--hosted"
            : ""
        }${entry.isPinned ? " chatkit-sidebar__workflow-compact-button--pinned" : ""}`}
        onClick={entry.onClick}
        disabled={entry.disabled}
        aria-current={entry.isActive ? "true" : undefined}
        tabIndex={isSidebarCollapsed ? 0 : -1}
        aria-label={entry.ariaLabel}
      >
        <span aria-hidden="true" className="chatkit-sidebar__workflow-compact-initial">
          {entry.initials}
        </span>
        <span className="visually-hidden">
          {entry.label}
          {entry.hiddenLabelSuffix ? ` (${entry.hiddenLabelSuffix})` : ""}
        </span>
      </button>
    </li>
  );

  return (
    <div className="chatkit-sidebar__workflow-compact-groups">
      {pinned.length > 0 ? (
        <div
          className="chatkit-sidebar__workflow-compact-group chatkit-sidebar__workflow-compact-group--pinned"
          data-workflow-group="pinned"
        >
          <h3 className="chatkit-sidebar__workflow-compact-group-title">{pinnedSectionTitle}</h3>
          <ul className="chatkit-sidebar__workflow-compact-list chatkit-sidebar__workflow-compact-list--grouped">
            {pinned.map((entry) => renderCompactEntry(entry))}
          </ul>
        </div>
      ) : null}
      {regular.length > 0 ? (
        <div className="chatkit-sidebar__workflow-compact-group" data-workflow-group="default">
          <h3 className="chatkit-sidebar__workflow-compact-group-title">{defaultSectionTitle}</h3>
          <ul className="chatkit-sidebar__workflow-compact-list">
            {regular.map((entry) => renderCompactEntry(entry))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

export default WorkflowSidebarSection;
