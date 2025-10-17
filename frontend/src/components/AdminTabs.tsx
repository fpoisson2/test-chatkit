import { NavLink } from "react-router-dom";

type AdminTabsProps = {
  activeTab: "users" | "voice" | "models";
};

const tabs = [
  { key: "users" as const, to: "/admin", label: "Gestion des utilisateurs" },
  { key: "voice" as const, to: "/admin/voice", label: "Paramètres du mode voix" },
  { key: "models" as const, to: "/admin/models", label: "Modèles disponibles" },
];

export const AdminTabs = ({ activeTab }: AdminTabsProps) => (
  <nav className="admin-tabs" aria-label="Navigation du panneau d'administration">
    {tabs.map((tab) => (
      <NavLink
        key={tab.key}
        to={tab.to}
        end={tab.key === "users"}
        className={({ isActive }) =>
          `admin-tabs__link${isActive || activeTab === tab.key ? " admin-tabs__link--active" : ""}`
        }
      >
        {tab.label}
      </NavLink>
    ))}
  </nav>
);
