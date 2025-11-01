import { useCallback, useEffect, useState } from "react";

import { useAuth } from "../auth";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { AppearanceForm } from "../features/appearance/AppearanceForm";
import { useAppearanceSettings } from "../features/appearance/AppearanceSettingsContext";
import { useI18n } from "../i18n";
import {
  type AppearanceSettings,
  type AppearanceSettingsUpdatePayload,
  appearanceSettingsApi,
  isUnauthorizedError,
} from "../utils/backend";

export const AdminAppearancePage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();
  const { applySnapshot } = useAppearanceSettings();
  const [settings, setSettings] = useState<AppearanceSettings | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    if (!token) {
      setSettings(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const data = await appearanceSettingsApi.get(token, { scope: "admin" });
      setSettings(data);
      applySnapshot(data);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.appearance.feedback.sessionExpired"));
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : t("admin.appearance.feedback.loadError"),
      );
    } finally {
      setLoading(false);
    }
  }, [applySnapshot, logout, t, token]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const handleSubmit = useCallback(
    async (payload: AppearanceSettingsUpdatePayload) => {
      if (!token) {
        return;
      }

      setSaving(true);
      setError(null);
      setSuccess(null);

      try {
        const updated = await appearanceSettingsApi.update(token, payload);
        setSettings(updated);
        applySnapshot(updated);
        setSuccess(t("admin.appearance.feedback.saved"));
      } catch (err) {
        if (isUnauthorizedError(err)) {
          logout();
          setError(t("admin.appearance.feedback.sessionExpired"));
          return;
        }
        setError(
          err instanceof Error
            ? err.message
            : t("admin.appearance.feedback.error"),
        );
      } finally {
        setSaving(false);
      }
    },
    [applySnapshot, logout, t, token],
  );

  return (
    <ManagementPageLayout
      title={t("admin.appearance.page.title")}
      subtitle={t("admin.appearance.page.subtitle")}
      tabs={<AdminTabs activeTab="appearance" />}
    >
      {error ? <div className="alert alert--danger">{error}</div> : null}
      {success ? <div className="alert alert--success">{success}</div> : null}

      <AppearanceForm
        id="admin-appearance-form"
        initialSettings={settings}
        isLoading={isLoading}
        isBusy={isSaving}
        autoFocus
        onSubmit={handleSubmit}
      />
    </ManagementPageLayout>
  );
};

export default AdminAppearancePage;
