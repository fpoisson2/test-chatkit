import { FormEvent, useEffect, useMemo, useState } from "react";

import { ApiError, type WidgetTemplate } from "../utils/backend";

type WidgetTemplateFormProps = {
  mode: "create" | "edit";
  initialValue?: WidgetTemplate;
  onSubmit: (payload: {
    slug: string;
    title: string | null;
    description: string | null;
    definition: Record<string, unknown>;
  }) => Promise<void>;
  onCancel: () => void;
  onPreview?: (definition: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const DEFAULT_DEFINITION: Record<string, unknown> = {
  type: "Card",
  size: "lg",
  children: [
    {
      type: "Text",
      id: "title",
      value: "Titre du widget",
      weight: "semibold",
    },
  ],
};

const toJson = (value: Record<string, unknown>): string => JSON.stringify(value, null, 2);

const extractApiErrorDetails = (
  error: ApiError,
): { message?: string; errors?: string[] } => {
  const payload = error.detail;
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === "string") {
      return { message: detail };
    }
    if (detail && typeof detail === "object") {
      const obj = detail as { message?: unknown; errors?: unknown };
      return {
        message: typeof obj.message === "string" ? obj.message : undefined,
        errors: Array.isArray(obj.errors) ? obj.errors.map((entry) => String(entry)) : undefined,
      };
    }
  }
  return {};
};

export const WidgetTemplateForm = ({
  mode,
  initialValue,
  onSubmit,
  onCancel,
  onPreview,
}: WidgetTemplateFormProps) => {
  const [slug, setSlug] = useState(initialValue?.slug ?? "");
  const [title, setTitle] = useState(initialValue?.title ?? "");
  const [description, setDescription] = useState(initialValue?.description ?? "");
  const [definitionInput, setDefinitionInput] = useState(() =>
    toJson((initialValue?.definition as Record<string, unknown>) ?? DEFAULT_DEFINITION),
  );
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [previewJson, setPreviewJson] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const [isPreviewing, setPreviewing] = useState(false);

  const header = useMemo(
    () => (mode === "edit" ? `Modifier « ${initialValue?.slug ?? "widget"} »` : "Nouveau widget"),
    [initialValue?.slug, mode],
  );

  useEffect(() => {
    if (initialValue) {
      setSlug(initialValue.slug);
      setTitle(initialValue.title ?? "");
      setDescription(initialValue.description ?? "");
      setDefinitionInput(toJson(initialValue.definition as Record<string, unknown>));
    } else if (mode === "create") {
      setSlug("");
      setTitle("");
      setDescription("");
      setDefinitionInput(toJson(DEFAULT_DEFINITION));
    }
    setError(null);
    setValidationErrors([]);
    setPreviewJson(null);
  }, [initialValue, mode]);

  const parseDefinition = (): Record<string, unknown> | null => {
    if (!definitionInput.trim()) {
      setError("La définition JSON est obligatoire.");
      return null;
    }
    try {
      return JSON.parse(definitionInput) as Record<string, unknown>;
    } catch (parseError) {
      setError("Impossible de parser la définition (JSON attendu).");
      return null;
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setValidationErrors([]);

    if (!slug.trim()) {
      setError("Le slug est obligatoire.");
      return;
    }

    const definition = parseDefinition();
    if (!definition) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        slug: slug.trim(),
        title: title.trim() ? title.trim() : null,
        description: description.trim() ? description.trim() : null,
        definition,
      });
    } catch (submitError) {
      if (submitError instanceof ApiError) {
        const details = extractApiErrorDetails(submitError);
        if (details.message) {
          setError(details.message);
        }
        if (details.errors) {
          setValidationErrors(details.errors);
        }
      } else {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Impossible d'enregistrer le widget.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreview = async () => {
    if (!onPreview) {
      return;
    }
    setError(null);
    setValidationErrors([]);

    const definition = parseDefinition();
    if (!definition) {
      return;
    }

    setPreviewing(true);
    try {
      const normalized = await onPreview(definition);
      setPreviewJson(toJson(normalized));
    } catch (previewError) {
      setPreviewJson(null);
      if (previewError instanceof ApiError) {
        const details = extractApiErrorDetails(previewError);
        if (details.message) {
          setError(details.message);
        }
        if (details.errors) {
          setValidationErrors(details.errors);
        }
      } else {
        setError(
          previewError instanceof Error
            ? previewError.message
            : "Impossible de prévisualiser le widget.",
        );
      }
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <form className="admin-form" onSubmit={handleSubmit} aria-label={header}>
      <h3 className="admin-card__title">{header}</h3>
      <p className="admin-card__subtitle">
        Décrivez votre widget ChatKit en JSON. Chaque définition est validée via <code>chatkit.widgets.WidgetRoot</code> avant
        d'être sauvegardée.
      </p>
      {error ? <div className="alert alert--danger">{error}</div> : null}
      {validationErrors.length > 0 ? (
        <div className="alert alert--danger">
          <p>Erreurs de validation :</p>
          <ul>
            {validationErrors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <label className="label">
        Slug (identifiant unique)
        <input
          className="input"
          type="text"
          required
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          placeholder="ex: tableau-de-bord"
          disabled={mode === "edit"}
        />
      </label>
      <label className="label">
        Titre (optionnel)
        <input
          className="input"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Résumé commercial"
        />
      </label>
      <label className="label">
        Description (optionnelle)
        <textarea
          className="textarea"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Informations supplémentaires pour l'équipe Ops"
        />
      </label>
      <label className="label">
        Définition JSON du widget
        <textarea
          className="textarea"
          rows={14}
          value={definitionInput}
          onChange={(event) => setDefinitionInput(event.target.value)}
          spellCheck={false}
        />
      </label>
      <div className="admin-form__actions">
        <button className="button button--subtle" type="button" onClick={onCancel} disabled={isSubmitting || isPreviewing}>
          Annuler
        </button>
        {onPreview ? (
          <button className="button button--ghost" type="button" onClick={handlePreview} disabled={isPreviewing}>
            {isPreviewing ? "Validation…" : "Prévisualiser"}
          </button>
        ) : null}
        <button className="button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Enregistrement…" : mode === "edit" ? "Mettre à jour" : "Créer"}
        </button>
      </div>
      {previewJson ? (
        <details className="accordion" open>
          <summary>Définition normalisée</summary>
          <pre className="code-block" aria-label="Prévisualisation du widget">
            {previewJson}
          </pre>
        </details>
      ) : null}
    </form>
  );
};
