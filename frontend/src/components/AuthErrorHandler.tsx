import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { ApiError, setGlobalUnauthorizedHandler } from "../utils/backend";

const RETURN_URL_KEY = "chatkit:auth:return_url";

/**
 * Save the current URL so the user can be redirected back after re-authentication.
 */
export function getReturnUrl(): string | null {
  return window.localStorage.getItem(RETURN_URL_KEY);
}

export function clearReturnUrl(): void {
  window.localStorage.removeItem(RETURN_URL_KEY);
}

/**
 * Global handler for authentication errors.
 * Listens to all React Query cache events and API requests,
 * then redirects to login when a 401 error occurs.
 */
export const AuthErrorHandler = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();

  // Track if we've already handled logout to prevent multiple redirects
  const isHandlingLogout = useRef(false);

  const handleUnauthorized = useCallback(() => {
    // Prevent multiple simultaneous logouts
    if (isHandlingLogout.current) {
      return;
    }
    isHandlingLogout.current = true;

    // Save the current URL so the user can return after re-authentication
    const currentPath = location.pathname + location.search + location.hash;
    if (currentPath && currentPath !== "/login") {
      window.localStorage.setItem(RETURN_URL_KEY, currentPath);
    }

    const isLtiUser = user?.is_lti || localStorage.getItem('lti_launch_workflow_id') !== null;

    logout();

    if (isLtiUser) {
      // LTI users can't use /login — show a message telling them to re-launch from Moodle
      navigate("/lti/expired", { replace: true });
    } else {
      navigate("/login", { replace: true });
    }

    // Reset the flag after a short delay to allow re-handling if needed
    setTimeout(() => {
      isHandlingLogout.current = false;
    }, 1000);
  }, [logout, navigate, location, user]);

  // Register global handler for non-React Query API calls
  useEffect(() => {
    if (!user) {
      setGlobalUnauthorizedHandler(null);
      return;
    }

    setGlobalUnauthorizedHandler(handleUnauthorized);

    return () => {
      setGlobalUnauthorizedHandler(null);
    };
  }, [user, handleUnauthorized]);

  // Subscribe to React Query cache for queries
  useEffect(() => {
    if (!user) {
      return;
    }

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") {
        return;
      }

      const error = event.query.state.error;

      if (error instanceof ApiError && error.status === 401) {
        handleUnauthorized();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [queryClient, handleUnauthorized, user]);

  // Subscribe to mutation cache for POST/PUT/DELETE requests
  useEffect(() => {
    if (!user) {
      return;
    }

    const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated") {
        return;
      }

      const error = event.mutation?.state.error;

      if (error instanceof ApiError && error.status === 401) {
        handleUnauthorized();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [queryClient, handleUnauthorized, user]);

  return null;
};
