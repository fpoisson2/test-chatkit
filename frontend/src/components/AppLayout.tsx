import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../auth";
import { SidebarIcon, type SidebarIconName } from "./SidebarIcon";
import { getDesktopLayoutPreference, useIsDesktopLayout } from "../hooks/useDesktopLayout";
import { SettingsModal } from "../features/settings/SettingsModal";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "../features/settings/sections";
import { useAdminUsers } from "../features/settings/useAdminUsers";

type NavigationItem = {
  key: string;
  label: string;
  icon: SidebarIconName;
  onClick: () => void;
};

type ApplicationKey = "chat" | "voice" | "workflows" | "vector-stores" | "widgets";

type ApplicationDescriptor = {
  key: ApplicationKey;
  label: string;
  path: string;
  requiresAdmin?: boolean;
};

const APPLICATIONS: ApplicationDescriptor[] = [
  { key: "chat", label: "Chat", path: "/" },
  { key: "voice", label: "Voix", path: "/voice" },
  { key: "workflows", label: "Workflow Builder", path: "/workflows", requiresAdmin: true },
  { key: "vector-stores", label: "Vector Store", path: "/vector-stores", requiresAdmin: true },
  { key: "widgets", label: "Widget Library", path: "/widgets", requiresAdmin: true },
];

const buildNavigationItems = ({
  isAuthenticated,
  handleSidebarLogin,
}: {
  isAuthenticated: boolean;
  handleSidebarLogin: () => void;
}): NavigationItem[] => {
  if (isAuthenticated) {
    return [];
  }

  return [
    {
      key: "login",
      label: "Connexion",
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
  openSettings: () => void;
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
    throw new Error("useAppLayout doit être utilisé à l'intérieur d'AppLayout");
  }

  return context;
};

export const useSidebarPortal = () => {
  const context = useContext(SidebarPortalContext);

  if (!context) {
    throw new Error("useSidebarPortal doit être utilisé à l'intérieur d'AppLayout");
  }

  return context;
};

export const AppLayout = ({ children }: { children?: ReactNode }) => {
  const { user, token, logout } = useAuth();
  const isAuthenticated = Boolean(user);
  const isAdmin = Boolean(user?.is_admin);
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktopLayout = useIsDesktopLayout();
  const previousIsDesktopRef = useRef(isDesktopLayout);
  const [isSidebarOpen, setIsSidebarOpen] = useState(getDesktopLayoutPreference);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>(
    SETTINGS_SECTIONS[0].id,
  );
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const [sidebarContent, setSidebarContent] = useState<ReactNode | null>(null);

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

  useEffect(() => {
    if (isSettingsModalOpen) {
      setActiveSettingsSection(SETTINGS_SECTIONS[0].id);
    }
  }, [isSettingsModalOpen]);

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

  const availableApplications = useMemo(
    () => APPLICATIONS.filter((application) => (application.requiresAdmin ? isAdmin : true)),
    [isAdmin],
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

  const handleApplicationChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextApplication = availableApplications.find((application) => application.key === event.target.value);

      if (!nextApplication) {
        return;
      }

      if (!isDesktopLayout) {
        closeSidebar();
      }

      navigate(nextApplication.path);
    },
    [availableApplications, closeSidebar, isDesktopLayout, navigate],
  );

  const handleOpenSettings = useCallback(() => {
    if (!user) {
      navigate("/login");
      return;
    }

    setIsSettingsModalOpen(true);
  }, [navigate, user]);

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

  const navigationItems = useMemo(
    () =>
      buildNavigationItems({
        isAuthenticated,
        handleSidebarLogin,
      }),
    [handleSidebarLogin, isAuthenticated],
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

  const handleCloseSettings = useCallback(() => {
    setIsSettingsModalOpen(false);
  }, []);

  const handleGoHomeFromModal = useCallback(() => {
    handleCloseSettings();
    navigate("/");
  }, [handleCloseSettings, navigate]);

  const handleOpenWorkflowsFromModal = useCallback(() => {
    handleCloseSettings();
    navigate("/workflows");
  }, [handleCloseSettings, navigate]);

  const handleLogoutFromModal = useCallback(() => {
    handleCloseSettings();
    logout();
  }, [handleCloseSettings, logout]);

  const handleSettingsUnauthorized = useCallback(() => {
    handleCloseSettings();
    logout();
  }, [handleCloseSettings, logout]);

  const adminUsers = useAdminUsers({
    token,
    isEnabled: Boolean(user?.is_admin) && isSettingsModalOpen,
    onUnauthorized: handleSettingsUnauthorized,
  });

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
      openSettings: handleOpenSettings,
      isDesktopLayout,
      isSidebarOpen,
    }),
    [closeSidebar, handleOpenSettings, isDesktopLayout, isSidebarOpen, openSidebar],
  );

  const handleSetSidebarContent = useCallback((content: ReactNode | null) => {
    setSidebarContent(content);
  }, []);

  const handleClearSidebarContent = useCallback(() => {
    setSidebarContent(null);
  }, []);

  const sidebarPortalValue = useMemo(
    () => ({
      setSidebarContent: handleSetSidebarContent,
      clearSidebarContent: handleClearSidebarContent,
    }),
    [handleClearSidebarContent, handleSetSidebarContent],
  );

  return (
    <SidebarPortalContext.Provider value={sidebarPortalValue}>
      <AppLayoutContext.Provider value={contextValue}>
        <div className={layoutClassName}>
          <aside
            className={sidebarClassName}
            aria-label="Navigation principale"
            aria-hidden={!isSidebarOpen && !isDesktopLayout}
          >
          <header className="chatkit-sidebar__header">
            <div className="chatkit-sidebar__topline">
              <div className="chatkit-sidebar__brand">
                <SidebarIcon name="logo" className="chatkit-sidebar__logo" />
                <div className="chatkit-sidebar__brand-switcher">
                  <span className="chatkit-sidebar__brand-title">ChatKit Studio</span>
                  <label
                    htmlFor="chatkit-app-switcher"
                    className="chatkit-sidebar__brand-label"
                  >
                    Application
                  </label>
                  <div className="chatkit-sidebar__brand-select-wrapper">
                    <select
                      id="chatkit-app-switcher"
                      className="chatkit-sidebar__brand-select"
                      value={activeApplication}
                      onChange={handleApplicationChange}
                      tabIndex={sidebarTabIndex}
                    >
                      {availableApplications.map((application) => (
                        <option key={application.key} value={application.key}>
                          {application.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              {isSidebarOpen && (
                <button
                  type="button"
                  className="chatkit-sidebar__dismiss"
                  onClick={closeSidebar}
                  tabIndex={sidebarTabIndex}
                  aria-label="Fermer la barre latérale"
                >
                  ×
                </button>
              )}
            </div>
          </header>
          {sidebarContent ? (
            <div className="chatkit-sidebar__dynamic">{sidebarContent}</div>
          ) : null}
          {navigationItems.length > 0 && (
            <nav className="chatkit-sidebar__nav" aria-label="Menu principal">
              <ul className="chatkit-sidebar__list">
                {navigationItems.map((item) => (
                  <li key={item.key} className="chatkit-sidebar__item">
                    <button
                      type="button"
                      onClick={item.onClick}
                      tabIndex={sidebarTabIndex}
                      aria-label={item.label}
                    >
                      <SidebarIcon name={item.icon} className="chatkit-sidebar__icon" />
                      <span className="chatkit-sidebar__label">{item.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          {isAuthenticated && (
            <footer className="chatkit-sidebar__footer">
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
                      {user.is_admin ? "Administrateur" : "Utilisateur"}
                    </span>
                  </span>
                  <span className="chatkit-sidebar__profile-caret" aria-hidden="true" />
                </button>
                <div
                  className="chatkit-sidebar__profile-menu"
                  role="menu"
                  aria-hidden={!isProfileMenuOpen}
                >
                  {user.is_admin && (
                    <button
                      type="button"
                      className="chatkit-sidebar__profile-action"
                      role="menuitem"
                      onClick={handleProfileGoToAdmin}
                      tabIndex={isProfileMenuOpen ? 0 : -1}
                    >
                      <SidebarIcon name="admin" className="chatkit-sidebar__icon" />
                      <span>Administration</span>
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
                    <span>Déconnexion</span>
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
          aria-label="Fermer la barre latérale"
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
        <SettingsModal
          isOpen={isSettingsModalOpen}
          sections={SETTINGS_SECTIONS}
          activeSectionId={activeSettingsSection}
          onSelectSection={setActiveSettingsSection}
          onClose={handleCloseSettings}
          currentUser={user}
          onGoHome={handleGoHomeFromModal}
          onLogout={handleLogoutFromModal}
          onOpenWorkflows={handleOpenWorkflowsFromModal}
          adminUsers={adminUsers}
        />
        </div>
      </AppLayoutContext.Provider>
    </SidebarPortalContext.Provider>
  );
};

export default AppLayout;
