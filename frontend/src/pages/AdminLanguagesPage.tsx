import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import {
  isUnauthorizedError,
} from "../utils/backend";

type Language = {
  code: string;
  name: string;
  translationFile: string;
  keysCount: number;
  totalKeys: number;
  fileExists: boolean;
};

type AvailableModel = {
  id: number;
  name: string;
  provider_id: string | null;
  provider_slug: string | null;
};

type Provider = {
  value: string; // Combined key "id|slug"
  id: string | null;
  slug: string | null;
  label: string;
};

type LanguageFormState = {
  code: string;
  name: string;
  model: string;
  provider_value: string; // Combined value "id|slug"
  custom_prompt: string;
  save_to_db: boolean;
};

const initialFormState: LanguageFormState = {
  code: "",
  name: "",
  model: "",
  provider_value: "",
  custom_prompt: "",
  save_to_db: false,
};

type TaskStatus = {
  task_id: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  language_id: number | null;
  can_download: boolean;
};

type StoredLanguage = {
  id: number;
  code: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export const AdminLanguagesPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();

  const [languages, setLanguages] = useState<Language[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formState, setFormState] = useState<LanguageFormState>(initialFormState);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);

  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [defaultPrompt, setDefaultPrompt] = useState<string>("");
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  // Task tracking
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(() => {
    // Restore task ID from localStorage on page load
    return localStorage.getItem('languageGenerationTaskId');
  });
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null);

  // Stored languages
  const [storedLanguages, setStoredLanguages] = useState<StoredLanguage[]>([]);
  const [loadingStored, setLoadingStored] = useState(false);

  // Persist currentTaskId to localStorage
  useEffect(() => {
    if (currentTaskId) {
      localStorage.setItem('languageGenerationTaskId', currentTaskId);
    } else {
      localStorage.removeItem('languageGenerationTaskId');
    }
  }, [currentTaskId]);

  const loadLanguages = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/languages", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (isUnauthorizedError(response.status)) {
          logout();
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setLanguages(data.languages || []);
    } catch (err) {
      console.error("Failed to load languages:", err);
      setError(t("admin.languages.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [token, logout, t]);

  const loadAvailableModels = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      const response = await fetch("/api/admin/languages/models", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (isUnauthorizedError(response.status)) {
          logout();
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setAvailableModels(data.models || []);
    } catch (err) {
      console.error("Failed to load available models:", err);
    }
  }, [token, logout]);

  const loadDefaultPrompt = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      const response = await fetch("/api/admin/languages/default-prompt", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (isUnauthorizedError(response.status)) {
          logout();
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setDefaultPrompt(data.prompt || "");
    } catch (err) {
      console.error("Failed to load default prompt:", err);
    }
  }, [token, logout]);

  const loadStoredLanguages = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoadingStored(true);

    try {
      const response = await fetch("/api/admin/languages/stored", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (isUnauthorizedError(response.status)) {
          logout();
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setStoredLanguages(data.languages || []);
    } catch (err) {
      console.error("Failed to load stored languages:", err);
    } finally {
      setLoadingStored(false);
    }
  }, [token, logout]);

  const pollTaskStatus = useCallback(async (taskId: string) => {
    if (!token) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/languages/tasks/${taskId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (isUnauthorizedError(response.status)) {
          logout();
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data: TaskStatus = await response.json();
      setTaskStatus(data);

      // Si la tâche est terminée, recharger les langues stockées
      if (data.status === "completed" || data.status === "failed") {
        setCurrentTaskId(null);
        if (data.status === "completed") {
          setSuccess(t("admin.languages.feedback.created", { name: formState.name }));
          await loadStoredLanguages();
        } else if (data.error_message) {
          setFormError(data.error_message);
        }
      }
    } catch (err) {
      console.error("Failed to poll task status:", err);
    }
  }, [token, logout, loadStoredLanguages, formState.name, t]);

  const downloadTaskResult = useCallback(async (taskId: string) => {
    if (!token) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/languages/tasks/${taskId}/download`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const contentDisposition = response.headers.get("Content-Disposition");
      const filename = contentDisposition?.match(/filename="(.+)"/)?.[1] || "translation.ts";
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Failed to download task result:", err);
      setFormError(t("admin.languages.errors.downloadFailed"));
    }
  }, [token, t]);

  const downloadStoredLanguage = useCallback(async (id: number) => {
    if (!token) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/languages/stored/${id}/download`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const contentDisposition = response.headers.get("Content-Disposition");
      const filename = contentDisposition?.match(/filename="(.+)"/)?.[1] || "translation.ts";
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Failed to download stored language:", err);
      setError(t("admin.languages.errors.downloadFailed"));
    }
  }, [token, t]);

  const deleteStoredLanguage = useCallback(async (id: number) => {
    if (!token) {
      return;
    }

    if (!confirm(t("admin.languages.confirm.delete"))) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/languages/stored/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setSuccess(t("admin.languages.feedback.deleted"));
      await loadStoredLanguages();
    } catch (err) {
      console.error("Failed to delete stored language:", err);
      setError(t("admin.languages.errors.deleteFailed"));
    }
  }, [token, loadStoredLanguages, t]);

  const activateStoredLanguage = useCallback(async (id: number, code: string, name: string) => {
    if (!token) {
      return;
    }

    if (!confirm(`Activate language ${name} (${code})? This will add it to the application and restart may be required.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/languages/stored/${id}/activate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setSuccess(data.message || `Language ${name} activated successfully. Refresh the page to see it in the language selector.`);
      await loadLanguages();
    } catch (err) {
      console.error("Failed to activate stored language:", err);
      setError(err instanceof Error ? err.message : "Failed to activate language");
    }
  }, [token, loadLanguages]);

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

  useEffect(() => {
    void loadLanguages();
    void loadAvailableModels();
    void loadDefaultPrompt();
    void loadStoredLanguages();
  }, [loadLanguages, loadAvailableModels, loadDefaultPrompt, loadStoredLanguages]);

  // Load task status on mount if a task ID exists
  useEffect(() => {
    if (currentTaskId && !taskStatus) {
      void pollTaskStatus(currentTaskId);
    }
  }, [currentTaskId, taskStatus, pollTaskStatus]);

  // Polling pour le statut de la tâche
  useEffect(() => {
    if (!currentTaskId) {
      return;
    }

    // Don't poll if task is already completed or failed
    if (taskStatus && (taskStatus.status === 'completed' || taskStatus.status === 'failed')) {
      return;
    }

    const interval = setInterval(() => {
      void pollTaskStatus(currentTaskId);
    }, 2000); // Poll toutes les 2 secondes

    // Premier poll immédiat
    void pollTaskStatus(currentTaskId);

    return () => clearInterval(interval);
  }, [currentTaskId, taskStatus, pollTaskStatus]);

  const handleFormChange = (field: keyof LanguageFormState, value: string | boolean) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
    setFormError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccess(null);
    setInstructions(null);
    setTaskStatus(null);

    if (!formState.code.trim()) {
      setFormError(t("admin.languages.errors.codeRequired"));
      return;
    }

    if (!formState.name.trim()) {
      setFormError(t("admin.languages.errors.nameRequired"));
      return;
    }

    if (!/^[a-z]{2}$/.test(formState.code.trim())) {
      setFormError(t("admin.languages.errors.codeInvalid"));
      return;
    }

    setSubmitting(true);

    try {
      const requestBody: {
        code: string;
        name: string;
        model?: string;
        provider_id?: string;
        provider_slug?: string;
        custom_prompt?: string;
        save_to_db: boolean;
      } = {
        code: formState.code.trim().toLowerCase(),
        name: formState.name.trim(),
        save_to_db: formState.save_to_db,
      };

      // Ajouter les paramètres optionnels s'ils sont fournis
      if (formState.model.trim()) {
        requestBody.model = formState.model.trim();
      }

      // Parse provider_value to extract provider_id and provider_slug
      if (formState.provider_value.trim()) {
        const selectedProvider = availableProviders.find(p => p.value === formState.provider_value);
        if (selectedProvider) {
          if (selectedProvider.id) {
            requestBody.provider_id = selectedProvider.id;
          }
          if (selectedProvider.slug) {
            requestBody.provider_slug = selectedProvider.slug;
          }
        }
      }

      if (formState.custom_prompt.trim()) {
        requestBody.custom_prompt = formState.custom_prompt.trim();
      }

      const response = await fetch("/api/admin/languages/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        if (isUnauthorizedError(response.status)) {
          logout();
          return;
        }

        const errorData = await response.json().catch(() => ({}));
        if (errorData.detail?.includes("already exist")) {
          setFormError(t("admin.languages.errors.codeExists"));
        } else {
          setFormError(t("admin.languages.errors.createFailed"));
        }
        return;
      }

      const data = await response.json();

      // L'API retourne maintenant un task_id
      setCurrentTaskId(data.task_id);
      setSuccess(t("admin.languages.feedback.taskStarted"));
      setFormState(initialFormState);
    } catch (err) {
      console.error("Failed to generate language:", err);
      setFormError(t("admin.languages.errors.createFailed"));
    } finally {
      setSubmitting(false);
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

              <form onSubmit={handleSubmit} className="admin-form">
                <div className="form-group">
                  <label htmlFor="language-code" className="form-label">
                    {t("admin.languages.form.codeLabel")}
                  </label>
                  <input
                    type="text"
                    id="language-code"
                    value={formState.code}
                    onChange={(e) => handleFormChange("code", e.target.value)}
                    placeholder={t("admin.languages.form.codePlaceholder")}
                    disabled={submitting}
                    maxLength={2}
                    className="form-input"
                    style={{ textTransform: "lowercase" }}
                  />
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
                    value={formState.name}
                    onChange={(e) => handleFormChange("name", e.target.value)}
                    placeholder={t("admin.languages.form.namePlaceholder")}
                    disabled={submitting}
                    className="form-input"
                  />
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
                    value={formState.model}
                    onChange={(e) => {
                      handleFormChange("model", e.target.value);
                    }}
                    disabled={submitting}
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
                    value={formState.provider_value}
                    onChange={(e) => handleFormChange("provider_value", e.target.value)}
                    disabled={submitting}
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
                        if (!showPromptEditor && !formState.custom_prompt && defaultPrompt) {
                          handleFormChange("custom_prompt", defaultPrompt);
                        }
                      }}
                      className="button button--sm button--secondary"
                      disabled={submitting}
                    >
                      {showPromptEditor ? t("admin.languages.form.hidePrompt") : t("admin.languages.form.showPrompt")}
                    </button>
                  </div>
                  {showPromptEditor && (
                    <>
                      <textarea
                        id="custom-prompt"
                        value={formState.custom_prompt}
                        onChange={(e) => handleFormChange("custom_prompt", e.target.value)}
                        placeholder={defaultPrompt || t("admin.languages.form.promptPlaceholder")}
                        disabled={submitting}
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
                      checked={formState.save_to_db}
                      onChange={(e) => handleFormChange("save_to_db", e.target.checked)}
                      disabled={submitting}
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
                        onClick={() => downloadTaskResult(taskStatus.task_id)}
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
                    disabled={submitting || !!currentTaskId}
                    className="button button--primary"
                  >
                    {submitting
                      ? t("admin.languages.form.creating")
                      : t("admin.languages.form.submitAdd")}
                  </button>
                  {(formState.code || formState.name) && !submitting && (
                    <button
                      type="button"
                      onClick={() => {
                        setFormState(initialFormState);
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
                <div style={{ overflowX: "auto" }}>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>{t("admin.languages.list.columns.code")}</th>
                        <th>{t("admin.languages.list.columns.name")}</th>
                        <th>{t("admin.languages.list.columns.translationFile")}</th>
                        <th>{t("admin.languages.list.columns.keysCount")}</th>
                        <th>{t("admin.languages.list.columns.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {languages.map((lang) => (
                        <tr key={lang.code}>
                          <td>
                            <code>{lang.code}</code>
                          </td>
                          <td>{lang.name}</td>
                          <td>
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
                          </td>
                          <td>
                            {lang.keysCount} / {lang.totalKeys}
                          </td>
                          <td>{getStatusLabel(lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
                <div style={{ overflowX: "auto" }}>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Name</th>
                        <th>Created At</th>
                        <th>Updated At</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storedLanguages.map((lang) => (
                        <tr key={lang.id}>
                          <td>
                            <code>{lang.code}</code>
                          </td>
                          <td>{lang.name}</td>
                          <td>{new Date(lang.created_at).toLocaleDateString()}</td>
                          <td>{new Date(lang.updated_at).toLocaleDateString()}</td>
                          <td>
                            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                              <button
                                type="button"
                                onClick={() => activateStoredLanguage(lang.id, lang.code, lang.name)}
                                className="button button--sm button--primary"
                              >
                                Activate
                              </button>
                              <button
                                type="button"
                                onClick={() => downloadStoredLanguage(lang.id)}
                                className="button button--sm button--secondary"
                              >
                                Download
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteStoredLanguage(lang.id)}
                                className="button button--sm button--danger"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      </ManagementPageLayout>
    </>
  );
};
