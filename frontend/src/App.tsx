import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AdminPage } from "./pages/AdminPage";
import { LoginPage } from "./pages/LoginPage";
import { MyChat } from "./MyChat";
import { useAuth } from "./auth";

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

const RequireAuth = ({ children }: { children: ReactElement }) => {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
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

const HomePage = () => {
  const { user } = useAuth();

  if (!user) {
    return null;
  }

  return (
    <div className="full-screen-shell">
      <MyChat />
    </div>
  );
};

export const App = () => (
  <Routes>
    <Route
      path="/"
      element={(
        <RequireAuth>
          <HomePage />
        </RequireAuth>
      )}
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
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);
