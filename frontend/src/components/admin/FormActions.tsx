import { type ReactNode } from "react";

export interface FormActionsProps {
  submitLabel: string;
  cancelLabel?: string;
  onCancel?: () => void;
  isSubmitting?: boolean;
  showCancel?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * FormActions - Standardized form action buttons for admin pages
 *
 * Provides consistent layout and styling for form submit and cancel buttons.
 * Uses existing .admin-form__actions CSS class from admin.css.
 *
 * @example
 * ```tsx
 * <FormActions
 *   submitLabel="Create User"
 *   cancelLabel="Cancel"
 *   onCancel={() => reset()}
 *   isSubmitting={isCreating}
 *   showCancel={!!editingId}
 * />
 * ```
 */
export const FormActions = ({
  submitLabel,
  cancelLabel = "Annuler",
  onCancel,
  isSubmitting = false,
  showCancel = false,
  className = "",
  children,
}: FormActionsProps) => {
  return (
    <div className={`flex items-center justify-end gap-3 ${className}`.trim()}>
      {showCancel && onCancel && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          {cancelLabel}
        </button>
      )}
      {children}
      <button
        type="submit"
        className="btn btn-primary"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Enregistrement..." : submitLabel}
      </button>
    </div>
  );
};
