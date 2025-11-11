import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "../auth";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { useI18n } from "../i18n";
import {
  type AppSettings,
  type AppSettingsUpdatePayload,
  isUnauthorizedError,
} from "../utils/backend";
import { useAppSettings, useUpdateAppSettings, useModelsAdmin } from "../hooks";
import { adminAppSettingsSchema, type AdminAppSettingsFormData } from "../schemas/admin";

export const AdminAppSettingsPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();

  // React Query hooks
  const { data: settings, isLoading, error: settingsError } = useAppSettings(token);
  const { data: availableModels = [], isLoading: isLoadingModels, error: modelsError } = useModelsAdmin(token);
  const updateSettings = useUpdateAppSettings();

  // React Hook Form
  const {
    register,
    handleSubmit: handleFormSubmit,
    formState: { errors: formErrors },
    watch,
    setValue,
    reset,
  } = useForm<AdminAppSettingsFormData>({
    resolver: zodResolver(adminAppSettingsSchema),
    defaultValues: {
      prompt: "",
      threadTitleModel: "",
      selectedModelOption: "",
    },
  });

  // Local UI state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Watch form values
  const formValues = watch();

  // Apply settings to local state when data changes
  useEffect(() => {
    if (settings) {
      const promptValue = settings.thread_title_prompt ?? "";
      const modelValue = settings.thread_title_model ?? "";
      reset({
        prompt: promptValue,
        threadTitleModel: modelValue,
        selectedModelOption: formValues.selectedModelOption,
      });
    }
  }, [settings, reset]);

  // Handle errors from React Query
  useEffect(() => {
    if (settingsError) {
      if (isUnauthorizedError(settingsError)) {
        logout();
        setError(t("admin.appSettings.errors.sessionExpired"));
      } else {
        setError(
          settingsError instanceof Error
            ? settingsError.message
            : t("admin.appSettings.errors.loadFailed")
        );
      }
    }
  }, [settingsError, logout, t]);

  const CUSTOM_MODEL_OPTION = "__custom__";

  useEffect(() => {
    const normalizedModel = formValues.threadTitleModel?.trim() || "";
    const hasMatch = availableModels.some((model) => model.name === normalizedModel);
    if (!normalizedModel) {
      if (formValues.selectedModelOption && formValues.selectedModelOption !== CUSTOM_MODEL_OPTION) {
        setValue("selectedModelOption", "");
      }
      return;
    }
    const nextValue = hasMatch ? normalizedModel : CUSTOM_MODEL_OPTION;
    if (formValues.selectedModelOption !== nextValue) {
      setValue("selectedModelOption", nextValue);
    }
  }, [formValues.threadTitleModel, formValues.selectedModelOption, availableModels, CUSTOM_MODEL_OPTION, setValue]);

  const handleSubmit = async (data: AdminAppSettingsFormData) => {
    setError(null);
    setSuccess(null);

    if (!token) {
      setError(t("admin.appSettings.errors.sessionExpired"));
      return;
    }

    const payload: AppSettingsUpdatePayload = {
      thread_title_prompt: data.prompt.trim(),
      thread_title_model: data.threadTitleModel.trim(),
    };

    updateSettings.mutate(
      { token, payload },
      {
        onSuccess: () => {
          setSuccess(t("admin.appSettings.success.saved"));
        },
        onError: (err) => {
          if (isUnauthorizedError(err)) {
            logout();
            setError(t("admin.appSettings.errors.sessionExpired"));
          } else {
            setError(
              err instanceof Error
                ? err.message
                : t("admin.appSettings.errors.saveFailed")
            );
          }
        },
      }
    );
  };

  const handleReset = async () => {
    setError(null);
    setSuccess(null);

    if (!token) {
      setError(t("admin.appSettings.errors.sessionExpired"));
      return;
    }

    updateSettings.mutate(
      {
        token,
        payload: {
          thread_title_prompt: null,
          thread_title_model: null,
        },
      },
      {
        onSuccess: () => {
          setSuccess(t("admin.appSettings.success.reset"));
        },
        onError: (err) => {
          if (isUnauthorizedError(err)) {
            logout();
            setError(t("admin.appSettings.errors.sessionExpired"));
          } else {
            setError(
              err instanceof Error
                ? err.message
                : t("admin.appSettings.errors.resetFailed")
            );
          }
        },
      }
    );
  };

  const isBusy = isLoading || updateSettings.isPending;
  const isCustomPrompt = settings?.is_custom_thread_title_prompt ?? false;
  const defaultPrompt = settings?.default_thread_title_prompt ?? "";
  const isCustomModel = settings?.is_custom_thread_title_model ?? false;
  const defaultModel = settings?.default_thread_title_model ?? "";
  const shouldShowCustomModelInput =
    formValues.selectedModelOption === CUSTOM_MODEL_OPTION || availableModels.length === 0;
  const modelOptionsError = modelsError
    ? t("admin.appSettings.errors.threadTitleModelsLoadFailed")
    : null;

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
            <form className="admin-form" onSubmit={handleFormSubmit(handleSubmit)}>
              <label
                className="label"
                htmlFor="thread-title-model-select"
              >
                {t("admin.appSettings.threadTitle.modelLabel")}
              </label>
              <select
                id="thread-title-model-select"
                name="thread-title-model-select"
                className="input"
                {...register("selectedModelOption")}
                onChange={(event) => {
                  const value = event.target.value;
                  setValue("selectedModelOption", value);
                  if (!value || value === CUSTOM_MODEL_OPTION) {
                    return;
                  }
                  setValue("threadTitleModel", value);
                }}
                disabled={isBusy || isLoadingModels}
              >
                <option value="">
                  {isLoadingModels
                    ? t("admin.appSettings.threadTitle.modelLoadingOption")
                    : t("admin.appSettings.threadTitle.modelPlaceholder")}
                </option>
                {availableModels.map((model) => {
                  const label = model.display_name
                    ? `${model.display_name} (${model.name})`
                    : model.name;
                  return (
                    <option key={model.id} value={model.name}>
                      {label}
                    </option>
                  );
                })}
                <option value={CUSTOM_MODEL_OPTION}>
                  {t("admin.appSettings.threadTitle.modelCustomOption")}
                </option>
              </select>
              {shouldShowCustomModelInput ? (
                <label className="label" htmlFor="thread-title-model">
                  {t("admin.appSettings.threadTitle.modelCustomLabel")}
                  <input
                    id="thread-title-model"
                    name="thread-title-model"
                    className="input"
                    type="text"
                    {...register("threadTitleModel")}
                    placeholder={t(
                      "admin.appSettings.threadTitle.modelPlaceholder",
                    )}
                    disabled={isBusy}
                  />
                  {formErrors.threadTitleModel && (
                    <span className="error-message" style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                      {formErrors.threadTitleModel.message}
                    </span>
                  )}
                </label>
              ) : null}
              {modelOptionsError ? (
                <p className="admin-form__hint">{modelOptionsError}</p>
              ) : null}
              <p className="admin-form__hint">
                {t("admin.appSettings.threadTitle.modelHint")}
              </p>
              <p className="admin-form__hint">
                {isCustomModel
                  ? t("admin.appSettings.threadTitle.modelStatus.custom")
                  : t("admin.appSettings.threadTitle.modelStatus.default")}
              </p>
              <div className="admin-form__default-block" aria-live="polite">
                <strong>
                  {t("admin.appSettings.threadTitle.modelDefaultLabel")}
                </strong>
                <pre>{defaultModel}</pre>
              </div>
              <div className="admin-form__divider" aria-hidden="true" />
              <label className="label" htmlFor="thread-title-prompt">
                {t("admin.appSettings.threadTitle.fieldLabel")}
                <textarea
                  id="thread-title-prompt"
                  name="thread-title-prompt"
                  className="textarea"
                  rows={5}
                  {...register("prompt")}
                  placeholder={t(
                    "admin.appSettings.threadTitle.placeholder",
                  )}
                  disabled={isBusy}
                />
                {formErrors.prompt && (
                  <span className="error-message" style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                    {formErrors.prompt.message}
                  </span>
                )}
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
              <div className="admin-form__actions" style={{ gap: "12px" }}>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={handleReset}
                  disabled={isBusy || (!isCustomPrompt && !isCustomModel)}
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
