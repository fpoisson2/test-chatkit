import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "./components/AppLayout";
import { useAuth } from "./auth";
import { MyChat } from "./MyChat";
import { LoginPage } from "./pages/LoginPage";
import { VoicePage } from "./pages/VoicePage";
import { SettingsPage } from "./pages/SettingsPage";
import WorkflowBuilderPage from "./features/workflow-builder/WorkflowBuilderPage";
import { VectorStoresPage } from "./pages/VectorStoresPage";
import WidgetLibraryPage from "./pages/WidgetLibraryPage";
import { AdminPage } from "./pages/AdminPage";
import { AdminModelsPage } from "./pages/AdminModelsPage";
import { AdminVoicePage } from "./pages/AdminVoicePage";

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
      <Route path="voice" element={<VoicePage />} />
      <Route path="settings" element={<SettingsPage />} />
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
      path="/admin/voice"
      element={
        <RequireAdmin>
          <AppLayout>
            <AdminVoicePage />
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
