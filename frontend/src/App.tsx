import { lazy, type ReactElement } from "react";
import { Navigate, Route, Routes, Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppLayout } from "./components/AppLayout";
import { WorkflowSidebarProvider } from "./features/workflows/WorkflowSidebarProvider";
import { SuspenseRoute } from "./components/SuspenseRoute";
import { useAuth } from "./auth";
import { MyChat } from "./MyChat";
import { LoginPage } from "./pages/LoginPage";

// Lazy load heavy components for better initial load performance
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage }))
);
const WorkflowBuilderPage = lazy(() => import("./pages/WorkflowBuilderPage"));
const VectorStoresPage = lazy(() =>
  import("./pages/VectorStoresPage").then((m) => ({
    default: m.VectorStoresPage,
  }))
);
const WidgetLibraryPage = lazy(() => import("./pages/WidgetLibraryPage"));
const AdminPage = lazy(() =>
  import("./pages/AdminPage").then((m) => ({ default: m.AdminPage }))
);
const AdminModelsPage = lazy(() =>
  import("./pages/AdminModelsPage").then((m) => ({
    default: m.AdminModelsPage,
  }))
);
const AdminModelProvidersPage = lazy(() =>
  import("./pages/AdminModelProvidersPage").then((m) => ({
    default: m.AdminModelProvidersPage,
  }))
);
const AdminAppSettingsPage = lazy(() =>
  import("./pages/AdminAppSettingsPage").then((m) => ({
    default: m.AdminAppSettingsPage,
  }))
);
const AdminTelephonyPage = lazy(() =>
  import("./pages/AdminTelephonyPage").then((m) => ({
    default: m.AdminTelephonyPage,
  }))
);
const AdminMcpServersPage = lazy(() =>
  import("./pages/AdminMcpServersPage").then((m) => ({
    default: m.AdminMcpServersPage,
  }))
);
const AdminAppearancePage = lazy(() =>
  import("./pages/AdminAppearancePage").then((m) => ({
    default: m.AdminAppearancePage,
  }))
);
const AdminLanguagesPage = lazy(() =>
  import("./pages/AdminLanguagesPage").then((m) => ({
    default: m.AdminLanguagesPage,
  }))
);
const AdminLtiPage = lazy(() =>
  import("./pages/AdminLtiPage").then((m) => ({ default: m.AdminLtiPage }))
);
const DocsPage = lazy(() =>
  import("./pages/docs/DocsPage").then((m) => ({ default: m.DocsPage }))
);
const DocDetail = lazy(() =>
  import("./pages/docs/DocDetail").then((m) => ({ default: m.DocDetail }))
);

// Configure React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const RequireAdmin = ({ children }: { children: ReactElement }) => {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.is_admin) {
    return <Navigate to="/" replace />;
  }

  return children;
};

const RequireGuest = ({ children }: { children: ReactElement }) => {
  const { user } = useAuth();

  if (user) {
    return <Navigate to="/" replace />;
  }

  return children;
};

const RequireUser = ({ children }: { children: ReactElement }) => {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

const HomePage = () => <MyChat />;

const AuthenticatedAppLayout = () => (
  <WorkflowSidebarProvider>
    <AppLayout />
  </WorkflowSidebarProvider>
);

export const App = () => (
  <QueryClientProvider client={queryClient}>
    <Routes>
      <Route
        path="/login"
        element={
          <RequireGuest>
            <LoginPage />
          </RequireGuest>
        }
      />
      <Route
        path="/"
        element={
          <RequireUser>
            <AuthenticatedAppLayout />
          </RequireUser>
        }
      >
        <Route index element={<HomePage />} />
        <Route
          path="settings"
          element={
            <SuspenseRoute>
              <SettingsPage />
            </SuspenseRoute>
          }
        />
        <Route
          path="docs"
          element={
            <SuspenseRoute>
              <DocsPage />
            </SuspenseRoute>
          }
        />
        <Route
          path="docs/:slug"
          element={
            <SuspenseRoute>
              <DocDetail />
            </SuspenseRoute>
          }
        />
        <Route
          path="workflows"
          element={
            <SuspenseRoute>
              <RequireAdmin>
                <WorkflowBuilderPage />
              </RequireAdmin>
            </SuspenseRoute>
          }
        />
        <Route
          path="vector-stores"
          element={
            <SuspenseRoute>
              <RequireAdmin>
                <VectorStoresPage />
              </RequireAdmin>
            </SuspenseRoute>
          }
        />
        <Route
          path="widgets"
          element={
            <SuspenseRoute>
              <RequireAdmin>
                <WidgetLibraryPage />
              </RequireAdmin>
            </SuspenseRoute>
          }
        />
      </Route>
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AuthenticatedAppLayout />
          </RequireAdmin>
        }
      >
        <Route
          index
          element={
            <SuspenseRoute>
              <AdminPage />
            </SuspenseRoute>
          }
        />
        <Route
          path="settings"
          element={
            <SuspenseRoute>
              <AdminAppSettingsPage />
            </SuspenseRoute>
          }
        />
        <Route
          path="appearance"
          element={
            <SuspenseRoute>
              <AdminAppearancePage />
            </SuspenseRoute>
          }
        />
        <Route
          path="models"
          element={
            <SuspenseRoute>
              <AdminModelsPage />
            </SuspenseRoute>
          }
        />
        <Route
          path="providers"
          element={
            <SuspenseRoute>
              <AdminModelProvidersPage />
            </SuspenseRoute>
          }
        />
        <Route
          path="sip-accounts"
          element={
            <SuspenseRoute>
              <AdminTelephonyPage />
            </SuspenseRoute>
          }
        />
        <Route
          path="mcp-servers"
          element={
            <SuspenseRoute>
              <AdminMcpServersPage />
            </SuspenseRoute>
          }
        />
        <Route
          path="languages"
          element={
            <SuspenseRoute>
              <AdminLanguagesPage />
            </SuspenseRoute>
          }
        />
        <Route
          path="lti"
          element={
            <SuspenseRoute>
              <AdminLtiPage />
            </SuspenseRoute>
          }
        />
      </Route>
      <Route path="/admin/vector-stores" element={<Navigate to="/vector-stores" replace />} />
      <Route path="/admin/widgets" element={<Navigate to="/widgets" replace />} />
      <Route path="/admin/workflows" element={<Navigate to="/workflows" replace />} />
      <Route
        path="*"
        element={
          <RequireUser>
            <Navigate to="/" replace />
          </RequireUser>
        }
      />
    </Routes>
  </QueryClientProvider>
);
