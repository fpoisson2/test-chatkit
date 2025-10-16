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
}: ManagementPageLayoutProps) => {
  const { openSidebar, isDesktopLayout, isSidebarOpen } = useAppLayout();
  const showSidebarButton = !isDesktopLayout || !isSidebarOpen;
  const showHeaderMain = Boolean(title) || Boolean(subtitle);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {showSidebarButton ? (
          <button
            type="button"
            onClick={openSidebar}
            className={styles.menuButton}
            aria-label="Ouvrir la navigation générale"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="#0f172a" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}

        {showHeaderMain ? (
          <div className={styles.headerMain}>
            {title ? <h1 className={styles.title}>{title}</h1> : null}
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
        ) : null}

        {badge || actions ? (
          <div className={styles.headerAside}>
            {badge ? <span className={styles.badge}>{badge}</span> : null}
            {actions ? <div className={styles.headerActions}>{actions}</div> : null}
          </div>
        ) : null}
      </header>

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
