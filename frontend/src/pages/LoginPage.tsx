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

    console.log('[LOGIN] Starting login attempt', { email: formData.email });

    try {
      const payload = JSON.stringify({ email: formData.email, password: formData.password });
      let lastError: Error | null = null;
      let data: { access_token: string; user: AuthUser } | null = null;

      console.log('[LOGIN] Attempting endpoints:', loginEndpoints);

      for (const endpoint of loginEndpoints) {
        console.log('[LOGIN] Trying endpoint:', endpoint);
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: payload,
          });

          console.log('[LOGIN] Response status:', response.status, response.statusText);

          if (!response.ok) {
            let detail = t("auth.login.error.failure");
            try {
              const body = await response.json();
              console.log('[LOGIN] Error response body:', body);

              if (body?.detail) {
                // Handle both string and object detail
                if (typeof body.detail === 'string') {
                  detail = body.detail;
                } else {
                  detail = JSON.stringify(body.detail);
                  console.warn('[LOGIN] detail is not a string:', body.detail);
                }
              } else {
                detail = `${response.status} ${response.statusText}`;
              }
            } catch (parseError) {
              console.error('[LOGIN] Failed to parse error response:', parseError);
              detail = `${response.status} ${response.statusText}`;
            }
            console.log('[LOGIN] Setting error:', detail);
            lastError = new Error(detail);
            continue;
          }

          data = (await response.json()) as { access_token: string; user: AuthUser };
          console.log('[LOGIN] Login successful!');
          break;
        } catch (networkError) {
          console.error('[LOGIN] Network error:', networkError);
          if (networkError instanceof Error) {
            lastError = networkError;
          } else {
            lastError = new Error(t("auth.login.error.unexpected"));
          }
        }
      }

      if (!data) {
        console.error('[LOGIN] All endpoints failed, last error:', lastError);
        throw lastError ?? new Error(t("auth.login.error.unreachable"));
      }

      login(data.access_token, data.user);
      navigate(data.user.is_admin ? "/admin" : "/");
    } catch (err) {
      console.error('[LOGIN] Final error:', err);
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
              <span className="error-message" style={{ color: 'var(--danger-color)', fontSize: '0.875rem', marginTop: '0.25rem', display: 'block' }}>
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
              <span className="error-message" style={{ color: 'var(--danger-color)', fontSize: '0.875rem', marginTop: '0.25rem', display: 'block' }}>
                {formErrors.password.message}
              </span>
            )}
          </label>
        </div>

        {error && <ErrorAlert message={error} dismissible onDismiss={() => setError(null)} />}

        <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("auth.login.submit.loading") : t("auth.login.submit.label")}
        </button>
      </form>
    </div>
  );
};
