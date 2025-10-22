import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth";
import { ManagementPageLayout } from "../../components/ManagementPageLayout";
import { useI18n } from "../../i18n";
import {
  docsApi,
  isUnauthorizedError,
  type DocumentationEntry,
  type DocumentationMetadata,
} from "../../utils/backend";
import { DocEditor, type DocEditorValues } from "./DocEditor";

import styles from "./DocsPage.module.css";

const sortDocuments = (entries: DocumentationMetadata[]): DocumentationMetadata[] =>
  [...entries].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

const toMetadata = (entry: DocumentationEntry): DocumentationMetadata => ({
  slug: entry.slug,
  title: entry.title,
  summary: entry.summary,
  language: entry.language,
  created_at: entry.created_at,
  updated_at: entry.updated_at,
});

const DEFAULT_EDITOR_VALUES: DocEditorValues = {
  slug: "",
  title: "",
  summary: "",
  content: "",
};

export const DocsPage = () => {
  const { token, user, logout } = useAuth();
  const { t, language } = useI18n();
  const isAdmin = Boolean(user?.is_admin);
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentationMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditorOpen, setEditorOpen] = useState(false);
  const [editorValues, setEditorValues] = useState<DocEditorValues>(DEFAULT_EDITOR_VALUES);
  const [isSubmitting, setSubmitting] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setDocuments([]);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    docsApi
      .list(token)
      .then((items) => {
        if (!isMounted) {
          return;
        }
        setDocuments(sortDocuments(items));
      })
      .catch((err) => {
        if (!isMounted) {
          return;
        }
        if (isUnauthorizedError(err)) {
          logout();
          setError(t("docs.errors.sessionExpired"));
          return;
        }
        setError(t("docs.list.error"));
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [logout, t, token]);

  const formatDate = useCallback(
    (value: string) => {
      const parsed = Date.parse(value);
      if (Number.isNaN(parsed)) {
        return value;
      }
      return new Date(parsed).toLocaleString(language);
    },
    [language],
  );

  const handleOpenEditor = () => {
    setEditorValues(DEFAULT_EDITOR_VALUES);
    setEditorError(null);
    setEditorOpen(true);
  };

  const handleCloseEditor = () => {
    setEditorOpen(false);
    setEditorError(null);
    setSubmitting(false);
  };

  const handleCreateDocument = async (values: DocEditorValues) => {
    if (!token) {
      return;
    }

    setSubmitting(true);
    setEditorError(null);

    try {
      const created = await docsApi.create(token, {
        slug: values.slug,
        title: values.title || null,
        summary: values.summary || null,
        content_markdown: values.content || null,
      });

      setDocuments((previous) => {
        const metadata = toMetadata(created);
        const withoutDuplicate = previous.filter((item) => item.slug !== metadata.slug);
        return sortDocuments([...withoutDuplicate, metadata]);
      });

      setEditorOpen(false);
      navigate(`/docs/${created.slug}`);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setEditorOpen(false);
        return;
      }
      setEditorError(err instanceof Error ? err.message : t("docs.editor.error.unexpected"));
    } finally {
      setSubmitting(false);
    }
  };

  const renderContent = useMemo(() => {
    if (isLoading) {
      return <div className={styles.state}>{t("docs.list.loading")}</div>;
    }

    if (error) {
      return <div className={styles.state}>{error}</div>;
    }

    if (documents.length === 0) {
      return <div className={styles.state}>{t("docs.list.empty")}</div>;
    }

    return (
      <ul className={styles.list}>
        {documents.map((document) => (
          <li key={document.slug}>
            <article className={styles.card}>
              <header>
                <h2 className={styles.cardTitle}>{document.title ?? document.slug}</h2>
                {document.summary ? (
                  <p className={styles.cardSummary}>{document.summary}</p>
                ) : null}
              </header>
              <footer className={styles.cardFooter}>
                <span className={styles.cardMeta}>
                  {document.language ? (
                    <span>
                      {t("docs.list.language", {
                        language: document.language.toUpperCase(),
                      })}
                    </span>
                  ) : null}
                  <span>{t("docs.list.updatedAt", { value: formatDate(document.updated_at) })}</span>
                </span>
                <div className={styles.actions}>
                  <Link className="button button--ghost" to={`/docs/${encodeURIComponent(document.slug)}`}>
                    {t("docs.list.open")}
                  </Link>
                </div>
              </footer>
            </article>
          </li>
        ))}
      </ul>
    );
  }, [documents, error, formatDate, isLoading, t]);

  return (
    <>
      <ManagementPageLayout
        title={t("docs.title")}
        subtitle={t("docs.subtitle")}
        maxWidth="lg"
        actions={
          isAdmin ? (
            <button type="button" className="button" onClick={handleOpenEditor}>
              {t("docs.list.create")}
            </button>
          ) : null
        }
      >
        <div className={styles.pageContent}>{renderContent}</div>
      </ManagementPageLayout>
      <DocEditor
        mode="create"
        isOpen={isEditorOpen}
        initialValues={editorValues}
        isSubmitting={isSubmitting}
        error={editorError}
        onSubmit={handleCreateDocument}
        onCancel={handleCloseEditor}
      />
    </>
  );
};

export default DocsPage;
