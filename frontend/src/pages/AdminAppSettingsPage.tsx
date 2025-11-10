import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../auth";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { useI18n } from "../i18n";
import {
  type AppSettings,
  type AppSettingsUpdatePayload,
  type AvailableModel,
  type ModelProviderUpdatePayload,
  appSettingsApi,
  isUnauthorizedError,
  modelRegistryApi,
} from "../utils/backend";

type ProviderRowState = {
  localId: string;
  id: string | null;
  provider: string;
  apiBase: string;
  apiKeyInput: string;
  hasStoredKey: boolean;
  apiKeyHint: string | null;
  isDefault: boolean;
  deleteStoredKey: boolean;
};

export const AdminAppSettingsPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [prompt, setPrompt] = useState("");
  const [threadTitleModel, setThreadTitleModel] = useState("");
  const [isLoading, setLoading] = useState(true);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [useCustomModelConfig, setUseCustomModelConfig] = useState(false);
  const [providerRows, setProviderRows] = useState<ProviderRowState[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [isLoadingModels, setLoadingModels] = useState(false);
  const [modelOptionsError, setModelOptionsError] = useState<string | null>(null);
  const promptRef = useRef("");
  const threadTitleModelRef = useRef("");
  const providerIdRef = useRef(0);
  const tRef = useRef(t);
  const logoutRef = useRef(logout);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    logoutRef.current = logout;
  }, [logout]);

  const createEmptyProviderRow = (isDefault: boolean): ProviderRowState => {
    providerIdRef.current += 1;
    return {
      localId: `new-${providerIdRef.current}`,
      id: null,
      provider: "",
      apiBase: "",
      apiKeyInput: "",
      hasStoredKey: false,
      apiKeyHint: null,
      isDefault,
      deleteStoredKey: false,
    };
  };

  const addProviderRow = () => {
    setProviderRows((rows) => {
      const nextRow = createEmptyProviderRow(rows.length === 0);
      return [...rows, nextRow];
    });
    setUseCustomModelConfig(true);
  };

  const removeProviderRow = (localId: string) => {
    setProviderRows((rows) => {
      const filtered = rows.filter((row) => row.localId !== localId);
      if (filtered.length === 0) {
        setUseCustomModelConfig(false);
        return filtered;
      }
      if (!filtered.some((row) => row.isDefault)) {
        const [first, ...rest] = filtered;
        return [{ ...first, isDefault: true }, ...rest];
      }
      return filtered;
    });
  };

  const selectDefaultProvider = (localId: string) => {
    setProviderRows((rows) =>
      rows.map((row) => ({
        ...row,
        isDefault: row.localId === localId,
      })),
    );
  };

  const mutateProviderRow = (
    localId: string,
    updater: (row: ProviderRowState) => ProviderRowState,
  ) => {
    setProviderRows((rows) =>
      rows.map((row) => (row.localId === localId ? updater(row) : row)),
    );
  };

  const applySettings = useCallback((data: AppSettings) => {
    setSettings(data);
    const promptValue = data.thread_title_prompt ?? "";
    setPrompt(promptValue);
    promptRef.current = promptValue;
    const modelValue = data.thread_title_model ?? "";
    setThreadTitleModel(modelValue);
    threadTitleModelRef.current = modelValue;
    const storedProviders = data.model_providers ?? [];
    const hasLegacyProvider =
      storedProviders.length === 0 &&
      Boolean(
        data.is_model_provider_overridden ||
          data.is_model_api_base_overridden ||
          data.is_model_api_key_managed,
      );
    const rows: ProviderRowState[] = storedProviders.map((entry) => ({
      localId: entry.id,
      id: entry.id,
      provider: entry.provider,
      apiBase: entry.api_base,
      apiKeyInput: "",
      hasStoredKey: entry.has_api_key,
      apiKeyHint: entry.api_key_hint,
      isDefault: entry.is_default,
      deleteStoredKey: false,
    }));
    if (hasLegacyProvider) {
      rows.push({
        localId: "__legacy__",
        id: "__legacy__",
        provider: (data.model_provider ?? "").trim(),
        apiBase: data.model_api_base ?? "",
        apiKeyInput: "",
        hasStoredKey: Boolean(data.is_model_api_key_managed),
        apiKeyHint: data.model_api_key_hint,
        isDefault: true,
        deleteStoredKey: false,
      });
    }
    providerIdRef.current = storedProviders.length;
    setProviderRows(rows);
    setUseCustomModelConfig(rows.length > 0);
  }, []);

  const fetchSettings = useCallback(async () => {
    if (!token) {
      setSettings(null);
      setPrompt("");
      promptRef.current = "";
      setAvailableModels([]);
      setModelOptionsError(null);
      setProviderRows([]);
      providerIdRef.current = 0;
      setUseCustomModelConfig(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await appSettingsApi.get(token);
      applySettings(data);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logoutRef.current();
        setError(tRef.current("admin.appSettings.errors.sessionExpired"));
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : tRef.current("admin.appSettings.errors.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [applySettings, token]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (!token) {
      setAvailableModels([]);
      setModelOptionsError(null);
      return;
    }

    let isActive = true;
    setLoadingModels(true);
    setModelOptionsError(null);

    void modelRegistryApi
      .listAdmin(token)
      .then((models) => {
        if (!isActive) {
          return;
        }
        setAvailableModels(models);
      })
      .catch((err) => {
        if (!isActive) {
          return;
        }
        if (isUnauthorizedError(err)) {
          logoutRef.current();
          setError(tRef.current("admin.appSettings.errors.sessionExpired"));
          return;
        }
        setAvailableModels([]);
        setModelOptionsError(
          tRef.current("admin.appSettings.errors.threadTitleModelsLoadFailed"),
        );
      })
      .finally(() => {
        if (isActive) {
          setLoadingModels(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [token]);

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

    setSaving(true);
    try {
      const payload: AppSettingsUpdatePayload = {
        thread_title_prompt: trimmed,
        thread_title_model: normalizedModel,
      };

      if (useCustomModelConfig) {
        if (providerRows.length === 0) {
          setError(t("admin.appSettings.errors.modelProvidersRequired"));
          setSaving(false);
          return;
        }
        const providersPayload: ModelProviderUpdatePayload[] = [];
        let defaultCount = 0;

        for (const row of providerRows) {
          const providerValue = row.provider.trim().toLowerCase();
          if (!providerValue) {
            setError(t("admin.appSettings.errors.modelProviderRequired"));
            setSaving(false);
            return;
          }
          const baseValue = row.apiBase.trim();
          // Validate URL only if provided (optional for LiteLLM auto-routing)
          if (baseValue) {
            try {
              const parsed = new URL(baseValue);
              if (!/^https?:$/i.test(parsed.protocol)) {
                throw new Error("invalid protocol");
              }
            } catch (error) {
              setError(t("admin.appSettings.errors.invalidModelApiBase"));
              setSaving(false);
              return;
            }
          }
          if (row.isDefault) {
            defaultCount += 1;
          }
          const trimmedKey = row.apiKeyInput.trim();
          const hasNewKey = trimmedKey.length > 0;
          // Normalize base URL only if provided (strip trailing slashes)
          const normalizedBase = baseValue ? baseValue.replace(/\/+$/, "") : "";
          const entry: ModelProviderUpdatePayload = {
            provider: providerValue,
            api_base: normalizedBase,
            is_default: row.isDefault,
          };
          if (row.id) {
            entry.id = row.id;
          }
          if (hasNewKey) {
            entry.api_key = trimmedKey;
          } else if (row.deleteStoredKey && row.hasStoredKey) {
            entry.delete_api_key = true;
          }
          providersPayload.push(entry);
        }

        if (defaultCount === 0) {
          setError(t("admin.appSettings.errors.modelDefaultRequired"));
          setSaving(false);
          return;
        }

        payload.model_providers = providersPayload;
      } else {
        payload.model_provider = null;
        payload.model_api_base = null;
        payload.model_api_key = null;
        payload.model_providers = [];
      }

      const updated = await appSettingsApi.update(token, payload);
      applySettings(updated);
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
        thread_title_model: null,
      });
      applySettings(updated);
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
  const isCustomModel = settings?.is_custom_thread_title_model ?? false;
  const defaultModel = settings?.default_thread_title_model ?? "";
  const effectiveProvider = settings?.model_provider ?? "";
  const effectiveBase = settings?.model_api_base ?? "";
  const shouldShowCustomModelInput =
    selectedModelOption === CUSTOM_MODEL_OPTION || availableModels.length === 0;

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
              <div>
                <h3 className="admin-card__title" style={{ marginBottom: "8px" }}>
                  {t("admin.appSettings.model.cardTitle")}
                </h3>
                <p className="admin-card__subtitle">
                  {t("admin.appSettings.model.cardDescription")}
                </p>
              </div>
              <label className="label" htmlFor="model-config-toggle">
                <input
                  id="model-config-toggle"
                  type="checkbox"
                  checked={useCustomModelConfig}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setUseCustomModelConfig(checked);
                    if (checked && providerRows.length === 0) {
                      setProviderRows((rows) => {
                        if (rows.length > 0) {
                          return rows;
                        }
                        return [createEmptyProviderRow(true)];
                      });
                    }
                  }}
                  disabled={isBusy}
                />
                <span>{t("admin.appSettings.model.enableCustomLabel")}</span>
              </label>
              {useCustomModelConfig ? (
                <>
                  <p className="admin-form__hint">
                    {t("admin.appSettings.model.customConfigHint")}
                  </p>
                  {providerRows.map((row) => (
                    <div key={row.localId} className="admin-provider">
                      <div className="admin-provider__header">
                        <label
                          className="label"
                          htmlFor={`provider-default-${row.localId}`}
                        >
                          <input
                            id={`provider-default-${row.localId}`}
                            type="radio"
                            name="model-provider-default"
                            checked={row.isDefault}
                            onChange={() => selectDefaultProvider(row.localId)}
                            disabled={isBusy}
                          />
                          <span>
                            {t("admin.appSettings.model.defaultProviderLabel")}
                          </span>
                        </label>
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={() => removeProviderRow(row.localId)}
                          disabled={isBusy}
                        >
                          {t("admin.appSettings.model.removeProvider")}
                        </button>
                      </div>
                      <label
                        className="label"
                        htmlFor={`provider-name-${row.localId}`}
                      >
                        {t("admin.appSettings.model.providerNameLabel")}
                        <input
                          id={`provider-name-${row.localId}`}
                          className="input"
                          type="text"
                          value={row.provider}
                          onChange={(event) =>
                            mutateProviderRow(row.localId, (current) => ({
                              ...current,
                              provider: event.target.value,
                            }))
                          }
                          placeholder={t(
                            "admin.appSettings.model.providerNamePlaceholder",
                          )}
                          disabled={isBusy}
                        />
                      </label>
                      <label
                        className="label"
                        htmlFor={`provider-base-${row.localId}`}
                      >
                        {t("admin.appSettings.model.apiBaseLabel")}
                        <input
                          id={`provider-base-${row.localId}`}
                          className="input"
                          type="text"
                          value={row.apiBase}
                          onChange={(event) =>
                            mutateProviderRow(row.localId, (current) => ({
                              ...current,
                              apiBase: event.target.value,
                            }))
                          }
                          placeholder={t(
                            "admin.appSettings.model.apiBasePlaceholder",
                          )}
                          disabled={isBusy}
                        />
                      </label>
                      <p className="admin-form__hint">
                        {t("admin.appSettings.model.apiBaseHint")}
                      </p>
                      <label
                        className="label"
                        htmlFor={`provider-key-${row.localId}`}
                      >
                        {t("admin.appSettings.model.apiKeyLabel")}
                        <input
                          id={`provider-key-${row.localId}`}
                          className="input"
                          type="password"
                          value={row.apiKeyInput}
                          onChange={(event) => {
                            const value = event.target.value;
                            mutateProviderRow(row.localId, (current) => ({
                              ...current,
                              apiKeyInput: value,
                              deleteStoredKey: value.trim()
                                ? false
                                : current.deleteStoredKey,
                            }));
                          }}
                          placeholder={t(
                            "admin.appSettings.model.apiKeyPlaceholder",
                          )}
                          disabled={isBusy}
                          autoComplete="new-password"
                        />
                      </label>
                      <p className="admin-form__hint">
                        {row.hasStoredKey &&
                        !row.deleteStoredKey &&
                        !row.apiKeyInput.trim()
                          ? t("admin.appSettings.model.apiKeyStoredHint", {
                              hint:
                                row.apiKeyHint ??
                                t(
                                  "admin.appSettings.model.apiKeyUnknownHint",
                                ),
                            })
                          : t("admin.appSettings.model.apiKeyHelp")}
                      </p>
                      {row.hasStoredKey ? (
                        <label
                          className="label"
                          htmlFor={`provider-clear-${row.localId}`}
                        >
                          <input
                            id={`provider-clear-${row.localId}`}
                            type="checkbox"
                            checked={row.deleteStoredKey}
                            onChange={(event) =>
                              mutateProviderRow(row.localId, (current) => ({
                                ...current,
                                deleteStoredKey: event.target.checked,
                              }))
                            }
                            disabled={
                              isBusy || Boolean(row.apiKeyInput.trim())
                            }
                          />
                          <span>
                            {t("admin.appSettings.model.apiKeyClearLabel")}
                          </span>
                        </label>
                      ) : null}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={addProviderRow}
                    disabled={isBusy}
                  >
                    {t("admin.appSettings.model.addProvider")}
                  </button>
                </>
              ) : (
                <p className="admin-form__hint">
                  {t("admin.appSettings.model.environmentSummary", {
                    provider:
                      effectiveProvider ||
                      t("admin.appSettings.model.providerUnknown"),
                    base:
                      effectiveBase ||
                      t("admin.appSettings.model.baseUnknown"),
                  })}
                </p>
              )}
              <div className="admin-form__divider" aria-hidden="true" />
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
