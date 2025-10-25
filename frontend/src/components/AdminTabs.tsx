import { MouseEvent, useCallback, useEffect, useMemo } from "react";
import { NavLink } from "react-router-dom";

import { useAppLayout, useSidebarPortal } from "./AppLayout";
import { useI18n } from "../i18n";

type AdminTabKey = "users" | "models" | "vector-stores" | "widgets" | "settings";

type AdminTabsProps = {
  activeTab: AdminTabKey;
};

const TAB_DEFINITIONS: { key: AdminTabKey; to: string; labelKey: string }[] = [
  { key: "users", to: "/admin", labelKey: "admin.tabs.users" },
  { key: "models", to: "/admin/models", labelKey: "admin.tabs.models" },
  { key: "vector-stores", to: "/vector-stores", labelKey: "admin.tabs.vectorStores" },
  { key: "widgets", to: "/widgets", labelKey: "admin.tabs.widgets" },
  { key: "settings", to: "/admin/settings", labelKey: "admin.tabs.settings" },
];

export const AdminTabs = ({ activeTab }: AdminTabsProps) => {
  const { setSidebarContent, clearSidebarContent } = useSidebarPortal();
  const { closeSidebar, isDesktopLayout } = useAppLayout();
  const { t } = useI18n();

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

  useEffect(() => {
    setSidebarContent(sidebarContent);

    return () => {
      clearSidebarContent();
    };
  }, [clearSidebarContent, setSidebarContent, sidebarContent]);

  return null;
};
