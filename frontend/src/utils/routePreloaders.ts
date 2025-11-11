/**
 * Route preloader functions for lazy-loaded components
 * Call these on hover/focus to preload route chunks before navigation
 */

// Type-safe preloader map
type RoutePreloader = () => Promise<any>;

const preloaders: Record<string, RoutePreloader> = {
  settings: () => import("../pages/SettingsPage"),
  workflows: () => import("../pages/WorkflowBuilderPage"),
  "vector-stores": () => import("../pages/VectorStoresPage"),
  widgets: () => import("../pages/WidgetLibraryPage"),
  admin: () => import("../pages/AdminPage"),
  "admin/settings": () => import("../pages/AdminAppSettingsPage"),
  "admin/appearance": () => import("../pages/AdminAppearancePage"),
  "admin/models": () => import("../pages/AdminModelsPage"),
  "admin/providers": () => import("../pages/AdminModelProvidersPage"),
  "admin/sip-accounts": () => import("../pages/AdminTelephonyPage"),
  "admin/mcp-servers": () => import("../pages/AdminMcpServersPage"),
  "admin/languages": () => import("../pages/AdminLanguagesPage"),
  "admin/lti": () => import("../pages/AdminLtiPage"),
  docs: () => import("../pages/docs/DocsPage"),
};

// Track which routes have been preloaded to avoid duplicate loads
const preloadedRoutes = new Set<string>();

/**
 * Preload a route's lazy-loaded chunk
 * @param route - The route path to preload
 * @returns Promise that resolves when the chunk is loaded
 */
export const preloadRoute = (route: string): Promise<any> | null => {
  // Remove leading slash and trailing slash for consistency
  const normalizedRoute = route.replace(/^\//, "").replace(/\/$/, "");

  if (preloadedRoutes.has(normalizedRoute)) {
    return null; // Already preloaded
  }

  const preloader = preloaders[normalizedRoute];
  if (preloader) {
    preloadedRoutes.add(normalizedRoute);
    return preloader().catch((err) => {
      // Remove from set if preload fails so we can retry
      preloadedRoutes.delete(normalizedRoute);
      console.warn(`Failed to preload route: ${route}`, err);
    });
  }

  return null;
};

/**
 * Create event handlers for preloading on hover/focus
 * @param route - The route path to preload
 */
export const createPreloadHandlers = (route: string) => ({
  onMouseEnter: () => preloadRoute(route),
  onFocus: () => preloadRoute(route),
});
