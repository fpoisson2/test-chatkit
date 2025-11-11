import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { AuthUser, useAuth } from "../auth";
import { makeApiEndpointCandidates } from "../utils/backend";
import { useI18n } from "../i18n";
import { loginFormSchema, type LoginFormData } from "../schemas/auth";
import { ErrorAlert } from "../components";

const backendUrl = (import.meta.env.VITE_BACKEND_URL ?? "").trim();

export const LoginPage = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();

  const {
    register,
    handleSubmit: handleFormSubmit,
    formState: { errors: formErrors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const loginEndpoints = useMemo(
    () => makeApiEndpointCandidates(backendUrl, "/api/auth/login"),
    [backendUrl],
  );

  const handleSubmit = async (formData: LoginFormData) => {
    setSubmitting(true);
    setError(null);

    try {
      const payload = JSON.stringify({ email: formData.email, password: formData.password });
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
            let detail = t("auth.login.error.failure");
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
            lastError = new Error(t("auth.login.error.unexpected"));
          }
        }
      }

      if (!data) {
        throw lastError ?? new Error(t("auth.login.error.unreachable"));
      }

      login(data.access_token, data.user);
      navigate(data.user.is_admin ? "/admin" : "/");
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t("auth.login.error.unexpected"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-layout">
      <form className="login-card" onSubmit={handleFormSubmit(handleSubmit)}>
        <div>
          <h1 className="login-card__title">{t("auth.login.title")}</h1>
          <p className="login-card__subtitle">{t("auth.login.subtitle")}</p>
        </div>

        <div className="form-grid">
          <label className="label">
            {t("auth.login.email.label")}
            <input
              className="input"
              type="email"
              {...register("email")}
              placeholder={t("auth.login.email.placeholder")}
            />
            {formErrors.email && (
              <span className="error-message" style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.25rem', display: 'block' }}>
                {formErrors.email.message}
              </span>
            )}
          </label>

          <label className="label">
            {t("auth.login.password.label")}
            <input
              className="input"
              type="password"
              {...register("password")}
              placeholder={t("auth.login.password.placeholder")}
            />
            {formErrors.password && (
              <span className="error-message" style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.25rem', display: 'block' }}>
                {formErrors.password.message}
              </span>
            )}
          </label>
        </div>

        {error && <ErrorAlert message={error} dismissible onDismiss={() => setError(null)} />}

        <button className="button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("auth.login.submit.loading") : t("auth.login.submit.label")}
        </button>
      </form>
    </div>
  );
};
