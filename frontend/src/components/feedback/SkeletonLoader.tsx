import "./SkeletonLoader.css";

export interface SkeletonLoaderProps {
  variant?: "text" | "circle" | "rectangle" | "card";
  width?: string | number;
  height?: string | number;
  count?: number;
  className?: string;
}

/**
 * SkeletonLoader - Loading placeholder component
 *
 * Displays an animated skeleton placeholder while content is loading.
 * Supports multiple variants for different use cases.
 *
 * @example
 * ```tsx
 * // Single text line
 * <SkeletonLoader variant="text" />
 *
 * // Multiple text lines
 * <SkeletonLoader variant="text" count={3} />
 *
 * // Circle (for avatars)
 * <SkeletonLoader variant="circle" width={48} height={48} />
 *
 * // Card layout
 * <SkeletonLoader variant="card" />
 * ```
 */
export const SkeletonLoader = ({
  variant = "text",
  width,
  height,
  count = 1,
  className = "",
}: SkeletonLoaderProps) => {
  const skeletons = Array.from({ length: count }, (_, i) => i);

  const getVariantClass = () => {
    switch (variant) {
      case "circle":
        return "skeleton skeleton--circle";
      case "rectangle":
        return "skeleton skeleton--rectangle";
      case "card":
        return "skeleton skeleton--card";
      case "text":
      default:
        return "skeleton skeleton--text";
    }
  };

  const getStyle = () => {
    const style: React.CSSProperties = {};
    if (width !== undefined) {
      style.width = typeof width === "number" ? `${width}px` : width;
    }
    if (height !== undefined) {
      style.height = typeof height === "number" ? `${height}px` : height;
    }
    return style;
  };

  if (variant === "card") {
    return (
      <div className={`skeleton-card ${className}`.trim()}>
        <div className="skeleton skeleton--rectangle skeleton-card__image" />
        <div className="skeleton-card__content">
          <div className="skeleton skeleton--text" style={{ width: "60%" }} />
          <div className="skeleton skeleton--text" style={{ width: "80%" }} />
          <div className="skeleton skeleton--text" style={{ width: "40%" }} />
        </div>
      </div>
    );
  }

  return (
    <>
      {skeletons.map((index) => (
        <div
          key={index}
          className={`${getVariantClass()} ${className}`.trim()}
          style={getStyle()}
          aria-label="Chargement en cours"
          aria-busy="true"
        />
      ))}
    </>
  );
};

/**
 * SkeletonTable - Table loading placeholder
 *
 * Displays a skeleton placeholder for table rows.
 *
 * @example
 * ```tsx
 * <SkeletonTable rows={5} columns={4} />
 * ```
 */
export const SkeletonTable = ({
  rows = 3,
  columns = 3,
}: {
  rows?: number;
  columns?: number;
}) => {
  const rowsArray = Array.from({ length: rows }, (_, i) => i);
  const columnsArray = Array.from({ length: columns }, (_, i) => i);

  return (
    <div className="skeleton-table" aria-label="Chargement du tableau" aria-busy="true">
      {rowsArray.map((rowIndex) => (
        <div key={rowIndex} className="skeleton-table__row">
          {columnsArray.map((colIndex) => (
            <div key={colIndex} className="skeleton-table__cell">
              <div className="skeleton skeleton--text" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
