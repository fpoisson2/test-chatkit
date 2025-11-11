import { useCallback, useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "../auth";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { Modal } from "../components/Modal";
import { ResponsiveCard, FeedbackMessages, FormField, FormSection } from "../components";
import { useI18n } from "../i18n";
import {
  type AppSettings,
  type AppSettingsUpdatePayload,
  type ModelProviderUpdatePayload,
  isUnauthorizedError,
} from "../utils/backend";
import { useAppSettings, useUpdateAppSettings } from "../hooks";
import {
  adminModelProvidersSchema,
  type ModelProviderFormData,
  type ModelProviderRow,
} from "../schemas/admin";

export const AdminModelProvidersPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();
  const [showConfigModal, setShowConfigModal] = useState(false);

  // Fetch app settings using React Query
  const { data: settings = null, isLoading, error: queryError } = useAppSettings(token);
  const updateSettings = useUpdateAppSettings();

  // React Hook Form with useFieldArray
  const {
    register,
    control,
    handleSubmit: handleFormSubmit,
    formState: { errors: formErrors },
    watch,
    setValue,
    reset,
  } = useForm<ModelProviderFormData>({
    resolver: zodResolver(adminModelProvidersSchema),
    defaultValues: {
      providers: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "providers",
  });

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [useCustomModelConfig, setUseCustomModelConfig] = useState(false);
  const providerIdRef = useRef(0);
  const tRef = useRef(t);
  const logoutRef = useRef(logout);

  // Watch providers array
  const providers = watch("providers");

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    logoutRef.current = logout;
  }, [logout]);

  // Handle query error
  useEffect(() => {
    if (queryError) {
      if (isUnauthorizedError(queryError)) {
        logoutRef.current();
        setError(tRef.current("admin.appSettings.errors.sessionExpired"));
      } else {
        setError(
          queryError instanceof Error
            ? queryError.message
            : tRef.current("admin.appSettings.errors.loadFailed")
        );
      }
    }
  }, [queryError]);

  const createEmptyProviderRow = (isDefault: boolean): ModelProviderRow => {
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
    const nextRow = createEmptyProviderRow(fields.length === 0);
    append(nextRow);
    setUseCustomModelConfig(true);
  };

  const removeProviderRow = (index: number) => {
    remove(index);
    if (fields.length === 1) {
      setUseCustomModelConfig(false);
    } else if (providers && !providers.some((p: ModelProviderRow) => p.isDefault)) {
      // If we removed the default, set the first one as default
      setValue("providers.0.isDefault", true);
    }
  };

  const selectDefaultProvider = (index: number) => {
    providers?.forEach((_: ModelProviderRow, i: number) => {
      setValue(`providers.${i}.isDefault`, i === index);
    });
  };

  // Apply settings when they are loaded
  useEffect(() => {
    if (!settings) {
      reset({ providers: [] });
      providerIdRef.current = 0;
      setUseCustomModelConfig(false);
      return;
    }

    const storedProviders = settings.model_providers ?? [];
    const hasLegacyProvider =
      storedProviders.length === 0 &&
      Boolean(
        settings.is_model_provider_overridden ||
          settings.is_model_api_base_overridden ||
          settings.is_model_api_key_managed,
      );
    const rows: ModelProviderRow[] = storedProviders.map((entry) => ({
      localId: entry.id,
      id: entry.id,
      provider: entry.provider,
      apiBase: entry.api_base || "",
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
        provider: (settings.model_provider ?? "").trim(),
        apiBase: settings.model_api_base ?? "",
        apiKeyInput: "",
        hasStoredKey: Boolean(settings.is_model_api_key_managed),
        apiKeyHint: settings.model_api_key_hint,
        isDefault: true,
        deleteStoredKey: false,
      });
    }
    providerIdRef.current = storedProviders.length;
    reset({ providers: rows });
    setUseCustomModelConfig(rows.length > 0);
  }, [settings, reset]);

  const handleSubmit = async (data: ModelProviderFormData) => {
    setError(null);
    setSuccess(null);

    if (!token) {
      setError(t("admin.appSettings.errors.sessionExpired"));
      return;
    }

    try {
      const payload: AppSettingsUpdatePayload = {};

      if (useCustomModelConfig) {
        const providersPayload: ModelProviderUpdatePayload[] = [];

        for (const row of data.providers) {
          const providerValue = row.provider.trim().toLowerCase();
          const baseValue = (row.apiBase || "").trim();

          // Validate URL only if provided
          if (baseValue) {
            try {
              const parsed = new URL(baseValue);
              if (!/^https?:$/i.test(parsed.protocol)) {
                throw new Error("invalid protocol");
              }
            } catch (error) {
              setError(t("admin.appSettings.errors.invalidModelApiBase"));
              return;
            }
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

        payload.model_providers = providersPayload;
      } else {
        payload.model_provider = null;
        payload.model_api_base = null;
        payload.model_api_key = null;
        payload.model_providers = [];
      }

      await updateSettings.mutateAsync({ token, payload });
      setSuccess(t("admin.modelProviders.success.saved"));
      setShowConfigModal(false);
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
    }
  };

  const isBusy = isLoading || updateSettings.isPending;
  const effectiveProvider = settings?.model_provider ?? "";
  const effectiveBase = settings?.model_api_base ?? "";

  return (
    <ManagementPageLayout
      tabs={<AdminTabs activeTab="providers" />}
      actions={
        <button
          type="button"
          className="management-header__icon-button"
          aria-label="Configurer un fournisseur"
          title="Configurer un fournisseur"
          onClick={() => setShowConfigModal(true)}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M10 4v12M4 10h12"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      }
    >
      <FeedbackMessages
        error={error}
        success={success}
        onDismissError={() => setError(null)}
        onDismissSuccess={() => setSuccess(null)}
      />

      {showConfigModal && (
        <Modal
          title={t("admin.appSettings.model.cardTitle")}
          onClose={() => setShowConfigModal(false)}
          size="lg"
          footer={
            <>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setShowConfigModal(false)}
              >
                Annuler
              </button>
              <button
                type="submit"
                className="button"
                form="model-providers-form"
                disabled={isBusy}
              >
                {t("admin.appSettings.actions.save")}
              </button>
            </>
          }
        >
          <form id="model-providers-form" className="admin-form" onSubmit={handleFormSubmit(handleSubmit)}>
              <label className="label" htmlFor="model-config-toggle">
                <input
                  id="model-config-toggle"
                  type="checkbox"
                  checked={useCustomModelConfig}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setUseCustomModelConfig(checked);
                    if (checked && fields.length === 0) {
                      append(createEmptyProviderRow(true));
                    }
                  }}
                  disabled={isBusy}
                />
                <span>{t("admin.appSettings.model.enableCustomLabel")}</span>
              </label>
              {formErrors.providers && (
                <div className="alert alert--danger" style={{ marginTop: '0.5rem' }}>
                  {formErrors.providers.message}
                </div>
              )}
              {useCustomModelConfig ? (
                <>
                  <p className="admin-form__hint">
                    {t("admin.appSettings.model.customConfigHint")}
                  </p>
                  {fields.map((field, index) => {
                    const row = providers?.[index];
                    return (
                      <ResponsiveCard key={field.id} className="admin-provider">
                        <div className="admin-provider__header">
                          <label
                            className="label"
                            htmlFor={`provider-default-${index}`}
                          >
                            <input
                              id={`provider-default-${index}`}
                              type="radio"
                              name="model-provider-default"
                              checked={row?.isDefault || false}
                              onChange={() => selectDefaultProvider(index)}
                              disabled={isBusy}
                            />
                            <span>
                              {t("admin.appSettings.model.defaultProviderLabel")}
                            </span>
                          </label>
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() => removeProviderRow(index)}
                            disabled={isBusy}
                          >
                            {t("admin.appSettings.model.removeProvider")}
                          </button>
                        </div>

                        <FormField
                          label={t("admin.appSettings.model.providerNameLabel")}
                          error={formErrors.providers?.[index]?.provider?.message}
                        >
                          <input
                            id={`provider-name-${index}`}
                            className="input"
                            type="text"
                            {...register(`providers.${index}.provider` as const)}
                            placeholder={t(
                              "admin.appSettings.model.providerNamePlaceholder",
                            )}
                            disabled={isBusy}
                          />
                        </FormField>

                        <FormField
                          label={t("admin.appSettings.model.apiBaseLabel")}
                          hint={t("admin.appSettings.model.apiBaseHint")}
                        >
                          <input
                            id={`provider-base-${index}`}
                            className="input"
                            type="text"
                            {...register(`providers.${index}.apiBase` as const)}
                            placeholder={t(
                              "admin.appSettings.model.apiBasePlaceholder",
                            )}
                            disabled={isBusy}
                          />
                        </FormField>

                        <FormField
                          label={t("admin.appSettings.model.apiKeyLabel")}
                          hint={
                            row?.hasStoredKey &&
                            !row?.deleteStoredKey &&
                            !row?.apiKeyInput?.trim()
                              ? t("admin.appSettings.model.apiKeyStoredHint", {
                                  hint:
                                    row.apiKeyHint ??
                                    t(
                                      "admin.appSettings.model.apiKeyUnknownHint",
                                    ),
                                })
                              : t("admin.appSettings.model.apiKeyHelp")
                          }
                        >
                          <input
                            id={`provider-key-${index}`}
                            className="input"
                            type="password"
                            {...register(`providers.${index}.apiKeyInput` as const)}
                            onChange={(event) => {
                              setValue(`providers.${index}.apiKeyInput`, event.target.value);
                              if (event.target.value.trim()) {
                                setValue(`providers.${index}.deleteStoredKey`, false);
                              }
                            }}
                            placeholder={t(
                              "admin.appSettings.model.apiKeyPlaceholder",
                            )}
                            disabled={isBusy}
                            autoComplete="new-password"
                          />
                        </FormField>

                        {row?.hasStoredKey ? (
                          <label
                            className="label"
                            htmlFor={`provider-clear-${index}`}
                          >
                            <input
                              id={`provider-clear-${index}`}
                              type="checkbox"
                              {...register(`providers.${index}.deleteStoredKey` as const)}
                              disabled={
                                isBusy || Boolean(row?.apiKeyInput?.trim())
                              }
                            />
                            <span>
                              {t("admin.appSettings.model.apiKeyClearLabel")}
                            </span>
                          </label>
                        ) : null}
                      </ResponsiveCard>
                    );
                  })}
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
          </form>
        </Modal>
      )}
    </ManagementPageLayout>
  );
};

export default AdminModelProvidersPage;
