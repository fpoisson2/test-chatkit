import { Suspense, type ReactNode } from "react";

import { useI18n } from "../i18n";

import { LoadingSpinner } from "./feedback/LoadingSpinner";

interface SuspenseRouteProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Wrapper component for lazy-loaded routes with Suspense
 * Provides a consistent loading state across the application
 */
export const SuspenseRoute = ({ children, fallback }: SuspenseRouteProps) => {
  const { t } = useI18n();

  const resolvedFallback =
    fallback ?? <LoadingSpinner size="lg" text={t("feedback.loading.page")} />;

  return <Suspense fallback={resolvedFallback}>{children}</Suspense>;
};
