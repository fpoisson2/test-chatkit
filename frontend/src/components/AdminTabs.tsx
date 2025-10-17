import { useEffect, useMemo } from "react";
import { NavLink } from "react-router-dom";

import { useSidebarPortal } from "./AppLayout";

type AdminTabsProps = {
  activeTab: "users" | "voice" | "models";
};

const tabs = [
  { key: "users" as const, to: "/admin", label: "Gestion des utilisateurs" },
  {
    key: "voice" as const,
    to: "/admin/voice",
    label: "Paramètres du mode voix",
  },
  { key: "models" as const, to: "/admin/models", label: "Modèles disponibles" },
];

export const AdminTabs = ({ activeTab }: AdminTabsProps) => {
  const { setSidebarContent, clearSidebarContent } = useSidebarPortal();

  const sidebarContent = useMemo(
    () => (
      <section
        className="chatkit-sidebar__section"
        aria-label="Navigation du panneau d'administration"
      >
        <div className="chatkit-sidebar__section-header">
          <h2 className="chatkit-sidebar__section-title">Administration</h2>
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
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </section>
    ),
    [activeTab],
  );

  useEffect(() => {
    setSidebarContent(sidebarContent);

    return () => {
      clearSidebarContent();
    };
  }, [clearSidebarContent, setSidebarContent, sidebarContent]);

  return null;
};
