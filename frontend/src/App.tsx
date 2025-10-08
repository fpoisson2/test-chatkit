import type { ReactElement } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";

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
  const { user, logout } = useAuth();

  if (!user) {
    return null;
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #e2e8f0",
          backgroundColor: "#f8fafc",
        }}
      >
        <div>
          <strong>ChatKit Demo</strong>
          <span style={{ marginLeft: "8px", color: "#475569" }}>
            Connecté en tant que {user.email}
          </span>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {user?.is_admin && (
            <Link to="/admin" style={{ color: "#2563eb", textDecoration: "none" }}>
              Administration
            </Link>
          )}
          {user && (
            <button
              type="button"
              onClick={logout}
              style={{
                backgroundColor: "#dc2626",
                color: "white",
                border: "none",
                borderRadius: "4px",
                padding: "6px 12px",
                cursor: "pointer",
              }}
            >
              Déconnexion
            </button>
          )}
        </div>
      </header>
      <div style={{ flex: "1 1 auto" }}>
        <MyChat />
      </div>
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
