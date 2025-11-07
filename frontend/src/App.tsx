import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "./components/AppLayout";
import { useAuth } from "./auth";
import { MyChat } from "./MyChat";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";
import WorkflowBuilderPage from "./pages/WorkflowBuilderPage"; // Phase 4: Import via pages/ to get WorkflowBuilderContainer with all providers
import { VectorStoresPage } from "./pages/VectorStoresPage";
import WidgetLibraryPage from "./pages/WidgetLibraryPage";
import { AdminPage } from "./pages/AdminPage";
import { AdminModelsPage } from "./pages/AdminModelsPage";
import { AdminAppSettingsPage } from "./pages/AdminAppSettingsPage";
import { AdminTelephonyPage } from "./pages/AdminTelephonyPage";
import { AdminMcpServersPage } from "./pages/AdminMcpServersPage";
import { AdminAppearancePage } from "./pages/AdminAppearancePage";
import { AdminLanguagesPage } from "./pages/AdminLanguagesPage";
import { DocsPage } from "./pages/docs/DocsPage";
import { DocDetail } from "./pages/docs/DocDetail";

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

export const App = () => (
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
          <AppLayout />
        </RequireUser>
      }
    >
      <Route index element={<HomePage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="docs" element={<DocsPage />} />
      <Route path="docs/:slug" element={<DocDetail />} />
      <Route
        path="workflows"
        element={
          <RequireAdmin>
            <WorkflowBuilderPage />
          </RequireAdmin>
        }
      />
      <Route
        path="vector-stores"
        element={
          <RequireAdmin>
            <VectorStoresPage />
          </RequireAdmin>
        }
      />
      <Route
        path="widgets"
        element={
          <RequireAdmin>
            <WidgetLibraryPage />
          </RequireAdmin>
        }
      />
    </Route>
    <Route
      path="/admin"
      element={
        <RequireAdmin>
          <AppLayout>
            <AdminPage />
          </AppLayout>
        </RequireAdmin>
      }
    />
    <Route
      path="/admin/settings"
      element={
        <RequireAdmin>
          <AppLayout>
            <AdminAppSettingsPage />
          </AppLayout>
        </RequireAdmin>
      }
    />
    <Route
      path="/admin/appearance"
      element={
        <RequireAdmin>
          <AppLayout>
            <AdminAppearancePage />
          </AppLayout>
        </RequireAdmin>
      }
    />
    <Route
      path="/admin/models"
      element={
        <RequireAdmin>
          <AppLayout>
            <AdminModelsPage />
          </AppLayout>
        </RequireAdmin>
      }
    />
    <Route
      path="/admin/sip-accounts"
      element={
        <RequireAdmin>
          <AppLayout>
            <AdminTelephonyPage />
          </AppLayout>
        </RequireAdmin>
      }
    />
    <Route
      path="/admin/mcp-servers"
      element={
        <RequireAdmin>
          <AppLayout>
            <AdminMcpServersPage />
          </AppLayout>
        </RequireAdmin>
      }
    />
    <Route
      path="/admin/languages"
      element={
        <RequireAdmin>
          <AppLayout>
            <AdminLanguagesPage />
          </AppLayout>
        </RequireAdmin>
      }
    />
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
);
