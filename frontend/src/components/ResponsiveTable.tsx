import { type ReactNode } from "react";
import { useIsDesktopLayout } from "../hooks/useDesktopLayout";
import "./ResponsiveTable.css";

export interface Column<T = any> {
  key: string;
  label: string;
  render: (item: T) => ReactNode;
}

export interface ResponsiveTableProps<T = any> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  mobileCardView?: boolean;
  className?: string;
}

/**
 * ResponsiveTable - A table component that adapts to mobile screens
 *
 * On desktop: Renders as a traditional table
 * On mobile: Renders as stacked cards (if mobileCardView=true) or horizontal scroll table
 *
 * @example
 * ```tsx
 * const columns = [
 *   { key: 'name', label: 'Name', render: (item) => item.name },
 *   { key: 'email', label: 'Email', render: (item) => item.email },
 * ];
 *
 * <ResponsiveTable
 *   columns={columns}
 *   data={users}
 *   keyExtractor={(user) => user.id}
 *   mobileCardView={true}
 * />
 * ```
 */
export function ResponsiveTable<T = any>({
  columns,
  data,
  keyExtractor,
  mobileCardView = true,
  className = "",
}: ResponsiveTableProps<T>) {
  const isDesktop = useIsDesktopLayout();

  // On mobile with card view enabled, render as cards
  if (!isDesktop && mobileCardView) {
    return (
      <div className={`responsive-table-cards ${className}`}>
        {data.map((item) => (
          <div key={keyExtractor(item)} className="responsive-table-card">
            {columns.map((column) => (
              <div key={column.key} className="responsive-table-card__row">
                <dt className="responsive-table-card__label">{column.label}</dt>
                <dd className="responsive-table-card__value">{column.render(item)}</dd>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  // On desktop or mobile without card view, render as table
  return (
    <div className={`responsive-table-wrapper ${className}`}>
      <table className="responsive-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr key={keyExtractor(item)}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(item)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
