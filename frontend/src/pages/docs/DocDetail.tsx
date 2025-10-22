import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";

import { useAuth } from "../../auth";
import { ManagementPageLayout } from "../../components/ManagementPageLayout";
import { useI18n } from "../../i18n";
import {
  ApiError,
  docsApi,
  isUnauthorizedError,
  type DocumentationEntry,
} from "../../utils/backend";
import { DocEditor, type DocEditorValues } from "./DocEditor";

import styles from "./DocDetail.module.css";

export const DocDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { token, user, logout } = useAuth();
  const { t, language } = useI18n();
  const isAdmin = Boolean(user?.is_admin);
  const [document, setDocument] = useState<DocumentationEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditorOpen, setEditorOpen] = useState(false);
  const [editorValues, setEditorValues] = useState<DocEditorValues>({
    slug: slug ?? "",
    title: "",
    summary: "",
    content: "",
  });
  const [isSubmitting, setSubmitting] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !slug) {
      setIsLoading(false);
      setError(t("docs.detail.missing"));
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    docsApi
      .get(token, slug)
      .then((entry) => {
        if (!isMounted) {
          return;
        }
        setDocument(entry);
        setEditorValues({
          slug: entry.slug,
          title: entry.title ?? "",
          summary: entry.summary ?? "",
          content: entry.content_markdown ?? "",
        });
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
        if (err instanceof ApiError && err.status === 404) {
          setError(t("docs.detail.missing"));
          return;
        }
        setError(t("docs.detail.error"));
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [logout, slug, t, token]);

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
    if (!document) {
      return;
    }
    setEditorValues({
      slug: document.slug,
      title: document.title ?? "",
      summary: document.summary ?? "",
      content: document.content_markdown ?? "",
    });
    setEditorError(null);
    setEditorOpen(true);
  };

  const handleCloseEditor = () => {
    setEditorOpen(false);
    setEditorError(null);
    setSubmitting(false);
  };

  const handleUpdateDocument = async (values: DocEditorValues) => {
    if (!token || !slug) {
      return;
    }
    setSubmitting(true);
    setEditorError(null);
    try {
      const updated = await docsApi.update(token, slug, {
        title: values.title || null,
        summary: values.summary || null,
        content_markdown: values.content || null,
      });
      setDocument(updated);
      setEditorValues({
        slug: updated.slug,
        title: updated.title ?? "",
        summary: updated.summary ?? "",
        content: updated.content_markdown ?? "",
      });
      setEditorOpen(false);
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

  const handleDelete = async () => {
    if (!token || !slug || !document) {
      return;
    }
    const confirmationLabel = t("docs.detail.delete.confirm", {
      title: document.title ?? document.slug,
    });
    if (!window.confirm(confirmationLabel)) {
      return;
    }
    try {
      await docsApi.delete(token, slug);
      navigate("/docs");
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        return;
      }
      setError(err instanceof Error ? err.message : t("docs.detail.error"));
    }
  };

  const actions = useMemo(
    () => (
      <div className={styles.actions}>
        <Link className="button button--ghost" to="/docs">
          {t("docs.detail.back")}
        </Link>
        {isAdmin ? (
          <>
            <button type="button" className="button button--ghost" onClick={handleOpenEditor} disabled={isLoading || Boolean(error)}>
              {t("docs.detail.edit")}
            </button>
            <button type="button" className="button button--danger" onClick={handleDelete} disabled={isLoading || Boolean(error)}>
              {t("docs.detail.delete")}
            </button>
          </>
        ) : null}
      </div>
    ),
    [error, handleDelete, handleOpenEditor, isAdmin, isLoading, t],
  );

  const body = useMemo(() => {
    if (isLoading) {
      return <div className={styles.state}>{t("docs.detail.loading")}</div>;
    }
    if (error) {
      return <div className={styles.state}>{error}</div>;
    }
    if (!document) {
      return <div className={styles.state}>{t("docs.detail.missing")}</div>;
    }

    return (
      <div className={styles.wrapper}>
        <div className={styles.meta}>
          {document.language ? (
            <span>
              {t("docs.detail.language", { language: document.language.toUpperCase() })}
            </span>
          ) : null}
          <span>{t("docs.detail.updatedAt", { value: formatDate(document.updated_at) })}</span>
        </div>
        <div className={styles.content}>
          {document.content_markdown ? (
            <ReactMarkdown>{document.content_markdown}</ReactMarkdown>
          ) : (
            <p className={styles.emptyContent}>{t("docs.detail.empty")}</p>
          )}
        </div>
      </div>
    );
  }, [document, error, formatDate, isLoading, t]);

  return (
    <>
      <ManagementPageLayout
        title={document?.title ?? slug ?? t("docs.detail.fallbackTitle")}
        subtitle={document?.summary ?? undefined}
        maxWidth="lg"
        actions={actions}
      >
        {body}
      </ManagementPageLayout>
      <DocEditor
        mode="edit"
        isOpen={isEditorOpen}
        initialValues={editorValues}
        isSubmitting={isSubmitting}
        error={editorError}
        onSubmit={handleUpdateDocument}
        onCancel={handleCloseEditor}
      />
    </>
  );
};

export default DocDetail;
