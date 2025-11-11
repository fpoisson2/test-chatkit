import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

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

export const AdminAppSettingsPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();

  // React Query hooks
  const { data: settings, isLoading, error: settingsError } = useAppSettings(token);
  const { data: availableModels = [], isLoading: isLoadingModels, error: modelsError } = useModelsAdmin(token);
  const updateSettings = useUpdateAppSettings();

  // Local UI state
  const [prompt, setPrompt] = useState("");
  const [threadTitleModel, setThreadTitleModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const promptRef = useRef("");
  const threadTitleModelRef = useRef("");

  // Apply settings to local state when data changes
  useEffect(() => {
    if (settings) {
      const promptValue = settings.thread_title_prompt ?? "";
      setPrompt(promptValue);
      promptRef.current = promptValue;
      const modelValue = settings.thread_title_model ?? "";
      setThreadTitleModel(modelValue);
      threadTitleModelRef.current = modelValue;
    }
  }, [settings]);

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
  const [selectedModelOption, setSelectedModelOption] = useState("");

  useEffect(() => {
    const normalizedModel = threadTitleModel.trim();
    const hasMatch = availableModels.some((model) => model.name === normalizedModel);
    if (!normalizedModel) {
      setSelectedModelOption((current) => {
        if (!current || current === CUSTOM_MODEL_OPTION) {
          return current;
        }
        return "";
      });
      return;
    }
    const nextValue = hasMatch ? normalizedModel : CUSTOM_MODEL_OPTION;
    setSelectedModelOption((current) =>
      current === nextValue ? current : nextValue,
    );
  }, [threadTitleModel, availableModels, CUSTOM_MODEL_OPTION]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!token) {
      setError(t("admin.appSettings.errors.sessionExpired"));
      return;
    }

    const trimmed = promptRef.current.trim();
    if (!trimmed) {
      setError(t("admin.appSettings.errors.promptRequired"));
      return;
    }

    const normalizedModel = threadTitleModelRef.current.trim();
    if (!normalizedModel) {
      setError(t("admin.appSettings.errors.threadTitleModelRequired"));
      return;
    }

    const payload: AppSettingsUpdatePayload = {
      thread_title_prompt: trimmed,
      thread_title_model: normalizedModel,
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
    selectedModelOption === CUSTOM_MODEL_OPTION || availableModels.length === 0;
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
            <form className="admin-form" onSubmit={handleSubmit}>
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
                value={selectedModelOption}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedModelOption(value);
                  if (!value || value === CUSTOM_MODEL_OPTION) {
                    return;
                  }
                  setThreadTitleModel(value);
                  threadTitleModelRef.current = value;
                }}
                disabled={isBusy || isLoadingModels}
              >
                <option value="" disabled>
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
                    value={threadTitleModel}
                    onChange={(event) => {
                      setThreadTitleModel(event.target.value);
                      threadTitleModelRef.current = event.target.value;
                    }}
                    placeholder={t(
                      "admin.appSettings.threadTitle.modelPlaceholder",
                    )}
                    disabled={isBusy}
                  />
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
                  value={prompt}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    promptRef.current = event.target.value;
                  }}
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
