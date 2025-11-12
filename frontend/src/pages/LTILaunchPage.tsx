import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth, type AuthUser } from "../auth";

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
      console.log("LTI Launch: Already processed, skipping");
      return;
    }

    const token = searchParams.get("token");
    const userJson = searchParams.get("user");
    const workflowId = searchParams.get("workflow");

    console.log("LTI Launch: token present?", !!token);
    console.log("LTI Launch: user present?", !!userJson);
    console.log("LTI Launch: workflow present?", !!workflowId);
    console.log("LTI Launch: full URL", window.location.href);

    setDebugInfo(`Token: ${token ? "présent" : "absent"}, User: ${userJson ? "présent" : "absent"}, Workflow: ${workflowId || "absent"}`);

    if (!token || !userJson) {
      console.error("LTI Launch: Missing token or user data");
      setError("Paramètres manquants dans l'URL");
      hasProcessed.current = true;
      setTimeout(() => {
        window.location.replace("/login");
      }, 3000);
      return;
    }

    try {
      console.log("LTI Launch: Parsing user JSON...");
      const user: AuthUser = JSON.parse(decodeURIComponent(userJson));
      console.log("LTI Launch: User parsed successfully", user);

      // Log the user in (stores token and user in localStorage)
      console.log("LTI Launch: Calling login...");
      login(token, user);
      console.log("LTI Launch: Login successful");

      // Store the workflow ID from the Deep Link for the ChatWorkflowSidebar
      if (workflowId) {
        console.log("LTI Launch: Storing workflow ID", workflowId);
        localStorage.setItem('lti_launch_workflow_id', workflowId);
      }

      console.log("LTI Launch: Redirecting to /");
      hasProcessed.current = true;

      // Use window.location.replace to force a hard reload and avoid infinite loop
      setTimeout(() => {
        console.log("LTI Launch: Performing hard redirect to /");
        window.location.replace("/");
      }, 100);
    } catch (error) {
      console.error("LTI Launch: Failed to parse user data", error);
      setError(`Erreur: ${error instanceof Error ? error.message : String(error)}`);
      hasProcessed.current = true;
      setTimeout(() => {
        window.location.replace("/login");
      }, 3000);
    }
  }, [searchParams, login]);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      fontFamily: "system-ui, sans-serif"
    }}>
      <div style={{ textAlign: "center", maxWidth: "500px", padding: "20px" }}>
        <h2>Connexion LTI en cours...</h2>
        <p>Vous allez être redirigé vers l'application.</p>
        {debugInfo && (
          <p style={{ fontSize: "0.9em", color: "#666", marginTop: "20px" }}>
            {debugInfo}
          </p>
        )}
        {error && (
          <div style={{
            marginTop: "20px",
            padding: "10px",
            backgroundColor: "#fee",
            border: "1px solid #fcc",
            borderRadius: "4px",
            color: "#c00"
          }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default LTILaunchPage;
