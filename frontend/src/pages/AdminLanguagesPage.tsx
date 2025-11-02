import {
  FormEvent,
  useCallback,
  useEffect,
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

type LanguageFormState = {
  code: string;
  name: string;
};

const initialFormState: LanguageFormState = {
  code: "",
  name: "",
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

  useEffect(() => {
    void loadLanguages();
  }, [loadLanguages]);

  const handleFormChange = (field: keyof LanguageFormState, value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
    setFormError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccess(null);
    setInstructions(null);

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
      const response = await fetch("/api/admin/languages/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: formState.code.trim().toLowerCase(),
          name: formState.name.trim(),
        }),
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

      // Télécharger le fichier généré
      const blob = new Blob([data.content], { type: "text/typescript" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setSuccess(t("admin.languages.feedback.created", { name: formState.name }));
      setInstructions(data.instructions);
      setFormState(initialFormState);
      await loadLanguages();
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

                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button
                    type="submit"
                    disabled={submitting}
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
          </div>
        </div>
      </ManagementPageLayout>
    </>
  );
};
