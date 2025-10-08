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
    <div className="app-shell">
      <header className="app-shell__header">
        <div className="app-shell__header-inner">
          <div className="branding">
            <h1 className="branding__title">ChatKit Demo</h1>
            <p className="branding__subtitle">Connecté en tant que {user.email}</p>
          </div>
          <div className="header-actions">
            <span className="header-actions__pill">Session sécurisée</span>
            {user?.is_admin && (
              <Link className="button button--ghost" to="/admin">
                Administration
              </Link>
            )}
            <button className="button button--danger" type="button" onClick={logout}>
              Déconnexion
            </button>
          </div>
        </div>
      </header>
      <main className="app-shell__main">
        <MyChat />
      </main>
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
