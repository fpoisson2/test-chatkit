import { lazy, ComponentType } from "react";

export type AdminSectionKey =
  | "users"
  | "models"
  | "providers"
  | "vector-stores"
  | "widgets"
  | "mcp-servers"
  | "github"
  | "telephony"
  | "workflow-monitor"
  | "workflow-generation"
  | "browser-test"
  | "settings"
  | "appearance"
  | "languages"
  | "lti"
  | "cleanup"
  | "docs"
  | "preferences";

export type AdminSection = {
  key: AdminSectionKey;
  labelKey: string;
  Component: ComponentType;
  requireAdmin?: boolean;
};

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    key: "users",
    labelKey: "admin.tabs.users",
    Component: lazy(() =>
      import("../pages/AdminPage").then((module) => ({
        default: module.AdminPage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "models",
    labelKey: "admin.tabs.models",
    Component: lazy(() =>
      import("../pages/AdminModelsPage").then((module) => ({
        default: module.AdminModelsPage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "providers",
    labelKey: "admin.tabs.providers",
    Component: lazy(() =>
      import("../pages/AdminModelProvidersPage").then((module) => ({
        default: module.AdminModelProvidersPage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "vector-stores",
    labelKey: "admin.tabs.vectorStores",
    Component: lazy(() =>
      import("../pages/VectorStoresPage").then((module) => ({
        default: module.VectorStoresPage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "widgets",
    labelKey: "admin.tabs.widgets",
    Component: lazy(() =>
      import("../pages/WidgetLibraryPage").then((module) => ({
        default: module.WidgetLibraryPage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "mcp-servers",
    labelKey: "admin.tabs.mcpServers",
    Component: lazy(() =>
      import("../pages/AdminMcpServersPage").then((module) => ({
        default: module.AdminMcpServersPage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "github",
    labelKey: "admin.tabs.github",
    Component: lazy(() =>
      import("../pages/AdminGitHubIntegrationsPage").then((module) => ({
        default: module.AdminGitHubIntegrationsPage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "telephony",
    labelKey: "admin.tabs.telephony",
    Component: lazy(() =>
      import("../pages/AdminTelephonyPage").then((module) => ({
        default: module.AdminTelephonyPage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "workflow-monitor",
    labelKey: "admin.tabs.workflowMonitor",
    Component: lazy(() =>
      import("../pages/AdminWorkflowMonitorPage").then((module) => ({
        default: module.AdminWorkflowMonitorPage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "workflow-generation",
    labelKey: "admin.tabs.workflowGeneration",
    Component: lazy(() =>
      import("../pages/AdminWorkflowGenerationPage").then((module) => ({
        default: module.AdminWorkflowGenerationPage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "browser-test",
    labelKey: "admin.tabs.browserTest",
    Component: lazy(() =>
      import("../pages/AdminBrowserTestPage").then((module) => ({
        default: module.AdminBrowserTestPage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "settings",
    labelKey: "admin.tabs.settings",
    Component: lazy(() =>
      import("../pages/AdminAppSettingsPage").then((module) => ({
        default: module.AdminAppSettingsPage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "appearance",
    labelKey: "admin.tabs.appearance",
    Component: lazy(() =>
      import("../pages/AdminAppearancePage").then((module) => ({
        default: module.AdminAppearancePage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "languages",
    labelKey: "admin.tabs.languages",
    Component: lazy(() =>
      import("../pages/AdminLanguagesPage").then((module) => ({
        default: module.AdminLanguagesPage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "lti",
    labelKey: "admin.tabs.lti",
    Component: lazy(() =>
      import("../pages/AdminLtiPage").then((module) => ({
        default: module.AdminLtiPage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "cleanup",
    labelKey: "admin.tabs.cleanup",
    Component: lazy(() =>
      import("../pages/AdminCleanupPage").then((module) => ({
        default: module.AdminCleanupPage,
      })),
    ),
    requireAdmin: true,
  },
  {
    key: "docs",
    labelKey: "admin.tabs.docs",
    Component: lazy(() =>
      import("../pages/docs/DocsPage").then((module) => ({
        default: module.DocsPage,
      })),
    ),
    requireAdmin: false,
  },
  {
    key: "preferences",
    labelKey: "admin.tabs.preferences",
    Component: lazy(() =>
      import("../pages/SettingsPage").then((module) => ({
        default: module.SettingsPage,
      })),
    ),
    requireAdmin: false,
  },
];
