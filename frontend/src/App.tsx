import { Navigate, Route, Routes, Outlet } from "react-router-dom";

import { AppLayout } from "./components/AppLayout";
import { WorkflowSidebarProvider } from "./features/workflows/WorkflowSidebarProvider";
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

const RequireAdmin = () => {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.is_admin) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

const RequireGuest = () => {
  const { user } = useAuth();

  if (user) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

const RequireUser = () => {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

const HomePage = () => <MyChat />;

const AuthenticatedAppLayout = () => (
  <WorkflowSidebarProvider>
    <AppLayout />
  </WorkflowSidebarProvider>
);

export const App = () => (
  <Routes>
    <Route element={<RequireGuest />}>
      <Route path="/login" element={<LoginPage />} />
    </Route>
    <Route element={<RequireUser />}>
      <Route element={<AuthenticatedAppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="docs" element={<DocsPage />} />
        <Route path="docs/:slug" element={<DocDetail />} />
        <Route element={<RequireAdmin />}>
          <Route path="workflows" element={<WorkflowBuilderPage />} />
          <Route path="vector-stores" element={<VectorStoresPage />} />
          <Route path="widgets" element={<WidgetLibraryPage />} />
          <Route path="admin" element={<Outlet />}>
            <Route index element={<AdminPage />} />
            <Route path="settings" element={<AdminAppSettingsPage />} />
            <Route path="appearance" element={<AdminAppearancePage />} />
            <Route path="models" element={<AdminModelsPage />} />
            <Route path="sip-accounts" element={<AdminTelephonyPage />} />
            <Route path="mcp-servers" element={<AdminMcpServersPage />} />
            <Route path="languages" element={<AdminLanguagesPage />} />
          </Route>
          <Route path="admin/vector-stores" element={<Navigate to="/vector-stores" replace />} />
          <Route path="admin/widgets" element={<Navigate to="/widgets" replace />} />
          <Route path="admin/workflows" element={<Navigate to="/workflows" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Route>
  </Routes>
);
