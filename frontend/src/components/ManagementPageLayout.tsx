import type { ReactNode } from "react";

import { useAppLayout } from "./AppLayout";

import styles from "./ManagementPageLayout.module.css";

type ContentWidth = "md" | "lg" | "full";

type ManagementPageLayoutProps = {
  title?: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  maxWidth?: ContentWidth;
  hideHeader?: boolean;
};

const contentWidthClassName: Record<ContentWidth, string> = {
  md: styles.contentMd,
  lg: styles.contentLg,
  full: styles.contentFull,
};

export const ManagementPageLayout = ({
  title,
  subtitle,
  badge,
  actions,
  tabs,
  toolbar,
  children,
  maxWidth = "lg",
  hideHeader = false,
}: ManagementPageLayoutProps) => {
  const { openSidebar, isDesktopLayout, isSidebarOpen } = useAppLayout();
  const showSidebarButton = !isDesktopLayout || !isSidebarOpen;
  const hasHeaderMain = Boolean(title || subtitle);
  const hasHeaderAside = Boolean(badge || actions);
  const shouldRenderHeader =
    !hideHeader && (showSidebarButton || hasHeaderMain || hasHeaderAside);
  const shouldRenderStandaloneMenuButton = hideHeader && showSidebarButton;
  const headerClassName = `${styles.header} ${
    hasHeaderMain ? styles.headerWithMain : styles.headerWithoutMain
  }`;

  const renderMenuButton = (extraClassName?: string) => (
    <button
      type="button"
      onClick={openSidebar}
      className={`${styles.menuButton}${extraClassName ? ` ${extraClassName}` : ""}`}
      aria-label="Ouvrir la navigation générale"
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );

  return (
    <div className={styles.page}>
      {shouldRenderStandaloneMenuButton ? (
        <div className={styles.menuButtonStandaloneWrapper}>
          {renderMenuButton()}
        </div>
      ) : null}
      {shouldRenderHeader ? (
        <header className={headerClassName}>
          {showSidebarButton ? renderMenuButton() : null}

          {hasHeaderMain ? (
            <div className={styles.headerMain}>
              {title ? <h1 className={styles.title}>{title}</h1> : null}
              {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
            </div>
          ) : null}

          {hasHeaderAside ? (
            <div className={styles.headerAside}>
              {badge ? <div className={styles.badge}>{badge}</div> : null}
              {actions ? <div className={styles.headerActions}>{actions}</div> : null}
            </div>
          ) : null}
        </header>
      ) : null}

      <div className={styles.inner}>
        <div className={`${styles.content} ${contentWidthClassName[maxWidth]}`}>
          {tabs ? <div className={styles.tabsSlot}>{tabs}</div> : null}
          {toolbar ? <div className={styles.toolbarSlot}>{toolbar}</div> : null}
          {children}
        </div>
      </div>
    </div>
  );
};

export default ManagementPageLayout;
