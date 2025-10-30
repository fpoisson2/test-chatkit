import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../auth";
import { SidebarIcon, type SidebarIconName } from "./SidebarIcon";
import { getDesktopLayoutPreference, useIsDesktopLayout } from "../hooks/useDesktopLayout";
import type { SettingsSectionId } from "../features/settings/sections";
import { useI18n } from "../i18n";

type NavigationItem = {
  key: string;
  label: string;
  icon: SidebarIconName;
  onClick: () => void;
  isActive?: boolean;
};

type ApplicationKey = "chat" | "workflows";

type ApplicationDescriptor = {
  key: ApplicationKey;
  labelKey: string;
  path: string;
  requiresAdmin?: boolean;
};

const APPLICATIONS: ApplicationDescriptor[] = [
  { key: "chat", labelKey: "app.sidebar.applications.chat", path: "/" },
  {
    key: "workflows",
    labelKey: "app.sidebar.applications.workflows",
    path: "/workflows",
    requiresAdmin: true,
  },
];

const APPLICATION_ICONS: Record<ApplicationKey, SidebarIconName> = {
  chat: "home",
  workflows: "workflow",
};

const buildNavigationItems = ({
  isAuthenticated,
  handleSidebarLogin,
  loginLabel,
}: {
  isAuthenticated: boolean;
  handleSidebarLogin: () => void;
  loginLabel: string;
}): NavigationItem[] => {
  if (isAuthenticated) {
    return [];
  }

  return [
    {
      key: "login",
      label: loginLabel,
      icon: "login",
      onClick: handleSidebarLogin,
    },
  ];
};

const useSidebarInteractions = ({
  isDesktopLayout,
  onInteract,
}: {
  isDesktopLayout: boolean;
  onInteract: () => void;
}) =>
  useMemo<Partial<HTMLAttributes<HTMLDivElement>>>(() => {
    if (isDesktopLayout) {
      return {};
    }

    return {
      onClick: onInteract,
      onPointerDown: onInteract,
      onTouchStart: onInteract,
    };
  }, [isDesktopLayout, onInteract]);

type AppLayoutContextValue = {
  openSidebar: () => void;
  closeSidebar: () => void;
  isDesktopLayout: boolean;
  isSidebarOpen: boolean;
};

const AppLayoutContext = createContext<AppLayoutContextValue | undefined>(undefined);

type SidebarPortalContextValue = {
  setSidebarContent: (content: ReactNode | null) => void;
  clearSidebarContent: () => void;
};

const SidebarPortalContext = createContext<SidebarPortalContextValue | undefined>(undefined);

export const useAppLayout = () => {
  const context = useContext(AppLayoutContext);

  if (!context) {
    throw new Error("useAppLayout must be used within AppLayout");
  }

  return context;
};

export const useSidebarPortal = () => {
  const context = useContext(SidebarPortalContext);

  if (!context) {
    throw new Error("useSidebarPortal must be used within AppLayout");
  }

  return context;
};

export const AppLayout = ({ children }: { children?: ReactNode }) => {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const isAuthenticated = Boolean(user);
  const isAdmin = Boolean(user?.is_admin);
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktopLayout = useIsDesktopLayout();
  const previousIsDesktopRef = useRef(isDesktopLayout);
  const [isSidebarOpen, setIsSidebarOpen] = useState(getDesktopLayoutPreference);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const [sidebarContent, setSidebarContent] = useState<ReactNode | null>(null);
  const appSwitcherLabelId = useId();

  useEffect(() => {
    const wasDesktop = previousIsDesktopRef.current;

    if (isDesktopLayout) {
      if (!wasDesktop) {
        setIsSidebarOpen(true);
      }
    } else {
      setIsSidebarOpen(false);
    }

    previousIsDesktopRef.current = isDesktopLayout;
  }, [isDesktopLayout]);

  const openSidebar = useCallback(() => {
    setIsSidebarOpen(true);
  }, []);

  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  const handleMainInteraction = useCallback(() => {
    if (!isDesktopLayout && isSidebarOpen) {
      closeSidebar();
    }
  }, [closeSidebar, isDesktopLayout, isSidebarOpen]);

  const mainInteractionHandlers = useSidebarInteractions({
    isDesktopLayout,
    onInteract: handleMainInteraction,
  });

  const sidebarTabIndex = isSidebarOpen || isDesktopLayout ? 0 : -1;
  const isSidebarCollapsed = isDesktopLayout && !isSidebarOpen;

  type LocalizedApplication = ApplicationDescriptor & { label: string };
  const localizedApplications = useMemo<LocalizedApplication[]>(
    () =>
      APPLICATIONS.map((application) => ({
        ...application,
        label: t(application.labelKey),
      })),
    [t],
  );

  const availableApplications = useMemo(
    () => localizedApplications.filter((application) => (application.requiresAdmin ? isAdmin : true)),
    [isAdmin, localizedApplications],
  );

  const activeApplication = useMemo<ApplicationKey>(() => {
    const matchingApplication = availableApplications.find((application) => {
      if (application.path === "/") {
        return location.pathname === "/";
      }

      return (
        location.pathname === application.path ||
        location.pathname.startsWith(`${application.path}/`)
      );
    });

    return matchingApplication?.key ?? "chat";
  }, [availableApplications, location.pathname]);

  const handleApplicationNavigate = useCallback(
    (application: ApplicationDescriptor) => {
      if (!isDesktopLayout) {
        closeSidebar();
      }

      navigate(application.path);
    },
    [closeSidebar, isDesktopLayout, navigate],
  );

  const handleOpenSettings = useCallback(
    (sectionId?: SettingsSectionId) => {
      if (!user) {
        navigate("/login");
        return;
      }

      const search = sectionId ? `?section=${encodeURIComponent(sectionId)}` : "";
      navigate(`/settings${search}`);
    },
    [navigate, user],
  );

  const handleSidebarLogin = useCallback(() => {
    if (!isDesktopLayout) {
      closeSidebar();
    }

    navigate("/login");
  }, [closeSidebar, isDesktopLayout, navigate]);

  const handleSidebarLogout = useCallback(() => {
    if (!isDesktopLayout) {
      closeSidebar();
    }

    logout();
  }, [closeSidebar, isDesktopLayout, logout]);

  const handleGoToAdmin = useCallback(() => {
    if (!isDesktopLayout) {
      closeSidebar();
    }

    navigate("/admin");
  }, [closeSidebar, isDesktopLayout, navigate]);

  const handleProfileOpenSettings = useCallback(() => {
    setIsProfileMenuOpen(false);
    handleOpenSettings();
  }, [handleOpenSettings]);

  const handleGoToDocs = useCallback(() => {
    if (!isDesktopLayout) {
      closeSidebar();
    }

    navigate("/docs");
  }, [closeSidebar, isDesktopLayout, navigate]);

  const isDocsActive = useMemo(
    () => location.pathname === "/docs" || location.pathname.startsWith("/docs/"),
    [location.pathname],
  );

  const navigationItems = useMemo(
    () =>
      buildNavigationItems({
        isAuthenticated,
        handleSidebarLogin,
        loginLabel: t("app.sidebar.login"),
      }),
    [handleSidebarLogin, isAuthenticated, t],
  );

  useEffect(() => {
    if (!isProfileMenuOpen) {
      return;
    }

    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (!profileMenuRef.current) {
        return;
      }

      if (event.target instanceof Node && profileMenuRef.current.contains(event.target)) {
        return;
      }

      setIsProfileMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsProfileMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProfileMenuOpen]);

  useEffect(() => {
    if (!isSidebarOpen) {
      setIsProfileMenuOpen(false);
    }
  }, [isSidebarOpen]);

  const profileInitial = useMemo(() => {
    if (!user?.email) {
      return "?";
    }

    return user.email.charAt(0).toUpperCase();
  }, [user?.email]);

  const handleToggleProfileMenu = useCallback(() => {
    setIsProfileMenuOpen((previous) => !previous);
  }, []);

  const handleProfileGoToAdmin = useCallback(() => {
    setIsProfileMenuOpen(false);
    handleGoToAdmin();
  }, [handleGoToAdmin]);

  const handleProfileLogout = useCallback(() => {
    setIsProfileMenuOpen(false);
    handleSidebarLogout();
  }, [handleSidebarLogout]);

  const handleScrimPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (isDesktopLayout) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      closeSidebar();
    },
    [closeSidebar, isDesktopLayout],
  );

  const layoutClassName = useMemo(
    () =>
      [
        "chatkit-layout",
        isSidebarOpen ? "chatkit-layout--sidebar-open" : "",
        isDesktopLayout ? "chatkit-layout--desktop" : "",
      ]
        .filter(Boolean)
        .join(" "),
    [isDesktopLayout, isSidebarOpen],
  );

  const sidebarClassName = useMemo(
    () =>
      [
        "chatkit-sidebar",
        isSidebarOpen ? "chatkit-sidebar--open" : "",
        isSidebarCollapsed ? "chatkit-sidebar--collapsed" : "",
      ]
        .filter(Boolean)
        .join(" "),
    [isSidebarCollapsed, isSidebarOpen],
  );

  const contextValue = useMemo(
    () => ({
      openSidebar,
      closeSidebar,
      isDesktopLayout,
      isSidebarOpen,
    }),
    [closeSidebar, isDesktopLayout, isSidebarOpen, openSidebar],
  );

  const handleSetSidebarContent = useCallback((content: ReactNode | null) => {
    setSidebarContent(content);
  }, []);

  const handleClearSidebarContent = useCallback(() => {
    setSidebarContent(null);
  }, []);

  const shouldRenderInlineAppSwitcher =
    isDesktopLayout && !isSidebarCollapsed && availableApplications.length > 0;

  const sidebarPortalValue = useMemo(
    () => ({
      setSidebarContent: handleSetSidebarContent,
      clearSidebarContent: handleClearSidebarContent,
    }),
    [handleClearSidebarContent, handleSetSidebarContent],
  );

  const renderAppSwitcher = useCallback(
    (layout: "inline" | "stacked") => {
      const isInline = layout === "inline";

      if (availableApplications.length === 0) {
        return null;
      }

      const containerClassName = [
        "chatkit-sidebar__switcher",
        isInline ? "chatkit-sidebar__switcher--inline" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const navClassName = [
        "chatkit-sidebar__app-switcher",
        !isInline && isSidebarCollapsed ? "chatkit-sidebar__app-switcher--compact" : "",
        isInline ? "chatkit-sidebar__app-switcher--inline" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return (
        <div className={containerClassName}>
          <span id={appSwitcherLabelId} className="visually-hidden">
            {t("app.sidebar.switcherLabel")}
          </span>
          <nav className={navClassName} aria-labelledby={appSwitcherLabelId}>
            {availableApplications.map((application) => {
              const isActive = activeApplication === application.key;

              return (
                <button
                  key={application.key}
                  type="button"
                  className={`chatkit-sidebar__app-switcher-button${
                    isActive ? " chatkit-sidebar__app-switcher-button--active" : ""
                  }`}
                  onClick={() => handleApplicationNavigate(application)}
                  tabIndex={sidebarTabIndex}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={application.label}
                >
                  <span className="chatkit-sidebar__app-switcher-icon" aria-hidden="true">
                    <SidebarIcon name={APPLICATION_ICONS[application.key]} />
                  </span>
                  <span className="chatkit-sidebar__app-switcher-label">
                    {application.label}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
      );
    },
    [
      activeApplication,
      appSwitcherLabelId,
      availableApplications,
      handleApplicationNavigate,
      isSidebarCollapsed,
      sidebarTabIndex,
      t,
    ],
  );

  return (
    <SidebarPortalContext.Provider value={sidebarPortalValue}>
      <AppLayoutContext.Provider value={contextValue}>
        <div className={layoutClassName}>
          <aside
            className={sidebarClassName}
            aria-label={t("app.sidebar.ariaLabel")}
            aria-hidden={!isSidebarOpen && !isDesktopLayout}
          >
          <header className="chatkit-sidebar__header">
            <div className="chatkit-sidebar__topline">
              <div className="chatkit-sidebar__brand-group">
                <div className="chatkit-sidebar__brand">
                  <span className="chatkit-sidebar__brand-mark" aria-hidden="true">
                    <SidebarIcon name="logo" className="chatkit-sidebar__logo" />
                  </span>
                  <span className="chatkit-sidebar__brand-title">
                    {t("app.sidebar.brandTitle")}
                  </span>
                </div>
                {shouldRenderInlineAppSwitcher ? (
                  <div className="chatkit-sidebar__brand-switcher">
                    {renderAppSwitcher("inline")}
                  </div>
                ) : null}
              </div>
              <div className="chatkit-sidebar__actions">
                {isSidebarOpen ? (
                  <button
                    type="button"
                    className="chatkit-sidebar__dismiss"
                    onClick={closeSidebar}
                    tabIndex={sidebarTabIndex}
                    aria-label={t("app.sidebar.close")}
                  >
                    <span aria-hidden="true" className="chatkit-sidebar__dismiss-icon">
                      <SidebarIcon name="close" />
                    </span>
                  </button>
                ) : null}
              </div>
            </div>
            {!shouldRenderInlineAppSwitcher ? renderAppSwitcher("stacked") : null}
          </header>
          {(sidebarContent || navigationItems.length > 0) && (
            <div className="chatkit-sidebar__main">
              {sidebarContent ? (
                <div className="chatkit-sidebar__dynamic">{sidebarContent}</div>
              ) : null}
              {navigationItems.length > 0 && (
                <nav className="chatkit-sidebar__nav" aria-label={t("app.sidebar.menu")}>
                  <ul className="chatkit-sidebar__list">
                    {navigationItems.map((item) => (
                      <li
                        key={item.key}
                        className={`chatkit-sidebar__item${
                          item.isActive ? " chatkit-sidebar__item--active" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={item.onClick}
                          tabIndex={sidebarTabIndex}
                          aria-label={item.label}
                          aria-current={item.isActive ? "page" : undefined}
                        >
                          <SidebarIcon name={item.icon} className="chatkit-sidebar__icon" />
                          <span className="chatkit-sidebar__label">{item.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
            </div>
          )}
          {isAuthenticated && (
            <footer className="chatkit-sidebar__footer">
              <button
                type="button"
                className={`chatkit-sidebar__footer-link${
                  isDocsActive ? " chatkit-sidebar__footer-link--active" : ""
                }`}
                onClick={handleGoToDocs}
                tabIndex={sidebarTabIndex}
                aria-label={t("app.sidebar.docs")}
                aria-current={isDocsActive ? "page" : undefined}
              >
                <SidebarIcon name="docs" className="chatkit-sidebar__icon" />
                <span className="chatkit-sidebar__footer-link-label">{t("app.sidebar.docs")}</span>
              </button>
              <div
                className={`chatkit-sidebar__profile${isProfileMenuOpen ? " chatkit-sidebar__profile--open" : ""}`}
                ref={profileMenuRef}
              >
                <button
                  type="button"
                  className="chatkit-sidebar__profile-trigger"
                  onClick={handleToggleProfileMenu}
                  aria-haspopup="menu"
                  aria-expanded={isProfileMenuOpen}
                  tabIndex={sidebarTabIndex}
                >
                  <span className="chatkit-sidebar__profile-avatar" aria-hidden="true">
                    {profileInitial}
                  </span>
                  <span className="chatkit-sidebar__profile-details">
                    <span className="chatkit-sidebar__profile-name">{user.email}</span>
                    <span className="chatkit-sidebar__profile-role">
                      {user.is_admin
                        ? t("app.sidebar.profile.role.admin")
                        : t("app.sidebar.profile.role.user")}
                    </span>
                  </span>
                  <span className="chatkit-sidebar__profile-caret" aria-hidden="true" />
                </button>
                  <div
                    className="chatkit-sidebar__profile-menu"
                    role="menu"
                    aria-hidden={!isProfileMenuOpen}
                  >
                    <button
                      type="button"
                      className="chatkit-sidebar__profile-action"
                      role="menuitem"
                      onClick={handleProfileOpenSettings}
                      tabIndex={isProfileMenuOpen ? 0 : -1}
                    >
                      <SidebarIcon name="settings" className="chatkit-sidebar__icon" />
                      <span>{t("app.sidebar.profile.settings")}</span>
                    </button>
                    {user.is_admin && (
                      <button
                        type="button"
                        className="chatkit-sidebar__profile-action"
                        role="menuitem"
                        onClick={handleProfileGoToAdmin}
                        tabIndex={isProfileMenuOpen ? 0 : -1}
                      >
                        <SidebarIcon name="admin" className="chatkit-sidebar__icon" />
                        <span>{t("app.sidebar.profile.admin")}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="chatkit-sidebar__profile-action chatkit-sidebar__profile-action--logout"
                      role="menuitem"
                      onClick={handleProfileLogout}
                      tabIndex={isProfileMenuOpen ? 0 : -1}
                    >
                      <SidebarIcon name="logout" className="chatkit-sidebar__icon" />
                      <span>{t("app.sidebar.profile.logout")}</span>
                    </button>
                  </div>
                </div>
              </footer>
            )}
          </aside>
        <button
          type="button"
          className={`chatkit-layout__scrim${isSidebarOpen ? " chatkit-layout__scrim--active" : ""}`}
          aria-hidden={!isSidebarOpen || isDesktopLayout}
          aria-label={t("app.sidebar.close")}
          onPointerDown={handleScrimPointerDown}
          onClick={() => {
            if (!isDesktopLayout) {
              closeSidebar();
            }
          }}
          tabIndex={isSidebarOpen && !isDesktopLayout ? 0 : -1}
        />
        <div className="chatkit-layout__main" {...mainInteractionHandlers}>
          {children ?? <Outlet />}
        </div>
        </div>
      </AppLayoutContext.Provider>
    </SidebarPortalContext.Provider>
  );
};

export default AppLayout;
