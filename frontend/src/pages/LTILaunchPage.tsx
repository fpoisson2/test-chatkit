import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth, type AuthUser } from "../auth";
import { LoadingSpinner } from "../components/feedback/LoadingSpinner";

/**
 * LTI Launch Handler Page
 *
 * This page receives the access token and user data from the LTI launch endpoint,
 * logs the user in automatically, and redirects to the chat interface.
 */
export const LTILaunchPage = () => {
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>("");
  const hasProcessed = useRef(false);

  useEffect(() => {
    // Prevent re-execution in strict mode or on re-renders
    if (hasProcessed.current) {
      return;
    }

    const token = searchParams.get("token");
    const userJson = searchParams.get("user");
    const workflowId = searchParams.get("workflow");
    const threadId = searchParams.get("thread_id");

    setDebugInfo(`Token: ${token ? "présent" : "absent"}, User: ${userJson ? "présent" : "absent"}, Workflow: ${workflowId || "absent"}, Thread: ${threadId || "absent"}`);

    if (!token || !userJson) {
      setError("Paramètres manquants dans l'URL");
      hasProcessed.current = true;
      setTimeout(() => {
        window.location.replace("/login");
      }, 3000);
      return;
    }

    try {
      const user: AuthUser = JSON.parse(decodeURIComponent(userJson));

      // Log the user in (stores token and user in localStorage)
      login(token, user);

      // Store the workflow ID from the Deep Link for the ChatWorkflowSidebar
      if (workflowId) {
        localStorage.setItem('lti_launch_workflow_id', workflowId);
      }

      hasProcessed.current = true;

      // Immediate redirect - no setTimeout needed
      window.location.replace(threadId ? `/c/${threadId}` : "/");
    } catch (error) {
      setError(`Erreur: ${error instanceof Error ? error.message : String(error)}`);
      hasProcessed.current = true;
      setTimeout(() => {
        window.location.replace("/login");
      }, 3000);
    }
  }, [searchParams, login]);

  // Don't show any UI during LTI launch - the redirect happens immediately
  // and showing UI causes unnecessary spinner flicker
  return null;
};

export default LTILaunchPage;
