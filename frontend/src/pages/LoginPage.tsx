import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AuthUser, useAuth } from "../auth";

const backendUrl = import.meta.env.VITE_BACKEND_URL ?? "";

export const LoginPage = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${backendUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const { detail } = await response.json();
        throw new Error(detail ?? "Échec de la connexion");
      }

      const data: { access_token: string; user: AuthUser } = await response.json();
      login(data.access_token, data.user);
      navigate(data.user.is_admin ? "/admin" : "/");
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Une erreur inattendue est survenue");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f1f5f9",
        padding: "24px",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: "400px",
          backgroundColor: "white",
          padding: "32px",
          borderRadius: "12px",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem", color: "#0f172a" }}>Connexion</h1>
          <p style={{ margin: "8px 0 0", color: "#475569" }}>
            Accédez au panneau d'administration pour gérer les utilisateurs.
          </p>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: "8px", color: "#1e293b" }}>
          Adresse e-mail
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            placeholder="vous@example.com"
            style={{
              padding: "10px 12px",
              borderRadius: "8px",
              border: "1px solid #cbd5f5",
              fontSize: "1rem",
            }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "8px", color: "#1e293b" }}>
          Mot de passe
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            placeholder="••••••••"
            style={{
              padding: "10px 12px",
              borderRadius: "8px",
              border: "1px solid #cbd5f5",
              fontSize: "1rem",
            }}
          />
        </label>

        {error && (
          <div style={{ color: "#b91c1c", backgroundColor: "#fee2e2", padding: "12px", borderRadius: "8px" }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            backgroundColor: isSubmitting ? "#94a3b8" : "#2563eb",
            color: "white",
            border: "none",
            borderRadius: "8px",
            padding: "12px 16px",
            fontSize: "1rem",
            cursor: isSubmitting ? "not-allowed" : "pointer",
            transition: "background-color 0.2s ease",
          }}
        >
          {isSubmitting ? "Connexion en cours…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
};
