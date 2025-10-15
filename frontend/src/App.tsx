import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AdminPage } from "./pages/AdminPage";
import { AdminModelsPage } from "./pages/AdminModelsPage";
import { MyChat } from "./MyChat";
import { useAuth } from "./auth";
import { LoginPage } from "./pages/LoginPage";
import { VectorStoresPage } from "./pages/VectorStoresPage";
import WorkflowBuilderPage from "./pages/WorkflowBuilderPage";
import { VoicePage } from "./pages/VoicePage";
import WidgetLibraryPage from "./pages/WidgetLibraryPage";

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
      path="/"
      element={
        <RequireUser>
          <HomePage />
        </RequireUser>
      }
    />
    <Route
      path="/login"
      element={
        <RequireGuest>
          <LoginPage />
        </RequireGuest>
      }
    />
    <Route
      path="/admin"
      element={
        <RequireAdmin>
          <AdminPage />
        </RequireAdmin>
      }
    />
    <Route
      path="/admin/models"
      element={
        <RequireAdmin>
          <AdminModelsPage />
        </RequireAdmin>
      }
    />
    <Route
      path="/admin/vector-stores"
      element={
        <RequireAdmin>
          <VectorStoresPage />
        </RequireAdmin>
      }
    />
    <Route
      path="/admin/widgets"
      element={
        <RequireAdmin>
          <WidgetLibraryPage />
        </RequireAdmin>
      }
    />
    <Route
      path="/admin/workflows"
      element={
        <RequireAdmin>
          <WorkflowBuilderPage />
        </RequireAdmin>
      }
    />
    <Route
      path="/voice"
      element={
        <RequireUser>
          <VoicePage />
        </RequireUser>
      }
    />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);
