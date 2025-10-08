import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AuthUser, useAuth } from "../auth";

const backendUrl = (import.meta.env.VITE_BACKEND_URL ?? "").trim();

export const LoginPage = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const loginEndpoints = useMemo(() => {
    const normalizedBackendUrl = backendUrl.replace(/\/+$/, "");
    const endpoints = ["/api/auth/login"];
    if (normalizedBackendUrl.length > 0) {
      endpoints.push(`${normalizedBackendUrl}/api/auth/login`);
    }
    return Array.from(new Set(endpoints));
  }, [backendUrl]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = JSON.stringify({ email, password });
      let lastError: Error | null = null;
      let data: { access_token: string; user: AuthUser } | null = null;

      for (const endpoint of loginEndpoints) {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: payload,
          });

          if (!response.ok) {
            let detail = "Échec de la connexion";
            try {
              const body = await response.json();
              if (body?.detail) {
                detail = String(body.detail);
              } else {
                detail = `${response.status} ${response.statusText}`;
              }
            } catch (parseError) {
              detail = `${response.status} ${response.statusText}`;
            }
            lastError = new Error(detail);
            continue;
          }

          data = (await response.json()) as { access_token: string; user: AuthUser };
          break;
        } catch (networkError) {
          if (networkError instanceof Error) {
            lastError = networkError;
          } else {
            lastError = new Error("Une erreur inattendue est survenue");
          }
        }
      }

      if (!data) {
        throw lastError ?? new Error("Impossible de joindre le backend d'authentification");
      }

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
    <div className="login-layout">
      <form className="login-card" onSubmit={handleSubmit}>
        <div>
          <h1 className="login-card__title">Connexion</h1>
          <p className="login-card__subtitle">
            Accédez au panneau d'administration pour gérer les utilisateurs et vos sessions ChatKit.
          </p>
        </div>

        <div className="form-grid">
          <label className="label">
            Adresse e-mail
            <input
              className="input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              placeholder="vous@example.com"
            />
          </label>

          <label className="label">
            Mot de passe
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              placeholder="••••••••"
            />
          </label>
        </div>

        {error && <div className="alert alert--danger">{error}</div>}

        <button className="button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Connexion en cours…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
};
