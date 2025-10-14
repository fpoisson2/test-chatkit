import { NavLink } from "react-router-dom";

type AdminTabsProps = {

activeTab: "users" | "vector-stores" | "widgets" | "models";


const tabs = [
  { key: "users" as const, to: "/admin", label: "Gestion des utilisateurs" },
  { key: "models" as const, to: "/admin/models", label: "Modèles disponibles" },
  { key: "vector-stores" as const, to: "/admin/vector-stores", label: "Vector stores JSON" },
  { key: "widgets" as const, to: "/admin/widgets", label: "Bibliothèque de widgets" },
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
