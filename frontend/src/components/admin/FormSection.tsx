import { type ReactNode } from "react";

export interface FormSectionProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}

/**
 * FormSection - Standardized card section for admin forms
 *
 * Provides consistent styling for form sections with optional title and subtitle.
 * Uses existing .admin-card CSS class from admin.css.
 *
 * @example
 * ```tsx
 * <FormSection
 *   title="User Information"
 *   subtitle="Enter the user's basic information"
 * >
 *   <form className="admin-form">
 *     {/* form fields *\/}
 *   </form>
 * </FormSection>
 * ```
 */
export const FormSection = ({
  title,
  subtitle,
  children,
  className = "",
}: FormSectionProps) => {
  return (
    <section className={`admin-card ${className}`.trim()}>
      {(title || subtitle) && (
        <div>
          {title && <h2 className="admin-card__title">{title}</h2>}
          {subtitle && <p className="admin-card__subtitle">{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
};
