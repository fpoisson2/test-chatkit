import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Modal } from "../../components/Modal";
import { useI18n } from "../../i18n";

import styles from "./DocEditor.module.css";

export type DocEditorValues = {
  slug: string;
  title: string;
  summary: string;
  content: string;
};

type DocEditorProps = {
  mode: "create" | "edit";
  isOpen: boolean;
  initialValues: DocEditorValues;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (values: DocEditorValues) => void;
  onCancel: () => void;
};

const sanitizeSlug = (value: string): string => value.trim();

export const DocEditor = ({
  mode,
  isOpen,
  initialValues,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: DocEditorProps) => {
  const { t } = useI18n();
  const [values, setValues] = useState<DocEditorValues>(initialValues);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setValues(initialValues);
    setLocalError(null);
  }, [initialValues, isOpen]);

  const modalTitle = useMemo(
    () =>
      mode === "create"
        ? t("docs.editor.title.create")
        : t("docs.editor.title.edit"),
    [mode, t],
  );

  const handleChange = (key: keyof DocEditorValues, nextValue: string) => {
    setValues((previous) => ({
      ...previous,
      [key]: nextValue,
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const slug = sanitizeSlug(values.slug);

    if (mode === "create" && !slug) {
      setLocalError(t("docs.editor.error.requiredSlug"));
      return;
    }

    setLocalError(null);
    onSubmit({
      ...values,
      slug: mode === "create" ? slug : values.slug,
    });
  };

  if (!isOpen) {
    return null;
  }

  const actionLabel =
    mode === "create"
      ? isSubmitting
        ? t("docs.editor.creating")
        : t("docs.editor.actions.create")
      : isSubmitting
        ? t("docs.editor.saving")
        : t("docs.editor.actions.save");

  return (
    <Modal
      title={modalTitle}
      onClose={onCancel}
      footer={
        <div className="admin-form__actions" style={{ gap: "12px" }}>
          <button type="button" className="button button--ghost" onClick={onCancel} disabled={isSubmitting}>
            {t("docs.editor.actions.cancel")}
          </button>
          <button type="submit" className="button" form="docs-editor-form" disabled={isSubmitting}>
            {actionLabel}
          </button>
        </div>
      }
    >
      <form id="docs-editor-form" className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.fieldGroup}>
          <label className="label" htmlFor="docs-editor-slug">
            {t("docs.editor.fields.slug")}
          </label>
          <input
            id="docs-editor-slug"
            className="input"
            name="slug"
            value={values.slug}
            onChange={(event) => handleChange("slug", event.target.value)}
            disabled={mode === "edit"}
            autoComplete="off"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className="label" htmlFor="docs-editor-title">
            {t("docs.editor.fields.title")}
          </label>
          <input
            id="docs-editor-title"
            className="input"
            name="title"
            value={values.title}
            onChange={(event) => handleChange("title", event.target.value)}
            autoComplete="off"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className="label" htmlFor="docs-editor-summary">
            {t("docs.editor.fields.summary")}
          </label>
          <textarea
            id="docs-editor-summary"
            className={`textarea ${styles.summaryField}`}
            name="summary"
            value={values.summary}
            onChange={(event) => handleChange("summary", event.target.value)}
            rows={4}
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className="label" htmlFor="docs-editor-content">
            {t("docs.editor.fields.content")}
          </label>
          <textarea
            id="docs-editor-content"
            className={`textarea ${styles.contentField}`}
            name="content"
            value={values.content}
            onChange={(event) => handleChange("content", event.target.value)}
            rows={12}
          />
        </div>

        {localError ? (
          <p className={`alert alert--danger ${styles.error}`} role="alert">
            {localError}
          </p>
        ) : null}
        {error ? (
          <p className={`alert alert--danger ${styles.error}`} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
};

export default DocEditor;
