import { lazy, type ReactElement } from "react";
import { Navigate, Route, Routes, Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppLayout } from "./components/AppLayout";
import { AuthErrorHandler } from "./components/AuthErrorHandler";
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
const DocsPage = lazy(() =>
  import("./pages/docs/DocsPage").then((m) => ({ default: m.DocsPage }))
);
const DocDetail = lazy(() =>
  import("./pages/docs/DocDetail").then((m) => ({ default: m.DocDetail }))
);
const LTIDeepLinkPage = lazy(() => import("./pages/LTIDeepLinkPage"));
const LTILaunchPage = lazy(() =>
  import("./pages/LTILaunchPage").then((m) => ({ default: m.LTILaunchPage }))
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
    <AuthErrorHandler />
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
        path="/lti/deep-link"
        element={
          <SuspenseRoute>
            <LTIDeepLinkPage />
          </SuspenseRoute>
        }
      />
      <Route
        path="/lti/launch"
        element={
          <SuspenseRoute fallback={null}>
            <LTILaunchPage />
          </SuspenseRoute>
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
              <DocsPage mode="standalone" />
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
      {/* Redirect old admin routes to home with admin modal query param */}
      <Route path="/admin" element={<Navigate to="/?admin=users" replace />} />
      <Route path="/admin/settings" element={<Navigate to="/?admin=settings" replace />} />
      <Route path="/admin/appearance" element={<Navigate to="/?admin=appearance" replace />} />
      <Route path="/admin/models" element={<Navigate to="/?admin=models" replace />} />
      <Route path="/admin/providers" element={<Navigate to="/?admin=providers" replace />} />
      <Route path="/admin/sip-accounts" element={<Navigate to="/?admin=telephony" replace />} />
      <Route path="/admin/mcp-servers" element={<Navigate to="/?admin=mcp-servers" replace />} />
      <Route path="/admin/languages" element={<Navigate to="/?admin=languages" replace />} />
      <Route path="/admin/lti" element={<Navigate to="/?admin=lti" replace />} />
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
