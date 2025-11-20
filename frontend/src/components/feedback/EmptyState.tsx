import { type ReactNode } from "react";
import { Inbox, Search, FileQuestion, AlertCircle } from "lucide-react";
import "./EmptyState.css";

export interface EmptyStateProps {
  icon?: "inbox" | "search" | "file" | "alert" | ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * EmptyState - Component for displaying empty states
 *
 * Shows a helpful message and optional action when there's no content to display.
 * Commonly used for empty lists, tables, or search results.
 *
 * @example
 * ```tsx
 * <EmptyState
 *   icon="inbox"
 *   title="No workflows yet"
 *   description="Create your first workflow to get started."
 *   action={
 *     <button onClick={handleCreate}>
 *       Create Workflow
 *     </button>
 *   }
 * />
 * ```
 */
export const EmptyState = ({
  icon = "inbox",
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) => {
  const iconMap = {
    inbox: Inbox,
    search: Search,
    file: FileQuestion,
    alert: AlertCircle,
  };

  const renderIcon = () => {
    if (typeof icon === "string") {
      const IconComponent = iconMap[icon];
      return <IconComponent size={48} strokeWidth={1.5} aria-hidden="true" />;
    }
    return icon;
  };

  return (
    <div className={`empty-state ${className}`.trim()} role="status">
      <div className="empty-state__icon">{renderIcon()}</div>
      <h3 className="empty-state__title">{title}</h3>
      {description && <p className="empty-state__description">{description}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
};
