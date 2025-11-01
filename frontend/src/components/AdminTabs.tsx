import { MouseEvent, useCallback, useEffect, useMemo } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { useAppLayout, useSidebarPortal } from "./AppLayout";
import { useI18n } from "../i18n";

type AdminTabKey =
  | "users"
  | "models"
  | "vector-stores"
  | "widgets"
  | "telephony"
  | "mcp-servers"
  | "settings";

type AdminTabsProps = {
  activeTab: AdminTabKey;
};

const TAB_DEFINITIONS: { key: AdminTabKey; to: string; labelKey: string }[] = [
  { key: "users", to: "/admin", labelKey: "admin.tabs.users" },
  { key: "models", to: "/admin/models", labelKey: "admin.tabs.models" },
  { key: "vector-stores", to: "/vector-stores", labelKey: "admin.tabs.vectorStores" },
  { key: "widgets", to: "/widgets", labelKey: "admin.tabs.widgets" },
  { key: "mcp-servers", to: "/admin/mcp-servers", labelKey: "admin.tabs.mcpServers" },
  { key: "telephony", to: "/admin/sip-accounts", labelKey: "admin.tabs.telephony" },
  { key: "settings", to: "/admin/settings", labelKey: "admin.tabs.settings" },
];

export const AdminTabs = ({ activeTab }: AdminTabsProps) => {
  const {
    setSidebarContent,
    setCollapsedSidebarContent,
    clearSidebarContent,
    clearCollapsedSidebarContent,
  } = useSidebarPortal();
  const { closeSidebar, isDesktopLayout, isSidebarCollapsed } = useAppLayout();
  const { t } = useI18n();
  const navigate = useNavigate();

  const handleNavLinkClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey
      ) {
        return;
      }

      if (!isDesktopLayout) {
        closeSidebar();
      }
    },
    [closeSidebar, isDesktopLayout],
  );

  const tabs = useMemo(
    () =>
      TAB_DEFINITIONS.map((tab) => ({
        ...tab,
        label: t(tab.labelKey),
      })),
    [t],
  );

  const navigationLabel = t("admin.tabs.navigationLabel");
  const sectionTitle = t("admin.tabs.sectionTitle");

  const handleCollapsedTabClick = useCallback(
    (to: string) => {
      navigate(to);

      if (!isDesktopLayout) {
        closeSidebar();
      }
    },
    [closeSidebar, isDesktopLayout, navigate],
  );

  const sidebarContent = useMemo(
    () => (
      <section
        className="chatkit-sidebar__section"
        aria-label={navigationLabel}
      >
        <div className="chatkit-sidebar__section-header">
          <h2 className="chatkit-sidebar__section-title">{sectionTitle}</h2>
        </div>
        <ul className="chatkit-sidebar__nav-list">
          {tabs.map((tab) => (
            <li key={tab.key} className="chatkit-sidebar__nav-item">
              <NavLink
                to={tab.to}
                end={tab.key === "users"}
                className={({ isActive }) =>
                  `chatkit-sidebar__nav-link${
                    isActive || activeTab === tab.key
                      ? " chatkit-sidebar__nav-link--active"
                      : ""
                  }`
                }
                onClick={handleNavLinkClick}
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </section>
    ),
    [activeTab, handleNavLinkClick, navigationLabel, sectionTitle, tabs],
  );

  const collapsedSidebarContent = useMemo(() => {
    if (tabs.length === 0) {
      return null;
    }

    return (
      <ul className="chatkit-sidebar__workflow-compact-list" role="list">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          const trimmedLabel = tab.label.trim();
          const initial = trimmedLabel ? trimmedLabel.charAt(0).toUpperCase() : "?";

          return (
            <li key={tab.key} className="chatkit-sidebar__workflow-compact-item">
              <button
                type="button"
                className={`chatkit-sidebar__workflow-compact-button${
                  isActive ? " chatkit-sidebar__workflow-compact-button--active" : ""
                }`}
                onClick={() => handleCollapsedTabClick(tab.to)}
                tabIndex={isSidebarCollapsed ? 0 : -1}
                aria-label={tab.label}
                aria-current={isActive ? "page" : undefined}
              >
                <span aria-hidden="true" className="chatkit-sidebar__workflow-compact-initial">
                  {initial}
                </span>
                <span className="visually-hidden">{tab.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }, [activeTab, handleCollapsedTabClick, isSidebarCollapsed, tabs]);

  useEffect(() => {
    setSidebarContent(sidebarContent);
    setCollapsedSidebarContent(collapsedSidebarContent);

    return () => {
      clearSidebarContent();
      clearCollapsedSidebarContent();
    };
  }, [
    clearCollapsedSidebarContent,
    clearSidebarContent,
    collapsedSidebarContent,
    setCollapsedSidebarContent,
    setSidebarContent,
    sidebarContent,
  ]);

  return null;
};
