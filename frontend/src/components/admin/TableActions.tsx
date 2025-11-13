export interface TableActionsProps {
  onEdit?: () => void;
  onDelete?: () => void;
  onTest?: () => void;
  editLabel?: string;
  deleteLabel?: string;
  testLabel?: string;
  deleteConfirmMessage?: string;
  className?: string;
}

/**
 * TableActions - Standardized action buttons for table rows
 *
 * Provides consistent action buttons (edit, delete, test) for admin tables.
 * Uses existing .admin-table__actions CSS class from admin.css.
 *
 * @example
 * ```tsx
 * const columns: Column<User>[] = [
 *   // ... other columns
 *   {
 *     key: "actions",
 *     label: "Actions",
 *     render: (user) => (
 *       <TableActions
 *         onEdit={() => handleEdit(user)}
 *         onDelete={() => handleDelete(user)}
 *         deleteConfirmMessage={`Supprimer ${user.email} ?`}
 *       />
 *     ),
 *   },
 * ];
 * ```
 */
export const TableActions = ({
  onEdit,
  onDelete,
  onTest,
  editLabel = "Modifier",
  deleteLabel = "Supprimer",
  testLabel = "Tester",
  deleteConfirmMessage = "Êtes-vous sûr de vouloir supprimer cet élément ?",
  className = "",
}: TableActionsProps) => {
  const handleDelete = () => {
    if (onDelete && window.confirm(deleteConfirmMessage)) {
      onDelete();
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      {onEdit && (
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={onEdit}
        >
          {editLabel}
        </button>
      )}
      {onTest && (
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={onTest}
        >
          {testLabel}
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          className="btn btn-sm btn-danger"
          onClick={handleDelete}
        >
          {deleteLabel}
        </button>
      )}
    </div>
  );
};
