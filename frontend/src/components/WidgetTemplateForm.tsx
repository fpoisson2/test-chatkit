import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { ApiError, type WidgetTemplate } from "../utils/backend";
import { WidgetPreviewPlayground } from "./WidgetPreviewPlayground";
import { widgetTemplateFormSchema, type WidgetTemplateFormData } from "../schemas/widget";

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
  const {
    register,
    handleSubmit: rhfHandleSubmit,
    formState: { errors: formErrors, isSubmitting },
    reset,
    getValues,
    setError: setFormError,
  } = useForm<WidgetTemplateFormData>({
    resolver: zodResolver(widgetTemplateFormSchema),
    defaultValues: {
      slug: initialValue?.slug ?? "",
      title: initialValue?.title ?? "",
      description: initialValue?.description ?? "",
      definitionInput: toJson((initialValue?.definition as Record<string, unknown>) ?? DEFAULT_DEFINITION),
    },
  });

  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [previewDefinition, setPreviewDefinition] = useState<Record<string, unknown> | null>(null);
  const [isPreviewing, setPreviewing] = useState(false);

  const header = useMemo(
    () => (mode === "edit" ? `Modifier « ${initialValue?.slug ?? "widget"} »` : "Nouveau widget"),
    [initialValue?.slug, mode],
  );

  useEffect(() => {
    if (initialValue) {
      reset({
        slug: initialValue.slug,
        title: initialValue.title ?? "",
        description: initialValue.description ?? "",
        definitionInput: toJson(initialValue.definition as Record<string, unknown>),
      });
    } else if (mode === "create") {
      reset({
        slug: "",
        title: "",
        description: "",
        definitionInput: toJson(DEFAULT_DEFINITION),
      });
    }
    setError(null);
    setValidationErrors([]);
    setPreviewDefinition(null);
  }, [initialValue, mode, reset]);

  const parseDefinition = (definitionInput: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(definitionInput) as Record<string, unknown>;
    } catch (parseError) {
      setError("Impossible de parser la définition (JSON attendu).");
      return null;
    }
  };

  const handleSubmit = async (data: WidgetTemplateFormData) => {
    setError(null);
    setValidationErrors([]);

    const definition = parseDefinition(data.definitionInput);
    if (!definition) {
      return;
    }

    try {
      await onSubmit({
        slug: data.slug,
        title: data.title?.trim() ? data.title.trim() : null,
        description: data.description?.trim() ? data.description.trim() : null,
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
    }
  };

  const handlePreview = async () => {
    if (!onPreview) {
      return;
    }
    setError(null);
    setValidationErrors([]);

    const definitionInput = getValues("definitionInput");
    const definition = parseDefinition(definitionInput);
    if (!definition) {
      return;
    }

    setPreviewing(true);
    try {
      const normalized = await onPreview(definition);
      setPreviewDefinition(normalized);
    } catch (previewError) {
      setPreviewDefinition(null);
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
    <form className="flex flex-col gap-6" onSubmit={rhfHandleSubmit(handleSubmit)} aria-label={header}>
      <div>
        <h3 className="card-title">{header}</h3>
        <p className="card-subtitle">
          Décrivez votre widget ChatKit en JSON. Chaque définition est validée via <code className="code-inline">chatkit.widgets.WidgetRoot</code> avant
          d'être sauvegardée.
        </p>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {validationErrors.length > 0 && (
        <div className="alert alert-danger">
          <p>Erreurs de validation :</p>
          <ul className="pl-4">
            {validationErrors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="form-group">
        <label className="form-label">Slug (identifiant unique)</label>
        <input
          className="input"
          type="text"
          {...register("slug")}
          placeholder="ex: tableau-de-bord"
          disabled={mode === "edit"}
        />
        {formErrors.slug && <span className="form-error">{formErrors.slug.message}</span>}
      </div>
      <div className="form-group">
        <label className="form-label">Titre (optionnel)</label>
        <input
          className="input"
          type="text"
          {...register("title")}
          placeholder="Résumé commercial"
        />
        {formErrors.title && <span className="form-error">{formErrors.title.message}</span>}
      </div>
      <div className="form-group">
        <label className="form-label">Description (optionnelle)</label>
        <textarea
          className="textarea"
          rows={3}
          {...register("description")}
          placeholder="Informations supplémentaires pour l'équipe Ops"
        />
        {formErrors.description && <span className="form-error">{formErrors.description.message}</span>}
      </div>
      <div className="form-group">
        <label className="form-label">Définition JSON du widget</label>
        <textarea
          className="textarea"
          rows={14}
          {...register("definitionInput")}
          spellCheck={false}
        />
        {formErrors.definitionInput && <span className="form-error">{formErrors.definitionInput.message}</span>}
      </div>
      <div className="flex items-center justify-end gap-3">
        <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={isSubmitting || isPreviewing}>
          Annuler
        </button>
        {onPreview ? (
          <button className="btn btn-ghost" type="button" onClick={handlePreview} disabled={isPreviewing}>
            {isPreviewing ? "Validation…" : "Prévisualiser"}
          </button>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Enregistrement…" : mode === "edit" ? "Mettre à jour" : "Créer"}
        </button>
      </div>
      {previewDefinition ? (
        <section className="card mt-6">
          <div className="card-header">
            <h4 className="card-title text-lg">Prévisualisation du widget</h4>
          </div>
          <div className="card-body">
            <WidgetPreviewPlayground definition={previewDefinition} />
            <details className="accordion-item mt-6">
              <summary className="accordion-trigger cursor-pointer">Définition normalisée</summary>
              <div className="accordion-content">
                <pre className="code-block" aria-label="Prévisualisation du widget">
                  {toJson(previewDefinition)}
                </pre>
              </div>
            </details>
          </div>
        </section>
      ) : null}
    </form>
  );
};
