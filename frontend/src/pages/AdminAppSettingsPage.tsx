import { FormEvent, useCallback, useEffect, useState } from "react";

import { useAuth } from "../auth";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { useI18n } from "../i18n";
import {
  type AppSettings,
  appSettingsApi,
  isUnauthorizedError,
} from "../utils/backend";

export const AdminAppSettingsPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [prompt, setPrompt] = useState("");
  const [sipTrunkUri, setSipTrunkUri] = useState("");
  const [sipTrunkUsername, setSipTrunkUsername] = useState("");
  const [sipTrunkPassword, setSipTrunkPassword] = useState("");
  const [isLoading, setLoading] = useState(true);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    if (!token) {
      setSettings(null);
      setPrompt("");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await appSettingsApi.get(token);
      setSettings(data);
      setPrompt(data.thread_title_prompt);
      setSipTrunkUri(data.sip_trunk_uri ?? "");
      setSipTrunkUsername(data.sip_trunk_username ?? "");
      setSipTrunkPassword(data.sip_trunk_password ?? "");
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.appSettings.errors.sessionExpired"));
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : t("admin.appSettings.errors.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [logout, t, token]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!token) {
      setError(t("admin.appSettings.errors.sessionExpired"));
      return;
    }

    const trimmed = prompt.trim();
    if (!trimmed) {
      setError(t("admin.appSettings.errors.promptRequired"));
      return;
    }

    setSaving(true);
    try {
      const updated = await appSettingsApi.update(token, {
        thread_title_prompt: trimmed,
        sip_trunk_uri: sipTrunkUri.trim() || null,
        sip_trunk_username: sipTrunkUsername.trim() || null,
        sip_trunk_password: sipTrunkPassword.trim() || null,
      });
      setSettings(updated);
      setPrompt(updated.thread_title_prompt);
      setSipTrunkUri(updated.sip_trunk_uri ?? "");
      setSipTrunkUsername(updated.sip_trunk_username ?? "");
      setSipTrunkPassword(updated.sip_trunk_password ?? "");
      setSuccess(t("admin.appSettings.success.saved"));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.appSettings.errors.sessionExpired"));
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : t("admin.appSettings.errors.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setError(null);
    setSuccess(null);

    if (!token) {
      setError(t("admin.appSettings.errors.sessionExpired"));
      return;
    }

    setSaving(true);
    try {
      const updated = await appSettingsApi.update(token, {
        thread_title_prompt: null,
      });
      setSettings(updated);
      setPrompt(updated.thread_title_prompt);
      setSipTrunkUri(updated.sip_trunk_uri ?? "");
      setSipTrunkUsername(updated.sip_trunk_username ?? "");
      setSipTrunkPassword(updated.sip_trunk_password ?? "");
      setSuccess(t("admin.appSettings.success.reset"));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.appSettings.errors.sessionExpired"));
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : t("admin.appSettings.errors.resetFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const isBusy = isLoading || isSaving;
  const isCustomPrompt = settings?.is_custom_thread_title_prompt ?? false;
  const defaultPrompt = settings?.default_thread_title_prompt ?? "";

  return (
    <>
      <AdminTabs activeTab="settings" />
      <ManagementPageLayout
        title={t("admin.appSettings.page.title")}
        subtitle={t("admin.appSettings.page.subtitle")}
      >
        {error ? <div className="alert alert--danger">{error}</div> : null}
        {success ? <div className="alert alert--success">{success}</div> : null}

        <div className="admin-grid">
          <section className="admin-card">
            <div>
              <h2 className="admin-card__title">
                {t("admin.appSettings.threadTitle.cardTitle")}
              </h2>
              <p className="admin-card__subtitle">
                {t("admin.appSettings.threadTitle.cardDescription")}
              </p>
            </div>
            <form className="admin-form" onSubmit={handleSubmit}>
              <label className="label" htmlFor="thread-title-prompt">
                {t("admin.appSettings.threadTitle.fieldLabel")}
                <textarea
                  id="thread-title-prompt"
                  className="textarea"
                  rows={5}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={t(
                    "admin.appSettings.threadTitle.placeholder",
                  )}
                  disabled={isBusy}
                />
              </label>
              <p className="admin-form__hint">
                {t("admin.appSettings.threadTitle.hint")}
              </p>
              <p className="admin-form__hint">
                {isCustomPrompt
                  ? t("admin.appSettings.threadTitle.status.custom")
                  : t("admin.appSettings.threadTitle.status.default")}
              </p>
              <div className="admin-form__default-block" aria-live="polite">
                <strong>{t("admin.appSettings.threadTitle.defaultLabel")}</strong>
                <pre>{defaultPrompt}</pre>
              </div>
              <div className="admin-form__divider" aria-hidden="true" />
              <div>
                <h3 className="admin-card__title" style={{ marginBottom: "8px" }}>
                  {t("admin.appSettings.sipTrunk.cardTitle")}
                </h3>
                <p className="admin-card__subtitle">
                  {t("admin.appSettings.sipTrunk.cardDescription")}
                </p>
              </div>
              <label className="label" htmlFor="sip-trunk-uri">
                {t("admin.appSettings.sipTrunk.uriLabel")}
                <input
                  id="sip-trunk-uri"
                  className="input"
                  type="text"
                  value={sipTrunkUri}
                  onChange={(event) => setSipTrunkUri(event.target.value)}
                  placeholder={t("admin.appSettings.sipTrunk.uriPlaceholder")}
                  disabled={isBusy}
                />
              </label>
              <label className="label" htmlFor="sip-trunk-username">
                {t("admin.appSettings.sipTrunk.usernameLabel")}
                <input
                  id="sip-trunk-username"
                  className="input"
                  type="text"
                  value={sipTrunkUsername}
                  onChange={(event) => setSipTrunkUsername(event.target.value)}
                  placeholder={t("admin.appSettings.sipTrunk.usernamePlaceholder")}
                  disabled={isBusy}
                  autoComplete="username"
                />
              </label>
              <label className="label" htmlFor="sip-trunk-password">
                {t("admin.appSettings.sipTrunk.passwordLabel")}
                <input
                  id="sip-trunk-password"
                  className="input"
                  type="password"
                  value={sipTrunkPassword}
                  onChange={(event) => setSipTrunkPassword(event.target.value)}
                  placeholder={t("admin.appSettings.sipTrunk.passwordPlaceholder")}
                  disabled={isBusy}
                  autoComplete="current-password"
                />
              </label>
              <p className="admin-form__hint">
                {t("admin.appSettings.sipTrunk.passwordHelp")}
              </p>
              <div className="admin-form__actions" style={{ gap: "12px" }}>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={handleReset}
                  disabled={isBusy || !isCustomPrompt}
                >
                  {t("admin.appSettings.actions.reset")}
                </button>
                <button
                  type="submit"
                  className="button"
                  disabled={isBusy}
                >
                  {t("admin.appSettings.actions.save")}
                </button>
              </div>
            </form>
          </section>
        </div>
      </ManagementPageLayout>
    </>
  );
};

export default AdminAppSettingsPage;
