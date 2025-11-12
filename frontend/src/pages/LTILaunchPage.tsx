import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth, type AuthUser } from "../auth";

/**
 * LTI Launch Handler Page
 *
 * This page receives the access token and user data from the LTI launch endpoint,
 * logs the user in automatically, and redirects to the chat interface.
 */
export const LTILaunchPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();

  useEffect(() => {
    const token = searchParams.get("token");
    const userJson = searchParams.get("user");

    if (!token || !userJson) {
      console.error("LTI Launch: Missing token or user data");
      navigate("/login", { replace: true });
      return;
    }

    try {
      const user: AuthUser = JSON.parse(decodeURIComponent(userJson));

      // Log the user in (stores token and user in localStorage)
      login(token, user);

      // Redirect to the chat interface
      navigate("/", { replace: true });
    } catch (error) {
      console.error("LTI Launch: Failed to parse user data", error);
      navigate("/login", { replace: true });
    }
  }, [searchParams, login, navigate]);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      fontFamily: "system-ui, sans-serif"
    }}>
      <div style={{ textAlign: "center" }}>
        <h2>Connexion LTI en cours...</h2>
        <p>Vous allez être redirigé vers l'application.</p>
      </div>
    </div>
  );
};

export default LTILaunchPage;
