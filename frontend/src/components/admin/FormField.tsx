import { type ReactNode } from "react";

export interface FormFieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * FormField - Standardized form field wrapper for admin pages
 *
 * Provides consistent layout for form fields with label, input, error message, and hint.
 * Uses existing CSS classes from admin.css.
 *
 * @example
 * ```tsx
 * <FormField
 *   label="Email"
 *   error={formErrors.email?.message}
 *   hint="Enter a valid email address"
 *   required
 * >
 *   <input
 *     type="email"
 *     className="input"
 *     {...register("email")}
 *   />
 * </FormField>
 * ```
 */
export const FormField = ({
  label,
  error,
  hint,
  required = false,
  children,
  className = "",
}: FormFieldProps) => {
  return (
    <div className={`form-group ${className}`.trim()}>
      <label className="form-label">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children}
      {error && <span className="form-error">{error}</span>}
      {hint && !error && <p className="form-hint">{hint}</p>}
    </div>
  );
};
