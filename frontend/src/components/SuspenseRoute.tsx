import { Suspense, type ReactNode } from "react";
import { LoadingSpinner } from "./LoadingSpinner";

interface SuspenseRouteProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Wrapper component for lazy-loaded routes with Suspense
 * Provides a consistent loading state across the application
 */
export const SuspenseRoute = ({
  children,
  fallback = <LoadingSpinner size="lg" text="Loading page..." />,
}: SuspenseRouteProps) => {
  return <Suspense fallback={fallback}>{children}</Suspense>;
};
