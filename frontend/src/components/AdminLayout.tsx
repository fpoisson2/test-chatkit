import { type ReactNode, useMemo } from "react";

import { useAppLayout } from "./AppLayout";

type AdminLayoutProps = {
  title: string;
  subtitle: string;
  badge?: ReactNode;
  onLogout: () => void;
  tabs?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
};

export const AdminLayout = ({
  title,
  subtitle,
  badge,
  onLogout,
  tabs,
  toolbar,
  children,
}: AdminLayoutProps) => {
  const { openSidebar, isDesktopLayout, isSidebarOpen } = useAppLayout();
  const showSidebarButton = useMemo(
    () => !isDesktopLayout || !isSidebarOpen,
    [isDesktopLayout, isSidebarOpen],
  );

  return (
    <div className="admin-layout">
      <div className="admin-shell">
        <header className="admin-shell__header">
          <div className="admin-shell__header-main">
            {showSidebarButton ? (
              <button
                className="button button--ghost admin-shell__menu-button"
                type="button"
                onClick={openSidebar}
              >
                Ouvrir le menu
              </button>
            ) : null}
            <div>
              <h1 className="admin-shell__title">{title}</h1>
              <p className="admin-shell__subtitle">{subtitle}</p>
            </div>
          </div>
          <div className="admin-shell__toolbar">
            {badge ? <span className="admin-shell__chips">{badge}</span> : null}
            <button className="button button--ghost" type="button" onClick={onLogout}>
              Déconnexion
            </button>
          </div>
        </header>

        {tabs}

        {toolbar ? <div className="admin-shell__toolbar admin-shell__toolbar--secondary">{toolbar}</div> : null}

        {children}
      </div>
    </div>
  );
};
