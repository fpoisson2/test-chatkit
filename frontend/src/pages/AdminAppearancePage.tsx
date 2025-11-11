import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "../auth";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { FeedbackMessages } from "../components";
import { AppearanceForm } from "../features/appearance/AppearanceForm";
import { useAppearanceSettings as useAppearanceContext } from "../features/appearance/AppearanceSettingsContext";
import { useI18n } from "../i18n";
import {
  type AppearanceSettingsUpdatePayload,
  isUnauthorizedError,
} from "../utils/backend";
import {
  useAppearanceSettings,
  useUpdateAppearanceSettings,
} from "../hooks";

export const AdminAppearancePage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();
  const { applySnapshot } = useAppearanceContext();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Fetch appearance settings using React Query
  const {
    data: settings = null,
    isLoading,
    error: queryError,
  } = useAppearanceSettings(token, { scope: "admin" });

  // Update appearance settings mutation
  const updateSettings = useUpdateAppearanceSettings();

  // Apply snapshot when settings change
  useEffect(() => {
    if (settings) {
      applySnapshot(settings);
    }
  }, [applySnapshot, settings]);

  // Handle query error
  useEffect(() => {
    if (queryError) {
      if (isUnauthorizedError(queryError)) {
        logout();
        setError(t("admin.appearance.feedback.sessionExpired"));
      } else {
        setError(
          queryError instanceof Error
            ? queryError.message
            : t("admin.appearance.feedback.loadError"),
        );
      }
    }
  }, [logout, queryError, t]);

  const handleSubmit = useCallback(
    async (payload: AppearanceSettingsUpdatePayload) => {
      if (!token) {
        return;
      }

      setError(null);
      setSuccess(null);

      try {
        const updated = await updateSettings.mutateAsync({ token, payload });
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
      }
    },
    [applySnapshot, logout, t, token, updateSettings],
  );

  return (
    <ManagementPageLayout tabs={<AdminTabs activeTab="appearance" />}>
      <FeedbackMessages
        error={error}
        success={success}
        onDismissError={() => setError(null)}
        onDismissSuccess={() => setSuccess(null)}
      />

      <AppearanceForm
        id="admin-appearance-form"
        initialSettings={settings}
        isLoading={isLoading}
        isBusy={updateSettings.isPending}
        autoFocus
        onSubmit={handleSubmit}
      />
    </ManagementPageLayout>
  );
};

export default AdminAppearancePage;
