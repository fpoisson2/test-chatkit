import { type ReactNode } from "react";

export interface FormSectionProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
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
 *   headerAction={<button>+</button>}
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
  headerAction,
}: FormSectionProps) => {
  return (
    <section className={`card ${className}`.trim()}>
      {(title || subtitle || headerAction) && (
        <div className={`card-header flex justify-between items-start gap-4 flex-wrap ${title || subtitle ? "mb-6" : "mb-0"}`}>
          <div className="flex-1 min-w-0">
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {headerAction && (
            <div className="flex-shrink-0 ml-auto flex">
              {headerAction}
            </div>
          )}
        </div>
      )}
      <div className="card-body">
        {children}
      </div>
    </section>
  );
};
