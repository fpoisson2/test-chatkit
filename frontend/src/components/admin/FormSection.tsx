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
    <section className={`admin-card ${className}`.trim()}>
      {(title || subtitle || headerAction) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "1rem",
            flexWrap: "wrap",
            marginBottom: title || subtitle ? "1.5rem" : "0",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {title && <h2 className="admin-card__title">{title}</h2>}
            {subtitle && <p className="admin-card__subtitle">{subtitle}</p>}
          </div>
          {headerAction && (
            <div
              style={{
                flexShrink: 0,
                marginLeft: "auto",
                display: "flex",
              }}
            >
              {headerAction}
            </div>
          )}
        </div>
      )}
      {children}
    </section>
  );
};
