import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { ResponsiveTable, type Column } from "../components";
import { isUnauthorizedError } from "../utils/backend";
import {
  useLanguages,
  useAvailableModels,
  useDefaultPrompt,
  useStoredLanguages,
  useTaskStatus,
  useGenerateLanguage,
  useDeleteStoredLanguage,
  useActivateStoredLanguage,
  downloadTaskResult,
  downloadStoredLanguage,
  type Language,
  type StoredLanguage,
} from "../hooks";
import { adminLanguageSchema, type AdminLanguageFormData } from "../schemas/admin";

type Provider = {
  value: string; // Combined key "id|slug"
  id: string | null;
  slug: string | null;
  label: string;
};

const initialFormState: AdminLanguageFormData = {
  code: "",
  name: "",
  model: "",
  provider_value: "",
  custom_prompt: "",
  save_to_db: false,
};

export const AdminLanguagesPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();

  // React Query hooks
  const { data: languages = [], isLoading: loading } = useLanguages(token);
  const { data: availableModels = [] } = useAvailableModels(token);
  const { data: defaultPrompt = "" } = useDefaultPrompt(token);
  const { data: storedLanguages = [], isLoading: loadingStored } = useStoredLanguages(token);

  const generateLanguage = useGenerateLanguage();
  const deleteStoredLanguageMutation = useDeleteStoredLanguage();
  const activateStoredLanguageMutation = useActivateStoredLanguage();

  // React Hook Form
  const {
    register,
    handleSubmit: handleFormSubmit,
    formState: { errors: formErrors },
    watch,
    setValue,
    reset,
  } = useForm<AdminLanguageFormData>({
    resolver: zodResolver(adminLanguageSchema),
    defaultValues: initialFormState,
  });

  // Watch form values
  const formValues = watch();

  // Task tracking
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(() => {
    return localStorage.getItem('languageGenerationTaskId');
  });
  const { data: taskStatus = null } = useTaskStatus(token, currentTaskId);

  // Local state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  // Persist currentTaskId to localStorage
  useEffect(() => {
    if (currentTaskId) {
      localStorage.setItem('languageGenerationTaskId', currentTaskId);
    } else {
      localStorage.removeItem('languageGenerationTaskId');
    }
  }, [currentTaskId]);

  // Clear task ID when task completes or fails
  useEffect(() => {
    if (taskStatus?.status === "completed" || taskStatus?.status === "failed") {
      if (taskStatus.status === "completed") {
        setSuccess(t("admin.languages.feedback.created", { name: formValues.name }));
      } else if (taskStatus.error_message) {
        setFormError(taskStatus.error_message);
      }
      setCurrentTaskId(null);
    }
  }, [taskStatus, formValues.name, t]);

  const handleDownloadTaskResult = useCallback(async (taskId: string) => {
    try {
      await downloadTaskResult(token, taskId);
    } catch (err) {
      console.error("Failed to download task result:", err);
      setFormError(t("admin.languages.errors.downloadFailed"));
    }
  }, [token, t]);

  const handleDownloadStoredLanguage = useCallback(async (id: number) => {
    try {
      await downloadStoredLanguage(token, id);
    } catch (err) {
      console.error("Failed to download stored language:", err);
      setError(t("admin.languages.errors.downloadFailed"));
    }
  }, [token, t]);

  const handleDeleteStoredLanguage = useCallback(async (id: number) => {
    if (!confirm(t("admin.languages.confirm.delete"))) {
      return;
    }

    try {
      await deleteStoredLanguageMutation.mutateAsync({ token, id });
      setSuccess(t("admin.languages.feedback.deleted"));
    } catch (err) {
      console.error("Failed to delete stored language:", err);
      setError(t("admin.languages.errors.deleteFailed"));
    }
  }, [token, deleteStoredLanguageMutation, t]);

  const handleActivateStoredLanguage = useCallback(async (id: number, code: string, name: string) => {
    if (!confirm(`Activate language ${name} (${code})? This will add it to the application and restart may be required.`)) {
      return;
    }

    try {
      const data = await activateStoredLanguageMutation.mutateAsync({ token, id });
      setSuccess(data.message || `Language ${name} activated successfully. Refresh the page to see it in the language selector.`);
    } catch (err) {
      console.error("Failed to activate stored language:", err);
      setError(err instanceof Error ? err.message : "Failed to activate language");
    }
  }, [token, activateStoredLanguageMutation]);

  // Extract unique providers from available models
  const availableProviders = useMemo(() => {
    const seen = new Set<string>();
    const providers: Provider[] = [];

    for (const model of availableModels) {
      const slug = model.provider_slug?.trim().toLowerCase() ?? "";
      const id = model.provider_id?.trim() ?? "";

      if (!slug && !id) {
        continue;
      }

      const key = `${id}|${slug}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      const baseLabel = slug || id || "provider";
      const label = slug && id ? `${slug} (${id})` : baseLabel;

      providers.push({
        value: key,
        id: id || null,
        slug: slug || null,
        label
      });
    }

    return providers.sort((a, b) => a.label.localeCompare(b.label));
  }, [availableModels]);


  const handleSubmit = async (data: AdminLanguageFormData) => {
    setFormError(null);
    setSuccess(null);
    setInstructions(null);

    try {
      const payload: {
        code: string;
        name: string;
        model?: string;
        provider_id?: string;
        provider_slug?: string;
        custom_prompt?: string;
        save_to_db: boolean;
      } = {
        code: data.code.trim().toLowerCase(),
        name: data.name.trim(),
        save_to_db: data.save_to_db,
      };

      // Add optional parameters if provided
      if (data.model?.trim()) {
        payload.model = data.model.trim();
      }

      // Parse provider_value to extract provider_id and provider_slug
      if (data.provider_value?.trim()) {
        const selectedProvider = availableProviders.find(p => p.value === data.provider_value);
        if (selectedProvider) {
          if (selectedProvider.id) {
            payload.provider_id = selectedProvider.id;
          }
          if (selectedProvider.slug) {
            payload.provider_slug = selectedProvider.slug;
          }
        }
      }

      if (data.custom_prompt?.trim()) {
        payload.custom_prompt = data.custom_prompt.trim();
      }

      const result = await generateLanguage.mutateAsync({ token, payload });

      // Set the task ID to start polling
      setCurrentTaskId(result.task_id);
      setSuccess(t("admin.languages.feedback.taskStarted"));
      reset(initialFormState);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        return;
      }

      if (err instanceof Error) {
        if (err.message.includes("already exist")) {
          setFormError(t("admin.languages.errors.codeExists"));
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError(t("admin.languages.errors.createFailed"));
      }
    }
  };

  const getStatusLabel = (lang: Language): string => {
    if (!lang.fileExists) {
      return t("admin.languages.list.status.empty");
    }
    if (lang.keysCount === lang.totalKeys) {
      return t("admin.languages.list.status.complete");
    }
    const percent = Math.round((lang.keysCount / lang.totalKeys) * 100);
    return t("admin.languages.list.status.partial", { percent });
  };

  const languageColumns = useMemo<Column<Language>[]>(
    () => [
      {
        key: "code",
        label: t("admin.languages.list.columns.code"),
        render: (lang) => <code>{lang.code}</code>,
      },
      {
        key: "name",
        label: t("admin.languages.list.columns.name"),
        render: (lang) => lang.name,
      },
      {
        key: "file",
        label: t("admin.languages.list.columns.translationFile"),
        render: (lang) => (
          <>
            <code style={{ fontSize: "0.875rem" }}>{lang.translationFile}</code>
            <br />
            <small
              style={{
                color: lang.fileExists
                  ? "var(--color-success)"
                  : "var(--color-danger)",
              }}
            >
              {lang.fileExists
                ? t("admin.languages.list.fileExists")
                : t("admin.languages.list.fileMissing")}
            </small>
          </>
        ),
      },
      {
        key: "keys",
        label: t("admin.languages.list.columns.keysCount"),
        render: (lang) => `${lang.keysCount} / ${lang.totalKeys}`,
      },
      {
        key: "status",
        label: t("admin.languages.list.columns.status"),
        render: (lang) => getStatusLabel(lang),
      },
    ],
    [getStatusLabel, t],
  );

  const storedLanguageColumns = useMemo<Column<StoredLanguage>[]>(
    () => [
      {
        key: "code",
        label: "Code",
        render: (lang) => <code>{lang.code}</code>,
      },
      {
        key: "name",
        label: "Name",
        render: (lang) => lang.name,
      },
      {
        key: "created",
        label: "Created At",
        render: (lang) => new Date(lang.created_at).toLocaleDateString(),
      },
      {
        key: "updated",
        label: "Updated At",
        render: (lang) => new Date(lang.updated_at).toLocaleDateString(),
      },
      {
        key: "actions",
        label: "Actions",
        render: (lang) => (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => handleActivateStoredLanguage(lang.id, lang.code, lang.name)}
              className="button button--sm button--primary"
            >
              Activate
            </button>
            <button
              type="button"
              onClick={() => handleDownloadStoredLanguage(lang.id)}
              className="button button--sm button--ghost"
            >
              Download
            </button>
            <button
              type="button"
              onClick={() => handleDeleteStoredLanguage(lang.id)}
              className="button button--sm button--danger"
            >
              Delete
            </button>
          </div>
        ),
      },
    ],
    [handleActivateStoredLanguage, handleDeleteStoredLanguage, handleDownloadStoredLanguage],
  );

  return (
    <>
      <AdminTabs activeTab="languages" />
      <ManagementPageLayout>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "2rem" }}>
          <header style={{ marginBottom: "2rem" }}>
            <h1 style={{ fontSize: "2rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              {t("admin.languages.page.title")}
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
              {t("admin.languages.page.subtitle")}
            </p>
          </header>

          {error && (
            <div className="alert alert--danger" role="alert" style={{ marginBottom: "1.5rem" }}>
              {error}
            </div>
          )}

          {success && (
            <div className="alert alert--success" role="alert" style={{ marginBottom: "1.5rem" }}>
              {success}
            </div>
          )}

          {instructions && (
            <div className="alert alert--info" role="alert" style={{ marginBottom: "1.5rem", whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: "0.875rem" }}>
              {instructions}
            </div>
          )}

          <div className="admin-grid">
            {/* Generate Language Form */}
            <section className="admin-card">
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
                {t("admin.languages.form.addTitle")}
              </h2>

              {formError && (
                <div className="alert alert--danger" role="alert" style={{ marginBottom: "1rem" }}>
                  {formError}
                </div>
              )}

              <form onSubmit={handleFormSubmit(handleSubmit)} className="admin-form">
                <div className="form-group">
                  <label htmlFor="language-code" className="form-label">
                    {t("admin.languages.form.codeLabel")}
                  </label>
                  <input
                    type="text"
                    id="language-code"
                    {...register("code")}
                    placeholder={t("admin.languages.form.codePlaceholder")}
                    disabled={generateLanguage.isPending}
                    maxLength={2}
                    className="form-input"
                    style={{ textTransform: "lowercase" }}
                  />
                  {formErrors.code && (
                    <span className="error-message" style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.25rem', display: 'block' }}>
                      {formErrors.code.message}
                    </span>
                  )}
                  <small style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    {t("admin.languages.form.codeHint")}
                  </small>
                </div>

                <div className="form-group">
                  <label htmlFor="language-name" className="form-label">
                    {t("admin.languages.form.nameLabel")}
                  </label>
                  <input
                    type="text"
                    id="language-name"
                    {...register("name")}
                    placeholder={t("admin.languages.form.namePlaceholder")}
                    disabled={generateLanguage.isPending}
                    className="form-input"
                  />
                  {formErrors.name && (
                    <span className="error-message" style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.25rem', display: 'block' }}>
                      {formErrors.name.message}
                    </span>
                  )}
                  <small style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    {t("admin.languages.form.nameHint")}
                  </small>
                </div>

                <div className="form-group">
                  <label htmlFor="model-select" className="form-label">
                    {t("admin.languages.form.modelLabel")}
                  </label>
                  <select
                    id="model-select"
                    {...register("model")}
                    disabled={generateLanguage.isPending}
                    className="form-input"
                  >
                    <option value="">{t("admin.languages.form.modelPlaceholder")}</option>
                    {availableModels.map((model) => (
                      <option key={model.id} value={model.name}>
                        {model.name}{model.provider_slug ? ` (${model.provider_slug})` : ''}
                      </option>
                    ))}
                  </select>
                  <small style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    {t("admin.languages.form.modelHint")}
                  </small>
                </div>

                <div className="form-group">
                  <label htmlFor="provider-select" className="form-label">
                    {t("admin.languages.form.providerLabel")}
                  </label>
                  <select
                    id="provider-select"
                    {...register("provider_value")}
                    disabled={generateLanguage.isPending}
                    className="form-input"
                  >
                    <option value="">{t("admin.languages.form.providerPlaceholder")}</option>
                    {availableProviders.map((provider) => (
                      <option key={provider.value} value={provider.value}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                  <small style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    {t("admin.languages.form.providerHint")}
                  </small>
                </div>

                <div className="form-group">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                    <label htmlFor="custom-prompt" className="form-label" style={{ margin: 0 }}>
                      {t("admin.languages.form.promptLabel")}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPromptEditor(!showPromptEditor);
                        if (!showPromptEditor && !formValues.custom_prompt && defaultPrompt) {
                          setValue("custom_prompt", defaultPrompt);
                        }
                      }}
                      className="button button--sm button--secondary"
                      disabled={generateLanguage.isPending}
                    >
                      {showPromptEditor ? t("admin.languages.form.hidePrompt") : t("admin.languages.form.showPrompt")}
                    </button>
                  </div>
                  {showPromptEditor && (
                    <>
                      <textarea
                        id="custom-prompt"
                        {...register("custom_prompt")}
                        placeholder={defaultPrompt || t("admin.languages.form.promptPlaceholder")}
                        disabled={generateLanguage.isPending}
                        className="form-input"
                        rows={12}
                        style={{ fontFamily: "monospace", fontSize: "0.875rem" }}
                      />
                      <small style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                        {t("admin.languages.form.promptHint")}
                      </small>
                    </>
                  )}
                </div>

                <div className="form-group">
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      {...register("save_to_db")}
                      disabled={generateLanguage.isPending}
                    />
                    <span>Save to database</span>
                  </label>
                  <small style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    Store the generated translation in the database for later reuse
                  </small>
                </div>

                {/* Progress bar */}
                {taskStatus && (
                  <div className="alert alert--info" style={{ marginTop: "1rem" }}>
                    <div style={{ marginBottom: "0.5rem" }}>
                      <strong>Status:</strong> {taskStatus.status} ({taskStatus.progress}%)
                    </div>
                    <div style={{ height: "8px", background: "var(--surface-2)", borderRadius: "4px", overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${taskStatus.progress}%`,
                          background: taskStatus.status === "failed" ? "var(--color-danger)" : "var(--color-primary)",
                          transition: "width 0.3s ease"
                        }}
                      />
                    </div>
                    {taskStatus.error_message && (
                      <div style={{ marginTop: "0.5rem", color: "var(--color-danger)" }}>
                        <strong>Error:</strong> {taskStatus.error_message}
                      </div>
                    )}
                    {taskStatus.can_download && (
                      <button
                        type="button"
                        onClick={() => handleDownloadTaskResult(taskStatus.task_id)}
                        className="button button--sm button--secondary"
                        style={{ marginTop: "0.5rem" }}
                      >
                        Download Result
                      </button>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button
                    type="submit"
                    disabled={generateLanguage.isPending || !!currentTaskId}
                    className="button button--primary"
                  >
                    {generateLanguage.isPending
                      ? t("admin.languages.form.creating")
                      : t("admin.languages.form.submitAdd")}
                  </button>
                  {(formValues.code || formValues.name) && !generateLanguage.isPending && (
                    <button
                      type="button"
                      onClick={() => {
                        reset(initialFormState);
                        setFormError(null);
                        setInstructions(null);
                      }}
                      className="button button--secondary"
                    >
                      {t("admin.languages.form.cancel")}
                    </button>
                  )}
                </div>
              </form>
            </section>

            {/* Languages List */}
            <section className="admin-card">
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                {t("admin.languages.list.title")}
              </h2>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
                {t("admin.languages.list.subtitle")}
              </p>

              {loading ? (
                <p style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
                  {t("admin.languages.list.loading")}
                </p>
              ) : (
                <ResponsiveTable
                  columns={languageColumns}
                  data={languages}
                  keyExtractor={(lang) => lang.code}
                  mobileCardView={true}
                />
              )}
            </section>

            {/* Stored Languages */}
            <section className="admin-card">
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                Stored Languages
              </h2>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
                Languages saved in the database
              </p>

              {loadingStored ? (
                <p style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
                  Loading stored languages...
                </p>
              ) : storedLanguages.length === 0 ? (
                <p style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
                  No stored languages yet. Enable "Save to database" when generating a language.
                </p>
              ) : (
                <ResponsiveTable
                  columns={storedLanguageColumns}
                  data={storedLanguages}
                  keyExtractor={(lang) => lang.id.toString()}
                  mobileCardView={true}
                />
              )}
            </section>
          </div>
        </div>
      </ManagementPageLayout>
    </>
  );
};
