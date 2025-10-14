import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AdminPage } from "./pages/AdminPage";
import { MyChat } from "./MyChat";
import { useAuth } from "./auth";
import { LoginPage } from "./pages/LoginPage";
import { VectorStoresPage } from "./pages/VectorStoresPage";
import WorkflowBuilderPage from "./pages/WorkflowBuilderPage";
import { VoicePage } from "./pages/VoicePage";

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
    return <Navigate to={user.is_admin ? "/admin" : "/"} replace />;
  }

  return children;
};

const HomePage = () => <MyChat />;

export const App = () => (
  <Routes>
    <Route
      path="/"
      element={<HomePage />}
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
      path="/admin/vector-stores"
      element={
        <RequireAdmin>
          <VectorStoresPage />
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
      element={<VoicePage />}
    />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);
